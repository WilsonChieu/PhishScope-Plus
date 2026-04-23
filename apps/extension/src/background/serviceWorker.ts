/**
 * serviceWorker.ts
 * PhishScope+ MV3 background service worker.
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
 *  This fixes the bug where GET_CACHED_BY_URL polling and the original
 *  ANALYSE_URL sendResponse both need the same result.
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

async function runFullAnalysis(url: string): Promise<FullAnalysis> {
  const [heuristic, sandbox] = await Promise.all([
    postJSON<AnalyseUrlResponse>('/analyse-url', { url }),
    postJSON<SandboxPreviewResponse>('/sandbox-preview', { url }),
  ]);
  const summary = await postJSON<SummariseResponse>('/summarise', {
    url,
    heuristicResult: heuristic,
    sandboxResult:   sandbox,
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

/**
 * Register a callback and start analysis if not already running.
 * If analysis is already in-flight the callback is queued with existing waiters.
 *
 * @param url - URL to analyse.
 * @param cb  - Optional sendResponse / waiter to call when done.
 */
function startOrJoin(url: string, cb?: (r: MessageResponse) => void): void {
  if (cb) {
    const arr = waiters.get(url) ?? [];
    arr.push(cb);
    waiters.set(url, arr);
  }
  if (!inFlight.has(url)) {
    inFlight.add(url);
    runFullAnalysis(url)
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

    // ANALYSE_URL — popup "Scan URL" button
    if (message.type === 'ANALYSE_URL') {
      const { url } = message;

      // Serve immediately from URL cache
      const cached = urlCache.get(url);
      if (cached) {
        sendResponse({ type: 'ANALYSIS_RESULT', data: cached });
        return false;
      }

      // Register as a waiter and start/join analysis
      startOrJoin(url, sendResponse);
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

  // Loading phase: fast heuristic interception
  if (changeInfo.status === 'loading') {
    if (acknowledged.has(url)) return;

    // Cached result for this tab — redirect immediately without a backend call
    const byTab = tabCache.get(tabId);
    if (byTab && byTab.url === url && isRisky(byTab.heuristic.riskLevel)) {
      redirectToWarning(tabId, url, byTab.heuristic);
      return;
    }

    // URL cache hit — same protection, no backend call needed
    const byUrl = urlCache.get(url);
    if (byUrl && isRisky(byUrl.heuristic.riskLevel)) {
      redirectToWarning(tabId, url, byUrl.heuristic);
      return;
    }

    // Fast heuristic check — never blocks on failure
    postJSON<AnalyseUrlResponse>('/analyse-url', { url })
      .then(heuristic => {
        if (acknowledged.has(url) || !isRisky(heuristic.riskLevel)) return;
        chrome.tabs.get(tabId, currentTab => {
          if (chrome.runtime.lastError) return;
          if (currentTab.url === url && !acknowledged.has(url)) {
            redirectToWarning(tabId, url, heuristic);
          }
        });
      })
      .catch(() => {});

    return;
  }

  // Complete phase: full background analysis
  if (changeInfo.status === 'complete') {
    // URL already cached — just associate this tabId
    const existing = urlCache.get(url);
    if (existing) {
      tabCache.set(tabId, existing);
      return;
    }

    // Start or join analysis; cache by tabId when done
    startOrJoin(url, (r) => {
      if (r.type === 'ANALYSIS_RESULT') tabCache.set(tabId, r.data);
    });
  }
});
