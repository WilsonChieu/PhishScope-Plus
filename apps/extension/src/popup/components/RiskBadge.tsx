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
  low: {
    headerBg: '#dcfce7',
    bg:       '#f0fdf4',
    border:   '#86efac',
    text:     '#15803d',
    label:    'LOW RISK',
    action:   'This site appears safe to visit',
  },
  medium: {
    headerBg: '#fef3c7',
    bg:       '#fffbeb',
    border:   '#fcd34d',
    text:     '#92400e',
    label:    'MEDIUM RISK',
    action:   'Proceed with caution',
  },
  high: {
    headerBg: '#ffe4e6',
    bg:       '#fff1f2',
    border:   '#fda4af',
    text:     '#9f1239',
    label:    'HIGH RISK',
    action:   'Do not enter any personal information',
  },
};

export const RiskBadge: React.FC<Props> = ({ riskLevel, riskScore, domain, isHttps }) => {
  const c = COLORS[riskLevel];

  return (
    <div style={{
      border: `1.5px solid ${c.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 4,
      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    }}>

      {/* Risk level header — dominant, immediately visible */}
      <div style={{
        background: c.headerBg,
        borderBottom: `1px solid ${c.border}`,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: c.text, letterSpacing: '0.04em' }}>
          {c.label}
        </div>
        <div style={{
          background: '#ffffff',
          border: `1.5px solid ${c.border}`,
          borderRadius: 8,
          padding: '4px 10px',
          textAlign: 'center',
          lineHeight: 1,
        }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: c.text }}>{riskScore}</span>
          <span style={{ fontSize: 10, color: c.text, opacity: 0.6 }}>/100</span>
        </div>
      </div>

      {/* Action message — tells user what to do */}
      <div style={{
        background: c.bg,
        padding: '8px 16px 10px',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.text, marginBottom: 6 }}>
          {c.action}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#475569', wordBreak: 'break-all', flex: 1, marginRight: 8 }}>
            {domain || 'Unknown domain'}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600,
            color: isHttps ? '#15803d' : '#b45309',
            flexShrink: 0,
          }}>
            {isHttps ? 'HTTPS' : 'HTTP'}
          </span>
        </div>
      </div>

    </div>
  );
};
