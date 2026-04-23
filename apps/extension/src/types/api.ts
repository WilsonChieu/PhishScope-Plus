/**
 * api.ts
 * Shared TypeScript type definitions for the PhishScope+ extension.
 *
 * These interfaces mirror the JSON shapes returned by the backend API and are
 * used across the popup, service worker, content script, and warning page.
 * Keeping types in one file ensures the extension and backend stay in sync.
 */

/** Response from POST /analyse-url — heuristic URL analysis result. */
export interface AnalyseUrlResponse {
  riskScore: number;                    // normalised 0–100
  riskLevel: 'low' | 'medium' | 'high';
  factors: string[];                    // list of triggered factor keys
  domain: string;                       // registered domain (e.g. "example.com")
  isHttps: boolean;
  threatIntelThreats?: string[];        // Google Safe Browsing threat types (if matched)
}

/** Response from POST /sandbox-preview — headless browser observations. */
export interface SandboxPreviewResponse {
  screenshot: string;                   // base64-encoded PNG (empty on error)
  pageTitle: string;
  pageDescription: string;             // <meta name="description"> content
  formCount: number;
  hasPasswordField: boolean;
  hasCreditCardField: boolean;
  iframeCount: number;                 // number of <iframe> elements on page
  externalLinkCount: number;           // links pointing to a different origin
  detectedBrands: string[];             // brand keywords found in visible body text
  redirectChain: string[];              // ordered main-frame navigation URLs
  externalPostTargets: string[];        // third-party origins that received POST data
  error?: string;                       // set if navigation failed
}

/** A single scan record as returned by GET /history. */
export interface ScanRecord {
  id: number;
  url: string;
  domain: string;
  risk_score: number;
  risk_level: string;
  factors: string;                      // JSON-serialised string[] (stored as text)
  page_title: string;
  has_password_field: number;           // 0 | 1
  has_credit_card_field: number;        // 0 | 1
  summary: string;
  scanned_at: string;                   // ISO-8601 timestamp
}

/** Response from POST /summarise — plain-language risk summary. */
export interface SummariseResponse {
  summary: string;                      // one-sentence narrative
  bulletPoints: string[];               // per-factor human-readable explanations
  overallRisk: 'low' | 'medium' | 'high'; // may be higher than heuristic alone
}

/**
 * The full analysis result cached by the service worker and displayed in the popup.
 * Combines all three pipeline stages: heuristic, sandbox, and summarise.
 */
export interface FullAnalysis {
  url: string;
  heuristic: AnalyseUrlResponse;
  sandbox: SandboxPreviewResponse;
  summary: SummariseResponse;
}

/**
 * Messages sent from the popup / warning page to the service worker.
 *   ANALYSE_URL    — trigger full analysis pipeline for a URL
 *   GET_CACHED     — retrieve cached analysis for a tab (popup on open)
 *   ACKNOWLEDGE_URL — mark a URL as user-acknowledged (warning page "proceed")
 */
export type MessageRequest =
  | { type: 'ANALYSE_URL'; url: string }
  | { type: 'GET_CACHED'; tabId: number }
  | { type: 'GET_CACHED_BY_URL'; url: string }
  | { type: 'ACKNOWLEDGE_URL'; url: string };

/**
 * Responses sent back from the service worker to the popup / warning page.
 *   ANALYSIS_RESULT — successful pipeline result
 *   LOADING         — request received but result not yet available
 *   ERROR           — pipeline failed; error message included
 */
export type MessageResponse =
  | { type: 'ANALYSIS_RESULT'; data: FullAnalysis }
  | { type: 'LOADING' }
  | { type: 'ERROR'; error: string };
