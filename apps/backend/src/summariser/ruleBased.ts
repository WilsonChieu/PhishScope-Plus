/**
 * ruleBased.ts
 * Rule-based plain-language summariser for PhishScope+.
 *
 * Combines the heuristic score and sandbox observations into:
 *  - A one-sentence narrative summary (tailored to risk level and key signals)
 *  - A list of human-readable bullet points explaining each risk factor
 *  - A final `overallRisk` that may be higher than the heuristic alone if the
 *    sandbox found credentials fields, payment fields, or external POST targets
 *
 * The overall risk can only be escalated by sandbox findings — never lowered.
 */

import type { HeuristicResult } from '../detection/heuristic';
import type { SandboxResult } from '../sandbox/playwrightSandbox';

/** Output of the summarise() function. */
export interface SummariseResult {
  summary: string;
  bulletPoints: string[];
  overallRisk: 'low' | 'medium' | 'high';
}

/**
 * Human-readable explanations for each heuristic factor key.
 * These are shown as bullet points in the popup's ExplanationList component.
 */
const FACTOR_EXPLANATIONS: Record<string, string> = {
  ip_in_url:            'This URL uses a raw IP address instead of a domain name — a common tactic used by phishing sites to avoid domain reputation checks.',
  no_https:             'The site does not use HTTPS, meaning your connection is unencrypted and data you submit can be intercepted.',
  suspicious_tld:       'The domain uses a low-cost or free top-level domain (e.g. .xyz, .tk) that is frequently associated with disposable phishing infrastructure.',
  brand_token_mismatch: 'The URL contains a well-known brand name in its hostname but is not hosted on that brand\'s official domain — a hallmark of phishing impersonation.',
  homoglyph_domain:     'The domain uses internationalised characters (punycode) which may be visual lookalikes of a trusted brand — e.g. "аpple.com" using a Cyrillic "а".',
  url_shortener:        'This URL uses a link-shortening service (e.g. bit.ly, tinyurl) which hides the true destination — a technique commonly used to disguise phishing links.',
  at_symbol:            'The URL contains an @ symbol, which can be used to disguise the real destination of a link.',
  many_subdomains:      'The URL has an unusually high number of subdomains, often used to obscure the true domain and mimic legitimate services.',
  high_entropy_domain:  'The domain name appears to be randomly generated, a technique used by phishing infrastructure and malware networks to evade reputation-based blocklists.',
  keyword_in_domain:    'The registered domain name itself contains a phishing-related keyword (e.g. "secure", "verify", "login") — a strong indicator of a purpose-built phishing domain.',
  suspicious_keywords:  'The URL contains multiple keywords commonly found in phishing pages (e.g. "verify", "secure", "login", "update") designed to create urgency.',
  non_standard_port:    'The URL uses a non-standard port number. Legitimate websites almost always serve on port 80 or 443; unusual ports are a common trait of improvised phishing servers.',
  excessive_length:     'The URL is unusually long, which can be used to hide the true destination within a maze of parameters.',
  deep_path:            'The URL has an unusually deep path structure, sometimes used to mimic navigation paths of legitimate sites.',
  hyphen_domain:        'The domain contains multiple hyphens, a pattern common in typosquatting domains designed to impersonate real brands.',
  digits_in_domain:     'The domain contains a long sequence of numbers, which is uncommon for legitimate services and typical of generated phishing domains.',
  invalid_url:          'The URL is malformed or cannot be parsed, which is unusual for a legitimate web address.',
  threat_intel_match:   'This URL was found in Google\'s Safe Browsing threat database and has been confirmed as dangerous. Accessing it may expose you to phishing, malware, or other threats.',
};

/** Numeric ordering for risk levels — used to determine the higher of two levels. */
const RISK_ORDER: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 1, high: 2 };

/**
 * Returns the higher of two risk levels.
 * Used when combining heuristic and sandbox risk signals.
 *
 * @param a - First risk level.
 * @param b - Second risk level.
 */
function maxRisk(a: 'low' | 'medium' | 'high', b: 'low' | 'medium' | 'high'): 'low' | 'medium' | 'high' {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/**
 * Computes the final overall risk level by potentially escalating the heuristic
 * result based on what the sandbox observed on the live page.
 *
 * Escalation rules (sandbox signals can only raise risk, never lower it):
 *  - Password field present                        → at least medium
 *  - Password field + brand impersonation signal   → high
 *  - Credit card / payment field present           → at least medium; if already medium → high
 *  - External POST targets detected                → at least medium
 *
 * @param heuristicLevel - Risk level from URL-only heuristic analysis.
 * @param sandbox        - Live sandbox observations.
 * @param factors        - Triggered heuristic factor keys.
 */
function computeOverallRisk(
  heuristicLevel: 'low' | 'medium' | 'high',
  sandbox: SandboxResult,
  factors: string[],
): 'low' | 'medium' | 'high' {
  let level = heuristicLevel;

  if (sandbox.hasPasswordField) {
    level = maxRisk(level, 'medium');

    // Password field combined with brand impersonation → escalate to high
    const hasBrandSignal =
      factors.includes('brand_token_mismatch') || sandbox.detectedBrands.length > 0;
    if (hasBrandSignal) level = 'high';
  }

  if (sandbox.hasCreditCardField) {
    level = maxRisk(level, 'medium');
    // Payment fields on a site that already scored medium → high
    if (level === 'medium') level = 'high';
  }

  if (sandbox.externalPostTargets && sandbox.externalPostTargets.length > 0) {
    // Form data sent to a third-party origin — suspicious regardless of score
    level = maxRisk(level, 'medium');
  }

  return level;
}

/**
 * Builds the list of risk factor bullet points shown in the popup.
 *
 * Each triggered heuristic factor maps to a human-readable explanation.
 * Sandbox-specific observations (password/credit card fields, brands, redirects,
 * external POST targets) are appended as additional bullets.
 *
 * @param factors     - Triggered heuristic factor keys.
 * @param sandbox     - Live sandbox observations.
 * @param overallRisk - Final computed risk level (used for conditional messaging).
 */
function buildBullets(
  factors: string[],
  sandbox: SandboxResult,
  overallRisk: 'low' | 'medium' | 'high',
): string[] {
  // Start with one bullet per triggered heuristic factor
  const bullets: string[] = factors
    .filter(f => FACTOR_EXPLANATIONS[f])
    .map(f => FACTOR_EXPLANATIONS[f]);

  // Always warn about password fields — regardless of heuristic risk level,
  // since a low-scoring URL could still be a credential harvesting page
  if (sandbox.hasPasswordField) {
    bullets.push('This page contains a password input field. Do not enter your credentials unless you are certain this is the legitimate site.');
  }

  if (sandbox.hasCreditCardField) {
    bullets.push('This page appears to collect payment or credit card information. Verify the site is legitimate before entering any financial data.');
  }

  if (sandbox.detectedBrands.length > 0) {
    bullets.push(`The page content references brand(s): ${sandbox.detectedBrands.join(', ')}. Confirm you are on the official site before trusting it.`);
  }

  // Warn if the redirect chain crosses domain boundaries — a common phishing tactic
  if (sandbox.redirectChain.length >= 2) {
    try {
      const firstOrigin = new URL(sandbox.redirectChain[0]).origin;
      const lastOrigin  = new URL(sandbox.redirectChain[sandbox.redirectChain.length - 1]).origin;
      if (firstOrigin !== lastOrigin) {
        bullets.push(`This URL redirects through ${sandbox.redirectChain.length} step(s) to a different domain (${lastOrigin}). Redirects to unrelated domains are a common phishing tactic.`);
      }
    } catch { /* ignore unparseable URLs in chain */ }
  }

  // Warn about POST targets that are external to the page origin (possible data exfiltration)
  if (sandbox.externalPostTargets && sandbox.externalPostTargets.length > 0) {
    bullets.push(`The page sends data to external domain(s): ${sandbox.externalPostTargets.join(', ')} — this may indicate form data is being collected by a third party.`);
  }

  return bullets;
}

/**
 * Generates a single narrative summary sentence appropriate for the overall risk level.
 *
 * The message is contextualised using specific signals when present
 * (e.g. brand impersonation + password field, or credit card fields).
 *
 * @param overallRisk    - Final computed risk level (after sandbox escalation).
 * @param heuristicLevel - Raw heuristic risk level (before escalation).
 * @param factors        - Triggered heuristic factor keys.
 * @param sandbox        - Live sandbox observations.
 * @param domain         - Registered domain of the URL.
 */
function buildSummary(
  overallRisk: 'low' | 'medium' | 'high',
  heuristicLevel: 'low' | 'medium' | 'high',
  factors: string[],
  sandbox: SandboxResult,
  domain: string,
): string {
  // True when sandbox observations pushed the risk above the heuristic score
  const sandboxEscalated = overallRisk !== heuristicLevel;

  if (overallRisk === 'high') {
    if (factors.includes('brand_token_mismatch') && sandbox.hasPasswordField) {
      return `This URL shows strong signs of a phishing attempt. It impersonates a known brand and requests your credentials on an unrelated domain (${domain || 'unknown'}). Do not proceed.`;
    }
    if (sandbox.hasCreditCardField) {
      return `This URL requests payment or credit card information${sandboxEscalated ? ' on a site with suspicious characteristics' : ' and exhibits multiple high-risk characteristics'}. Do not enter any financial details.`;
    }
    if (sandboxEscalated && factors.length === 0) {
      return `The page was found to contain suspicious elements (such as credential or payment fields) that raise the risk level. Verify this is the intended site before entering any information.`;
    }
    return `This URL exhibits ${factors.length} high-risk characteristic${factors.length !== 1 ? 's' : ''}. Exercise extreme caution and avoid entering any personal information.`;
  }

  if (overallRisk === 'medium') {
    if (sandboxEscalated && sandbox.hasPasswordField) {
      return `This URL looks relatively safe from a structural standpoint but the page is requesting your password. Verify you are on the correct site before logging in.`;
    }
    return `This URL has some suspicious characteristics that warrant caution. Review the details below before clicking or submitting any information.`;
  }

  return `No significant risk factors were detected for this URL. It appears relatively safe, but always remain vigilant online.`;
}

/**
 * Entry point for the summariser. Combines heuristic and sandbox results into
 * a SummariseResult containing a narrative summary, bullet points, and the
 * final overall risk level.
 *
 * @param heuristic - Result from analyseUrl() in heuristic.ts.
 * @param sandbox   - Result from runSandbox() in playwrightSandbox.ts.
 */
export function summarise(
  heuristic: HeuristicResult,
  sandbox: SandboxResult,
): SummariseResult {
  const overallRisk = computeOverallRisk(heuristic.riskLevel, sandbox, heuristic.factors);
  const bulletPoints = buildBullets(heuristic.factors, sandbox, overallRisk);
  const summary = buildSummary(
    overallRisk,
    heuristic.riskLevel,
    heuristic.factors,
    sandbox,
    heuristic.domain,
  );

  return { summary, bulletPoints, overallRisk };
}
