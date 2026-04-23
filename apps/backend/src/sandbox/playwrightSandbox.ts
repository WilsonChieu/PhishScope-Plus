/**
 * playwrightSandbox.ts
 * Headless Chromium sandbox for PhishScope+.
 *
 * Two-tier analysis strategy:
 *  1. Playwright (full) — headless Chromium with anti-detection patches.
 *     Provides screenshot, full DOM analysis, redirect chain, POST tracking.
 *  2. HTTP fallback — plain fetch when Playwright is blocked (Cloudflare, bot walls).
 *     Provides page title, description, basic form/field detection from raw HTML.
 *     No screenshot, but still useful for phishing signal extraction.
 *
 * Navigation order (fastest → slowest, 30 s hard cap):
 *  commit (8 s) → domcontentloaded (10 s) → networkidle (12 s)
 * The previous order (networkidle first) wasted 40 s before even trying commit.
 */

import { chromium } from 'playwright';

/** Result shape returned by runSandbox(). */
export interface SandboxResult {
  screenshot: string;            // base64-encoded PNG (empty on fallback / error)
  pageTitle: string;
  pageDescription: string;       // <meta name="description"> content
  formCount: number;
  hasPasswordField: boolean;
  hasCreditCardField: boolean;
  iframeCount: number;           // number of <iframe> elements
  externalLinkCount: number;     // links pointing to a different origin
  detectedBrands: string[];
  redirectChain: string[];       // ordered list of main-frame navigation URLs
  externalPostTargets: string[]; // origins that received POST requests from this page
  error?: string;                // set if analysis is partial or failed
}

/** Brand keywords searched for in the page's visible body text. */
const BRAND_KEYWORDS = [
  'paypal', 'google', 'apple', 'amazon', 'microsoft', 'facebook',
  'instagram', 'netflix', 'bank', 'chase', 'hsbc', 'barclays',
  'dropbox', 'linkedin', 'ebay', 'yahoo', 'outlook',
];

/** Realistic Chrome UA used for both Playwright and HTTP fallback. */
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Hard cap on the total Playwright operation time. */
const OVERALL_TIMEOUT_MS = 30_000;

// ── Empty / error result helpers ──────────────────────────────────────────────

function emptyResult(error: string): SandboxResult {
  return {
    screenshot: '', pageTitle: '', pageDescription: '',
    formCount: 0, hasPasswordField: false, hasCreditCardField: false,
    iframeCount: 0, externalLinkCount: 0,
    detectedBrands: [], redirectChain: [], externalPostTargets: [],
    error,
  };
}

// ── HTTP fallback ─────────────────────────────────────────────────────────────

/**
 * Plain HTTP fetch fallback used when Playwright is blocked.
 * Extracts title, description, form signals and basic brand matches from raw HTML.
 * No screenshot is possible in this mode.
 */
async function httpFallback(url: string): Promise<SandboxResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':      CHROME_UA,
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection':      'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: controller.signal,
    });
    clearTimeout(t);

    const html = await res.text();
    const h    = html.toLowerCase();

    // Basic HTML extraction — no DOM parser needed
    const titleMatch = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i);
    const descMatch  = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,300})/i)
                    ?? html.match(/<meta[^>]+content=["']([^"']{0,300})["'][^>]+name=["']description["']/i);

    const hasPassword    = /<input[^>]+type=["']password["']/i.test(html);
    const hasCreditCard  = /card|cvv|cvc\b|ccv/i.test(html) && /<input/i.test(html);
    const formCount      = (html.match(/<form[\s>]/gi) ?? []).length;
    const iframeCount    = (html.match(/<iframe[\s>]/gi) ?? []).length;
    const detectedBrands = BRAND_KEYWORDS.filter(b => h.includes(b));

    // Redirect chain from response URL (fetch follows redirects automatically)
    const redirectChain = res.url !== url ? [url, res.url] : [url];

    return {
      screenshot:        '',
      pageTitle:         titleMatch?.[1]?.trim() ?? '',
      pageDescription:   descMatch?.[1]?.trim() ?? '',
      formCount,
      hasPasswordField:  hasPassword,
      hasCreditCardField: hasCreditCard,
      iframeCount,
      externalLinkCount: 0,  // cannot count without DOM
      detectedBrands,
      redirectChain,
      externalPostTargets: [],
      error: 'Headless browser was blocked — showing HTTP-only analysis (no screenshot)',
    };
  } catch (err) {
    clearTimeout(t);
    const msg = err instanceof Error ? err.message : String(err);
    return emptyResult(`Site unreachable: ${msg}`);
  }
}

// ── Main Playwright sandbox ───────────────────────────────────────────────────

/**
 * Visits the given URL in an isolated headless Chromium context and returns
 * a set of behavioural observations useful for phishing detection.
 *
 * Falls back to HTTP fetch if Playwright is blocked (ERR_CONNECTION_TIMED_OUT,
 * Cloudflare challenges, bot walls, etc.).
 *
 * @param url - A valid http:// or https:// URL to visit.
 * @returns   SandboxResult; `error` is set when results are partial or unavailable.
 */
export async function runSandbox(url: string): Promise<SandboxResult> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return emptyResult('Sandbox only supports http:// and https:// URLs.');
  }

  // Wrap the entire Playwright operation in a hard overall timeout
  const playwrightResult = await Promise.race([
    runPlaywright(url),
    new Promise<null>(resolve => setTimeout(() => resolve(null), OVERALL_TIMEOUT_MS)),
  ]);

  // Overall timeout fired — try HTTP fallback
  if (playwrightResult === null) {
    return httpFallback(url);
  }

  // Playwright returned an error that suggests it was blocked → try HTTP fallback
  if (playwrightResult.error && isConnectionError(playwrightResult.error)) {
    return httpFallback(url);
  }

  return playwrightResult;
}

/** Returns true when the error string indicates a network/connection level failure. */
function isConnectionError(msg: string): boolean {
  return (
    msg.includes('ERR_CONNECTION_TIMED_OUT') ||
    msg.includes('ERR_CONNECTION_REFUSED') ||
    msg.includes('ERR_NAME_NOT_RESOLVED') ||
    msg.includes('ERR_NETWORK_CHANGED') ||
    msg.includes('net::ERR_') ||
    msg.includes('Timeout') && msg.includes('exceeded')
  );
}

/** Inner Playwright operation — never throws, always resolves. */
async function runPlaywright(url: string): Promise<SandboxResult> {
  let browser;
  let context;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-size=1280,800',
      ],
    });

    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      userAgent: CHROME_UA,
      viewport:  { width: 1280, height: 800 },
      locale:    'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      },
    });

    const page = await context.newPage();

    // ── Extended stealth patches ──────────────────────────────────────────────
    await page.addInitScript(() => {
      // Hide webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => false });

      // Fake plugin list (real Chrome has plugins; headless has none)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin' },
          { name: 'Chrome PDF Viewer' },
          { name: 'Native Client' },
        ],
      });

      // Realistic language list
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });

      // Fake permissions API (headless returns 'denied' for everything)
      const origQuery = window.navigator.permissions?.query?.bind(navigator.permissions);
      if (origQuery) {
        // @ts-ignore
        navigator.permissions.query = (params: PermissionDescriptor) =>
          params.name === 'notifications'
            ? Promise.resolve({ state: 'denied' } as PermissionStatus)
            : origQuery(params);
      }

      // Remove CDP leak artifacts left by some Chromium versions
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
      // @ts-ignore
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
    });

    // ── Redirect chain tracking ───────────────────────────────────────────────
    const redirectChain: string[] = [];
    const seenUrls = new Set<string>();
    page.on('request', req => {
      if (req.isNavigationRequest() && req.frame() === page.mainFrame() && !seenUrls.has(req.url())) {
        seenUrls.add(req.url());
        redirectChain.push(req.url());
      }
    });

    // ── External POST target tracking ─────────────────────────────────────────
    const targetOrigin = new URL(url).origin;
    const externalPostOrigins = new Set<string>();
    page.on('request', req => {
      if (req.method() !== 'POST') return;
      try {
        const o = new URL(req.url()).origin;
        if (o !== targetOrigin) externalPostOrigins.add(o);
      } catch { /* ignore */ }
    });

    // Block heavy resources irrelevant to detection
    await page.route('**/*.{mp4,mp3,woff,woff2,ttf,otf,pdf}', route => route.abort());

    // ── Navigation: commit first (fast), then upgrade ─────────────────────────
    // commit fires as soon as any bytes are received — the cheapest signal
    // that the server is responding. We then try to upgrade to domcontentloaded
    // and networkidle so we get progressively richer DOM data without blocking.
    try {
      await page.goto(url, { timeout: 8_000, waitUntil: 'commit' });
    } catch (commitErr) {
      // Even commit failed — server did not respond at all
      const msg = commitErr instanceof Error ? commitErr.message : String(commitErr);
      return emptyResult(msg);
    }

    // Try to upgrade to domcontentloaded — more DOM content available
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
    } catch {
      // Partial load — continue with whatever is in the DOM
    }

    // Try to wait for SPA content (JS-rendered pages) — best effort
    await Promise.race([
      page.waitForFunction(() => (document.body?.innerText?.length ?? 0) > 100, { timeout: 4_000 }).catch(() => {}),
      new Promise(r => setTimeout(r, 4_000)),
    ]);

    // Try for networkidle for a short window — improves screenshot quality on slower pages
    try {
      await page.waitForLoadState('networkidle', { timeout: 6_000 });
    } catch {
      // Fine — partial load is still useful
    }

    // ── Screenshot ────────────────────────────────────────────────────────────
    let screenshot = '';
    try {
      const buf = await page.screenshot({ fullPage: false, type: 'png' });
      screenshot = buf.toString('base64');
    } catch {
      // Screenshot failure should not abort the whole analysis
    }

    // ── Page metadata ─────────────────────────────────────────────────────────
    const pageTitle = await page.title().catch(() => '');

    const { formCount, hasPasswordField, hasCreditCardField, iframeCount, externalLinkCount, pageDescription } =
      await page.evaluate(() => {
        const inputs = document.querySelectorAll('input');
        let hasPassword = false;
        let hasCreditCard = false;

        inputs.forEach((input: HTMLInputElement) => {
          if (input.type.toLowerCase() === 'password') hasPassword = true;
          const attrs = (input.name + input.id + input.placeholder).toLowerCase();
          if (attrs.includes('card') || attrs.includes('cvv') || attrs.includes('ccv') || attrs.includes('cvc')) {
            hasCreditCard = true;
          }
        });

        const origin = window.location.origin;
        let extLinks = 0;
        document.querySelectorAll('a[href]').forEach(a => {
          try {
            if (new URL((a as HTMLAnchorElement).href).origin !== origin) extLinks++;
          } catch { /* ignore */ }
        });

        const descEl = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;

        return {
          formCount:          document.querySelectorAll('form').length,
          hasPasswordField:   hasPassword,
          hasCreditCardField: hasCreditCard,
          iframeCount:        document.querySelectorAll('iframe').length,
          externalLinkCount:  extLinks,
          pageDescription:    descEl?.content ?? '',
        };
      }).catch(() => ({
        formCount: 0, hasPasswordField: false, hasCreditCardField: false,
        iframeCount: 0, externalLinkCount: 0, pageDescription: '',
      }));

    const bodyText    = await page.evaluate(() => document.body?.innerText?.toLowerCase() ?? '').catch(() => '');
    const detectedBrands = BRAND_KEYWORDS.filter(b => bodyText.includes(b));

    return {
      screenshot,
      pageTitle,
      pageDescription,
      formCount,
      hasPasswordField,
      hasCreditCardField,
      iframeCount,
      externalLinkCount,
      detectedBrands,
      redirectChain,
      externalPostTargets: [...externalPostOrigins],
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return emptyResult(msg);
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}
