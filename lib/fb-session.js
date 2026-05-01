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
import { normalizeProxyInput } from './shared-marketplace/proxy.js';

/**
 * Resolve the effective FB doc_id overrides at bootstrap time.
 * Kept as an env-only emergency escape hatch. The normal user path discovers
 * IDs and variables from the live Marketplace page.
 */
function resolveDocOverrides() {
  return {
    search: config.docIds?.search || null,
    detail: config.docIds?.detail || null,
    searchVariables: config.docIds?.searchVariables || null,
    detailVariables: config.docIds?.detailVariables || null,
  };
}

// ─── Session Cache ─────────────────────────────────────────────────────────────

const _cachedSessions = new Map();
const _pendingSessions = new Map();

function proxyCacheValue(proxyUrl = null) {
  if (!proxyUrl) return '__direct__';
  const normalized = normalizeProxyInput(proxyUrl);
  return normalized?.href || String(proxyUrl || '').trim() || '__direct__';
}

export function buildSessionCacheKey(proxyUrl = null, bootstrapLocation = null) {
  const locTag = bootstrapLocation && Number.isFinite(Number(bootstrapLocation.latitude)) && Number.isFinite(Number(bootstrapLocation.longitude))
    ? `${Number(bootstrapLocation.latitude).toFixed(3)},${Number(bootstrapLocation.longitude).toFixed(3)}`
    : 'nocoords';
  return `${proxyCacheValue(proxyUrl)}::${locTag}`;
}

function cachePrefixForProxy(proxyUrl = null) {
  return `${proxyCacheValue(proxyUrl)}::`;
}

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

function extractJsonValueAt(source, startIndex) {
  const opener = source[startIndex];
  const closer = opener === '[' ? ']' : opener === '{' ? '}' : null;
  if (!closer) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === opener) depth++;
    if (ch === closer) depth--;
    if (depth === 0) {
      const raw = source.slice(startIndex, i + 1);
      try {
        return JSON.parse(raw);
      } catch (_) {
        return null;
      }
    }
  }

  return null;
}

function parseGraphqlVariables(postData) {
  const varsMatch = String(postData || '').match(/variables=([^&]+)/);
  if (!varsMatch) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(varsMatch[1]));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function parseRenderedPrice(text) {
  const match = String(text || '').match(/(?:[$€£]\s*[\d.,]+|[\d.,]+\s*(?:[$€£]|USD|EUR|GBP))/i);
  if (!match) return null;

  const raw = match[0].trim();
  const currency = /€|EUR/i.test(raw)
    ? 'EUR'
    : /£|GBP/i.test(raw)
    ? 'GBP'
    : 'USD';
  let numeric = raw.replace(/[^\d.,]/g, '');
  const lastDot = numeric.lastIndexOf('.');
  const lastComma = numeric.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1 && lastComma > lastDot) {
    numeric = numeric.replace(/\./g, '').replace(',', '.');
  } else if (lastDot !== -1 && lastComma !== -1) {
    numeric = numeric.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const tail = numeric.slice(lastComma + 1);
    numeric = tail.length === 3 ? numeric.replace(/,/g, '') : numeric.replace(',', '.');
  } else if (lastDot !== -1) {
    const tail = numeric.slice(lastDot + 1);
    if (tail.length === 3) numeric = numeric.replace(/\./g, '');
  }

  const amount = Number.parseFloat(numeric);
  if (!Number.isFinite(amount)) return null;
  return { amount: String(amount), currency, text: raw };
}

function isLikelyLocationLine(line) {
  return /,\s*[A-Z]{2}$|,\s*[^,]+$|\b(mi|km|miles|kilometers?)\b/i.test(line);
}

function normalizeRenderedImageUrls(record = {}) {
  const rawValues = [];
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) add(item);
      return;
    }
    if (typeof value === 'object') {
      add(value.currentSrc || value.src || value.url || value.uri);
      return;
    }
    rawValues.push(String(value).trim());
  };

  add(record.images);
  add(record.image);

  const urls = [];
  for (const value of rawValues) {
    if (!value || /^(?:data|blob):/i.test(value) || !/^https?:\/\//i.test(value)) continue;
    if (!urls.includes(value)) urls.push(value);
  }
  return urls;
}

export function buildMarketplaceListingFromDomRecord(record = {}) {
  const href = String(record.href || '');
  const id =
    href.match(/\/marketplace\/item\/(\d{5,})/)?.[1] ||
    href.match(/[?&](?:item_id|listing_id)=(\d{5,})/)?.[1] ||
    '';
  if (!id) return null;

  const text = String(record.text || record.ariaLabel || '').replace(/\s+\n/g, '\n').trim();
  const price = parseRenderedPrice(text);
  if (!price) return null;

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^sponsored$/i.test(line));
  const priceIndex = lines.findIndex((line) => line.includes(price.text));
  const title =
    lines
      .slice(priceIndex >= 0 ? priceIndex + 1 : 0)
      .find((line) => !line.includes(price.text) && !isLikelyLocationLine(line)) ||
    lines.find((line) => !line.includes(price.text)) ||
    '';
  if (!title) return null;

  const locationLine = lines.find((line) => line !== title && !line.includes(price.text) && isLikelyLocationLine(line)) || '';
  const imageUrls = normalizeRenderedImageUrls(record);

  return {
    id,
    marketplace_listing_title: title,
    listing_price: {
      amount: price.amount,
      currency: price.currency,
      formatted_amount: price.text,
    },
    primary_listing_photo: imageUrls[0] ? { image: { uri: imageUrls[0] } } : null,
    listing_photos: imageUrls.map((uri) => ({ image: { uri } })),
    location: locationLine ? { reverse_geocode: { city: locationLine } } : null,
  };
}

async function createMarketplacePage(proxyUrl = null, geo = null) {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch (e) {
    throw new Error(
      'puppeteer is not installed. Run: npm install puppeteer\n' + e.message
    );
  }

  const parsedProxy = normalizeProxyInput(proxyUrl);
  if (proxyUrl && !parsedProxy) {
    throw new Error(`Unsupported proxy format "${proxyUrl}". Use host:port, http://host:port, http://user:pass@host:port, or host:port:user:pass.`);
  }

  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--window-size=1366,768',
  ];

  if (parsedProxy?.server) launchArgs.push(`--proxy-server=${parsedProxy.server}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: launchArgs,
  });

  const geoLat = Number(geo?.lat);
  const geoLng = Number(geo?.lng);
  const hasGeo = Number.isFinite(geoLat) && Number.isFinite(geoLng);
  if (hasGeo) {
    try {
      const context = browser.defaultBrowserContext();
      await context.overridePermissions('https://www.facebook.com', ['geolocation']);
    } catch (err) {
      console.warn('[fb-session] geolocation permission grant failed:', err.message);
    }
  }

  const page = await browser.newPage();
  if (parsedProxy?.username) {
    await page.authenticate({
      username: parsedProxy.username,
      password: parsedProxy.password || '',
    });
  }

  if (hasGeo) {
    try {
      await page.setGeolocation({ latitude: geoLat, longitude: geoLng });
      console.log(`[fb-session] Geolocation override active: ${geoLat}, ${geoLng}`);
    } catch (err) {
      console.warn('[fb-session] setGeolocation failed:', err.message);
    }
  }

  await page.setViewport({
    width: 1280 + Math.floor(Math.random() * 200),
    height: 720 + Math.floor(Math.random() * 100),
    deviceScaleFactor: 1,
  });

  const userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  await page.setUserAgent(userAgent);

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    delete navigator.__proto__.webdriver;
  });

  return { browser, page, userAgent };
}

async function tryClickUseMyLocation(page) {
  const selectors = [
    'div[role="button"][aria-label*="current location" i]',
    'div[role="button"][aria-label*="use my location" i]',
    'div[role="button"][aria-label*="use current location" i]',
    'button[aria-label*="current location" i]',
    'button[aria-label*="use my location" i]',
    'a[aria-label*="current location" i]',
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        console.log(`[fb-session] Clicked location button: ${sel}`);
        await new Promise((r) => setTimeout(r, 1500));
        return true;
      }
    } catch (_) { /* try next */ }
  }
  try {
    const xpaths = [
      '//div[@role="button" and (contains(., "Use my location") or contains(., "Current location") or contains(., "Use current location"))]',
      '//button[contains(., "Use my location") or contains(., "Current location")]',
      '//span[contains(., "Use my location") or contains(., "Current location")]/ancestor::div[@role="button"][1]',
    ];
    for (const xp of xpaths) {
      const found = await page.$x(xp);
      if (found && found.length) {
        await found[0].click();
        console.log(`[fb-session] Clicked location via xpath: ${xp}`);
        await new Promise((r) => setTimeout(r, 1500));
        return true;
      }
    }
  } catch (_) { /* ignore */ }
  return false;
}

async function acceptCookieBanner(page) {
  try {
    for (const selector of [
      '[data-testid="cookie-policy-manage-dialog-accept-button"]',
      '[data-cookiebanner="accept_button"]',
      'button[title="Allow all cookies"]',
      'button[title="Permitir todas las cookies"]',
    ]) {
      const btn = await page.$(selector);
      if (btn) {
        await btn.click();
        return true;
      }
    }

    const xpaths = [
      '//button[contains(., "Allow all cookies")]',
      '//button[contains(., "Allow essential and optional cookies")]',
      '//button[contains(., "Permitir todas")]',
      '//button[contains(., "Accept All")]',
    ];
    for (const xp of xpaths) {
      try {
        const btns = await page.$x(xp);
        if (btns.length) {
          await btns[0].click();
          return true;
        }
      } catch (_) { /* skip */ }
    }
  } catch (_) {
    return false;
  }
  return false;
}

function buildMarketplaceSearchUrl({ query, lat, lng, radiusKM, fbLocationId } = {}) {
  const params = new URLSearchParams({
    query: String(query || ''),
    sortBy: 'creation_time_descend',
  });
  if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
    params.set('latitude', String(Number(lat)));
    params.set('longitude', String(Number(lng)));
  }
  if (Number.isFinite(Number(radiusKM))) params.set('radius', String(Number(radiusKM)));
  const id = String(fbLocationId || '').trim();
  if (/^\d{6,}$/.test(id)) {
    return `https://www.facebook.com/marketplace/${id}/search/?${params.toString()}`;
  }
  return `https://www.facebook.com/marketplace/search/?${params.toString()}`;
}

export async function scrapeMarketplaceSearchPage({
  query,
  lat = null,
  lng = null,
  radiusKM = null,
  proxyUrl = null,
  maxListings = 24,
  fbLocationId = null,
} = {}) {
  const { browser, page } = await createMarketplacePage(proxyUrl, { lat, lng });
  try {
    const url = buildMarketplaceSearchUrl({ query, lat, lng, radiusKM, fbLocationId });
    console.log(`[fb-scraper] Rendered fallback URL: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
    const accepted = await acceptCookieBanner(page);
    if (accepted) await new Promise((resolve) => setTimeout(resolve, 1500));

    const clicked = await tryClickUseMyLocation(page);
    if (clicked) {
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      } catch (_) { /* keep current page */ }
    } else {
      console.log('[fb-scraper] No "Use my location" button found — relying on geolocation override only');
    }

    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
      await new Promise((resolve) => setTimeout(resolve, 700));
    }

    const records = await page.evaluate((limit) => {
      const srcsetUrls = (srcset) => String(srcset || '')
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
      const addImageUrls = (img, list) => {
        if (!img) return;
        for (const value of [
          img.currentSrc,
          img.src,
          img.getAttribute('src'),
          img.getAttribute('data-src'),
          img.getAttribute('data-lazy-src'),
        ]) {
          if (value && !list.includes(value)) list.push(value);
        }
        for (const attr of ['srcset', 'data-srcset']) {
          for (const value of srcsetUrls(img.getAttribute(attr))) {
            if (value && !list.includes(value)) list.push(value);
          }
        }
      };
      const anchors = [...document.querySelectorAll('a[href*="/marketplace/item/"]')];
      const seen = new Set();
      const out = [];
      for (const anchor of anchors) {
        const href = anchor.href || '';
        const id = href.match(/\/marketplace\/item\/(\d{5,})/)?.[1];
        if (!id || seen.has(id)) continue;
        seen.add(id);

        let el = anchor;
        let bestElement = anchor;
        let bestText = anchor.innerText || anchor.getAttribute('aria-label') || '';
        for (let depth = 0; depth < 8 && el; depth++) {
          const text = (el.innerText || '').trim();
          if (text && text.length > bestText.length && text.length < 1000) {
            bestText = text;
            bestElement = el;
          }
          if (/[$€£]\s*[\d.,]+|[\d.,]+\s*(?:[$€£]|USD|EUR|GBP)/i.test(text) && text.split('\n').length >= 2) {
            bestText = text;
            bestElement = el;
            break;
          }
          el = el.parentElement;
        }

        const containers = [];
        const addContainer = (node) => {
          if (node && !containers.includes(node)) containers.push(node);
        };
        addContainer(anchor);
        addContainer(bestElement);
        addContainer(anchor.closest('[role="article"]'));
        for (let node = anchor.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
          addContainer(node);
        }

        const images = [];
        for (const container of containers) {
          for (const img of container.querySelectorAll('img')) addImageUrls(img, images);
          if (images.length) break;
        }
        out.push({
          href,
          text: bestText,
          ariaLabel: anchor.getAttribute('aria-label') || '',
          image: images[0] || '',
          images,
        });
        if (out.length >= limit) break;
      }
      return out;
    }, Math.max(1, Number(maxListings) || 24));

    return records
      .map((record) => buildMarketplaceListingFromDomRecord(record))
      .filter(Boolean);
  } finally {
    await browser.close();
  }
}

function rememberMarketplacePreloader(result, preloader) {
  const queryID = preloader?.queryID || preloader?.queryId || preloader?.doc_id;
  const queryName = preloader?.queryName || preloader?.name || '';
  const docId = sanitizeDocId(queryID);
  if (!docId || !queryName) return;

  if (/CometMarketplaceSearchContentContainer/i.test(queryName)) {
    if (!result.searchContent) result.searchContent = docId;
    result.search = docId;
    if (preloader.variables && typeof preloader.variables === 'object') {
      result._capturedVariables = preloader.variables;
    }
    return;
  }

  if (/CometMarketplaceSearchRoot/i.test(queryName)) {
    if (!result.searchRoot) result.searchRoot = docId;
    if (!result.searchContent) result.search = result.search || docId;
    if (!result._capturedVariables && preloader.variables && typeof preloader.variables === 'object') {
      result._capturedVariables = preloader.variables;
    }
    return;
  }

  if (/MarketplacePDP|MarketplaceProductDetail|PDPContainer/i.test(queryName)) {
    if (!result.detail) result.detail = docId;
    if (preloader.variables && typeof preloader.variables === 'object') {
      result._pdpVariables = preloader.variables;
    }
  }
}

/**
 * Extract persisted GraphQL query IDs from FB's route preloader payload.
 */
export function extractMarketplacePreloaderDocIds(source) {
  const result = {};
  if (!source) return result;
  const text = String(source);

  const preloaderKeyPattern = /["'](?:expectedPreloaders|preloaders)["']\s*:/g;
  for (const match of text.matchAll(preloaderKeyPattern)) {
    const arrayStart = text.indexOf('[', match.index + match[0].length);
    if (arrayStart === -1) continue;
    const preloaders = extractJsonValueAt(text, arrayStart);
    if (!Array.isArray(preloaders)) continue;
    for (const preloader of preloaders) {
      rememberMarketplacePreloader(result, preloader);
    }
  }

  if (!result.searchRoot || !result.searchContent || !result.detail) {
    const pairPatterns = [
      /["']?queryID["']?\s*:\s*["'](\d{10,})["'][\s\S]{0,30000}?["']?queryName["']?\s*:\s*["']([^"']+)["']/g,
      /["']?queryName["']?\s*:\s*["']([^"']+)["'][\s\S]{0,30000}?["']?queryID["']?\s*:\s*["'](\d{10,})["']/g,
    ];
    for (const pattern of pairPatterns) {
      for (const match of text.matchAll(pattern)) {
        const firstIsId = /^\d+$/.test(match[1]);
        rememberMarketplacePreloader(result, {
          queryID: firstIsId ? match[1] : match[2],
          queryName: firstIsId ? match[2] : match[1],
        });
      }
    }
  }

  result.search = result.searchContent || result.search || result.searchRoot || null;
  if (!result.search) delete result.search;
  return result;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Bootstrap a Facebook session.
 *
 * @param {string|null} proxyUrl  Optional proxy URL e.g. "http://user:pass@host:port"
 * @returns {Promise<{tokens, cookies, userAgent, docIds, timestamp}>}
 */
export async function bootstrapSession(proxyUrl = null, bootstrapLocation = null) {
  const cacheKey = buildSessionCacheKey(proxyUrl, bootstrapLocation);
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

    const parsedProxy = normalizeProxyInput(proxyUrl);
    if (proxyUrl && !parsedProxy) {
      throw new Error(`Unsupported proxy format "${proxyUrl}". Use host:port, http://host:port, http://user:pass@host:port, or host:port:user:pass.`);
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1366,768',
    ];

    if (parsedProxy?.server) launchArgs.push(`--proxy-server=${parsedProxy.server}`);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: launchArgs,
    });

    const _bootLat = Number(bootstrapLocation?.latitude);
    const _bootLng = Number(bootstrapLocation?.longitude);
    const _hasBootGeo = Number.isFinite(_bootLat) && Number.isFinite(_bootLng);
    if (_hasBootGeo) {
      try {
        const ctx = browser.defaultBrowserContext();
        await ctx.overridePermissions('https://www.facebook.com', ['geolocation']);
      } catch (err) {
        console.warn('[fb-session] bootstrap geolocation permission grant failed:', err.message);
      }
    }

    const page = await browser.newPage();
    if (parsedProxy?.username) {
      await page.authenticate({
        username: parsedProxy.username,
        password: parsedProxy.password || '',
      });
    }

    if (_hasBootGeo) {
      try {
        await page.setGeolocation({ latitude: _bootLat, longitude: _bootLng });
        console.log(`[fb-session] Bootstrap geolocation override active: ${_bootLat}, ${_bootLng}`);
      } catch (err) {
        console.warn('[fb-session] bootstrap setGeolocation failed:', err.message);
      }
    }

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
  const capturedPageSources = [];

  async function capturePageSource(label) {
    try {
      const html = await page.content();
      const scriptText = await page.evaluate(() => {
        return [...document.querySelectorAll('script')]
          .map((s) => s.textContent || '')
          .join('\n');
      });
      capturedPageSources.push(html, scriptText);
      if (label) console.log(`[fb-session] Captured ${label} page source for token/doc_id scan`);
    } catch (err) {
      console.warn(`[fb-session] Failed to capture ${label || 'current'} page source:`, err.message);
    }
  }

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
        // Network-intercepted variables override preloader-derived ones —
        // they reflect a real, executable client-side query that FB's
        // backend just answered, rather than a hydration spec.
        const variables = parseGraphqlVariables(postData);
        if (variables) {
          discoveredDocIds._capturedVariables = variables;
          discoveredDocIds.searchPaginationFromNetwork = true;
        }
      }
      if (/CometMarketplaceSearchRoot/i.test(name)) {
        discoveredDocIds.searchRoot = docId;
      }
      if (/MarketplacePDP|MarketplaceProductDetail|PDPContainer/i.test(name)) {
        discoveredDocIds.detail = docId;
        // Also capture the PDP variables structure
        const variables = parseGraphqlVariables(postData);
        if (variables) discoveredDocIds._pdpVariables = variables;
      }
      // Capture the actual search variables FB used (only from real search queries)
      if (isMarketplaceSearch && !discoveredDocIds._capturedVariables) {
        const variables = parseGraphqlVariables(postData);
        if (variables) discoveredDocIds._capturedVariables = variables;
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
        discoveredDocIds.searchContent ||
        discoveredDocIds.searchGeneric ||
        discoveredDocIds.searchRoot ||
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

    if (_hasBootGeo) {
      const clicked = await tryClickUseMyLocation(page);
      if (clicked) {
        console.log('[fb-session] Bootstrap location updated via "Use my location"');
        await new Promise((r) => setTimeout(r, 2000));
      }
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

    // Scroll aggressively to trigger FB's infinite-scroll "load more" GraphQL
    // request. The initial search results are SSR'd into the HTML — a real
    // marketplace search GraphQL request only fires once we scroll past the
    // first batch. Capturing that pagination call gives us a doc_id that
    // returns real listings when POSTed standalone (the route-preloader
    // doc_id is a client-side hydration spec and returns
    // MarketplaceSearchFeedNoResults for anon POSTs).
    for (let i = 0; i < 15; i++) {
      try {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } catch (_) { break; }
      await new Promise((r) => setTimeout(r, 1200));
      if (discoveredDocIds.searchPaginationFromNetwork) break;
    }

    // Snapshot a listing href and the page source NOW, before any later step
    // (search interaction, etc.) can navigate the page away. The samsung
    // search interaction below detaches the iphone-results frame, which is
    // why earlier versions logged "No listing links found" — by the time we
    // looked, the page was mid-navigation to a fresh empty results page.
    await capturePageSource('search');
    let pendingListingHref = null;
    try {
      pendingListingHref = await page.evaluate(() => {
        const sels = [
          'a[href*="/marketplace/item/"]',
          'a[href*="marketplace/item"]',
          'div[role="main"] a[href*="/item/"]',
        ];
        for (const sel of sels) {
          const a = document.querySelector(sel);
          if (a?.href) return a.href;
        }
        return null;
      });
    } catch (_) { /* page raced — fallback handles it later */ }

    // If we still don't have a search doc_id, try interacting with the search.
    // This may detach the current frame, which is why we captured the listing
    // href above first.
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
          await capturePageSource('search-after-interaction');
        }
      } catch (_) {
        // Search interaction failed — continue
      }
    }

    // ─── Phase 2b: Navigate to a listing detail page to capture PDP doc_id ───

    if (!discoveredDocIds.detail) {
      console.log('[fb-session] Looking for a listing to navigate to for PDP doc_id…');
      try {
        let listingHref = pendingListingHref;

        if (!listingHref) {
          for (let i = 0; i < 4; i++) {
            try {
              await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
            } catch (_) { break; }
            await new Promise((r) => setTimeout(r, 800));
          }

          for (let i = 0; i < 8 && !listingHref; i++) {
            try {
              listingHref = await page.evaluate(() => {
                const sels = [
                  'a[href*="/marketplace/item/"]',
                  'a[href*="marketplace/item"]',
                  'div[role="main"] a[href*="/item/"]',
                ];
                for (const sel of sels) {
                  const a = document.querySelector(sel);
                  if (a?.href) return a.href;
                }
                return null;
              });
            } catch (_) { break; }
            if (!listingHref) await new Promise((r) => setTimeout(r, 500));
          }
        }

        if (!listingHref) {
          const haystack = capturedPageSources.join('\n');
          let m = haystack.match(/\/marketplace\/item\/(\d{6,})/);
          if (!m) m = haystack.match(/"marketplace_listing_id"\s*:\s*"?(\d{6,})/);
          if (!m) m = haystack.match(/"listing_id"\s*:\s*"?(\d{6,})/);
          if (m) {
            listingHref = `https://www.facebook.com/marketplace/item/${m[1]}/`;
            console.log(`[fb-session] Built listing URL from page source: ${listingHref}`);
          }
        }

        if (listingHref) {
          console.log(`[fb-session] Navigating to listing page: ${listingHref}`);
          // PDP pages are heavy — 'domcontentloaded' is plenty for CDP to intercept
          // the PDP GraphQL query, and avoids spurious "networkidle2" timeouts.
          await page.goto(listingHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await new Promise((r) => setTimeout(r, 3000));
          await capturePageSource('pdp');
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
    await capturePageSource('current');

    // Combine captured HTML + script text for pattern matching. We snapshot the
    // search page before PDP navigation because route preloaders are page-local.
    const fullSource = capturedPageSources.join('\n');

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

    const preloaderDocIds = extractMarketplacePreloaderDocIds(fullSource);
    if (preloaderDocIds.searchRoot && !discoveredDocIds.searchRoot) {
      discoveredDocIds.searchRoot = preloaderDocIds.searchRoot;
      console.log(`[fb-session] Found search root doc_id in route preloader: ${preloaderDocIds.searchRoot}`);
    }
    if (preloaderDocIds.searchContent && !discoveredDocIds.searchContent) {
      discoveredDocIds.searchContent = preloaderDocIds.searchContent;
      console.log(`[fb-session] Found search content doc_id in route preloader: ${preloaderDocIds.searchContent}`);
    }
    if (preloaderDocIds.detail && !discoveredDocIds.detail) {
      discoveredDocIds.detail = preloaderDocIds.detail;
      console.log(`[fb-session] Found PDP doc_id in route preloader: ${preloaderDocIds.detail}`);
    }
    if (preloaderDocIds._capturedVariables && !discoveredDocIds._capturedVariables) {
      discoveredDocIds._capturedVariables = preloaderDocIds._capturedVariables;
      console.log('[fb-session] Captured search variables from route preloader');
    }
    if (preloaderDocIds._pdpVariables && !discoveredDocIds._pdpVariables) {
      discoveredDocIds._pdpVariables = preloaderDocIds._pdpVariables;
      console.log('[fb-session] Captured PDP variables from route preloader');
    }
    discoveredDocIds.search =
      discoveredDocIds.searchContent ||
      discoveredDocIds.searchGeneric ||
      discoveredDocIds.search ||
      discoveredDocIds.searchRoot ||
      null;

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
    // Config overrides win unconditionally. Treat a generic emergency search
    // override as the feed/content query because RootQuery returns Marketplace
    // metadata, not listing feed_units.
    const overrides = resolveDocOverrides();
    if (overrides.search) {
      discoveredDocIds.searchContent = overrides.search;
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
      const message = proxyUrl
        ? '[fb-session] WARNING: This proxy did not expose a Marketplace search doc_id.\n' +
          '  Network interception and JS bundle scanning both failed through the proxy.\n' +
          '  The scraper will try direct Marketplace metadata fallback while keeping proxied requests.'
        : '[fb-session] WARNING: Could not discover search doc_id.\n' +
          '  Network interception and JS bundle scanning both failed.\n' +
          '  Set FB_SEARCH_DOC_ID env var or edit lib/fb-config.js → docIds.search\n' +
          '  with a doc_id captured from your browser DevTools (see comment in fb-config.js).';
      console.warn(message);
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
export function clearSession(proxyUrl = null, bootstrapLocation = null) {
  if (proxyUrl == null && bootstrapLocation == null) {
    _cachedSessions.clear();
    _pendingSessions.clear();
    return;
  }

  if (bootstrapLocation) {
    const cacheKey = buildSessionCacheKey(proxyUrl, bootstrapLocation);
    _cachedSessions.delete(cacheKey);
    _pendingSessions.delete(cacheKey);
    return;
  }

  const prefix = cachePrefixForProxy(proxyUrl);
  for (const key of [..._cachedSessions.keys()]) {
    if (key.startsWith(prefix)) _cachedSessions.delete(key);
  }
  for (const key of [..._pendingSessions.keys()]) {
    if (key.startsWith(prefix)) _pendingSessions.delete(key);
  }
}

/**
 * Return the cached session without re-bootstrapping.
 */
export function getCachedSession(proxyUrl = null, bootstrapLocation = null) {
  if (bootstrapLocation) {
    return _cachedSessions.get(buildSessionCacheKey(proxyUrl, bootstrapLocation)) || null;
  }

  const legacy = _cachedSessions.get(proxyCacheValue(proxyUrl));
  if (legacy) return legacy;

  const prefix = cachePrefixForProxy(proxyUrl);
  let newest = null;
  for (const [key, session] of _cachedSessions.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (!newest || Number(session?.timestamp || 0) > Number(newest?.timestamp || 0)) {
      newest = session;
    }
  }
  return newest;
}
