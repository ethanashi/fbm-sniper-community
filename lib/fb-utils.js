/**
 * Facebook Marketplace Scraper — Utilities
 */

/**
 * Returns a promise that resolves after a random delay between min and max ms.
 */
export function randomDelay(min, max) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse Facebook's price object into an integer number of cents.
 * FB gives amount as a string like "450.00" in the listing currency.
 */
export function parseFBPrice(priceObj) {
  if (!priceObj) return null;
  const raw = priceObj.amount ?? priceObj.formatted_amount ?? '';
  // Strip everything except digits and decimal point
  const numeric = String(raw).replace(/[^0-9.]/g, '');
  if (!numeric) return null;
  return Math.round(parseFloat(numeric) * 100);
}

/**
 * Build a canonical Facebook Marketplace listing URL from a listing ID.
 */
export function buildListingUrl(listingId) {
  return `https://www.facebook.com/marketplace/item/${listingId}/`;
}

/**
 * Convert a cookies array (from puppeteer's page.cookies()) into a
 * "name=value; name=value" header string.
 */
export function rotateCookieString(cookies) {
  if (!cookies || !cookies.length) return '';
  if (typeof cookies === 'string') return cookies;
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Incrementing request counter that produces the sequence a, b, c, ... z, aa, ab, ...
 * Call generateRequestId() to get a stateful generator, then call gen.next() each time.
 */
export function* generateRequestId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let n = 0;
  while (true) {
    let id = '';
    let tmp = n;
    do {
      id = chars[tmp % 26] + id;
      tmp = Math.floor(tmp / 26) - 1;
    } while (tmp >= 0);
    yield id;
    n++;
  }
}

/**
 * Parse a raw Facebook response body that may be:
 *  1. A single JSON object
 *  2. Multiple JSON objects separated by newlines (NDJSON / streaming)
 *
 * Returns the parsed object that contains `marketplace_search`, or the first
 * parseable object if that key is not found.
 */
export function parseFBResponse(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);

  // Attempt 1 — single JSON object
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch (_) {
    // fall through
  }

  // Attempt 2 — NDJSON (newline-delimited JSON)
  const lines = text.split('\n').filter((l) => l.trim().startsWith('{'));
  let first = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (!first) first = parsed;
      // Prefer whichever chunk has the marketplace_search key
      if (parsed?.data?.marketplace_search) return parsed;
    } catch (_) {
      // skip unparseable lines
    }
  }
  return first;
}
