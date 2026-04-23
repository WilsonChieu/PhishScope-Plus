/**
 * index.ts
 * PhishScope+ backend entry point.
 *
 * Starts an Express HTTP server that exposes the following routes:
 *   GET  /health           — liveness check used by the extension to test connectivity
 *   POST /analyse-url      — heuristic risk score (URL-only, no network to target)
 *   POST /sandbox-preview  — headless Chromium screenshot + DOM + redirect analysis
 *   POST /summarise        — plain-language summary + history persistence
 *   GET  /history          — recent scan records
 *   DELETE /history/:id    — delete a single scan record
 *   DELETE /history        — delete all scan records
 *
 * CORS is open to all origins so the Chrome extension (which runs on
 * chrome-extension://) can reach the local server without extra configuration.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import analyseUrlRouter from './routes/analyseUrl';
import sandboxRouter from './routes/sandbox';
import summariseRouter from './routes/summarise';
import historyRouter from './routes/history';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

// Allow cross-origin requests from the Chrome extension and any dev tools
app.use(cors({ origin: '*' }));

// Serve admin dashboard and other static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parse JSON request bodies; 2 MB limit accommodates base64 screenshots in /summarise
app.use(express.json({ limit: '2mb' }));

/**
 * GET /health
 * Simple liveness probe. The extension popup shows an error banner if this
 * endpoint is unreachable, prompting the user to start the backend.
 */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'PhishScope+ Backend' });
});

app.use('/analyse-url',     analyseUrlRouter);
app.use('/sandbox-preview', sandboxRouter);
app.use('/summarise',       summariseRouter);
app.use('/history',         historyRouter);

app.listen(PORT, () => {
  console.log(`PhishScope+ backend running on http://localhost:${PORT}`);
});

export default app;
