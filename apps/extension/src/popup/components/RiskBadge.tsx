/**
 * RiskBadge.tsx
 */

import React from 'react';

interface Props {
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;
  domain: string;
  isHttps: boolean;
}

const COLORS = {
  low:    { bg: '#f0fdf4', border: '#86efac', text: '#15803d', label: 'LOW RISK' },
  medium: { bg: '#fffbeb', border: '#fcd34d', text: '#b45309', label: 'MEDIUM RISK' },
  high:   { bg: '#fff1f2', border: '#fda4af', text: '#be123c', label: 'HIGH RISK' },
};

export const RiskBadge: React.FC<Props> = ({ riskLevel, riskScore, domain, isHttps }) => {
  const c = COLORS[riskLevel];

  return (
    <div style={{
      background: c.bg,
      border: `1.5px solid ${c.border}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      marginBottom: 4,
    }}>
      {/* Score ring */}
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        border: `3px solid ${c.border}`,
        background: '#ffffff',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        boxShadow: `0 0 0 3px ${c.bg}`,
      }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: c.text, lineHeight: 1 }}>{riskScore}</span>
        <span style={{ fontSize: 9, color: c.text, opacity: 0.7 }}>/100</span>
      </div>

      {/* Info */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.text, letterSpacing: '0.06em' }}>
          {c.label}
        </div>
        <div style={{ fontSize: 12, color: '#475569', marginTop: 3, wordBreak: 'break-all' }}>
          {domain || 'Unknown domain'}
        </div>
        <div style={{
          fontSize: 11,
          color: isHttps ? '#15803d' : '#b45309',
          marginTop: 4,
          fontWeight: 500,
        }}>
          {isHttps ? 'HTTPS — Encrypted' : 'HTTP — Unencrypted'}
        </div>
      </div>
    </div>
  );
};
