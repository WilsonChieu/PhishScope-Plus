/**
 * heuristic.ts (extension)
 * On-device URL risk engine — mirrors the backend scoring algorithm but uses
 * the browser URL API instead of the tldts package so it runs inside the
 * extension without any npm dependencies or network requests.
 *
 * Used as a privacy gate: only URLs that score medium/high locally are
 * forwarded to the backend for deeper analysis.
 */

import type { AnalyseUrlResponse } from '../types/api';

const SUSPICIOUS_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq',
  '.xyz', '.pw', '.top', '.cc', '.icu', '.vip', '.click', '.online',
  '.date', '.men', '.bid', '.loan', '.win', '.download', '.stream',
  '.racing', '.trade', '.review', '.accountant', '.link', '.work',
]);

const URL_SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'ow.ly', 't.co', 'short.link', 'rb.gy',
  'is.gd', 'v.gd', 'buff.ly', 'dlvr.it', 'ift.tt', 'cutt.ly',
  'shorte.st', 'clck.ru', 'tiny.cc', 'shorturl.at', 'qr.io', 'u.to',
  'tr.im', 'snip.ly', 'bl.ink', 'rebrand.ly', 'trib.al', 'x.co',
]);

const PHISHING_KEYWORDS = [
  'verify', 'secure', 'update', 'confirm', 'validate',
  'signin', 'login', 'password', 'credential',
  'account', 'billing', 'payment',
  'suspend', 'alert', 'recover', 'reset', 'unlock', 'reactivate',
];

const BRAND_OFFICIAL_DOMAINS: Record<string, string[]> = {
  paypal:     ['paypal.com', 'paypal.co.uk', 'paypal.com.au'],
  google:     ['google.com', 'google.co.uk', 'google.com.au', 'google.ca', 'googleapis.com', 'google.de', 'google.fr'],
  apple:      ['apple.com', 'icloud.com', 'itunes.com'],
  amazon:     ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.ca', 'amazon.com.au', 'amazonaws.com'],
  microsoft:  ['microsoft.com', 'live.com', 'hotmail.com', 'office.com', 'azure.com', 'msn.com', 'microsoftonline.com'],
  facebook:   ['facebook.com', 'fb.com', 'fbcdn.net', 'meta.com'],
  instagram:  ['instagram.com'],
  twitter:    ['twitter.com', 'x.com', 't.co'],
  netflix:    ['netflix.com'],
  chase:      ['chase.com'],
  wellsfargo: ['wellsfargo.com'],
  citibank:   ['citi.com', 'citibank.com'],
  hsbc:       ['hsbc.com', 'hsbc.co.uk'],
  barclays:   ['barclays.com', 'barclays.co.uk'],
  dropbox:    ['dropbox.com'],
  linkedin:   ['linkedin.com'],
  ebay:       ['ebay.com', 'ebay.co.uk'],
  yahoo:      ['yahoo.com', 'yahoo.co.uk'],
  outlook:    ['outlook.com', 'outlook.live.com'],
  office365:  ['office365.com', 'office.com', 'microsoft.com'],
  gmail:      ['gmail.com', 'google.com'],
  steam:      ['steampowered.com', 'steamcommunity.com'],
  binance:    ['binance.com'],
  coinbase:   ['coinbase.com'],
};

const BRAND_TOKENS = Object.keys(BRAND_OFFICIAL_DOMAINS);

const FACTOR_WEIGHTS: Record<string, number> = {
  ip_in_url:            20,
  no_https:             15,
  suspicious_tld:       15,
  brand_token_mismatch: 20,
  homoglyph_domain:     20,
  url_shortener:        15,
  at_symbol:            15,
  many_subdomains:      10,
  high_entropy_domain:  10,
  keyword_in_domain:    12,
  suspicious_keywords:   8,
  non_standard_port:    10,
  excessive_length:      5,
  deep_path:             5,
  hyphen_domain:         5,
  digits_in_domain:      5,
};

const MAX_POSSIBLE_SCORE = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);

// Covers the most common two-part public suffixes used by major brands/regions
const MULTI_PART_TLDS = new Set([
  'co.uk', 'com.au', 'co.in', 'com.br', 'co.za', 'org.uk', 'net.au',
  'me.uk', 'org.au', 'co.nz', 'co.jp', 'gov.uk', 'gov.au', 'edu.au',
  'co.id', 'com.sg', 'com.my', 'com.ph', 'com.hk', 'co.kr',
]);

function parseDomain(hostname: string) {
  const parts = hostname.split('.');
  if (parts.length < 2) {
    return { registeredDomain: hostname, tld: '', domainLabel: hostname, subdomains: [] as string[] };
  }
  const lastTwo = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    const tld = `.${lastTwo}`;
    const domainLabel = parts[parts.length - 3];
    return {
      registeredDomain: `${domainLabel}${tld}`,
      tld,
      domainLabel,
      subdomains: parts.slice(0, -3),
    };
  }
  const tld = `.${parts[parts.length - 1]}`;
  const domainLabel = parts[parts.length - 2];
  return {
    registeredDomain: `${domainLabel}${tld}`,
    tld,
    domainLabel,
    subdomains: parts.slice(0, -2),
  };
}

function isIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1;
  const n = s.length;
  return -Object.values(freq).reduce((sum, count) => {
    const p = count / n;
    return sum + p * Math.log2(p);
  }, 0);
}

function getRiskLevel(score: number): 'low' | 'medium' | 'high' {
  if (score <= 30) return 'low';
  if (score <= 60) return 'medium';
  return 'high';
}

/**
 * Analyses a URL's structural properties entirely on-device.
 * Identical scoring logic to the backend heuristic engine; no network call.
 */
export function analyseUrlLocally(rawUrl: string): AnalyseUrlResponse {
  const factors: string[] = [];
  let rawScore = 0;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { riskScore: 100, riskLevel: 'high', factors: ['invalid_url'], domain: '', isHttps: false };
  }

  const hostname = parsed.hostname;
  const isHttps = parsed.protocol === 'https:';
  const { registeredDomain, tld, domainLabel, subdomains } = parseDomain(hostname);

  if (isIPv4(hostname)) {
    factors.push('ip_in_url');
    rawScore += FACTOR_WEIGHTS.ip_in_url;
  }

  if (!isHttps) {
    factors.push('no_https');
    rawScore += FACTOR_WEIGHTS.no_https;
  }

  if (SUSPICIOUS_TLDS.has(tld)) {
    factors.push('suspicious_tld');
    rawScore += FACTOR_WEIGHTS.suspicious_tld;
  }

  const hasNonAscii = [...hostname].some(c => c.charCodeAt(0) > 127);
  const hasPunycode = hostname.split('.').some(label => label.toLowerCase().startsWith('xn--'));
  if (hasNonAscii || hasPunycode) {
    factors.push('homoglyph_domain');
    rawScore += FACTOR_WEIGHTS.homoglyph_domain;
  }

  if (URL_SHORTENERS.has(registeredDomain)) {
    factors.push('url_shortener');
    rawScore += FACTOR_WEIGHTS.url_shortener;
  }

  const hostLower = hostname.toLowerCase();
  for (const brand of BRAND_TOKENS) {
    const officialDomains = BRAND_OFFICIAL_DOMAINS[brand] ?? [];
    const isOfficialDomain = officialDomains.some(od => registeredDomain.toLowerCase() === od);
    if (hostLower.includes(brand) && !isOfficialDomain) {
      factors.push('brand_token_mismatch');
      rawScore += FACTOR_WEIGHTS.brand_token_mismatch;
      break;
    }
  }

  if (parsed.username || rawUrl.includes('@')) {
    factors.push('at_symbol');
    rawScore += FACTOR_WEIGHTS.at_symbol;
  }

  if (subdomains.length >= 3) {
    factors.push('many_subdomains');
    rawScore += FACTOR_WEIGHTS.many_subdomains;
  }

  if (domainLabel.length > 10 && shannonEntropy(domainLabel) > 3.7) {
    factors.push('high_entropy_domain');
    rawScore += FACTOR_WEIGHTS.high_entropy_domain;
  }

  if (PHISHING_KEYWORDS.some(kw => domainLabel.toLowerCase().includes(kw))) {
    factors.push('keyword_in_domain');
    rawScore += FACTOR_WEIGHTS.keyword_in_domain;
  }

  const subdomainStr = subdomains.join('.').toLowerCase();
  const pathAndQuery = `${subdomainStr}.${parsed.pathname}${parsed.search}`.toLowerCase();
  const matchedKeywords = PHISHING_KEYWORDS.filter(kw => pathAndQuery.includes(kw));
  if (matchedKeywords.length >= 2) {
    factors.push('suspicious_keywords');
    rawScore += FACTOR_WEIGHTS.suspicious_keywords;
  }

  const port = parsed.port ? parseInt(parsed.port, 10) : null;
  if (port !== null && port !== 80 && port !== 443) {
    factors.push('non_standard_port');
    rawScore += FACTOR_WEIGHTS.non_standard_port;
  }

  if (rawUrl.length > 120) {
    factors.push('excessive_length');
    rawScore += FACTOR_WEIGHTS.excessive_length;
  }

  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  if (pathSegments.length > 5) {
    factors.push('deep_path');
    rawScore += FACTOR_WEIGHTS.deep_path;
  }

  if ((registeredDomain.match(/-/g) ?? []).length >= 2) {
    factors.push('hyphen_domain');
    rawScore += FACTOR_WEIGHTS.hyphen_domain;
  }

  if (/\d{4,}/.test(registeredDomain)) {
    factors.push('digits_in_domain');
    rawScore += FACTOR_WEIGHTS.digits_in_domain;
  }

  const riskScore = Math.min(100, Math.round((rawScore / MAX_POSSIBLE_SCORE) * 100));
  return { riskScore, riskLevel: getRiskLevel(riskScore), factors, domain: registeredDomain, isHttps };
}
