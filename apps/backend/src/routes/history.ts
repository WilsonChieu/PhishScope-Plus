/**
 * routes/history.ts
 * Scan history management endpoints.
 *
 *   GET    /history         — returns the 50 most recent scan records
 *   DELETE /history         — deletes all records (clear all)
 *   DELETE /history/:id     — deletes a single record by its numeric ID
 *
 * Records are stored in scan_history.json via the db.ts persistence layer.
 * There is no authentication — this is a local single-user FYP deployment.
 */

import { Router, Request, Response } from 'express';
import { getRecentScans, deleteScan, clearAllScans } from '../database/db';

const router = Router();

/**
 * GET /history
 * Returns the 50 most recent scan records, newest first.
 * Used by the extension's History tab to populate the scan list.
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const raw = parseInt(req.query.limit as string, 10);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 500) : 50;
    const scans = getRecentScans(limit);
    res.json(scans);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /history
 * Removes all scan records from persistent storage.
 * Called when the user clicks "Clear all" in the History tab and confirms.
 */
router.delete('/', (_req: Request, res: Response) => {
  try {
    clearAllScans();
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

/**
 * DELETE /history/:id
 * Removes the single record with the given numeric ID.
 * Returns 404 if no record with that ID exists.
 *
 * @param req.params.id - String representation of the numeric record ID.
 */
router.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid id.' });
    return;
  }
  const deleted = deleteScan(id);
  if (!deleted) {
    res.status(404).json({ error: 'Record not found.' });
    return;
  }
  res.json({ ok: true });
});

export default router;
