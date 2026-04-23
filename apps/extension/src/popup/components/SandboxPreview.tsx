/**
 * SandboxPreview.tsx
 * Displays headless-browser sandbox observations in the Scanner tab.
 *
 * Shows:
 *  - Screenshot thumbnail (always visible, click to open full size in a new tab)
 *  - Page title and meta description
 *  - Form signals: password field, credit card field, iframe count, external links
 *  - Redirect chain
 *  - External POST targets (where form data is sent)
 *  - Detected brand keywords
 */

import React from 'react';
import type { SandboxPreviewResponse } from '../../types/api';

interface Props {
  sandbox: SandboxPreviewResponse;
}

/** Opens the base64 screenshot as a full-size image in a new browser tab. */
function openScreenshot(base64: string) {
  chrome.tabs.create({ url: `data:image/png;base64,${base64}` });
}

/** Renders the main-frame redirect chain. Only shown when length > 1. */
const RedirectChain: React.FC<{ chain: string[] }> = ({ chain }) => {
  const hops        = chain.length - 1;
  const showEllipsis = chain.length > 3;
  const first       = chain[0];
  const last        = chain[chain.length - 1];

  return (
    <div style={{ background: '#1e293b', borderRadius: 6, padding: '8px 10px', borderLeft: '3px solid #f87171' }}>
      <div style={{ fontSize: 10, color: '#f87171', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.7 }}>
        ↪ Redirected ({hops} hop{hops !== 1 ? 's' : ''})
      </div>
      <div style={{ fontSize: 10, color: '#94a3b8', wordBreak: 'break-all', lineHeight: 1.5, marginBottom: 3 }}>
        <span style={{ color: '#64748b' }}>From: </span>{first}
      </div>
      {showEllipsis && (
        <div style={{ fontSize: 10, color: '#475569', paddingLeft: 8, marginBottom: 3 }}>
          ··· {chain.length - 2} intermediate hop{chain.length - 2 !== 1 ? 's' : ''}
        </div>
      )}
      <div style={{ fontSize: 10, color: '#94a3b8', wordBreak: 'break-all', lineHeight: 1.5 }}>
        <span style={{ color: '#4ade80' }}>To:&nbsp;&nbsp; </span>{last}
      </div>
    </div>
  );
};

export const SandboxPreview: React.FC<Props> = ({ sandbox }) => {
  const hasRedirect     = Array.isArray(sandbox.redirectChain) && sandbox.redirectChain.length > 1;
  const hasPostTargets  = Array.isArray(sandbox.externalPostTargets) && sandbox.externalPostTargets.length > 0;

  const row = (label: string, value: React.ReactNode, color?: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
      <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 11, color: color ?? '#e2e8f0', fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ marginTop: 12 }}>
      {/* Section header */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        Sandbox Preview
      </div>

      {/* ── Error state ─────────────────────────────────────── */}
      {sandbox.error ? (
        <div style={{ background: '#1e293b', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#f87171' }}>
          ⚠ Sandbox error: {sandbox.error}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* ── Screenshot thumbnail ─────────────────────────── */}
          {sandbox.screenshot ? (
            <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #334155', lineHeight: 0 }}>
              <img
                src={`data:image/png;base64,${sandbox.screenshot}`}
                alt="Page preview"
                style={{ width: '100%', maxHeight: 160, objectFit: 'cover', objectPosition: 'top', display: 'block' }}
              />
              {/* Gradient overlay with open-in-tab button */}
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom, transparent 45%, rgba(0,0,0,0.75) 100%)',
                display: 'flex', alignItems: 'flex-end', padding: 8,
              }}>
                <button
                  onClick={() => openScreenshot(sandbox.screenshot)}
                  style={{
                    background: 'rgba(15,23,42,0.85)', border: '1px solid #475569',
                    borderRadius: 5, color: '#e2e8f0', fontSize: 10, fontWeight: 600,
                    padding: '4px 8px', cursor: 'pointer', letterSpacing: 0.3,
                  }}
                >
                  🔍 Open full screenshot
                </button>
              </div>
            </div>
          ) : (
            <div style={{ background: '#1e293b', borderRadius: 8, padding: '16px', textAlign: 'center', fontSize: 11, color: '#475569' }}>
              No screenshot available
            </div>
          )}

          {/* ── Page info ────────────────────────────────────── */}
          <div style={{ background: '#1e293b', borderRadius: 8, padding: '8px 12px' }}>
            {sandbox.pageTitle && row('Title', sandbox.pageTitle)}
            {sandbox.pageDescription && row('Description', sandbox.pageDescription, '#94a3b8')}
            {row('Forms detected', sandbox.formCount)}
            {row(
              'Password field',
              sandbox.hasPasswordField ? '⚠ Yes' : '✓ No',
              sandbox.hasPasswordField ? '#f87171' : '#4ade80',
            )}
            {sandbox.hasCreditCardField && row('Credit card field', '⚠ Detected', '#f87171')}
            {(sandbox.iframeCount ?? 0) > 0 && row('Iframes', sandbox.iframeCount, '#fbbf24')}
            {(sandbox.externalLinkCount ?? 0) > 0 && row('External links', sandbox.externalLinkCount, '#94a3b8')}
            {sandbox.detectedBrands.length > 0 && row('Brand references', sandbox.detectedBrands.join(', '), '#fbbf24')}
          </div>

          {/* ── Redirect chain ───────────────────────────────── */}
          {hasRedirect && <RedirectChain chain={sandbox.redirectChain} />}

          {/* ── External POST targets ────────────────────────── */}
          {hasPostTargets && (
            <div style={{ background: '#1e293b', borderRadius: 6, padding: '8px 10px', borderLeft: '3px solid #f87171' }}>
              <div style={{ fontSize: 10, color: '#f87171', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                ⚠ Form data sent to external domains
              </div>
              {sandbox.externalPostTargets.map(target => (
                <div key={target} style={{ fontSize: 10, color: '#94a3b8', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  → {target}
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
};
