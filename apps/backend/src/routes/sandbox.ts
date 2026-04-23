/**
 * routes/sandbox.ts
 * POST /sandbox-preview
 *
 * Launches a headless Chromium instance, visits the target URL, and returns
 * behavioural observations: screenshot, form analysis, brand keywords, redirect
 * chain, and external POST targets.
 *
 * This is the slowest endpoint (~5–20 s depending on page complexity). It is
 * called in parallel with /analyse-url by the service worker so the heuristic
 * result is available immediately while the sandbox runs in the background.
 */

import { Router, Request, Response } from 'express';
import { runSandbox } from '../sandbox/playwrightSandbox';

const router = Router();

/**
 * Returns true when `url` is a parseable http:// or https:// address.
 * Rejects non-HTTP schemes before launching Playwright (which only supports HTTP/S).
 *
 * @param url - Raw URL string from the request body.
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
 * POST /sandbox-preview
 *
 * Body:    { url: string }
 * Returns: SandboxResult — screenshot, pageTitle, formCount, hasPasswordField,
 *          hasCreditCardField, detectedBrands, redirectChain, externalPostTargets, error?
 *
 * On navigation failure (e.g. DNS error, timeout) the response is still HTTP 200
 * with `error` set in the body so the summariser can still produce output.
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
    const result = await runSandbox(url);
    res.json(result);
  } catch (err) {
    // runSandbox() is designed never to throw — this catch is a safety net
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
