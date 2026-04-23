/**
 * heuristic.ts
 * URL-based heuristic risk scoring engine for PhishScope+.
 *
 * Analyses a URL's structural properties — without making any network requests —
 * and returns a normalised risk score (0–100) plus a list of triggered factors.
 * Each factor has a fixed weight; the raw weight sum is normalised against the
 * maximum possible score so the final value always fits in [0, 100].
 *
 * Risk thresholds:  score ≤ 30 → low | ≤ 60 → medium | > 60 → high
 */

import { parse as parseTld } from 'tldts';

/** Result returned by analyseUrl(). */
export interface HeuristicResult {
  riskScore: number;              // 0–100 normalised risk score
  riskLevel: 'low' | 'medium' | 'high';
  factors: string[];              // list of triggered factor keys
  domain: string;                 // registered domain (e.g. "example.com")
  isHttps: boolean;
}

/**
 * Top-level domains that are free, frequently abused for phishing, or both.
 * Presence of any of these TLDs adds to the risk score.
 */
const SUSPICIOUS_TLDS = new Set([
  // Free / abuse-prone ccTLDs
  '.tk', '.ml', '.ga', '.cf', '.gq',
  // Commonly abused gTLDs
  '.xyz', '.pw', '.top', '.cc', '.icu', '.vip', '.click', '.online',
  '.date', '.men', '.bid', '.loan', '.win', '.download', '.stream',
  '.racing', '.trade', '.review', '.accountant', '.link', '.work',
]);

/**
 * Well-known URL shortening services.
 * These mask the true destination and are frequently exploited in phishing campaigns.
 */
const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'ow.ly', 't.co', 'short.link', 'rb.gy',
  'is.gd', 'v.gd', 'buff.ly', 'dlvr.it', 'ift.tt', 'cutt.ly',
  'shorte.st', 'clck.ru', 'tiny.cc', 'shorturl.at', 'qr.io', 'u.to',
  'tr.im', 'snip.ly', 'bl.ink', 'rebrand.ly', 'trib.al', 'x.co',
]);

/**
 * Keywords frequently found in phishing URL paths and query strings.
 * Flagged when 2 or more appear together — reduces false positives on
 * legitimate sites that may use one of these words in isolation.
 */
const PHISHING_KEYWORDS = [
  'verify', 'secure', 'update', 'confirm', 'validate',
  'signin', 'login', 'password', 'credential',
  'account', 'billing', 'payment',
  'suspend', 'alert', 'recover', 'reset', 'unlock', 'reactivate',
];

/**
 * Maps a brand token to the set of registered domains that legitimately use it.
 * If a URL's hostname contains the brand token but is NOT on one of these
 * official domains, it is flagged as `brand_token_mismatch`.
 */
const BRAND_OFFICIAL_DOMAINS: Record<string, string[]> = {
  paypal:      ['paypal.com', 'paypal.co.uk', 'paypal.com.au'],
  google:      ['google.com', 'google.co.uk', 'google.com.au', 'google.ca', 'googleapis.com', 'google.de', 'google.fr'],
  apple:       ['apple.com', 'icloud.com', 'itunes.com'],
  amazon:      ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.com.au', 'amazonaws.com'],
  microsoft:   ['microsoft.com', 'live.com', 'hotmail.com', 'office.com', 'azure.com', 'msn.com', 'microsoftonline.com'],
  facebook:    ['facebook.com', 'fb.com', 'fbcdn.net', 'meta.com'],
  instagram:   ['instagram.com'],
  twitter:     ['twitter.com', 'x.com', 't.co'],
  netflix:     ['netflix.com'],
  chase:       ['chase.com'],
  wellsfargo:  ['wellsfargo.com'],
  citibank:    ['citi.com', 'citibank.com'],
  hsbc:        ['hsbc.com', 'hsbc.co.uk'],
  barclays:    ['barclays.com', 'barclays.co.uk'],
  dropbox:     ['dropbox.com'],
  linkedin:    ['linkedin.com'],
  ebay:        ['ebay.com', 'ebay.co.uk'],
  yahoo:       ['yahoo.com', 'yahoo.co.uk'],
  outlook:     ['outlook.com', 'outlook.live.com'],
  office365:   ['office365.com', 'office.com', 'microsoft.com'],
  gmail:       ['gmail.com', 'google.com'],
  steam:       ['steampowered.com', 'steamcommunity.com'],
  binance:     ['binance.com'],
  coinbase:    ['coinbase.com'],
};

const BRAND_TOKENS = Object.keys(BRAND_OFFICIAL_DOMAINS);

/**
 * Point weights assigned to each risk factor.
 * The sum of all weights equals MAX_POSSIBLE_SCORE, which is used to normalise
 * the raw score into the 0–100 range.
 */
const FACTOR_WEIGHTS: Record<string, number> = {
  ip_in_url:            20,  // raw IP instead of domain name
  no_https:             15,  // unencrypted HTTP connection
  suspicious_tld:       15,  // free/abuse-prone TLD
  brand_token_mismatch: 20,  // brand name in hostname but not on official domain
  homoglyph_domain:     20,  // punycode / non-ASCII lookalike characters
  url_shortener:        15,  // known link-shortening service masks true destination
  at_symbol:            15,  // @ credential trick in URL — almost never legitimate
  many_subdomains:      10,  // ≥3 subdomain levels
  high_entropy_domain:  10,  // randomly-generated DGA-style domain
  keyword_in_domain:    12,  // phishing keyword embedded in the registered domain label
  suspicious_keywords:   8,  // 2+ phishing keywords in path/query/subdomain
  non_standard_port:    10,  // non-standard port (not 80/443) in URL
  excessive_length:      5,  // URL > 120 characters
  deep_path:             5,  // > 5 path segments
  hyphen_domain:         5,  // ≥2 hyphens in registered domain
  digits_in_domain:      5,  // ≥4 consecutive digits in domain
};

/** Sum of all factor weights — used for score normalisation. */
const MAX_POSSIBLE_SCORE = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Validates that a host string is a well-formed IPv4 address.
 * Each octet must be a decimal integer in [0, 255].
 */
function isIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/**
 * Computes Shannon entropy of a string in bits per character.
 * High entropy (> 3.7) on a long domain label indicates a randomly-generated
 * DGA-style name rather than a human-chosen word.
 */
function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1;
  const n = s.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / n;
    return sum + p * Math.log2(p);
  }, 0);
}

/**
 * Maps a normalised score to a human-readable risk level.
 */
function getRiskLevel(score: number): 'low' | 'medium' | 'high' {
  if (score <= 30) return 'low';
  if (score <= 60) return 'medium';
  return 'high';
}

/**
 * Analyses a URL's structural properties and returns a heuristic risk assessment.
 *
 * No network requests are made — the function is pure URL-string analysis and
 * completes in <1 ms. It is safe to call on every navigation event.
 *
 * Factors checked (see FACTOR_WEIGHTS for point values):
 *  - ip_in_url            Raw IPv4 address instead of a domain name
 *  - no_https             Protocol is http:// (unencrypted)
 *  - suspicious_tld       TLD is in the abuse-prone set
 *  - homoglyph_domain     Hostname contains non-ASCII or punycode (xn--) labels
 *  - brand_token_mismatch Brand keyword in hostname but not on official domain
 *  - url_shortener        Registered domain is a known link-shortening service
 *  - at_symbol            @ character in the URL (credential smuggling trick)
 *  - many_subdomains      ≥3 subdomain levels
 *  - high_entropy_domain  Domain label Shannon entropy > 3.7 (DGA-style name)
 *  - suspicious_keywords  2+ phishing keywords in URL path/query string
 *  - excessive_length     URL length > 120 characters
 *  - deep_path            > 5 path segments
 *  - hyphen_domain        ≥3 hyphens in the registered domain
 *  - digits_in_domain     ≥4 consecutive digits in the registered domain
 *
 * @param rawUrl - The full URL string to analyse (must include protocol).
 * @returns HeuristicResult with score, level, triggered factors, domain, and HTTPS flag.
 */
export function analyseUrl(rawUrl: string): HeuristicResult {
  const factors: string[] = [];
  let rawScore = 0;

  // Attempt to parse the URL; treat unparseable strings as maximally suspicious.
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      riskScore: 100,
      riskLevel: 'high',
      factors: ['invalid_url'],
      domain: '',
      isHttps: false,
    };
  }

  const hostname = parsed.hostname;
  const isHttps = parsed.protocol === 'https:';
  const tldParsed = parseTld(hostname);
  const registeredDomain = tldParsed.domain ?? hostname;
  const tld = tldParsed.publicSuffix ? `.${tldParsed.publicSuffix}` : '';
  const domainLabel = tldParsed.domainWithoutSuffix ?? registeredDomain;
  const subdomains = tldParsed.subdomain?.split('.').filter(Boolean) ?? [];

  // ── Factor checks ──────────────────────────────────────────────────────────

  // IPv4 address used as host (avoids domain reputation checks)
  if (isIPv4(hostname)) {
    factors.push('ip_in_url');
    rawScore += FACTOR_WEIGHTS.ip_in_url;
  }

  // No HTTPS — connection is unencrypted and interceptable
  if (!isHttps) {
    factors.push('no_https');
    rawScore += FACTOR_WEIGHTS.no_https;
  }

  // TLD is free or frequently associated with phishing infrastructure
  if (SUSPICIOUS_TLDS.has(tld)) {
    factors.push('suspicious_tld');
    rawScore += FACTOR_WEIGHTS.suspicious_tld;
  }

  // Homoglyph / IDN (punycode) domain — non-ASCII or xn-- labels indicate
  // lookalike attacks (e.g. Cyrillic "а" substituted for Latin "a")
  const hasNonAscii = [...hostname].some(c => c.charCodeAt(0) > 127);
  const hasPunycode = hostname.split('.').some(label => label.toLowerCase().startsWith('xn--'));
  if (hasNonAscii || hasPunycode) {
    factors.push('homoglyph_domain');
    rawScore += FACTOR_WEIGHTS.homoglyph_domain;
  }

  // Known URL shortening service — masks the true destination
  if (URL_SHORTENERS.has(registeredDomain)) {
    factors.push('url_shortener');
    rawScore += FACTOR_WEIGHTS.url_shortener;
  }

  // Brand token in hostname but not on the brand's official registered domain.
  // Only the hostname is checked — brand names in paths are legitimate (e.g. news articles).
  const hostLower = hostname.toLowerCase();
  for (const brand of BRAND_TOKENS) {
    const officialDomains = BRAND_OFFICIAL_DOMAINS[brand] ?? [];
    const isOfficialDomain = officialDomains.some(od => registeredDomain.toLowerCase() === od);
    if (hostLower.includes(brand) && !isOfficialDomain) {
      factors.push('brand_token_mismatch');
      rawScore += FACTOR_WEIGHTS.brand_token_mismatch;
      break; // Only penalise once even if multiple brands match
    }
  }

  // @ symbol in URL — can disguise the real destination (http://user@evil.com)
  if (parsed.username || rawUrl.includes('@')) {
    factors.push('at_symbol');
    rawScore += FACTOR_WEIGHTS.at_symbol;
  }

  // Excessive subdomain depth (≥3 levels) — used to mimic legitimate services
  if (subdomains.length >= 3) {
    factors.push('many_subdomains');
    rawScore += FACTOR_WEIGHTS.many_subdomains;
  }

  // High Shannon entropy on domain label — indicates a randomly-generated
  // DGA-style name used by phishing/malware infrastructure to evade blocklists.
  // Only checked for labels longer than 10 characters to avoid false positives
  // on short but uncommon legitimate names.
  if (domainLabel.length > 10 && shannonEntropy(domainLabel) > 3.7) {
    factors.push('high_entropy_domain');
    rawScore += FACTOR_WEIGHTS.high_entropy_domain;
  }

  // Phishing keyword embedded directly in the registered domain label
  // (e.g. "secure-login.tk", "verify-account.com") — stronger signal than
  // keywords in the path, which often appear on legitimate sites.
  if (PHISHING_KEYWORDS.some(kw => domainLabel.toLowerCase().includes(kw))) {
    factors.push('keyword_in_domain');
    rawScore += FACTOR_WEIGHTS.keyword_in_domain;
  }

  // 2+ phishing keywords in path/query/subdomain — reduces false positives vs.
  // checking a single keyword, which may appear on legitimate sites in isolation.
  const subdomain = tldParsed.subdomain?.toLowerCase() ?? '';
  const pathAndQuery = `${subdomain}.${parsed.pathname}${parsed.search}`.toLowerCase();
  const matchedKeywords = PHISHING_KEYWORDS.filter(kw => pathAndQuery.includes(kw));
  if (matchedKeywords.length >= 2) {
    factors.push('suspicious_keywords');
    rawScore += FACTOR_WEIGHTS.suspicious_keywords;
  }

  // Non-standard port — legitimate sites almost always use 80/443.
  // A non-default port (e.g. :8080, :4443) is a strong indicator of an
  // improvised phishing server or a suspicious proxy.
  const port = parsed.port ? parseInt(parsed.port, 10) : null;
  if (port !== null && port !== 80 && port !== 443) {
    factors.push('non_standard_port');
    rawScore += FACTOR_WEIGHTS.non_standard_port;
  }

  // Abnormally long URL (> 120 chars) — can hide the true destination in noise
  if (rawUrl.length > 120) {
    factors.push('excessive_length');
    rawScore += FACTOR_WEIGHTS.excessive_length;
  }

  // Deep URL path (>5 segments) — mimics legitimate navigation paths
  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 5) {
    factors.push('deep_path');
    rawScore += FACTOR_WEIGHTS.deep_path;
  }

  // Multiple hyphens in registered domain (≥2) — common in typosquatting
  // e.g. "paypal-secure.com", "secure-paypal-login.com"
  if ((registeredDomain.match(/-/g) ?? []).length >= 2) {
    factors.push('hyphen_domain');
    rawScore += FACTOR_WEIGHTS.hyphen_domain;
  }

  // Long numeric sequence in domain (≥4 digits) — rare in legitimate domains
  if (/\d{4,}/.test(registeredDomain)) {
    factors.push('digits_in_domain');
    rawScore += FACTOR_WEIGHTS.digits_in_domain;
  }

  // Normalise raw weight sum to [0, 100]
  const riskScore = Math.min(100, Math.round((rawScore / MAX_POSSIBLE_SCORE) * 100));

  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    factors,
    domain: registeredDomain,
    isHttps,
  };
}
