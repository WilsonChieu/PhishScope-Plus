/**
 * index.tsx
 * PhishScope+ popup root — the main extension popup UI.
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

function normaliseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('://')) return trimmed;
  if (trimmed) return 'https://' + trimmed;
  return trimmed;
}

function App() {
  const [status, setStatus]     = useState<Status>('checking');
  const [analysis, setAnalysis] = useState<FullAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [tabUrl, setTabUrl]     = useState('');
  const [scanUrl, setScanUrl]   = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('scanner');
  const [copied, setCopied]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function startPolling(url: string) {
    stopPolling();
    let attempts = 0;
    pollRef.current = setInterval(() => {
      attempts++;
      if (attempts > 60) {
        stopPolling();
        setStatus('error');
        setErrorMsg('Scan timed out. The backend may be overloaded or the site is unreachable.');
        return;
      }
      chrome.runtime.sendMessage(
        { type: 'GET_CACHED_BY_URL', url } as MessageRequest,
        (response: MessageResponse) => {
          if (chrome.runtime.lastError) return;
          if (response.type === 'ANALYSIS_RESULT') {
            stopPolling(); setAnalysis(response.data); setStatus('done');
          } else if (response.type === 'ERROR') {
            stopPolling(); setStatus('error'); setErrorMsg(response.error);
          }
        }
      );
    }, 1500);
  }

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const url = tab?.url ?? '';
      setTabUrl(url); setScanUrl(url);
      if (tab?.id != null && url.startsWith('http')) {
        chrome.runtime.sendMessage(
          { type: 'GET_CACHED', tabId: tab.id } as MessageRequest,
          (response: MessageResponse) => {
            if (chrome.runtime.lastError || !response) { setStatus('idle'); return; }
            if (response.type === 'ANALYSIS_RESULT') {
              setAnalysis(response.data); setStatus('done');
            } else {
              chrome.runtime.sendMessage(
                { type: 'GET_CACHED_BY_URL', url } as MessageRequest,
                (r: MessageResponse) => {
                  if (r?.type === 'ANALYSIS_RESULT') { setAnalysis(r.data); setStatus('done'); }
                  else setStatus('idle');
                }
              );
            }
          }
        );
      } else { setStatus('idle'); }
    });
  }, []);

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    setScanUrl(e.target.value);
    if (status === 'done' || status === 'error') {
      setStatus('idle'); setAnalysis(null); setErrorMsg('');
    }
  }

  function handleUrlKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAnalyse();
  }

  function handleUseCurrentTab() {
    setScanUrl(tabUrl); setStatus('idle'); setAnalysis(null); setErrorMsg('');
  }

  function handleAnalyse() {
    const url = normaliseUrl(scanUrl);
    if (!url) return;
    setScanUrl(url); setStatus('loading'); setAnalysis(null); setErrorMsg('');
    const msg: MessageRequest = { type: 'ANALYSE_URL', url };
    chrome.runtime.sendMessage(msg, (response: MessageResponse) => {
      if (chrome.runtime.lastError) { startPolling(url); return; }
      if (response.type === 'ANALYSIS_RESULT') {
        stopPolling(); setAnalysis(response.data); setStatus('done');
      } else if (response.type === 'LOADING') {
        startPolling(url);
      } else if (response.type === 'ERROR') {
        stopPolling(); setStatus('error'); setErrorMsg(response.error);
      }
    });
  }

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
      ...analysis.summary.bulletPoints.map(p => `  - ${p}`),
      '',
      'Sandbox:',
      `  Forms: ${analysis.sandbox.formCount}`,
      `  Password field: ${analysis.sandbox.hasPasswordField ? 'Yes' : 'No'}`,
      `  Credit card field: ${analysis.sandbox.hasCreditCardField ? 'Yes' : 'No'}`,
      analysis.sandbox.detectedBrands.length > 0
        ? `  Brands detected: ${analysis.sandbox.detectedBrands.join(', ')}` : null,
      analysis.sandbox.redirectChain && analysis.sandbox.redirectChain.length > 1
        ? `  Redirects: ${analysis.sandbox.redirectChain.join(' -> ')}` : null,
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

  const statusDot = {
    'loading':  '#f59e0b',
    'checking': '#f59e0b',
    'done':     '#059669',
    'error':    '#e11d48',
    'idle':     '#cbd5e1',
  }[status];

  const tabStyle = (t: Tab): React.CSSProperties => ({
    flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 600,
    border: 'none', cursor: 'pointer', background: 'transparent',
    color: activeTab === t ? '#4f46e5' : '#94a3b8',
    borderBottom: activeTab === t ? '2px solid #4f46e5' : '2px solid transparent',
    letterSpacing: '0.02em', transition: 'color 0.15s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div style={{
        background: '#1e293b',
        padding: '14px 16px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', letterSpacing: '0.02em' }}>
            PhishScope<span style={{ color: '#818cf8' }}>+</span>
          </div>
          <div style={{ fontSize: 10, color: '#64748b', marginTop: 2, letterSpacing: '0.03em' }}>
            Phishing Detection & Sandbox
          </div>
        </div>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: statusDot,
          boxShadow: `0 0 6px ${statusDot}`,
        }} />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', background: '#ffffff', borderBottom: '1px solid #e2e8f0' }}>
        <button style={tabStyle('scanner')} onClick={() => setActiveTab('scanner')}>Scanner</button>
        <button style={tabStyle('history')} onClick={() => setActiveTab('history')}>History</button>
      </div>

      {/* Content */}
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* Scanner tab */}
        {activeTab === 'scanner' && (
          <>
            {/* URL input */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <label style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  URL to Scan
                </label>
                {tabUrl.startsWith('http') && !isCurrentTab && (
                  <button
                    onClick={handleUseCurrentTab}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#4f46e5', padding: 0 }}
                  >
                    Use current tab
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
                  background: '#ffffff', border: '1px solid #e2e8f0',
                  borderRadius: 7, padding: '8px 11px',
                  fontSize: 11, color: '#0f172a', outline: 'none',
                  fontFamily: 'monospace',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#4f46e5'}
                onBlur={e => e.currentTarget.style.borderColor = '#e2e8f0'}
              />
              {tabUrl.startsWith('http') && isCurrentTab && (
                <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 4 }}>
                  Showing current tab — paste any URL to scan a different page
                </div>
              )}
            </div>

            {status === 'checking' && (
              <div style={{ textAlign: 'center', padding: '12px 0', color: '#94a3b8', fontSize: 11 }}>
                Checking cache…
              </div>
            )}

            {scanUrl && !isScannable && status !== 'checking' && (
              <div style={{
                background: '#fff7ed', border: '1px solid #fed7aa',
                borderRadius: 7, padding: '8px 12px',
                fontSize: 11, color: '#92400e', marginBottom: 8,
              }}>
                Only http:// and https:// URLs can be scanned.
              </div>
            )}

            {isScannable && (status === 'idle' || status === 'done' || status === 'error') && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button
                  onClick={handleAnalyse}
                  disabled={!scanUrl}
                  style={{
                    flex: 1,
                    background: '#4f46e5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 7,
                    padding: '9px 0',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    letterSpacing: '0.02em',
                    boxShadow: '0 1px 3px rgba(79,70,229,0.3)',
                  }}
                >
                  {status === 'done' ? 'Re-scan URL' : 'Scan URL'}
                </button>
                {status === 'done' && analysis && (
                  <button
                    onClick={handleCopy}
                    title="Copy report to clipboard"
                    style={{
                      background: copied ? '#ecfdf5' : '#ffffff',
                      color: copied ? '#059669' : '#64748b',
                      border: `1px solid ${copied ? '#6ee7b7' : '#e2e8f0'}`,
                      borderRadius: 7, padding: '9px 12px',
                      fontSize: 12, cursor: 'pointer', flexShrink: 0,
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
            )}

            {status === 'loading' && (
              <div style={{
                background: '#ffffff', border: '1px solid #e2e8f0',
                borderRadius: 8, padding: '20px',
                textAlign: 'center', fontSize: 12, color: '#64748b',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
              }}>
                <div style={{
                  width: 28, height: 28, border: '3px solid #e2e8f0',
                  borderTopColor: '#4f46e5', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <div style={{ fontWeight: 500 }}>Running sandbox analysis</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>This may take 10–20 seconds</div>
              </div>
            )}

            {status === 'error' && (
              <div style={{
                background: '#fff1f2', border: '1px solid #fda4af',
                borderRadius: 7, padding: '10px 12px',
                fontSize: 11, color: '#be123c', marginTop: 4,
              }}>
                <strong>Error:</strong> {errorMsg}
                <div style={{ marginTop: 4, color: '#9f1239', fontSize: 10 }}>
                  Make sure the PhishScope+ backend is running on localhost:3000
                </div>
              </div>
            )}

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

        {activeTab === 'history' && <HistoryView />}

        <div style={{ marginTop: 14, fontSize: 9, color: '#cbd5e1', textAlign: 'center' }}>
          PhishScope+ v1.0.0 — FYP TP067323
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
