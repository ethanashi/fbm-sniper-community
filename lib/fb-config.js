/**
 * Facebook Marketplace Scraper — Configuration
 */

// ─── GraphQL doc_id overrides ────────────────────────────────────────────────
//
// PASTE YOUR DOC_IDS BELOW. This is the FB equivalent of the Vinted cookie:
// when Facebook's anon bootstrap can't discover a search query, the scraper
// uses these known-working doc_ids instead.
//
// You can paste in any reasonable form — bare number, with `doc_id=` prefix,
// with quotes, JSON-style, copied straight from DevTools URL params, etc.
// The sanitizer below extracts the digit run for you. Examples that all work:
//
//   '26533620642955534'
//   'doc_id=26533620642955534'
//   '"doc_id":"26533620642955534"'
//   '&doc_id=26533620642955534&__req=h'
//
// HOW TO REFRESH (5 min, when scraper starts logging "doc_id was not found"
// or "missing_required_variable_value"):
//   1. Open https://www.facebook.com/marketplace/ in your normal browser, logged in.
//   2. DevTools → Network → filter "graphql" → click Clear.
//   3. Navigate to a fresh search URL (e.g. /marketplace/search/?query=iphone).
//   4. Find the POST whose x-fb-friendly-name is `CometMarketplaceSearchContentContainerQuery`
//      (NOT the Pagination variant — that one needs different variables).
//      Copy its `doc_id` from the request payload. Paste below as `search`.
//   5. For detail: click any listing, find the POST with friendly-name
//      `MarketplacePDPContainerQuery`. Copy its `doc_id`. Paste as `detail`.
//
const FB_DOC_IDS = {
  // CometMarketplaceSearchContentContainerQuery — captured 2026-04-28
  search: process.env.FB_SEARCH_DOC_ID || '26533620642955534',
  // MarketplacePDPContainerQuery — captured 2026-04-28
  detail: process.env.FB_DETAIL_DOC_ID || '27009005318723768',
};

// ─── Variables template (REQUIRED when search doc_id is set) ─────────────────
//
// FB's persisted-query schema is strict — sending the wrong shape fails with
// `missing_required_variable_value` (code 1675012). Paste the *variables*
// payload your browser sent with the same `CometMarketplaceSearchContentContainerQuery`
// request, in any of these shapes:
//
//   - The full POST form body (everything in the Payload tab, view source):
//       'av=0&__user=0&...&variables=%7B%22buyLocation%22%3A...%7D&doc_id=...'
//   - The raw `variables=...` URL-encoded value, with or without prefix
//   - The decoded JSON object as a string: '{"buyLocation":{...},"params":{...},...}'
//
// HOW TO CAPTURE (DevTools → that POST → Payload tab):
//   1. Click "view source" or "view URL-encoded" if available — that gives you
//      the whole form body. Copy it. Paste below as a string.
//   2. Or click "view parsed" → expand `variables` → right-click → Copy value.
//      Paste below as a JSON string.
//
// The scraper merges this template into every search request and rewrites
// only the user-specific fields (query, lat/lng, price range, sort).
//
const FB_SEARCH_VARIABLES = process.env.FB_SEARCH_VARIABLES || '';
const FB_DETAIL_VARIABLES = process.env.FB_DETAIL_VARIABLES || '';

/**
 * Extract a doc_id from any reasonable input shape. Returns null if no
 * usable digit run is found. Prefers numbers explicitly tagged with
 * `doc_id` (handles `doc_id=...`, `doc_id: ...`, `"doc_id":"..."`, etc.)
 * but falls back to the first 10+ digit run anywhere in the string.
 */
function sanitizeDocId(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  const tagged = s.match(/doc[_-]?id[^0-9]{0,10}(\d{10,})/i);
  if (tagged) return tagged[1];
  const bare = s.match(/\d{10,}/);
  return bare ? bare[0] : null;
}

/**
 * Parse a GraphQL variables payload from any of:
 *   - full URL-encoded form body containing `variables=...`
 *   - raw URL-encoded JSON
 *   - plain JSON string
 *   - already-an-object
 * Returns the parsed object, or null if nothing usable was found.
 */
function sanitizeVariables(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'object') return input;
  let s = String(input).trim();
  if (!s) return null;

  // If pasted as a full POST body, pull the `variables` field out
  const m = s.match(/(?:^|[&?])variables=([^&]+)/);
  if (m) s = m[1];

  // URL-decode if it looks encoded — the test for percent-escaped braces is
  // cheap and avoids decoding plain JSON twice.
  if (/%7B|%22|%5B/i.test(s)) {
    try { s = decodeURIComponent(s); } catch (_) { /* skip */ }
  }

  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) { /* not valid JSON */ }

  return null;
}

export default {
  // GraphQL persisted-query IDs — see comment block at top of file.
  docIds: {
    search: sanitizeDocId(FB_DOC_IDS.search),
    detail: sanitizeDocId(FB_DOC_IDS.detail),
    // Optional variables template — required when the search doc_id needs
    // a non-default variable shape. Parsed from FB_SEARCH_VARIABLES above.
    searchVariables: sanitizeVariables(FB_SEARCH_VARIABLES),
    detailVariables: sanitizeVariables(FB_DETAIL_VARIABLES),
  },

  // Search defaults
  search: {
    defaultRadiusKM: 65,
    defaultSort: 'CREATION_TIME_DESCEND',
    resultsPerPage: 24,
    maxPages: 5,
  },

  // Location is user-configured via the Settings tab — no default baked in.
  location: {
    latitude: null,
    longitude: null,
  },

  // Rate limiting / stealth
  timing: {
    minDelayBetweenRequests: 1200,
    maxDelayBetweenRequests: 2800,
    sessionRefreshInterval: 30 * 60 * 1000, // 30 min
    retryDelay: 9000,
    maxRetries: 3,
  },

  // Proxy (optional — fill in or use env vars)
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true' || false,
    host: process.env.PROXY_HOST || '',
    port: process.env.PROXY_PORT || '',
    username: process.env.PROXY_USER || '',
    password: process.env.PROXY_PASS || '',
  },

  // Phone-specific search presets
  phoneSearch: {
    queries: ['iphone', 'samsung galaxy', 'pixel'],
    maxPrice: 80000, // cents ($800)
    minPrice: 5000,  // cents ($50)
    categories: [],
  },
};

export { sanitizeDocId, sanitizeVariables };
