/**
 * index.tsx
 * PhishScope+ popup root — the main extension popup UI.
 *
 * Renders two tabs:
 *   Scanner  — URL input, scan trigger, risk badge, explanation list, sandbox preview
 *   History  — paginated list of past scans with filter and delete controls
 *
 * On open, the popup checks the service worker cache for a result for the active tab.
 * If found it displays immediately; otherwise it shows an idle "Scan URL" button.
 * The user can scan any URL (not just the current tab) by editing the input field.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FullAnalysis, MessageRequest, MessageResponse } from '../types/api';
import { RiskBadge } from './components/RiskBadge';
import { ExplanationList } from './components/ExplanationList';
import { SandboxPreview } from './components/SandboxPreview';
import { HistoryView } from './components/HistoryView';

type Status = 'checking' | 'idle' | 'loading' | 'done' | 'error';
type Tab = 'scanner' | 'history';

/**
 * Normalises a raw URL string entered by the user.
 * Bare domain names (e.g. "example.com") are prefixed with "https://".
 * URLs that already contain "://" (any scheme) are left unchanged.
 *
 * @param raw - Raw string from the URL input field.
 */
function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  // Already has any protocol (http://, https://, chrome://, etc.) — leave it alone
  if (trimmed.includes('://')) return trimmed;
  // Bare domain like "example.com" — add https://
  if (trimmed) return 'https://' + trimmed;
  return trimmed;
}

function App() {
  const [status, setStatus] = useState<Status>('checking');
  const [analysis, setAnalysis] = useState<FullAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [tabUrl, setTabUrl] = useState('');
  const [scanUrl, setScanUrl] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('scanner');
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Stop any active polling loop. */
  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  /**
   * Poll GET_CACHED_BY_URL every 1.5 s until a result is available.
   * Used when ANALYSE_URL returns LOADING (analysis already in-flight).
   * Times out after 90 s to avoid a permanent loading state.
   */
  function startPolling(url: string) {
    stopPolling();
    let attempts = 0;
    pollRef.current = setInterval(() => {
      attempts++;
      if (attempts > 60) {                  // 60 × 1.5 s = 90 s hard cap
        stopPolling();
        setStatus('error');
        setErrorMsg('Scan timed out. The backend may be overloaded or the site is unreachable.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'GET_CACHED_BY_URL', url } as MessageRequest,
        (response: MessageResponse) => {
          if (chrome.runtime.lastError) return; // SW restart — keep polling
          if (response.type === 'ANALYSIS_RESULT') {
            stopPolling();
            setAnalysis(response.data);
            setStatus('done');
          } else if (response.type === 'ERROR') {
            stopPolling();
            setStatus('error');
            setErrorMsg(response.error);
          }
          // LOADING → keep polling
        }
      );
    }, 1500);
  }

  // Clean up polling on unmount
  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const url = tab?.url ?? '';
      setTabUrl(url);
      setScanUrl(url);

      if (tab?.id != null && url.startsWith('http')) {
        // Try tabId cache first
        chrome.runtime.sendMessage(
          { type: 'GET_CACHED', tabId: tab.id } as MessageRequest,
          (response: MessageResponse) => {
            if (chrome.runtime.lastError || !response) { setStatus('idle'); return; }
            if (response.type === 'ANALYSIS_RESULT') {
              setAnalysis(response.data);
              setStatus('done');
            } else {
              // Fall back to URL cache (useful after service worker restart)
              chrome.runtime.sendMessage(
                { type: 'GET_CACHED_BY_URL', url } as MessageRequest,
                (r: MessageResponse) => {
                  if (r?.type === 'ANALYSIS_RESULT') {
                    setAnalysis(r.data);
                    setStatus('done');
                  } else {
                    setStatus('idle');
                  }
                }
              );
            }
          }
        );
      } else {
        setStatus('idle');
      }
    });
  }, []);

  /**
   * Handles text input changes in the URL field.
   * Clears any existing analysis result so the user starts fresh when typing a new URL.
   */
  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setScanUrl(e.target.value);
    // Clear old results when URL is changed
    if (status === 'done' || status === 'error') {
      setStatus('idle');
      setAnalysis(null);
      setErrorMsg('');
    }
  }

  /** Triggers a scan when the user presses Enter in the URL input field. */
  function handleUrlKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAnalyse();
  }

  /**
   * Resets the URL input to the active tab's URL.
   * Shown as a "← Use current tab" link when the input has been modified.
   */
  function handleUseCurrentTab() {
    setScanUrl(tabUrl);
    setStatus('idle');
    setAnalysis(null);
    setErrorMsg('');
  }

  /**
   * Sends an ANALYSE_URL message to the service worker to trigger the full
   * analysis pipeline (heuristic + sandbox + summarise) for the current scanUrl.
   * Updates popup state based on the response.
   */
  function handleAnalyse() {
    const url = normaliseUrl(scanUrl);
    if (!url) return;
    setScanUrl(url);
    setStatus('loading');
    setAnalysis(null);
    setErrorMsg('');

    const msg: MessageRequest = { type: 'ANALYSE_URL', url };
    chrome.runtime.sendMessage(msg, (response: MessageResponse) => {
      if (chrome.runtime.lastError) {
        // Service worker restarted mid-flight — fall back to polling
        startPolling(url);
        return;
      }
      if (response.type === 'ANALYSIS_RESULT') {
        stopPolling();
        setAnalysis(response.data);
        setStatus('done');
      } else if (response.type === 'LOADING') {
        // Analysis is already in-flight — poll until it finishes
        startPolling(url);
      } else if (response.type === 'ERROR') {
        stopPolling();
        setStatus('error');
        setErrorMsg(response.error);
      }
    });
  }

  /**
   * Builds a plain-text analysis report and copies it to the clipboard.
   * The report includes the URL, risk score, summary, bullet points, and sandbox findings.
   * The button temporarily shows "✓" to confirm the copy succeeded.
   */
  function handleCopy() {
    if (!analysis) return;
    const lines = [
      'PhishScope+ Analysis Report',
      `URL: ${analysis.url}`,
      `Risk: ${analysis.heuristic.riskLevel.toUpperCase()} (${analysis.heuristic.riskScore}/100)`,
      `Domain: ${analysis.heuristic.domain}`,
      `HTTPS: ${analysis.heuristic.isHttps ? 'Yes' : 'No'}`,
      '',
      `Summary: ${analysis.summary.summary}`,
      '',
      'Risk Factors:',
      ...analysis.summary.bulletPoints.map(p => `  • ${p}`),
      '',
      'Sandbox:',
      `  Forms: ${analysis.sandbox.formCount}`,
      `  Password field: ${analysis.sandbox.hasPasswordField ? 'Yes' : 'No'}`,
      `  Credit card field: ${analysis.sandbox.hasCreditCardField ? 'Yes' : 'No'}`,
      analysis.sandbox.detectedBrands.length > 0
        ? `  Brands detected: ${analysis.sandbox.detectedBrands.join(', ')}`
        : null,
      analysis.sandbox.redirectChain && analysis.sandbox.redirectChain.length > 1
        ? `  Redirects: ${analysis.sandbox.redirectChain.join(' → ')}`
        : null,
      '',
      `Scanned: ${new Date().toLocaleString()}`,
    ].filter((l): l is string => l !== null);

    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const normalisedScanUrl = normaliseUrl(scanUrl);
  const isScannable = normalisedScanUrl.startsWith('http://') || normalisedScanUrl.startsWith('https://');
  const isCurrentTab = scanUrl.trim() === tabUrl;

  const statusDotColor =
    status === 'loading' || status === 'checking' ? '#fbbf24'
    : status === 'done' ? '#4ade80'
    : status === 'error' ? '#f87171'
    : '#334155';

  /**
   * Returns inline styles for a tab button, highlighting the active tab
   * with a blue bottom border and brighter text.
   *
   * @param t - The tab this style is being computed for.
   */
  const tabStyle = (t: Tab): React.CSSProperties => ({
    flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 600,
    border: 'none', cursor: 'pointer',
    background: activeTab === t ? '#1e293b' : 'transparent',
    color: activeTab === t ? '#e2e8f0' : '#475569',
    borderBottom: activeTab === t ? '2px solid #3b82f6' : '2px solid transparent',
  });

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: 0.5 }}>
            PhishScope<span style={{ color: '#3b82f6' }}>+</span>
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>Phishing Detection & Sandbox</div>
        </div>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusDotColor }} />
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #1e293b', marginBottom: 10 }}>
        <button style={tabStyle('scanner')} onClick={() => setActiveTab('scanner')}>Scanner</button>
        <button style={tabStyle('history')} onClick={() => setActiveTab('history')}>History</button>
      </div>

      {/* Scanner tab */}
      {activeTab === 'scanner' && (
        <>
          {/* URL input */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              <label style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                URL to scan
              </label>
              {tabUrl.startsWith('http') && !isCurrentTab && (
                <button
                  onClick={handleUseCurrentTab}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: '#3b82f6', padding: 0,
                  }}
                >
                  ← Use current tab
                </button>
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              value={scanUrl}
              onChange={handleUrlChange}
              onKeyDown={handleUrlKeyDown}
              placeholder="https://example.com"
              spellCheck={false}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#1e293b', border: '1px solid #334155',
                borderRadius: 6, padding: '7px 10px',
                fontSize: 11, color: '#e2e8f0', outline: 'none',
                fontFamily: 'monospace',
              }}
            />
            {tabUrl.startsWith('http') && isCurrentTab && (
              <div style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>
                Current tab · paste any URL to scan a different page
              </div>
            )}
          </div>

          {/* Checking cache */}
          {status === 'checking' && (
            <div style={{ textAlign: 'center', padding: '12px 0', color: '#64748b', fontSize: 11 }}>
              Checking cache…
            </div>
          )}

          {/* Non-scannable notice */}
          {scanUrl && !isScannable && status !== 'checking' && (
            <div style={{
              background: '#1e293b', borderRadius: 8, padding: '8px 12px',
              fontSize: 11, color: '#64748b', marginBottom: 8,
            }}>
              Only <strong style={{ color: '#94a3b8' }}>http://</strong> and{' '}
              <strong style={{ color: '#94a3b8' }}>https://</strong> URLs can be scanned.
            </div>
          )}

          {/* Scan / Re-scan button */}
          {isScannable && (status === 'idle' || status === 'done' || status === 'error') && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
              <button
                onClick={handleAnalyse}
                disabled={!scanUrl}
                style={{
                  flex: 1, background: '#3b82f6', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '9px 0', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {status === 'done' ? '🔄 Re-scan URL' : '🔍 Scan URL'}
              </button>

              {status === 'done' && analysis && (
                <button
                  onClick={handleCopy}
                  title="Copy report to clipboard"
                  style={{
                    background: copied ? '#166534' : '#1e293b',
                    color: copied ? '#4ade80' : '#94a3b8',
                    border: '1px solid #334155', borderRadius: 8,
                    padding: '9px 12px', fontSize: 12, cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  {copied ? '✓' : '⎘'}
                </button>
              )}
            </div>
          )}

          {/* Loading state */}
          {status === 'loading' && (
            <div style={{
              textAlign: 'center', padding: '24px 0', color: '#64748b', fontSize: 12,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              <div style={{ fontSize: 22 }}>⏳</div>
              <div>Running sandbox analysis…</div>
              <div style={{ fontSize: 10, color: '#475569' }}>This may take 10–20 seconds</div>
            </div>
          )}

          {/* Error state */}
          {status === 'error' && (
            <div style={{
              background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8,
              padding: '10px 12px', fontSize: 11, color: '#f87171', marginTop: 8,
            }}>
              <strong>Error:</strong> {errorMsg}
              <div style={{ marginTop: 4, color: '#94a3b8', fontSize: 10 }}>
                Make sure the PhishScope+ backend is running on localhost:3000
              </div>
            </div>
          )}

          {/* Results */}
          {status === 'done' && analysis && (
            <>
              <RiskBadge
                riskLevel={analysis.heuristic.riskLevel}
                riskScore={analysis.heuristic.riskScore}
                domain={analysis.heuristic.domain}
                isHttps={analysis.heuristic.isHttps}
              />
              <ExplanationList
                summary={analysis.summary.summary}
                bulletPoints={analysis.summary.bulletPoints}
              />
              <SandboxPreview sandbox={analysis.sandbox} />
            </>
          )}
        </>
      )}

      {/* History tab */}
      {activeTab === 'history' && <HistoryView />}

      {/* Footer */}
      <div style={{ marginTop: 14, fontSize: 9, color: '#334155', textAlign: 'center' }}>
        PhishScope+ v1.0.0 — FYP TP067323
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
