/**
 * routes/analyseUrl.ts
 * POST /analyse-url
 *
 * Runs URL-only heuristic analysis, then (if GOOGLE_SAFE_BROWSING_API_KEY is
 * configured) cross-checks the URL against Google Safe Browsing threat databases.
 * Returns a risk score, level, triggered factors, and any threat intel findings.
 *
 * No requests are made to the target URL by the heuristic engine — that portion
 * completes in < 1 ms. The Safe Browsing call adds up to 4 s but is skipped
 * gracefully when the API key is absent or the service is unreachable.
 *
 * History is NOT saved here — only /summarise (which has the full picture
 * including sandbox results) persists to scan_history.json.
 */

import { Router, Request, Response } from 'express';
import { analyseUrl } from '../detection/heuristic';
import { checkThreatIntel } from '../detection/threatIntel';

const router = Router();

/**
 * Returns true when `url` is a parseable http:// or https:// address.
 * Rejects relative paths, chrome:// URLs, and other non-HTTP schemes early.
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
 * POST /analyse-url
 *
 * Body:    { url: string }
 * Returns: HeuristicResult + optional threatIntelThreats
 *   { riskScore, riskLevel, factors, domain, isHttps, threatIntelThreats? }
 *
 * If Google Safe Browsing flags the URL:
 *  - 'threat_intel_match' is appended to factors
 *  - riskScore is escalated to at least 90
 *  - riskLevel is set to 'high'
 *  - threatIntelThreats carries the matched threat type strings
 */
router.post('/', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing or invalid "url" field in request body.' });
    return;
  }

  if (!isValidHttpUrl(url)) {
    res.status(400).json({ error: 'URL must be a valid http:// or https:// address.' });
    return;
  }

  try {
    const heuristic = analyseUrl(url);

    // Run threat intel check in parallel — fails open if unavailable
    const threatIntel = await checkThreatIntel(url);

    // Merge threat intel into the heuristic result when a match is found
    if (threatIntel.isMalicious) {
      heuristic.factors.push('threat_intel_match');
      heuristic.riskScore  = Math.max(heuristic.riskScore, 90);
      heuristic.riskLevel  = 'high';
    }

    res.json({
      ...heuristic,
      ...(threatIntel.isMalicious && { threatIntelThreats: threatIntel.threats }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
