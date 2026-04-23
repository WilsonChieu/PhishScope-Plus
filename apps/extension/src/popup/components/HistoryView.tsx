/**
 * HistoryView.tsx
 * History tab content for the PhishScope+ popup.
 *
 * Fetches the last 50 scan records from GET /history on mount and renders
 * them as a filterable, deletable list. Each record shows the domain, risk
 * level badge, score, timestamp, and summary snippet.
 *
 * Features:
 *  - Filter buttons: ALL / HIGH / MEDIUM / LOW
 *  - Per-record delete with inline Yes / No confirmation (prevents accidental deletion)
 *  - "Clear all" with a two-step confirmation (button → confirm row)
 */

import React, { useEffect, useState } from 'react';
import type { ScanRecord } from '../../types/api';
import { BACKEND } from '../../config';

/** Colour for each risk level label. */
const RISK_COLORS: Record<string, string> = {
  low: '#4ade80',
  medium: '#fbbf24',
  high: '#f87171',
};

type RiskFilter = 'all' | 'low' | 'medium' | 'high';

/**
 * HistoryView component.
 * Loads scan history from the backend on mount and provides filter and
 * delete controls. All state is local — re-opening the popup refetches.
 */
export const HistoryView: React.FC = () => {
  const [records, setRecords]                 = useState<ScanRecord[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState('');

  /** ID of the record currently being deleted (shows a spinner). */
  const [deleting, setDeleting]               = useState<number | null>(null);

  /** ID of the record awaiting inline delete confirmation (null = none). */
  const [confirmId, setConfirmId]             = useState<number | null>(null);

  /** Whether the "Clear all records?" confirmation row is visible. */
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  /** True while the clear-all DELETE request is in flight. */
  const [clearingAll, setClearingAll]         = useState(false);

  /** Active risk-level filter; 'all' shows every record. */
  const [filter, setFilter]                   = useState<RiskFilter>('all');

  /** Fetch scan history from the backend on component mount. */
  useEffect(() => {
    fetch(`${BACKEND}/history`)
      .then(r => r.json())
      .then((data: ScanRecord[]) => {
        setRecords(data);
        setLoading(false);
      })
      .catch(() => {
        setError('Could not load history. Is the backend running?');
        setLoading(false);
      });
  }, []);

  /**
   * Sends DELETE /history to remove all records, then clears local state.
   * Only called after the user confirms the "Clear all records?" prompt.
   */
  function handleClearAll() {
    setClearingAll(true);
    setConfirmClearAll(false);
    fetch(`${BACKEND}/history`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => setRecords([]))
      .catch(() => {})
      .finally(() => setClearingAll(false));
  }

  /**
   * Shows the inline "Delete?" confirmation row for a specific record.
   * Replaces the ✕ button with Yes / No buttons.
   *
   * @param id - ID of the record to confirm deletion for.
   */
  function requestDelete(id: number) {
    setConfirmId(id);
  }

  /**
   * Cancels a pending delete confirmation without deleting anything.
   * Restores the ✕ button for the record.
   */
  function cancelDelete() {
    setConfirmId(null);
  }

  /**
   * Confirms and executes deletion of a single scan record.
   * Sends DELETE /history/:id, then removes the record from local state on success.
   *
   * @param id - ID of the record to delete.
   */
  function confirmDelete(id: number) {
    setConfirmId(null);
    setDeleting(id);
    fetch(`${BACKEND}/history/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => {
        setRecords(prev => prev.filter(r => r.id !== id));
      })
      .catch(() => {})
      .finally(() => setDeleting(null));
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0', color: '#64748b', fontSize: 12 }}>
        Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 8,
        padding: '10px 12px', fontSize: 11, color: '#f87171',
      }}>
        {error}
      </div>
    );
  }

  /** Records after applying the active risk-level filter. */
  const visible = filter === 'all' ? records : records.filter(r => r.risk_level === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>

      {/* ── Clear all controls — only shown when records exist ── */}
      {records.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          {confirmClearAll ? (
            /* Two-step confirmation: prompt + Yes/Cancel buttons */
            <>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>Clear all records?</span>
              <button
                onClick={handleClearAll}
                style={{
                  background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 4,
                  color: '#f87171', fontSize: 10, padding: '2px 8px', cursor: 'pointer',
                }}
              >
                Yes, clear all
              </button>
              <button
                onClick={() => setConfirmClearAll(false)}
                style={{
                  background: 'none', border: '1px solid #334155', borderRadius: 4,
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
                background: 'none', border: '1px solid #334155', borderRadius: 4,
                color: clearingAll ? '#475569' : '#64748b',
                fontSize: 10, padding: '2px 8px', cursor: 'pointer',
              }}
            >
              {clearingAll ? 'Clearing…' : 'Clear all'}
            </button>
          )}
        </div>
      )}

      {/* ── Risk-level filter pills ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        {(['all', 'high', 'medium', 'low'] as RiskFilter[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: '3px 0',
              fontSize: 10,
              fontWeight: filter === f ? 700 : 400,
              borderRadius: 5,
              border: `1px solid ${filter === f ? (f === 'all' ? '#94a3b8' : RISK_COLORS[f]) : '#334155'}`,
              background: filter === f ? '#1e293b' : 'transparent',
              color: filter === f ? (f === 'all' ? '#e2e8f0' : RISK_COLORS[f]) : '#64748b',
              cursor: 'pointer',
            }}
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      {/* ── Record list or empty state ── */}
      {visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b', fontSize: 12 }}>
          {records.length === 0 ? 'No scans yet.' : `No ${filter} risk scans.`}
        </div>
      ) : (
        visible.map(rec => {
          const color = RISK_COLORS[rec.risk_level] ?? '#94a3b8';
          const date = new Date(rec.scanned_at).toLocaleString();
          const isPendingConfirm = confirmId === rec.id;

          return (
            <div key={rec.id} style={{
              background: '#1e293b', borderRadius: 8, padding: '8px 10px',
              borderLeft: `3px solid ${color}`,
            }}>
              {/* Record header: domain + delete control */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
                <div style={{ fontSize: 11, color: '#e2e8f0', wordBreak: 'break-all', marginBottom: 2, flex: 1 }}>
                  {rec.domain || rec.url}
                </div>

                {isPendingConfirm ? (
                  /* Inline delete confirmation */
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>Delete?</span>
                    <button
                      onClick={() => confirmDelete(rec.id)}
                      style={{
                        background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: 4,
                        color: '#f87171', fontSize: 10, padding: '1px 6px', cursor: 'pointer',
                      }}
                    >
                      Yes
                    </button>
                    <button
                      onClick={cancelDelete}
                      style={{
                        background: 'none', border: '1px solid #334155', borderRadius: 4,
                        color: '#64748b', fontSize: 10, padding: '1px 6px', cursor: 'pointer',
                      }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  /* Single-tap delete button — shows confirm row on click */
                  <button
                    onClick={() => requestDelete(rec.id)}
                    disabled={deleting === rec.id}
                    title="Delete record"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: deleting === rec.id ? '#475569' : '#64748b',
                      fontSize: 12, padding: '0 2px', flexShrink: 0, lineHeight: 1,
                    }}
                  >
                    {deleting === rec.id ? '…' : '✕'}
                  </button>
                )}
              </div>

              {/* Risk level badge + timestamp */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color, fontWeight: 600 }}>
                  {rec.risk_level.toUpperCase()} · {rec.risk_score}/100
                </span>
                <span style={{ fontSize: 9, color: '#475569' }}>{date}</span>
              </div>

              {/* Summary snippet */}
              {rec.summary && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
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
