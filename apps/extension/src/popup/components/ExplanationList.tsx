/**
 * ExplanationList.tsx
 * Displays the plain-language risk summary and collapsible factor bullet points
 * in the Scanner tab below the RiskBadge.
 *
 * The bullet list is expanded by default; the user can toggle it with the
 * "Hide / Show N risk factors" button.
 */

import React, { useState } from 'react';

interface Props {
  summary: string;        // One-sentence narrative from the summariser
  bulletPoints: string[]; // Per-factor human-readable explanations
}

/**
 * ExplanationList component.
 * Renders a blue-left-bordered summary card followed by a collapsible
 * unordered list of risk factor explanations.
 */
export const ExplanationList: React.FC<Props> = ({ summary, bulletPoints }) => {
  /** Controls whether the bullet list is visible. Starts expanded. */
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ marginTop: 12 }}>
      {/* One-sentence narrative summary */}
      <div style={{
        background: '#1e293b',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 12,
        lineHeight: 1.6,
        color: '#cbd5e1',
        borderLeft: '3px solid #3b82f6',
      }}>
        {summary}
      </div>

      {/* Collapsible risk factor bullet list — only rendered if there are bullets */}
      {bulletPoints.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {/* Toggle button */}
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none',
              border: 'none',
              color: '#64748b',
              fontSize: 11,
              cursor: 'pointer',
              padding: '2px 0',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>▶</span>
            {expanded ? 'Hide' : 'Show'} {bulletPoints.length} risk factor{bulletPoints.length !== 1 ? 's' : ''}
          </button>

          {/* Bullet point list */}
          {expanded && (
            <ul style={{ marginTop: 6, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {bulletPoints.map((point, i) => (
                <li key={i} style={{
                  background: '#1e293b',
                  borderRadius: 6,
                  padding: '8px 10px',
                  fontSize: 11,
                  color: '#94a3b8',
                  lineHeight: 1.5,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                }}>
                  {/* Flag icon prefixes each bullet */}
                  <span style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }}>⚑</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
