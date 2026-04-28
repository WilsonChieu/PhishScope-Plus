/**
 * SandboxPreview.tsx
 */

import React from 'react';
import type { SandboxPreviewResponse } from '../../types/api';

interface Props {
  sandbox: SandboxPreviewResponse;
}

function openScreenshot(base64: string) {
  chrome.tabs.create({ url: `data:image/png;base64,${base64}` });
}

const RedirectChain: React.FC<{ chain: string[] }> = ({ chain }) => {
  const hops        = chain.length - 1;
  const showEllipsis = chain.length > 3;
  const first       = chain[0];
  const last        = chain[chain.length - 1];

  return (
    <div style={{
      background: '#fff1f2', border: '1px solid #fda4af',
      borderLeft: '3px solid #e11d48',
      borderRadius: 6, padding: '8px 10px',
    }}>
      <div style={{ fontSize: 10, color: '#be123c', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Redirected — {hops} hop{hops !== 1 ? 's' : ''}
      </div>
      <div style={{ fontSize: 10, color: '#6b7280', wordBreak: 'break-all', lineHeight: 1.5, marginBottom: 3 }}>
        <span style={{ color: '#9ca3af' }}>From: </span>{first}
      </div>
      {showEllipsis && (
        <div style={{ fontSize: 10, color: '#9ca3af', paddingLeft: 8, marginBottom: 3 }}>
          {chain.length - 2} intermediate hop{chain.length - 2 !== 1 ? 's' : ''}
        </div>
      )}
      <div style={{ fontSize: 10, color: '#6b7280', wordBreak: 'break-all', lineHeight: 1.5 }}>
        <span style={{ color: '#15803d' }}>To: </span>{last}
      </div>
    </div>
  );
};

export const SandboxPreview: React.FC<Props> = ({ sandbox }) => {
  const hasRedirect    = Array.isArray(sandbox.redirectChain) && sandbox.redirectChain.length > 1;
  const hasPostTargets = Array.isArray(sandbox.externalPostTargets) && sandbox.externalPostTargets.length > 0;

  const row = (label: string, value: React.ReactNode, color?: string) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '5px 0', borderBottom: '1px solid #f1f5f9',
    }}>
      <span style={{ fontSize: 11, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 11, color: color ?? '#1e293b', fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#64748b',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
      }}>
        Sandbox Preview
      </div>

      {sandbox.error ? (
        <div style={{
          background: '#fff1f2', border: '1px solid #fda4af',
          borderRadius: 7, padding: '10px 12px',
          fontSize: 11, color: '#be123c',
        }}>
          Sandbox error: {sandbox.error}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Screenshot */}
          {sandbox.screenshot ? (
            <div style={{
              position: 'relative', borderRadius: 8, overflow: 'hidden',
              border: '1px solid #e2e8f0', lineHeight: 0,
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}>
              <img
                src={`data:image/png;base64,${sandbox.screenshot}`}
                alt="Page preview"
                style={{ width: '100%', maxHeight: 160, objectFit: 'cover', objectPosition: 'top', display: 'block' }}
              />
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.55) 100%)',
                display: 'flex', alignItems: 'flex-end', padding: 8,
              }}>
                <button
                  onClick={() => openScreenshot(sandbox.screenshot)}
                  style={{
                    background: 'rgba(255,255,255,0.92)',
                    border: '1px solid #e2e8f0',
                    borderRadius: 5, color: '#1e293b',
                    fontSize: 10, fontWeight: 600,
                    padding: '4px 9px', cursor: 'pointer',
                  }}
                >
                  Open full screenshot
                </button>
              </div>
            </div>
          ) : (
            <div style={{
              background: '#f8fafc', border: '1px solid #e2e8f0',
              borderRadius: 7, padding: '16px', textAlign: 'center',
              fontSize: 11, color: '#94a3b8',
            }}>
              No screenshot available
            </div>
          )}

          {/* Page info */}
          <div style={{
            background: '#ffffff', border: '1px solid #e2e8f0',
            borderRadius: 8, padding: '8px 12px',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}>
            {sandbox.pageTitle && row('Title', sandbox.pageTitle)}
            {sandbox.pageDescription && row('Description', sandbox.pageDescription, '#64748b')}
            {row('Forms detected', sandbox.formCount)}
            {row(
              'Password field',
              sandbox.hasPasswordField ? 'Detected' : 'None',
              sandbox.hasPasswordField ? '#be123c' : '#15803d',
            )}
            {sandbox.hasCreditCardField && row('Credit card field', 'Detected', '#be123c')}
            {(sandbox.iframeCount ?? 0) > 0 && row('Iframes', sandbox.iframeCount, '#b45309')}
            {(sandbox.externalLinkCount ?? 0) > 0 && row('External links', sandbox.externalLinkCount, '#64748b')}
            {sandbox.detectedBrands.length > 0 && row('Brand references', sandbox.detectedBrands.join(', '), '#b45309')}
          </div>

          {hasRedirect && <RedirectChain chain={sandbox.redirectChain} />}

          {hasPostTargets && (
            <div style={{
              background: '#fff1f2', border: '1px solid #fda4af',
              borderLeft: '3px solid #e11d48',
              borderRadius: 6, padding: '8px 10px',
            }}>
              <div style={{ fontSize: 10, color: '#be123c', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Form data sent to external domains
              </div>
              {sandbox.externalPostTargets.map(target => (
                <div key={target} style={{ fontSize: 10, color: '#6b7280', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  {target}
                </div>
              ))}
            </div>
          )}

        </div>
      )}
    </div>
  );
};
