/**
 * db.ts
 * Lightweight JSON-file persistence layer for PhishScope+ scan history.
 *
 * All reads load the full file from disk; all writes atomically replace it.
 * The file is capped at MAX_RECORDS entries (FIFO eviction) to prevent
 * unbounded growth. This is intentionally simple — suitable for a local
 * single-user FYP demo. A real deployment would use a proper database.
 */

import fs from 'fs';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', '..', 'scan_history.json');

/** Maximum number of scan records kept on disk (oldest evicted first). */
const MAX_RECORDS = 500;

/** Shape of a single scan record stored in scan_history.json. */
export interface ScanRecord {
  id: number;
  url: string;
  domain: string;
  risk_score: number;
  risk_level: string;
  factors: string;        // JSON-serialised string[]
  page_title: string;
  has_password_field: number;   // 0 | 1 (SQLite-style boolean)
  has_credit_card_field: number;
  summary: string;
  scanned_at: string;     // ISO-8601 timestamp
}

/**
 * Reads all records from the JSON file.
 * Returns an empty array if the file does not exist or is corrupt.
 */
function loadRecords(): ScanRecord[] {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) as ScanRecord[];
    }
  } catch {
    // Corrupted file — treat as empty rather than crashing
  }
  return [];
}

/**
 * Overwrites the JSON file with the given record array.
 * Failures are silently swallowed — history loss is non-critical for a prototype.
 */
function saveRecords(records: ScanRecord[]): void {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(records, null, 2), 'utf-8');
  } catch {
    // Non-critical — prototype storage
  }
}

/** Auto-incrementing ID counter; seeded from the last record on first use. */
let nextId = 1;

/**
 * Appends a new scan record to persistent storage.
 * The record is timestamped automatically. If the store exceeds MAX_RECORDS
 * the oldest entries are discarded.
 *
 * @param record - All fields except `id` and `scanned_at`, which are set here.
 */
export function saveScan(record: Omit<ScanRecord, 'id' | 'scanned_at'>): void {
  const records = loadRecords();
  if (records.length > 0) nextId = records[records.length - 1].id + 1;
  records.push({ ...record, id: nextId++, scanned_at: new Date().toISOString() });
  saveRecords(records.slice(-MAX_RECORDS));
}

/**
 * Returns the most recent `limit` scan records, newest first.
 *
 * @param limit - Maximum number of records to return (default 20).
 */
export function getRecentScans(limit = 20): ScanRecord[] {
  const records = loadRecords();
  return records.slice(-limit).reverse();
}

/**
 * Deletes the record with the given ID.
 *
 * @param id - Numeric record ID.
 * @returns `true` if a record was found and deleted; `false` if not found.
 */
export function deleteScan(id: number): boolean {
  const records = loadRecords();
  const filtered = records.filter(r => r.id !== id);
  if (filtered.length === records.length) return false;
  saveRecords(filtered);
  return true;
}

/**
 * Removes all records from persistent storage, resetting history to empty.
 * Called by the "Clear all" action in the extension's History tab.
 */
export function clearAllScans(): void {
  saveRecords([]);
}

/**
 * Returns true if a scan for the given URL was already saved within
 * the last `withinMinutes` minutes.
 *
 * This prevents the history from filling up with duplicate entries caused by
 * the MV3 service worker restarting frequently and re-running the full
 * analysis pipeline on the same URL in quick succession.
 *
 * @param url          - The URL to look up.
 * @param withinMinutes - Deduplication window in minutes (default 5).
 */
export function hasScanForUrl(url: string, withinMinutes = 5): boolean {
  const records = loadRecords();
  const cutoff = Date.now() - withinMinutes * 60 * 1000;
  return records.some(r => r.url === url && new Date(r.scanned_at).getTime() >= cutoff);
}

