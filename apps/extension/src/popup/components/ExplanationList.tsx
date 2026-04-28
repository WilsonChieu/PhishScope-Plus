/**
 * ExplanationList.tsx
 */

import React, { useState } from 'react';

interface Props {
  summary: string;
  bulletPoints: string[];
}

export const ExplanationList: React.FC<Props> = ({ summary, bulletPoints }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginTop: 10 }}>
      {/* Summary */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderLeft: '3px solid #4f46e5',
        borderRadius: 7,
        padding: '10px 12px',
        fontSize: 12,
        lineHeight: 1.6,
        color: '#374151',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}>
        {summary}
      </div>

      {bulletPoints.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none', border: 'none',
              color: '#64748b', fontSize: 11,
              cursor: 'pointer', padding: '2px 0',
              display: 'flex', alignItems: 'center', gap: 5,
              fontWeight: 500,
            }}
          >
            <span style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s',
              fontSize: 9,
            }}>
              &#9654;
            </span>
            {expanded ? 'Hide' : 'Show'} {bulletPoints.length} risk factor{bulletPoints.length !== 1 ? 's' : ''}
          </button>

          {expanded && (
            <ul style={{ marginTop: 6, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {bulletPoints.map((point, i) => (
                <li key={i} style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderLeft: '3px solid #fca5a5',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: '#374151',
                  lineHeight: 1.5,
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}>
                  {point}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
