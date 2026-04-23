/**
 * warning.ts
 * Script for the PhishScope+ risk warning interstitial page (warning.html).
 *
 * Reads URL parameters injected by the service worker, populates the warning UI,
 * and handles the two action buttons:
 *   "Take me back to safety"   — navigates the tab to chrome://newtab/
 *   "I understand the risk"    — sends ACKNOWLEDGE_URL to the service worker,
 *                                then navigates to the original risky URL
 *
 * This script runs in an extension page context (chrome-extension://...)
 * and therefore has access to the chrome.tabs and chrome.runtime APIs.
 */

/**
 * Short human-readable labels for each heuristic factor key.
 * Used to build the factor tag pills displayed on the warning page.
 */
const FACTOR_LABELS: Record<string, string> = {
  ip_in_url:            'Raw IP address',
  no_https:             'No HTTPS',
  suspicious_tld:       'Suspicious TLD',
  brand_token_mismatch: 'Brand impersonation',
  homoglyph_domain:     'Lookalike domain (IDN)',
  at_symbol:            '@ in URL',
  many_subdomains:      'Excessive subdomains',
  excessive_length:     'Abnormally long URL',
  deep_path:            'Deep URL path',
  hyphen_domain:        'Hyphen-heavy domain',
  digits_in_domain:     'Numeric domain',
  invalid_url:          'Malformed URL',
  url_shortener:        'URL shortener',
  high_entropy_domain:  'High-entropy domain (possible DGA)',
  keyword_in_domain:    'Phishing keyword in domain',
  suspicious_keywords:  'Suspicious keywords in URL',
  non_standard_port:    'Non-standard port number',
  threat_intel_match:   'Google Safe Browsing match',
};

// ── Read URL parameters injected by the service worker ───────────────────────

const params    = new URLSearchParams(location.search);

/** The original risky URL the user was navigating to. */
const targetUrl = decodeURIComponent(params.get('url') ?? '');

/** Overall risk level: 'high' or 'medium'. */
const risk      = (params.get('risk') ?? 'high') as 'high' | 'medium';

/** Normalised risk score (0–100). */
const score     = parseInt(params.get('score') ?? '0', 10);

/** List of triggered heuristic factor keys (e.g. ['no_https', 'suspicious_tld']). */
const factors   = (params.get('factors') ?? '').split(',').filter(Boolean);

// ── Populate UI ───────────────────────────────────────────────────────────────

const banner     = document.getElementById('banner')!;
const riskBadge  = document.getElementById('risk-badge')!;
const scoreBar   = document.getElementById('score-bar')!;
const scoreLabel = document.getElementById('score-label')!;
const heading    = document.getElementById('heading')!;

// Apply risk-level CSS class to colour-coded elements
banner.classList.add(risk);
riskBadge.classList.add(risk);
riskBadge.textContent = risk === 'high' ? 'HIGH RISK' : 'MEDIUM RISK';
scoreBar.classList.add(risk);
scoreLabel.textContent = `${score}/100`;

// Animate the score bar after the first paint to trigger the CSS transition
requestAnimationFrame(() => {
  setTimeout(() => { scoreBar.style.width = `${score}%`; }, 50);
});

// Softer wording and icon for medium-risk URLs
if (risk === 'medium') {
  heading.textContent = 'Suspicious Site Detected';
  (document.getElementById('subheading') as HTMLElement).textContent =
    'PhishScope+ has detected suspicious characteristics in this URL. Proceed with caution and do not enter personal information.';
  (document.getElementById('shield') as HTMLElement).innerHTML = '&#x26A0;&#xFE0F;';
}

// Show the flagged URL in the read-only URL box
(document.getElementById('url-display') as HTMLElement).textContent = targetUrl || '(unknown)';

/**
 * Build and insert factor tag pills.
 * Each factor key is mapped to a human-readable label via FACTOR_LABELS.
 * Unknown keys fall back to the raw key string.
 */
if (factors.length > 0) {
  const section = document.getElementById('factors-section')!;
  const list    = document.getElementById('factors-list')!;
  section.style.display = 'block';
  factors.forEach(f => {
    const tag = document.createElement('span');
    tag.className = 'factor-tag';
    tag.textContent = FACTOR_LABELS[f] ?? f;
    list.appendChild(tag);
  });
}

// ── Action buttons ────────────────────────────────────────────────────────────

/**
 * "Take me back to safety" button.
 * Navigates the current tab to chrome://newtab/.
 *
 * window.location.href = 'chrome://...' is blocked by Chrome from regular JS,
 * so chrome.tabs.getCurrent() + chrome.tabs.update() is used instead.
 * Both APIs are available because this script runs in an extension page context.
 */
document.getElementById('btn-safe')!.addEventListener('click', () => {
  chrome.tabs.getCurrent(tab => {
    if (tab?.id != null) {
      chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
    }
  });
});

/**
 * "I understand the risk — proceed anyway" button.
 * 1. Disables the button to prevent double-clicks.
 * 2. Sends ACKNOWLEDGE_URL to the service worker so it won't intercept this URL again.
 * 3. Navigates to the original risky URL once the service worker acknowledges.
 */
document.getElementById('btn-proceed')!.addEventListener('click', () => {
  if (!targetUrl) return;

  const btn = document.getElementById('btn-proceed') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Proceeding…';

  chrome.runtime.sendMessage({ type: 'ACKNOWLEDGE_URL', url: targetUrl }, () => {
    window.location.href = targetUrl;
  });
});
