# PhishScope+

A Chrome browser extension that detects phishing URLs through a multi-layered approach combining on-device heuristic analysis, headless browser sandboxing, and Google Safe Browsing threat intelligence — built as a Final Year Project (TP067323).

---

## Features

- **On-Device Heuristic Analysis** — 16-factor URL scoring engine that runs entirely in-browser with no network calls (< 1 ms)
- **Headless Browser Sandbox** — Playwright/Chromium automation captures screenshots, detects credential/payment fields, tracks redirects, and flags suspicious POST targets
- **Google Safe Browsing Integration** — Optional threat intelligence lookup against Google's phishing/malware database
- **Plain-Language Risk Summary** — Rule-based engine generates one-sentence risk narratives and per-factor explanations
- **Interstitial Warning Page** — Full-screen warning intercepts navigation to high/medium risk URLs before the user reaches the site
- **Scan History** — Stores up to 500 recent scans locally with per-item deletion; query strings stripped for privacy
- **Privacy-First** — Automatic scanning uses only on-device heuristics; backend is called only on explicit user consent

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension UI | React 18, TypeScript, Webpack 5 |
| Chrome API | Manifest V3 (service worker, content script) |
| Backend | Node.js, Express.js, TypeScript |
| Sandbox | Playwright (Headless Chromium) |
| Threat Intel | Google Safe Browsing API v4 |
| Domain Parsing | tldts |

---

## Project Structure

```
PhishScope-Plus/
├── apps/
│   ├── backend/            # Express.js API server
│   │   └── src/
│   │       ├── detection/  # Heuristic engine + threat intel
│   │       ├── sandbox/    # Playwright headless browser
│   │       ├── summariser/ # Rule-based text generation
│   │       ├── routes/     # REST API endpoints
│   │       └── database/   # JSON file persistence
│   └── extension/          # Chrome MV3 extension
│       └── src/
│           ├── popup/      # React popup UI
│           ├── background/ # Service worker
│           ├── content/    # Link inspection content script
│           ├── warning/    # Interstitial warning page
│           └── detection/  # On-device heuristic (no deps)
└── packages/
    └── shared/             # Shared TypeScript types
```

---

## Getting Started

### Prerequisites

- Node.js 16+
- Chrome/Chromium browser
- Google Safe Browsing API key (optional — [get one here](https://console.cloud.google.com/apis/library/safebrowsing.googleapis.com))

### Installation

```bash
# Clone the repo
git clone https://github.com/WilsonChieu/PhishScope-Plus.git
cd PhishScope-Plus

# Install all workspace dependencies
npm install
```

### Configure the Backend

Create `apps/backend/.env` (use `.env.example` as a template):

```env
PORT=3000
GOOGLE_SAFE_BROWSING_API_KEY=your_api_key_here
```

### Run the Backend

```bash
cd apps/backend
npm run dev      # Dev mode with auto-reload
# Server starts at http://localhost:3000
```

### Build the Extension

```bash
cd apps/extension
npm run build    # Production build → dist/
# or
npm run dev      # Watch mode
```

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `apps/extension/dist/` folder

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | Liveness check |
| POST | `/analyse-url` | Heuristic URL scoring + threat intel |
| POST | `/sandbox-preview` | Headless browser analysis |
| POST | `/summarise` | Generate plain-language risk summary |
| GET | `/history` | Retrieve recent scan history |
| DELETE | `/history` | Clear all scan history |
| DELETE | `/history/:id` | Delete a single scan record |

---

## Heuristic Risk Factors

The engine scores URLs across 16 signals:

- IP address used as hostname
- Missing HTTPS
- Suspicious TLD (`.tk`, `.xyz`, `.pw`, etc.)
- Brand token mismatch (e.g. `fake-paypal.xyz`)
- Homoglyph / punycode domain
- URL shortener service
- `@` symbol credential trick
- Excessive subdomain depth (≥ 3 levels)
- High-entropy domain name (DGA indicator)
- Phishing keywords in domain or path
- Non-standard port
- Abnormally long URL
- Deep path structure (> 5 segments)
- Multiple hyphens in domain
- Consecutive digits in domain
- Invalid / unparseable URL

---

## Architecture

```
User navigates to URL
        │
        ▼
[Content Script] ──heuristic only──▶ Low risk → allow
        │
        │ High / Medium risk
        ▼
[Warning Page] ──── user proceeds ────▶ site loads
        │
        │ user opens popup & clicks Scan
        ▼
[Backend API]
  ├── /analyse-url   (heuristic + Google Safe Browsing)
  ├── /sandbox-preview  (Playwright headless Chromium)
  └── /summarise     (rule-based plain-language summary)
        │
        ▼
[Popup UI] displays RiskBadge, score, factors, summary, screenshot
```

---

## Privacy

- Automatic (passive) detection runs entirely on-device — no data leaves the browser
- Backend is contacted **only** when the user explicitly clicks **Scan URL**
- Query strings and URL fragments are stripped before any scan record is stored
- No user tracking, analytics, or telemetry of any kind

---
MIT

---

*FYP Project TP067323*
```
