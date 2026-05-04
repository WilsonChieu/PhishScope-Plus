/**
 * serviceWorker.ts
 * PhishScope+ MV3 background service worker.
 *
 * Privacy model — all automatic scanning is 100% on-device:
 *  1. Navigation interception uses the local heuristic engine only.
 *     No URL is ever sent to the backend automatically.
 *  2. The backend is called ONLY when the user explicitly clicks "Scan URL"
 *     in the popup (consent is the act of clicking the button).
 *  3. User-initiated scans set log:true so the result is saved to history.
 *  4. Before any URL reaches the backend, query strings and fragments are
 *     stripped (sanitizeUrl) to remove tokens / personal identifiers.
 *
 * Caching strategy (two layers):
 *  - tabCache  (Map<tabId, FullAnalysis>) — for auto-scanned tabs
 *  - urlCache  (Map<url,   FullAnalysis>) — for manually scanned URLs and
 *    reliable lookup after service worker restarts
 *
 * Multi-waiter pattern:
 *  When multiple callers request the same URL while it is in-flight,
 *  their sendResponse callbacks are collected in `waiters`. When the
 *  analysis completes all waiters are resolved at once.
 */

import type {
  FullAnalysis,
  AnalyseUrlResponse,
  SandboxPreviewResponse,
  SummariseResponse,
  MessageRequest,
  MessageResponse,
} from '../types/api';
import { BACKEND } from '../config';
import { analyseUrlLocally } from '../detection/heuristic';

/** Per-tab cache: tabId → FullAnalysis. */
const tabCache = new Map<number, FullAnalysis>();

/** Per-URL cache: url → FullAnalysis. Survives tab closes; reset on SW restart. */
const urlCache = new Map<string, FullAnalysis>();

/** URLs currently being analysed. */
const inFlight = new Set<string>();

/** URLs the user acknowledged despite the warning. */
const acknowledged = new Set<string>();

/**
 * Pending sendResponse callbacks indexed by URL.
 * All registered callbacks are called when the analysis for that URL completes.
 */
const waiters = new Map<string, Array<(r: MessageResponse) => void>>();

// ── Core helpers ──────────────────────────────────────────────────────────────


async function postJSON<T>(endpoint: string, body: object): Promise<T> {
  const res = await fetch(`${BACKEND}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

async function runFullAnalysis(url: string, log: boolean): Promise<FullAnalysis> {
  const [heuristic, sandbox] = await Promise.all([
    postJSON<AnalyseUrlResponse>('/analyse-url', { url }),
    postJSON<SandboxPreviewResponse>('/sandbox-preview', { url }),
  ]);
  const summary = await postJSON<SummariseResponse>('/summarise', {
    url,
    heuristicResult: heuristic,
    sandboxResult:   sandbox,
    log,
  });
  return { url, heuristic, sandbox, summary };
}

/** Store a completed result and notify all waiters. */
function resolveAnalysis(url: string, result: FullAnalysis): void {
  urlCache.set(url, result);
  inFlight.delete(url);
  const pending = waiters.get(url) ?? [];
  waiters.delete(url);
  pending.forEach(fn => { try { fn({ type: 'ANALYSIS_RESULT', data: result }); } catch {} });
}

/** Notify all waiters of a failure. */
function rejectAnalysis(url: string, err: unknown): void {
  inFlight.delete(url);
  const msg = err instanceof Error ? err.message : String(err);
  const pending = waiters.get(url) ?? [];
  waiters.delete(url);
  pending.forEach(fn => { try { fn({ type: 'ERROR', error: msg }); } catch {} });
}

function startOrJoin(url: string, log: boolean, cb?: (r: MessageResponse) => void): void {
  if (cb) {
    const arr = waiters.get(url) ?? [];
    arr.push(cb);
    waiters.set(url, arr);
  }
  if (!inFlight.has(url)) {
    inFlight.add(url);
    runFullAnalysis(url, log)
      .then(result => resolveAnalysis(url, result))
      .catch(err   => rejectAnalysis(url, err));
  }
}

// ── Warning helpers ───────────────────────────────────────────────────────────

function buildWarningUrl(targetUrl: string, heuristic: AnalyseUrlResponse): string {
  const base = chrome.runtime.getURL('warning.html');
  const q = new URLSearchParams({
    url:     encodeURIComponent(targetUrl),
    risk:    heuristic.riskLevel,
    score:   String(heuristic.riskScore),
    factors: heuristic.factors.join(','),
  });
  return `${base}?${q.toString()}`;
}

function redirectToWarning(tabId: number, url: string, heuristic: AnalyseUrlResponse): void {
  chrome.tabs.update(tabId, { url: buildWarningUrl(url, heuristic) });
}

function isRisky(risk: 'low' | 'medium' | 'high'): boolean {
  return risk === 'high' || risk === 'medium';
}

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: MessageRequest, _sender, sendResponse: (r: MessageResponse) => void) => {

    // ACKNOWLEDGE_URL — user clicked "proceed anyway" on the warning page
    if (message.type === 'ACKNOWLEDGE_URL') {
      acknowledged.add(message.url);
      sendResponse({ type: 'LOADING' });
      return false;
    }

    // ANALYSE_URL — popup "Scan URL" button (user-initiated: log = true)
    if (message.type === 'ANALYSE_URL') {
      const { url } = message;

      // Serve immediately from URL cache
      const cached = urlCache.get(url);
      if (cached) {
        sendResponse({ type: 'ANALYSIS_RESULT', data: cached });
        return false;
      }

      // User explicitly requested a scan — consent implied, always log
      startOrJoin(url, true, sendResponse);
      return true; // Keep channel open until sendResponse is called
    }

    // GET_CACHED — popup opened, check if tab was already auto-scanned
    if (message.type === 'GET_CACHED') {
      const byTab = tabCache.get(message.tabId);
      if (byTab) {
        sendResponse({ type: 'ANALYSIS_RESULT', data: byTab });
      } else {
        sendResponse({ type: 'ERROR', error: 'No cached result for this tab.' });
      }
      return false;
    }

    // GET_CACHED_BY_URL — polling fallback used by popup when LOADING is received
    if (message.type === 'GET_CACHED_BY_URL') {
      const { url } = message;
      const cached = urlCache.get(url);
      if (cached) {
        sendResponse({ type: 'ANALYSIS_RESULT', data: cached });
      } else if (inFlight.has(url)) {
        sendResponse({ type: 'LOADING' });
      } else {
        sendResponse({ type: 'ERROR', error: 'No analysis found for this URL.' });
      }
      return false;
    }
  }
);

// ── Tab lifecycle ─────────────────────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = tab.url ?? '';
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;

  // Loading phase: fast on-device interception before page renders
  if (changeInfo.status === 'loading') {
    if (acknowledged.has(url)) return;

    // Cached result for this tab — redirect immediately without any network call
    const byTab = tabCache.get(tabId);
    if (byTab && byTab.url === url && isRisky(byTab.heuristic.riskLevel)) {
      redirectToWarning(tabId, url, byTab.heuristic);
      return;
    }

    // URL cache hit from a previous user scan — redirect without re-analysing
    const byUrl = urlCache.get(url);
    if (byUrl && isRisky(byUrl.heuristic.riskLevel)) {
      redirectToWarning(tabId, url, byUrl.heuristic);
      return;
    }

    // On-device heuristic — no backend call, no data leaves the browser
    const localResult = analyseUrlLocally(url);
    if (isRisky(localResult.riskLevel)) {
      redirectToWarning(tabId, url, localResult);
    }
    return;
  }

  // Complete phase: associate any previously user-scanned result with this tab
  if (changeInfo.status === 'complete') {
    const existing = urlCache.get(url);
    if (existing) tabCache.set(tabId, existing);
  }
});
