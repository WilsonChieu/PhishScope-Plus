/**
 * routes/summarise.ts
 * POST /summarise
 *
 * Accepts a URL (and optionally pre-computed heuristic / sandbox results from
 * the service worker) and returns a plain-language risk summary. Results are
 * persisted to scan_history.json — but only if no scan for the same URL was
 * saved in the last 5 minutes, preventing duplicate history entries that arise
 * from MV3 service worker restarts re-triggering the full analysis pipeline.
 */

import { Router, Request, Response } from 'express';
import { analyseUrl, HeuristicResult } from '../detection/heuristic';
import { runSandbox, SandboxResult } from '../sandbox/playwrightSandbox';
import { summarise } from '../summariser/ruleBased';
import { saveScan, hasScanForUrl } from '../database/db';

const router = Router();

/**
 * Returns true when `url` is a parseable http:// or https:// address.
 * Used for lightweight input validation before running expensive analysis.
 */
function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * POST /summarise
 *
 * Body:
 *   url            {string}           Required. The URL to summarise.
 *   heuristicResult {HeuristicResult} Optional. Pre-computed by the service worker.
 *   sandboxResult  {SandboxResult}    Optional. Pre-computed by the service worker.
 *
 * When pre-computed results are supplied and structurally valid, they are
 * reused (avoiding a redundant backend round-trip). Otherwise a fresh run is
 * performed. Clients cannot use this endpoint to spoof risk levels because the
 * summariser always re-computes `overallRisk` from the supplied/computed data.
 *
 * Returns: { summary, bulletPoints, overallRisk }
 */
router.post('/', async (req: Request, res: Response) => {
  const { url, heuristicResult, sandboxResult, log } = req.body as {
    url?: string;
    heuristicResult?: HeuristicResult;
    sandboxResult?: SandboxResult;
    log?: boolean;
  };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "url" field in request body.' });
    return;
  }

  if (!isValidHttpUrl(url)) {
    res.status(400).json({ error: 'URL must be a valid http:// or https:// address.' });
    return;
  }

  try {
    // Accept pre-computed results from the service worker when structurally valid.
    // Re-run locally if the supplied objects are missing required fields.
    const heuristic: HeuristicResult =
      heuristicResult && typeof heuristicResult.riskScore === 'number'
        ? heuristicResult
        : analyseUrl(url);

    const sandbox: SandboxResult =
      sandboxResult && typeof sandboxResult.screenshot === 'string'
        ? sandboxResult
        : await runSandbox(url);

    const result = summarise(heuristic, sandbox);

    // Persist to history only when the caller explicitly opts in (log:true).
    // Auto-triggered background scans set log:false — the user never consented
    // to having those URLs stored. Only popup "Scan URL" clicks set log:true.
    if (log === true && !hasScanForUrl(url, 5)) {
      saveScan({
        url,
        domain:               heuristic.domain,
        risk_score:           heuristic.riskScore,
        risk_level:           heuristic.riskLevel,
        factors:              JSON.stringify(heuristic.factors),
        page_title:           sandbox.pageTitle,
        has_password_field:   sandbox.hasPasswordField   ? 1 : 0,
        has_credit_card_field: sandbox.hasCreditCardField ? 1 : 0,
        summary:              result.summary,
      });
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
