/**
 * Facebook Marketplace Scraper — Session Bootstrapper
 *
 * Uses Puppeteer to load the Facebook Marketplace page once, extract all the
 * dynamic tokens FB needs for GraphQL calls, and cache them for 30 minutes.
 *
 * Two-phase approach:
 *   1. Intercept ALL /api/graphql/ network requests to capture live doc_ids
 *   2. Also scan inline <script> tags and JS bundles for doc_ids + tokens
 */

import { rotateCookieString } from './fb-utils.js';
import config, { sanitizeDocId, sanitizeVariables } from './fb-config.js';
import { loadWorkspaceConfig } from './shared-marketplace/workspace.js';

/**
 * Resolve the effective FB doc_id overrides at bootstrap time.
 * Workspace config (set via the Settings tab) wins over fb-config.js
 * defaults. Both are sanitized — users can paste pretty much any shape.
 */
function resolveDocOverrides() {
  let ws;
  try { ws = loadWorkspaceConfig(); } catch (_) { ws = null; }
  const fb = ws?.bots?.facebook || {};
  return {
    search: sanitizeDocId(fb.searchDocId) || config.docIds?.search || null,
    detail: sanitizeDocId(fb.detailDocId) || config.docIds?.detail || null,
    searchVariables:
      sanitizeVariables(fb.searchVariables) ||
      config.docIds?.searchVariables ||
      null,
    detailVariables:
      sanitizeVariables(fb.detailVariables) ||
      config.docIds?.detailVariables ||
      null,
  };
}

// ─── Session Cache ─────────────────────────────────────────────────────────────

const _cachedSessions = new Map();
const _pendingSessions = new Map();

// ─── Token Extraction Patterns ────────────────────────────────────────────────
// Facebook embeds these in various ways depending on deployment. We try every
// known pattern and take the first match.

const TOKEN_PATTERNS = {
  lsd: [
    /"LSD",\[\],\{"token":"([^"]+)"\}/,
    /\["LSD",\[\],\{"token":"([^"]+)"\}/,
    /name="lsd"\s+value="([^"]+)"/,
    /"lsd":"([^"]+)"/,
    /"token":"([^"]+)".*?"LSD"/,
  ],
  fb_dtsg: [
    /"DTSGInitialData",\[\],\{"token":"([^"]+)"\}/,
    /"DTSGInitData",\[\],\{"token":"([^"]+)"\}/,
    /"dtsg":\{"token":"([^"]+)"\}/,
    /"fb_dtsg":"([^"]+)"/,
    /\{"name":"fb_dtsg","value":"([^"]+)"\}/,
    /"token":"([^"]+)"[^}]*"DTSGInitial/,
  ],
  jazoest: [
    /jazoest=(\d+)/,
    /name="jazoest"\s+value="(\d+)"/,
    /"jazoest":"(\d+)"/,
    /"jazoest":(\d+)/,
  ],
  __dyn: [
    /&__dyn=([^&"'\s]+)/,
    /"__dyn":"([^"]+)"/,
    /__dyn=([A-Za-z0-9_-]+)/,
  ],
  __csr: [
    /&__csr=([^&"'\s]+)/,
    /"__csr":"([^"]+)"/,
    /__csr=([A-Za-z0-9_-]+)/,
  ],
  __rev: [
    /"server_revision":(\d+)/,
    /"__rev":(\d+)/,
    /\\"__rev\\":(\d+)/,
    /__rev=(\d+)/,
  ],
  __hsi: [
    /"__hsi":"(\d+)"/,
    /&__hsi=(\d+)/,
    /__hsi=(\d+)/,
  ],
  __spin_r: [
    /"__spin_r":(\d+)/,
    /__spin_r=(\d+)/,
  ],
  __spin_b: [
    /"__spin_b":"([^"]+)"/,
    /__spin_b=([^&"'\s]+)/,
  ],
  __spin_t: [
    /"__spin_t":(\d+)/,
    /__spin_t=(\d+)/,
  ],
};

function extractToken(source, patterns) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Bootstrap a Facebook session.
 *
 * @param {string|null} proxyUrl  Optional proxy URL e.g. "http://user:pass@host:port"
 * @returns {Promise<{tokens, cookies, userAgent, docIds, timestamp}>}
 */
export async function bootstrapSession(proxyUrl = null, bootstrapLocation = null) {
  const locTag = bootstrapLocation && Number.isFinite(Number(bootstrapLocation.latitude)) && Number.isFinite(Number(bootstrapLocation.longitude))
    ? `${Number(bootstrapLocation.latitude).toFixed(3)},${Number(bootstrapLocation.longitude).toFixed(3)}`
    : 'nocoords';
  const cacheKey = `${proxyUrl || '__direct__'}::${locTag}`;
  // Return cached session if still fresh
  const cached = _cachedSessions.get(cacheKey) || null;
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < config.timing.sessionRefreshInterval) {
      return cached;
    }
  }

  if (_pendingSessions.has(cacheKey)) {
    return _pendingSessions.get(cacheKey);
  }

  const bootstrapPromise = (async () => {
    let puppeteer;
    try {
      puppeteer = (await import('puppeteer')).default;
    } catch (e) {
      throw new Error(
        'puppeteer is not installed. Run: npm install puppeteer\n' + e.message
      );
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ];

    if (proxyUrl) launchArgs.push(`--proxy-server=${proxyUrl}`);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
    });

    const page = await browser.newPage();

  await page.setViewport({
    width: 1280 + Math.floor(Math.random() * 200),
    height: 720 + Math.floor(Math.random() * 100),
    deviceScaleFactor: 1,
  });

  const userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  await page.setUserAgent(userAgent);

  // Hide webdriver fingerprint
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    // Remove the automation-related properties
    delete navigator.__proto__.webdriver;
  });

  // ─── Intercept ALL network requests to capture doc_ids & tokens ────────────

  const discoveredDocIds = {};
  const capturedTokensFromNetwork = {};

  // Use CDP session for network monitoring (avoids request interception overhead)
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');

  cdp.on('Network.requestWillBeSent', (event) => {
    const { url, postData } = event.request;
    if (!url.includes('/api/graphql/') || !postData) return;

    // Capture doc_id from ANY graphql request
    const docMatch = postData.match(/doc_id=(\d+)/);
    const nameMatch = postData.match(/fb_api_req_friendly_name=([^&]+)/);

    if (docMatch) {
      const docId = docMatch[1];
      const name = nameMatch ? decodeURIComponent(nameMatch[1]) : '';

      console.log(`[fb-session] Intercepted GraphQL: ${name || 'unnamed'} → doc_id=${docId}`);

      // A query qualifies as a real marketplace search only if it mentions
      // both "marketplace" and "search" AND is not a typeahead / suggestion /
      // warm-call decorator / logging mutation. Without this guard, doc_ids
      // from useCIXLogMutation, MarketplaceSuggestionDataSourceQuery, and
      // SERP warm-call decorators get misclassified as the search query and
      // every subsequent /api/graphql/ POST fails with "doc_id not found".
      const isMarketplaceSearch =
        /marketplace.*search|search.*marketplace/i.test(name) &&
        !/typeahead|suggestion|warmcall|warm_call|decorator|mutation|log\b|cixlog/i.test(name);

      if (/CometMarketplaceSearchContentContainer/i.test(name)) {
        discoveredDocIds.searchContent = docId;
      }
      if (/CometMarketplaceSearchRoot/i.test(name)) {
        discoveredDocIds.searchRoot = docId;
      }
      if (/MarketplacePDP|MarketplaceProductDetail|PDPContainer/i.test(name)) {
        discoveredDocIds.detail = docId;
        // Also capture the PDP variables structure
        const varsMatch = postData.match(/variables=([^&]+)/);
        if (varsMatch) {
          try {
            discoveredDocIds._pdpVariables = JSON.parse(decodeURIComponent(varsMatch[1]));
          } catch (_) { /* skip */ }
        }
      }
      // Capture the actual search variables FB used (only from real search queries)
      const varsMatch = postData.match(/variables=([^&]+)/);
      if (varsMatch && isMarketplaceSearch) {
        try {
          discoveredDocIds._capturedVariables = JSON.parse(decodeURIComponent(varsMatch[1]));
        } catch (_) { /* skip */ }
      }
      // Generic last-resort: any query that *looks like* a marketplace search
      // but didn't match the specific Root/Content names above. Tolerant of
      // FB renames (e.g. *PaginationQuery, *PageQuery) without letting
      // unrelated calls pollute the slot.
      if (isMarketplaceSearch && !discoveredDocIds.searchRoot && !discoveredDocIds.searchContent) {
        discoveredDocIds.searchGeneric = docId;
      }
      // Keep a "search" alias pointing to the best candidate. Resolve to
      // null (not an arbitrary doc_id) when nothing valid was discovered, so
      // the scraper throws its "no search doc_id available" error instead of
      // hammering FB with garbage.
      discoveredDocIds.search =
        discoveredDocIds.searchRoot ||
        discoveredDocIds.searchContent ||
        discoveredDocIds.searchGeneric ||
        null;
    }

    // Also capture tokens from the request body itself
    for (const key of ['__dyn', '__csr', '__hsi', 'lsd', 'jazoest', '__rev', '__spin_r', '__spin_b', '__spin_t']) {
      const re = new RegExp(`(?:^|&)${key.replace('__', '__')}=([^&]+)`);
      const m = postData.match(re);
      if (m && m[1]) capturedTokensFromNetwork[key] = decodeURIComponent(m[1]);
    }
  });

    try {
    // ─── Phase 1: Load Marketplace and accept cookies ────────────────────────

    console.log('[fb-session] Loading marketplace page…');
    await page.goto('https://www.facebook.com/marketplace/', {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    // Accept cookie/consent banner (EU regions)
    try {
      // Try multiple selectors for cookie consent
      for (const selector of [
        '[data-testid="cookie-policy-manage-dialog-accept-button"]',
        '[data-cookiebanner="accept_button"]',
        'button[title="Allow all cookies"]',
        'button[title="Permitir todas las cookies"]', // Spanish
      ]) {
        const btn = await page.$(selector);
        if (btn) {
          await btn.click();
          console.log('[fb-session] Accepted cookie banner');
          break;
        }
      }
      // XPath fallback
      const xpaths = [
        '//button[contains(., "Allow all cookies")]',
        '//button[contains(., "Allow essential and optional cookies")]',
        '//button[contains(., "Permitir todas")]',
        '//button[contains(., "Accept All")]',
      ];
      for (const xp of xpaths) {
        try {
          const btns = await page.$x(xp);
          if (btns.length) { await btns[0].click(); break; }
        } catch (_) { /* skip */ }
      }
      await new Promise((r) => setTimeout(r, 2000));
    } catch (_) {
      // Cookie banner may not be present
    }

    // ─── Phase 2: Trigger a search to capture the live doc_id ────────────────

    console.log('[fb-session] Navigating to search page to capture live doc_id…');

    // Navigate to a search URL — this should trigger GraphQL requests.
    // sortBy=creation_time_descend tells FB's frontend to query newest-first,
    // so the variables we intercept will already carry that sort.
    // We deliberately AVOID a city-slug path (e.g. /marketplace/madrid/search/)
    // because FB's frontend bakes that city's internal marketplace_seo_page_id
    // into the captured browse_request_params, and the server then filters
    // every subsequent search to that city regardless of the lat/lng we send.
    // Use the generic /marketplace/search/ with lat/lng query params so the
    // captured variables reflect the user's real location.
    const bootLat = Number(bootstrapLocation?.latitude);
    const bootLng = Number(bootstrapLocation?.longitude);
    const hasBootCoords = Number.isFinite(bootLat) && Number.isFinite(bootLng);
    const searchUrl = hasBootCoords
      ? `https://www.facebook.com/marketplace/search/?query=iphone&sortBy=creation_time_descend&latitude=${bootLat}&longitude=${bootLng}&radius=65`
      : 'https://www.facebook.com/marketplace/search/?query=iphone&sortBy=creation_time_descend';
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    // Scroll down to trigger lazy-loaded content / additional GraphQL calls
    await page.evaluate(() => window.scrollBy(0, 800));
    await new Promise((r) => setTimeout(r, 2000));
    await page.evaluate(() => window.scrollBy(0, 1200));
    await new Promise((r) => setTimeout(r, 2000));

    // If we still don't have a search doc_id, try interacting with the search
    if (!discoveredDocIds.searchRoot && !discoveredDocIds.searchContent) {
      console.log('[fb-session] No search doc_id from navigation, trying search interaction…');
      try {
        const searchInput = await page.$('input[placeholder*="Search"]') ||
                            await page.$('input[aria-label*="Search"]') ||
                            await page.$('input[type="search"]');
        if (searchInput) {
          await searchInput.click();
          await searchInput.type('samsung', { delay: 80 });
          await page.keyboard.press('Enter');
          await new Promise((r) => setTimeout(r, 5000));
        }
      } catch (_) {
        // Search interaction failed — continue
      }
    }

    // ─── Phase 2b: Navigate to a listing detail page to capture PDP doc_id ───

    if (!discoveredDocIds.detail) {
      console.log('[fb-session] Looking for a listing to navigate to for PDP doc_id…');
      try {
        // Find a listing link on the current search results page
        const listingHref = await page.evaluate(() => {
          const links = [...document.querySelectorAll('a[href*="/marketplace/item/"]')];
          const href = links[0]?.href;
          return href || null;
        });

        if (listingHref) {
          console.log(`[fb-session] Navigating to listing page: ${listingHref}`);
          // PDP pages are heavy — 'domcontentloaded' is plenty for CDP to intercept
          // the PDP GraphQL query, and avoids spurious "networkidle2" timeouts.
          await page.goto(listingHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise((r) => setTimeout(r, 3000));
          // CDP will capture MarketplacePDPContainerQuery from this navigation
        } else {
          console.warn('[fb-session] No listing links found on search page — cannot capture PDP doc_id');
        }
      } catch (err) {
        console.warn('[fb-session] Failed to navigate to listing detail:', err.message);
      }
    }

    // ─── Phase 3: Extract tokens from page source ────────────────────────────

    console.log('[fb-session] Extracting tokens from page source…');
    const html = await page.content();

    // Also collect all inline script contents for deeper scanning
    const allScriptText = await page.evaluate(() => {
      return [...document.querySelectorAll('script')]
        .map((s) => s.textContent || '')
        .join('\n');
    });

    // Combine HTML + script text for pattern matching
    const fullSource = html + '\n' + allScriptText;

    const tokens = {};
    for (const [key, patterns] of Object.entries(TOKEN_PATTERNS)) {
      tokens[key] = extractToken(fullSource, patterns);
    }

    // Merge in any tokens we captured from network requests (these are the most
    // reliable since they were actually used in a successful request)
    for (const [key, value] of Object.entries(capturedTokensFromNetwork)) {
      if (!tokens[key] && value) {
        tokens[key] = value;
        console.log(`[fb-session] Token ${key} recovered from network interception`);
      }
    }

    // ─── Phase 4: Try to extract doc_ids from JS bundle source ───────────────

    if (!discoveredDocIds.search) {
      console.log('[fb-session] Scanning JS bundles for doc_ids…');

      // Look for marketplace search query definitions in scripts
      // FB bundles contain patterns like: .params={id:"DOC_ID",metadata:{},name:"CometMarketplace..."}
      const docIdPatterns = [
        /id:"(\d{10,})",metadata:\{[^}]*\},name:"CometMarketplace[^"]*Search[^"]*"/g,
        /doc_id:"(\d{10,})"[^}]*Marketplace[^}]*Search/gi,
        /"(\d{10,})"[^}]*CometMarketplaceSearch/g,
        /queryID:"(\d{10,})".*?marketplace.*?search/gi,
        /params:\{id:"(\d{10,})".*?CometMarketplace/g,
      ];

      for (const pattern of docIdPatterns) {
        const matches = [...fullSource.matchAll(pattern)];
        if (matches.length) {
          discoveredDocIds.search = matches[0][1];
          console.log(`[fb-session] Found search doc_id in JS bundle: ${discoveredDocIds.search}`);
          break;
        }
      }

      // Also look for generic marketplace GraphQL query IDs
      if (!discoveredDocIds.search) {
        const genericPatterns = [
          /id:"(\d{10,})"[^}]*name:"[^"]*[Mm]arketplace[^"]*"/g,
          /__d="(\d{10,})"[^}]*marketplace/gi,
        ];
        for (const pattern of genericPatterns) {
          const matches = [...fullSource.matchAll(pattern)];
          for (const m of matches) {
            console.log(`[fb-session] Found marketplace-related doc_id in bundle: ${m[1]}`);
            if (!discoveredDocIds.search) discoveredDocIds.search = m[1];
          }
        }
      }
    }

    // ─── Phase 5: Last-resort doc_id extraction via page responses ───────────

    if (!discoveredDocIds.search) {
      console.log('[fb-session] Attempting to extract doc_id from page.__RELAY_STORE__…');
      try {
        const relayData = await page.evaluate(() => {
          // Some FB deployments expose relay data on the window
          const keys = Object.keys(window).filter(
            (k) => k.startsWith('__') || k.includes('relay') || k.includes('Relay')
          );
          return keys.slice(0, 10);
        });
        if (relayData.length) {
          console.log('[fb-session] Found window globals:', relayData.join(', '));
        }
      } catch (_) { /* skip */ }
    }

    // ─── Validate ────────────────────────────────────────────────────────────

    const criticalTokens = ['lsd'];
    const missing = criticalTokens.filter((k) => !tokens[k]);
    if (missing.length) {
      console.warn(
        '[fb-session] WARNING: Missing critical tokens:', missing.join(', '),
        '\n  Session may not work. FB might have changed their page structure.'
      );
    }

    // ─── Apply config overrides ──────────────────────────────────────────────
    // Config overrides win unconditionally — they're set by the user when
    // discovery is unreliable (FB anon page no longer triggers the search
    // GraphQL). We seed `searchRoot` so the scraper's existing candidate
    // ordering treats the override as the primary doc_id.
    const overrides = resolveDocOverrides();
    if (overrides.search) {
      discoveredDocIds.searchRoot = overrides.search;
      discoveredDocIds.search = overrides.search;
      console.log(`[fb-session] Using configured search doc_id: ${overrides.search}`);
    }
    if (overrides.detail) {
      discoveredDocIds.detail = overrides.detail;
      console.log(`[fb-session] Using configured detail doc_id: ${overrides.detail}`);
    }
    // Variables template wins over anything captured live — when the user
    // pastes one, they explicitly want their browser's exact request shape.
    if (overrides.searchVariables) {
      discoveredDocIds._capturedVariables = overrides.searchVariables;
      const keys = Object.keys(overrides.searchVariables).join(', ');
      console.log(`[fb-session] Using configured search variables template (keys: ${keys})`);
    }
    if (overrides.detailVariables) {
      // Same slot the live PDP-query interception fills — fb-scraper.js
      // already merges this with the per-listing listingID at request time.
      discoveredDocIds._pdpVariables = overrides.detailVariables;
      const keys = Object.keys(overrides.detailVariables).join(', ');
      console.log(`[fb-session] Using configured detail variables template (keys: ${keys})`);
    }

    if (!discoveredDocIds.search) {
      console.warn(
        '[fb-session] WARNING: Could not discover search doc_id.\n' +
        '  Network interception and JS bundle scanning both failed.\n' +
        '  Set FB_SEARCH_DOC_ID env var or edit lib/fb-config.js → docIds.search\n' +
        '  with a doc_id captured from your browser DevTools (see comment in fb-config.js).'
      );
    }

    // ─── Collect cookies ─────────────────────────────────────────────────────

    const cookiesArr = await page.cookies();
    const cookieString = rotateCookieString(cookiesArr);

    // ─── Build session object ────────────────────────────────────────────────

    const session = {
      tokens,
      cookies: cookieString,
      cookiesArr,
      userAgent,
      docIds: discoveredDocIds,
      timestamp: Date.now(),
    };
    _cachedSessions.set(cacheKey, session);

    const foundTokens = Object.entries(tokens).filter(([, v]) => !!v).map(([k]) => k);
    console.log('[fb-session] Session bootstrapped. Tokens found:', foundTokens.join(', '));
    console.log('[fb-session] doc_ids:', JSON.stringify(discoveredDocIds));

      return session;

    } finally {
      await browser.close();
    }
  })();

  _pendingSessions.set(cacheKey, bootstrapPromise);
  try {
    return await bootstrapPromise;
  } finally {
    _pendingSessions.delete(cacheKey);
  }
}

/**
 * Force-expire the cached session so the next call re-bootstraps.
 */
export function clearSession(proxyUrl = null) {
  if (proxyUrl == null) {
    _cachedSessions.clear();
    _pendingSessions.clear();
    return;
  }
  const cacheKey = proxyUrl || '__direct__';
  _cachedSessions.delete(cacheKey);
  _pendingSessions.delete(cacheKey);
}

/**
 * Return the cached session without re-bootstrapping.
 */
export function getCachedSession(proxyUrl = null) {
  return _cachedSessions.get(proxyUrl || '__direct__') || null;
}
