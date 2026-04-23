/**
 * linkChecker.ts
 * PhishScope+ content script — injected into every http/https page.
 *
 * Displays a floating risk tooltip when the user hovers over any hyperlink.
 * The tooltip shows the heuristic risk level, score, domain, HTTPS status,
 * and up to 3 triggered risk factor tags.
 *
 * Results are cached in memory for the lifetime of the page to avoid
 * repeated network calls for the same URL. Only the lightweight /analyse-url
 * endpoint is used — no sandbox or summarise call is made from here.
 */

import { BACKEND } from '../config';

/**
 * Short human-readable labels for each heuristic factor key.
 * Shown as compact tags inside the tooltip.
 */
const FACTOR_LABELS: Record<string, string> = {
  ip_in_url:            'Raw IP address',
  no_https:             'No HTTPS',
  suspicious_tld:       'Suspicious TLD',
  brand_token_mismatch: 'Brand impersonation',
  homoglyph_domain:     'Lookalike domain (IDN)',
  at_symbol:            '@ symbol in URL',
  many_subdomains:      'Excessive subdomains',
  excessive_length:     'URL too long',
  deep_path:            'Deep URL path',
  hyphen_domain:        'Hyphen-heavy domain',
  digits_in_domain:     'Numeric domain',
  invalid_url:          'Malformed URL',
};

/** Subset of HeuristicResult fields needed by the tooltip. */
interface HeuristicResult {
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  domain: string;
  isHttps: boolean;
  factors: string[];
}

/** In-page URL → heuristic result cache. Cleared on page unload. */
const cache = new Map<string, HeuristicResult>();

/** URLs whose heuristic is currently being fetched (prevents duplicate requests). */
const inFlight = new Set<string>();

/** Colour scheme for each risk level. */
const RISK = {
  low:    { color: '#4ade80', border: '#16a34a', label: 'LOW RISK' },
  medium: { color: '#fbbf24', border: '#d97706', label: 'MEDIUM RISK' },
  high:   { color: '#f87171', border: '#dc2626', label: 'HIGH RISK' },
};

// ── Tooltip element ──────────────────────────────────────────────────────────

/** Singleton tooltip <div> appended to <html> (not <body>) to survive body replacements. */
let tooltip: HTMLDivElement | null = null;

/**
 * Returns the singleton tooltip element, creating it on first call.
 * Appended to `document.documentElement` (the <html> element) so it survives
 * any JS that replaces document.body.
 */
function getTooltip(): HTMLDivElement {
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.setAttribute('id', 'phishscope-tooltip');
    tooltip.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'background:#0f172a',
      'border:1px solid #334155',
      'border-radius:8px',
      'padding:8px 12px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:12px',
      'color:#e2e8f0',
      'pointer-events:none',
      'box-shadow:0 4px 20px rgba(0,0,0,0.6)',
      'min-width:160px',
      'max-width:280px',
      'display:none',
      'line-height:1.4',
    ].join(';');
    document.documentElement.appendChild(tooltip);
  }
  return tooltip;
}

/**
 * Positions the tooltip near the cursor while keeping it inside the viewport.
 * Flips the tooltip to the left or above the cursor if it would overflow.
 *
 * @param x - Cursor clientX position.
 * @param y - Cursor clientY position.
 */
function positionTooltip(x: number, y: number) {
  const el = getTooltip();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = el.offsetWidth || 200;
  const h = el.offsetHeight || 80;

  const left = x + 14 + w > vw ? x - w - 10 : x + 14;
  const top  = y + 14 + h > vh ? y - h - 10 : y + 14;

  el.style.left = left + 'px';
  el.style.top  = top + 'px';
}

/**
 * Shows the tooltip in a "Checking link…" loading state at the cursor position.
 * Displayed while waiting for the heuristic API response.
 *
 * @param x - Cursor clientX position.
 * @param y - Cursor clientY position.
 */
function showLoading(x: number, y: number) {
  const el = getTooltip();
  el.innerHTML = '<span style="color:#64748b;font-size:11px">Checking link…</span>';
  el.style.display = 'block';
  positionTooltip(x, y);
}

/**
 * Populates and shows the tooltip with the heuristic result for a URL.
 * Displays risk level, score, domain, HTTPS status, and up to 3 factor tags.
 *
 * @param data - Heuristic result from the backend.
 * @param x    - Cursor clientX position.
 * @param y    - Cursor clientY position.
 */
function showResult(data: HeuristicResult, x: number, y: number) {
  const r = RISK[data.riskLevel] ?? RISK.low;
  const el = getTooltip();

  // Build up to 3 factor tags (most important factors)
  const factorTags = data.factors
    .slice(0, 3)
    .map(f => {
      const label = FACTOR_LABELS[f] ?? f;
      return `<span style="display:inline-block;background:#1e293b;border:1px solid #334155;border-radius:3px;padding:1px 5px;font-size:9px;color:#94a3b8;margin:1px 1px 0 0">${label}</span>`;
    })
    .join('');

  const moreCount = data.factors.length - 3;
  const moreTag = moreCount > 0
    ? `<span style="display:inline-block;font-size:9px;color:#475569;margin-top:1px">+${moreCount} more</span>`
    : '';

  el.innerHTML = `
    <div style="border-left:3px solid ${r.border};padding-left:8px">
      <div style="font-weight:700;color:${r.color};font-size:11px;letter-spacing:0.5px">
        ${r.label} · ${data.riskScore}/100
      </div>
      <div style="color:#94a3b8;font-size:10px;margin-top:3px;word-break:break-all">
        ${data.domain}
      </div>
      <div style="color:${data.isHttps ? '#4ade80' : '#f87171'};font-size:10px;margin-top:3px">
        ${data.isHttps ? 'HTTPS' : 'HTTP (unencrypted)'}
      </div>
      ${data.factors.length > 0 ? `
        <div style="margin-top:5px;line-height:1.6">
          ${factorTags}${moreTag}
        </div>
      ` : ''}
    </div>
  `;
  el.style.display = 'block';
  positionTooltip(x, y);
}

/**
 * Hides the tooltip element (sets display:none).
 * Called on mouseout or when the cursor moves to a different link.
 */
function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

// ── Heuristic fetching ────────────────────────────────────────────────────────

/**
 * Fetches the heuristic risk assessment for a URL from the backend.
 * Returns null if the backend is unreachable or returns an error — the tooltip
 * simply won't be shown rather than causing visible errors.
 *
 * @param url - The fully-qualified URL of the hovered link.
 */
async function fetchHeuristic(url: string): Promise<HeuristicResult | null> {
  try {
    const res = await fetch(`${BACKEND}/analyse-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    return await res.json() as HeuristicResult;
  } catch {
    return null; // Backend not running — fail silently
  }
}

// ── Event handling ────────────────────────────────────────────────────────────

/** Timer that delays showing the tooltip to avoid flicker when skimming links. */
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

/** Timer that delays hiding the tooltip after the cursor leaves a link. */
let hideTimer:  ReturnType<typeof setTimeout> | null = null;

/** href of the link currently under the cursor. */
let currentHref = '';

/**
 * mouseover: start the 350 ms hover timer when the cursor enters a link.
 * On expiry: show a loading state, fetch the heuristic, then show the result.
 * Uses capture phase (true) so it receives events before the page's own handlers.
 */
document.addEventListener('mouseover', (e) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;

  const href = (anchor as HTMLAnchorElement).href;
  if (!href || (!href.startsWith('http://') && !href.startsWith('https://'))) return;

  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  currentHref = href;

  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(async () => {
    // Serve from cache if already fetched for this URL
    if (cache.has(href)) {
      showResult(cache.get(href)!, e.clientX, e.clientY);
      return;
    }

    showLoading(e.clientX, e.clientY);

    // Only one in-flight request per URL to prevent duplicate API calls
    if (!inFlight.has(href)) {
      inFlight.add(href);
      const result = await fetchHeuristic(href);
      inFlight.delete(href);
      if (result) cache.set(href, result);
    }

    // Only render the result if the mouse is still on the same link
    if (currentHref === href && cache.has(href)) {
      showResult(cache.get(href)!, e.clientX, e.clientY);
    } else if (currentHref !== href) {
      hideTooltip();
    }
  }, 350);
}, true);

/**
 * mousemove: keep the tooltip tracking the cursor while it's visible.
 * Uses capture phase so it fires even on pages that stop propagation.
 */
document.addEventListener('mousemove', (e) => {
  if (tooltip && tooltip.style.display !== 'none') {
    positionTooltip(e.clientX, e.clientY);
  }
}, true);

/**
 * mouseout: cancel the hover timer and schedule hiding the tooltip with a
 * short 200 ms delay (allows the cursor to briefly leave and re-enter the
 * link without the tooltip disappearing).
 */
document.addEventListener('mouseout', (e) => {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;

  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  currentHref = '';
  hideTimer = setTimeout(hideTooltip, 200);
}, true);
