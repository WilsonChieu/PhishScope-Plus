/**
 * HistoryView.tsx
 */

import React, { useEffect, useState } from 'react';
import type { ScanRecord } from '../../types/api';
import { BACKEND } from '../../config';

const RISK_COLORS: Record<string, string> = {
  low:    '#15803d',
  medium: '#b45309',
  high:   '#be123c',
};

const RISK_BG: Record<string, string> = {
  low:    '#f0fdf4',
  medium: '#fffbeb',
  high:   '#fff1f2',
};

const RISK_BORDER: Record<string, string> = {
  low:    '#86efac',
  medium: '#fcd34d',
  high:   '#fda4af',
};

type RiskFilter = 'all' | 'low' | 'medium' | 'high';

export const HistoryView: React.FC = () => {
  const [records, setRecords]               = useState<ScanRecord[]>([]);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState('');
  const [deleting, setDeleting]             = useState<number | null>(null);
  const [confirmId, setConfirmId]           = useState<number | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [clearingAll, setClearingAll]       = useState(false);
  const [filter, setFilter]                 = useState<RiskFilter>('all');

  useEffect(() => {
    fetch(`${BACKEND}/history`)
      .then(r => r.json())
      .then((data: ScanRecord[]) => { setRecords(data); setLoading(false); })
      .catch(() => { setError('Could not load history. Is the backend running?'); setLoading(false); });
  }, []);

  function handleClearAll() {
    setClearingAll(true); setConfirmClearAll(false);
    fetch(`${BACKEND}/history`, { method: 'DELETE' })
      .then(() => setRecords([]))
      .catch(() => {})
      .finally(() => setClearingAll(false));
  }

  function confirmDelete(id: number) {
    setConfirmId(null); setDeleting(id);
    fetch(`${BACKEND}/history/${id}`, { method: 'DELETE' })
      .then(() => setRecords(prev => prev.filter(r => r.id !== id)))
      .catch(() => {})
      .finally(() => setDeleting(null));
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: '#94a3b8', fontSize: 12 }}>
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: '#fff1f2', border: '1px solid #fda4af',
        borderRadius: 7, padding: '10px 12px',
        fontSize: 11, color: '#be123c',
      }}>
        {error}
      </div>
    );
  }

  const visible = filter === 'all' ? records : records.filter(r => r.risk_level === filter);

  const filterBtn = (f: RiskFilter, label: string) => {
    const isActive = filter === f;
    const color = f === 'all' ? '#4f46e5' : RISK_COLORS[f];
    return (
      <button
        key={f}
        onClick={() => setFilter(f)}
        style={{
          flex: 1, padding: '4px 0', fontSize: 10,
          fontWeight: isActive ? 700 : 500,
          borderRadius: 5,
          border: `1px solid ${isActive ? color : '#e2e8f0'}`,
          background: isActive ? (f === 'all' ? '#eef2ff' : RISK_BG[f]) : '#ffffff',
          color: isActive ? color : '#94a3b8',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* Clear all */}
      {records.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          {confirmClearAll ? (
            <>
              <span style={{ fontSize: 10, color: '#64748b' }}>Clear all records?</span>
              <button
                onClick={handleClearAll}
                style={{
                  background: '#fff1f2', border: '1px solid #fda4af', borderRadius: 4,
                  color: '#be123c', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                }}
              >
                Yes, clear all
              </button>
              <button
                onClick={() => setConfirmClearAll(false)}
                style={{
                  background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
                  color: '#64748b', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmClearAll(true)}
              disabled={clearingAll}
              style={{
                background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
                color: clearingAll ? '#cbd5e1' : '#64748b',
                fontSize: 10, padding: '2px 8px', cursor: 'pointer',
              }}
            >
              {clearingAll ? 'Clearing…' : 'Clear all'}
            </button>
          )}
        </div>
      )}

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {filterBtn('all', 'ALL')}
        {filterBtn('high', 'HIGH')}
        {filterBtn('medium', 'MED')}
        {filterBtn('low', 'LOW')}
      </div>

      {/* Records */}
      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#94a3b8', fontSize: 12 }}>
          {records.length === 0 ? 'No scans yet.' : `No ${filter} risk scans.`}
        </div>
      ) : (
        visible.map(rec => {
          const color  = RISK_COLORS[rec.risk_level] ?? '#64748b';
          const bg     = RISK_BG[rec.risk_level] ?? '#f8fafc';
          const border = RISK_BORDER[rec.risk_level] ?? '#e2e8f0';
          const date   = new Date(rec.scanned_at).toLocaleString();
          const isPendingConfirm = confirmId === rec.id;

          return (
            <div key={rec.id} style={{
              background: '#ffffff',
              border: `1px solid ${border}`,
              borderLeft: `3px solid ${color}`,
              borderRadius: 8,
              padding: '9px 11px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#1e293b', fontWeight: 600, wordBreak: 'break-all', flex: 1 }}>
                  {rec.domain || rec.url}
                </div>

                {isPendingConfirm ? (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#64748b' }}>Delete?</span>
                    <button
                      onClick={() => confirmDelete(rec.id)}
                      style={{
                        background: '#fff1f2', border: '1px solid #fda4af', borderRadius: 4,
                        color: '#be123c', fontSize: 10, padding: '1px 6px', cursor: 'pointer',
                      }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setConfirmId(null)}
                      style={{
                        background: 'none', border: '1px solid #e2e8f0', borderRadius: 4,
                        color: '#64748b', fontSize: 10, padding: '1px 6px', cursor: 'pointer',
                      }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmId(rec.id)}
                    disabled={deleting === rec.id}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: deleting === rec.id ? '#cbd5e1' : '#94a3b8',
                      fontSize: 12, padding: '0 2px', flexShrink: 0,
                    }}
                  >
                    {deleting === rec.id ? '…' : 'x'}
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{
                  fontSize: 10, color, fontWeight: 700,
                  background: bg, padding: '1px 7px', borderRadius: 10,
                  border: `1px solid ${border}`,
                }}>
                  {rec.risk_level.toUpperCase()} {rec.risk_score}/100
                </span>
                <span style={{ fontSize: 9, color: '#94a3b8' }}>{date}</span>
              </div>

              {rec.summary && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 5, lineHeight: 1.4 }}>
                  {rec.summary}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
