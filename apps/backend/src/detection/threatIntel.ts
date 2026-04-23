/**
 * threatIntel.ts
 * Google Safe Browsing v4 API integration for PhishScope+.
 *
 * Checks a URL against Google's threat databases (phishing, malware, unwanted
 * software). Returns a result indicating whether the URL is known-malicious and
 * which threat types were matched.
 *
 * Requires the environment variable GOOGLE_SAFE_BROWSING_API_KEY to be set.
 * If the key is absent or the API call fails, the function returns a safe
 * no-match result so the heuristic pipeline continues uninterrupted.
 *
 * Free tier: 10,000 queries/day — sufficient for local/demo use.
 * API docs: https://developers.google.com/safe-browsing/v4/lookup-api
 */

const SAFE_BROWSING_ENDPOINT =
  'https://safebrowsing.googleapis.com/v4/threatMatches:find';

const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',         // phishing
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
];

export interface ThreatIntelResult {
  isMalicious: boolean;
  threats: string[];   // e.g. ["SOCIAL_ENGINEERING", "MALWARE"]
}

/**
 * Queries Google Safe Browsing for the given URL.
 *
 * @param url - The fully-qualified URL to check.
 * @returns ThreatIntelResult — always resolves, never rejects.
 */
export async function checkThreatIntel(url: string): Promise<ThreatIntelResult> {
  const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
  if (!apiKey) return { isMalicious: false, threats: [] };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'phishscope-plus', clientVersion: '1.0.0' },
        threatInfo: {
          threatTypes: THREAT_TYPES,
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) return { isMalicious: false, threats: [] };

    const data = await response.json() as { matches?: Array<{ threatType: string }> };
    const matches = data.matches ?? [];

    return {
      isMalicious: matches.length > 0,
      threats: [...new Set(matches.map(m => m.threatType))],
    };
  } catch {
    // Network error, timeout, or API quota exceeded — fail open
    return { isMalicious: false, threats: [] };
  }
}
