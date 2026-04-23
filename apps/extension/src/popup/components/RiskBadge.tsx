/**
 * RiskBadge.tsx
 * Displays a colour-coded risk badge at the top of the Scanner tab.
 *
 * Shows:
 *  - A circular score ring (0–100 with coloured border)
 *  - Risk level label (LOW RISK / MEDIUM RISK / HIGH RISK)
 *  - Registered domain of the scanned URL
 *  - HTTPS / HTTP status indicator
 */

import React from 'react';

interface Props {
  riskLevel: 'low' | 'medium' | 'high';
  riskScore: number;   // 0–100
  domain: string;      // registered domain, e.g. "example.com"
  isHttps: boolean;
}

/** Colour palette for each risk level (background, border, text, label). */
const COLORS = {
  low:    { bg: '#14532d', border: '#16a34a', text: '#4ade80', label: 'LOW RISK' },
  medium: { bg: '#713f12', border: '#d97706', text: '#fbbf24', label: 'MEDIUM RISK' },
  high:   { bg: '#7f1d1d', border: '#dc2626', text: '#f87171', label: 'HIGH RISK' },
};

/**
 * RiskBadge component.
 * Renders a horizontally-laid-out badge with a score ring on the left and
 * risk level / domain / protocol information on the right.
 */
export const RiskBadge: React.FC<Props> = ({ riskLevel, riskScore, domain, isHttps }) => {
  const c = COLORS[riskLevel];

  return (
    <div style={{
      background: c.bg,
      border: `2px solid ${c.border}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}>
      {/* Circular score ring */}
      <div style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: `4px solid ${c.border}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: c.text, lineHeight: 1 }}>{riskScore}</span>
        <span style={{ fontSize: 9, color: c.text, opacity: 0.8 }}>/100</span>
      </div>

      {/* Risk level, domain, and protocol */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: c.text, letterSpacing: 1 }}>{c.label}</div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2, wordBreak: 'break-all' }}>
          {domain || 'Unknown domain'}
        </div>
        <div style={{ fontSize: 11, color: isHttps ? '#4ade80' : '#f87171', marginTop: 3 }}>
          {isHttps ? '🔒 HTTPS' : '⚠️ HTTP (unencrypted)'}
        </div>
      </div>
    </div>
  );
};
