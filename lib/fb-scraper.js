import fetch from 'node-fetch';

/**
 * Facebook Marketplace Scraper — Main Scraper
 *
 * Makes POST requests to Facebook's internal GraphQL endpoint and returns
 * normalised listing objects compatible with the Wallapop pipeline.
 */

import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { bootstrapSession, clearSession } from './fb-session.js';
import config from './fb-config.js';

// Dedicated agent for HTML detail fetches — FB frequently drops pooled
// keep-alive sockets mid-response, which surfaces as fetch "aborted" errors.
const detailHttpsAgent = new https.Agent({ keepAlive: false });
import {
  randomDelay,
  parseFBPrice,
  buildListingUrl,
  generateRequestId,
  parseFBResponse,
} from './fb-utils.js';

const FB_GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';

/**
 * Extract the feed_units (listing edges) from a parsed GraphQL response.
 * Facebook nests this differently depending on which query was used.
 */
function extractFeedUnits(parsed) {
  if (!parsed) return null;

  // Path 1: marketplace_search.feed_units (ContentContainerQuery)
  const direct = parsed?.data?.marketplace_search?.feed_units;
  if (direct?.edges) return direct;

  // Path 2: node.marketplace_search.feed_units or viewer.marketplace_search_feed_units
  const viewer = parsed?.data?.viewer;
  if (viewer?.marketplace_search_feed_units?.edges) return viewer.marketplace_search_feed_units;

  // Path 3: marketplace_search may be nested under a node
  const node = parsed?.data?.node;
  if (node?.marketplace_search?.feed_units?.edges) return node.marketplace_search.feed_units;

  // Path 4: Search within the RootQuery response — results may be in a different key
  const searchResults = parsed?.data?.marketplace_search_results;
  if (searchResults?.edges) return searchResults;

  // Path 5: Deep-walk the response to find any object with an "edges" array
  // containing nodes that look like listings
  return deepFindFeedUnits(parsed?.data);
}

/**
 * Recursively search a response object for something that looks like listing edges.
 */
function deepFindFeedUnits(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;

  // Check if this object has edges that look like listings
  if (Array.isArray(obj.edges) && obj.edges.length > 0) {
    const sample = obj.edges[0]?.node;
    if (sample && (sample.listing || sample.marketplace_listing_title || sample.listing_price)) {
      return obj;
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = deepFindFeedUnits(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// ─── Request Counter ──────────────────────────────────────────────────────────

const reqIdGen = generateRequestId();


// ─── Core GraphQL Request ─────────────────────────────────────────────────────

async function graphqlRequest(session, variables, docId, friendlyName, proxyUrl = null) {
  const reqId = reqIdGen.next().value;

  const params = new URLSearchParams({
    av: '0',
    __user: '0',
    __a: '1',
    __dyn: session.tokens.__dyn || '',
    __csr: session.tokens.__csr || '',
    __req: reqId,
    __pc: 'PHASED:DEFAULT',
    dpr: '1',
    __rev: session.tokens.__rev || '',
    __s: '',
    __hsi: session.tokens.__hsi || '',
    lsd: session.tokens.lsd || '',
    jazoest: session.tokens.jazoest || '',
    __spin_r: session.tokens.__spin_r || '',
    __spin_b: session.tokens.__spin_b || '',
    __spin_t: session.tokens.__spin_t || '',
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: friendlyName,
    variables: JSON.stringify(variables),
    doc_id: docId,
  });

  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': session.userAgent,
    cookie: session.cookies,
    referer: 'https://www.facebook.com/marketplace/search/?query=iphone',
    origin: 'https://www.facebook.com',
    'x-fb-friendly-name': friendlyName,
  };

  const defaultProxy = config.proxy.enabled ? `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.host}:${config.proxy.port}` : null;
  const effectiveProxy = proxyUrl || defaultProxy;
  const agent = effectiveProxy ? new HttpsProxyAgent(effectiveProxy) : undefined;

  const response = await fetch(FB_GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: params.toString(),
    agent,
  });
  const text = await response.text();
  return parseFBResponse(text);
}

// ─── Search Listings ──────────────────────────────────────────────────────────

// Map FB URL condition values → GraphQL enum strings
const CONDITION_MAP = {
  new: 'NEW',
  used_like_new: 'USED_LIKE_NEW',
  used_good: 'USED_GOOD',
  used_fair: 'USED_FAIR',
  used_poor: 'USED_POOR',
};

/**
 * Search Facebook Marketplace listings.
 *
 * @param {object} opts
 * @param {string}  opts.query
 * @param {number}  [opts.lat]              Latitude from saved settings
 * @param {number}  [opts.lng]              Longitude from saved settings
 * @param {number}  [opts.radiusKM]
 * @param {number}  [opts.minPrice]         Price in cents
 * @param {number}  [opts.maxPrice]         Price in cents
 * @param {string}  [opts.sort]
 * @param {number}  [opts.maxPages]
 * @param {string[]} [opts.conditions]      e.g. ['used_like_new', 'used_good', 'new']
 * @param {number}  [opts.daysSinceListed]  e.g. 1 for last 24 hours
 * @returns {Promise<{listings: object[], totalFound: number}>}
 */
export async function searchMarketplace({
  query,
  lat = config.location.latitude,
  lng = config.location.longitude,
  radiusKM = config.search.defaultRadiusKM,
  minPrice = 0,
  maxPrice = 1000000,
  sort = config.search.defaultSort,
  maxPages = config.search.maxPages,
  conditions = [],
  daysSinceListed = null,
  proxyUrl = null,
} = {}) {
  const defaultProxy = config.proxy.enabled ? `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.host}:${config.proxy.port}` : null;
  const effectiveProxy = proxyUrl || defaultProxy;
  const session = await bootstrapSession(effectiveProxy, { latitude: lat, longitude: lng });

  // Build the list of doc_ids to try (prefer Root over Content, use both)
  const docIdCandidates = [];
  if (session.docIds.searchRoot) docIdCandidates.push({ id: session.docIds.searchRoot, name: 'CometMarketplaceSearchRootQuery' });
  if (session.docIds.searchContent) docIdCandidates.push({ id: session.docIds.searchContent, name: 'CometMarketplaceSearchContentContainerQuery' });
  if (session.docIds.search && !docIdCandidates.find((c) => c.id === session.docIds.search)) {
    docIdCandidates.push({ id: session.docIds.search, name: 'CometMarketplaceSearchRootQuery' });
  }

  if (!docIdCandidates.length) {
    throw new Error(
      '[fb-scraper] No search doc_id available. Session bootstrap could not discover one.\n' +
      'Facebook may have changed their page structure. Try running fb-session.js\n' +
      'with headless:false to manually inspect what GraphQL requests the page makes.'
    );
  }

  // Suppress the "Trying X (doc_id: Y)" logs in production (verbose for debugging only)

  const listings = [];
  let cursor = null;
  let pageNum = 0;
  let retries = 0;

  // Build filters array for conditions + recency
  const conditionEnums = conditions
    .map((c) => CONDITION_MAP[c] || c.toUpperCase())
    .filter(Boolean);

  const builtFilters = [];
  if (conditionEnums.length) {
    builtFilters.push({ name: 'item_condition', values: conditionEnums });
  }
  if (daysSinceListed != null) {
    builtFilters.push({ name: 'days_since_listed', values: [String(daysSinceListed)] });
  }

  while (pageNum < maxPages) {
    // Variables format matching what FB's frontend actually sends
    const variables = {
      buyLocation: { latitude: lat, longitude: lng },
      categoryIDArray: [],
      count: config.search.resultsPerPage,
      cursor,
      filters: builtFilters,
      hideItemsSoldByPage: false,
      priceRange: [minPrice, maxPrice],
      query,
      radiusKM,
      savedSearchID: null,
      sortOrder: sort,
      topicPageParams: { topicPageID: null, url: null },
      vehicleParams: null,
    };

    // If bootstrap captured FB's actual variables, use them as a template
    // but override search-specific values with the caller's parameters
    const capturedVars = session.docIds._capturedVariables;
    if (capturedVars) {
      // Preserve structural fields FB requires that we didn't know about
      for (const key of Object.keys(capturedVars)) {
        if (!(key in variables)) variables[key] = capturedVars[key];
      }
      // Override the nested params structure with our actual search terms
      if (capturedVars.params) {
        variables.params = JSON.parse(JSON.stringify(capturedVars.params));
        if (variables.params.bqf) variables.params.bqf.query = query;
        if (variables.params.browse_request_params) {
          const brp = variables.params.browse_request_params;
          brp.filter_location_latitude = lat;
          brp.filter_location_longitude = lng;
          brp.filter_radius_km = radiusKM;
          // Null out any city-scoped IDs FB may have captured during bootstrap.
          // If these remain set (e.g. Madrid's marketplace_seo_page_id), the
          // server-side filter honors them and ignores our lat/lng — results
          // come back pinned to whichever city the bootstrap URL used.
          for (const key of Object.keys(brp)) {
            if (
              key === 'filter_location_latitude' ||
              key === 'filter_location_longitude' ||
              key === 'filter_radius_km'
            ) continue;
            if (
              key.includes('location_id') ||
              key.includes('location_page') ||
              key.includes('marketplace_seo') ||
              key.includes('seo_page') ||
              key === 'marketplace_id'
            ) {
              brp[key] = null;
            }
          }
          brp.filter_price_lower_bound = minPrice;
          brp.filter_price_upper_bound = maxPrice;
          // Sort newest-first so the sniper sees fresh listings first on every page
          brp.filter_sort_by = sort;
          // Condition filter
          if (conditionEnums.length) brp.filter_item_condition = conditionEnums;
          // Recency filter (seconds since epoch, 1 day = 86400s)
          if (daysSinceListed != null) {
            brp.filter_date_listed_range_days = daysSinceListed;
          }
        }
      }
      if (capturedVars.savedSearchQuery !== undefined) variables.savedSearchQuery = query;
      if (variables.searchPopularSearchesParams) {
        variables.searchPopularSearchesParams = { ...variables.searchPopularSearchesParams, query };
      }
    }

    let parsed = null;
    let lastError = null;

    // Try each doc_id candidate until one returns results
    for (const candidate of docIdCandidates) {
      try {
        parsed = await graphqlRequest(session, variables, candidate.id, candidate.name, effectiveProxy);

        // Check for stale doc_id error
        const errors = parsed?.errors || [];
        const staleDocId = errors.some(
          (e) => e?.message?.includes('was not found')
        );
        if (staleDocId) {
          console.warn(`[fb-scraper] doc_id ${candidate.id} (${candidate.name}) is stale, trying next…`);
          parsed = null;
          continue;
        }

        // Check if this response actually has listings data
        const feedUnits = extractFeedUnits(parsed);
        if (feedUnits) break;

        // Response was successful but had no feed_units — try the next doc_id candidate
        parsed = null;
      } catch (err) {
        lastError = err;
        const status = err?.response?.status;
        const data = err?.response?.data || '';

        if (status === 429 || String(data).includes('1675004')) {
          if (retries >= config.timing.maxRetries) {
            throw new Error(
              '[fb-scraper] Rate limited / IP blocked (error 1675004). Configure a proxy in fb-config.js.'
            );
          }
          const backoff = config.timing.retryDelay * Math.pow(2, retries);
          console.warn(`[fb-scraper] Rate limited. Waiting ${backoff / 1000}s before retry…`);
          await randomDelay(backoff, backoff + 5000);
          retries++;
          clearSession(effectiveProxy);
          break; // will retry in the outer while loop
        }

        console.warn(`[fb-scraper] ${candidate.name} failed: ${err.message}`);
      }
    }

    if (!parsed) {
      if (retries > 0) continue; // retry after rate limit
      if (lastError) throw lastError;
      console.warn('[fb-scraper] All doc_id candidates failed.');
      break;
    }

    retries = 0;

    const feedUnits = extractFeedUnits(parsed);
    if (!feedUnits) {
      console.warn('[fb-scraper] No feed_units in response. Full structure:',
        JSON.stringify(parsed).slice(0, 500));
      break;
    }

    const edges = feedUnits.edges || [];
    for (const edge of edges) {
      const listing = edge?.node?.listing || edge?.node;
      if (listing) listings.push(normalizeListing(listing));
    }

    const pageInfo = feedUnits.page_info;
    if (!pageInfo?.has_next_page || !pageInfo.end_cursor) break;

    cursor = pageInfo.end_cursor;
    pageNum++;

    if (pageNum < maxPages) {
      await randomDelay(
        config.timing.minDelayBetweenRequests,
        config.timing.maxDelayBetweenRequests
      );
    }
  }

  return { listings, totalFound: listings.length };
}

// ─── Listing Detail ───────────────────────────────────────────────────────────

/**
 * Fetch full details for a single listing (description, all photos, seller info).
 *
 * Strategy 1 — GraphQL PDP query (requires detail doc_id captured during bootstrap).
 * Strategy 2 — HTML page scrape: extract description + photos from the public listing
 *              page via og:description / og:image and embedded JSON data.
 *
 * Returns a raw-detail-compatible object the caller can pass to mergeDetail(), or null.
 *
 * @param {string} listingId  Facebook listing ID
 * @param {string} [sessionCookies]  Cookie string to use for the HTML request
 * @returns {Promise<object|null>}
 */
export async function getListingDetail(listingId, sessionCookies, proxyUrl = null) {
  const defaultProxy = config.proxy.enabled ? `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.host}:${config.proxy.port}` : null;
  const effectiveProxy = proxyUrl || defaultProxy;
  const session = await bootstrapSession(effectiveProxy);

  // ─── Strategy 1: GraphQL (fast, structured) ───────────────────────────────

  if (session.docIds.detail) {
    const capturedPdpVars = session.docIds._pdpVariables;
    const variables = capturedPdpVars
      ? { ...capturedPdpVars, listingID: listingId }
      : { listingID: listingId, scale: 2 };

    try {
      const parsed = await graphqlRequest(
        session,
        variables,
        session.docIds.detail,
        'MarketplacePDPContainerQuery',
        effectiveProxy
      );

      const detail =
        parsed?.data?.viewer?.marketplace_product_details_page?.target ||
        parsed?.data?.marketplace_product_details_page?.target ||
        parsed?.data?.node ||
        parsed?.data?.listing;

      if (detail) return detail;
    } catch (err) {
      console.warn(`[fb-scraper] GraphQL detail failed for ${listingId}: ${err.message}`);
    }
  }

  // ─── Strategy 2: HTML page scrape ─────────────────────────────────────────
  // The public FB marketplace listing page embeds structured data we can extract.
  // We deliberately omit auth cookies so FB serves the public guest-mode page.

  const url = `https://www.facebook.com/marketplace/item/${listingId}/`;
  const headers = {
    'User-Agent': session.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,es;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
    'Connection': 'close',
    // Use all session cookies from the Puppeteer bootstrap session
    'cookie': sessionCookies || session.cookies,
  };

  let html = '';
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const agent = effectiveProxy ? new HttpsProxyAgent(effectiveProxy) : undefined;
    try {
      const res = await fetch(url, {
        headers,
        signal: controller.signal,
        redirect: 'follow',
        agent,
      });
      html = await res.text();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || '');
      const retriable = controller.signal.aborted || /ECONNRESET|socket hang up|ETIMEDOUT|EAI_AGAIN|timeout/i.test(msg);
      if (!retriable || attempt === 2) break;
      await randomDelay(800 + attempt * 600, 1600 + attempt * 900);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!html) {
    console.warn(`[fb-scraper] HTML detail fetch failed for ${listingId}: ${lastErr?.message || 'no response'}`);
    return null;
  }

  try {

    // Extract OG meta tags — always present on public listing pages
    const ogDesc = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/)?.[1] || '';
    const ogImage = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)?.[1] || '';
    const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)?.[1] || '';

    // Decode HTML entities in description
    const description = ogDesc
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&#39;/g, "'");

    // Extract photos from the listing_photos JSON array embedded in the page.
    // IMPORTANT: scope to that array only — the full page has 30+ scontent URLs
    // (ads, thumbnails, profile pics) that we must not grab.
    // We deliberately skip og:image because it is always a scaled copy of
    // listing_photos[0], and including it creates a duplicate in the merged list.
    const photos = [];

    const lpKey = '"listing_photos":[';
    const lpStart = html.indexOf(lpKey);
    if (lpStart !== -1) {
      // Find the matching closing bracket by tracking depth
      let depth = 0;
      let i = lpStart + lpKey.length - 1; // points at '['
      const arrayStart = i;
      for (; i < html.length; i++) {
        if (html[i] === '[') depth++;
        else if (html[i] === ']') { depth--; if (depth === 0) break; }
      }
      const section = html.slice(arrayStart, i + 1);
      const uriMatches = [...section.matchAll(/"uri"\s*:\s*"([^"]+)"/g)];
      for (const m of uriMatches) {
        let uri;
        try { uri = JSON.parse('"' + m[1] + '"'); }
        catch { uri = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'); }
        if (uri && !photos.includes(uri)) photos.push(uri);
      }
    }

    // Fall back to og:image only if we found no listing_photos
    if (photos.length === 0 && ogImage) photos.push(ogImage);

    // Try to find creation_time
    const ctMatch = html.match(/"creation_time"\s*:\s*(\d+)/);
    const creationTime = ctMatch ? parseInt(ctMatch[1], 10) : null;

    // Try to find seller name
    const sellerMatch = html.match(/"seller_name"\s*:\s*"([^"]+)"/) ||
                        html.match(/"display_name"\s*:\s*"([^"]+)"/);
    const sellerName = sellerMatch?.[1] || '';

    return {
      // Format compatible with mergeDetail()
      redacted_description: { text: description },
      description,
      listing_photos: photos.map((uri) => ({ image: { uri } })),
      creation_time: creationTime,
      marketplace_listing_seller: sellerName ? { name: sellerName } : null,
      _source: 'html_scrape',
    };
  } catch (err) {
    console.warn(`[fb-scraper] HTML detail parse failed for ${listingId}: ${err.message}`);
    return null;
  }
}

// ─── Normalisation ────────────────────────────────────────────────────────────

/**
 * Merge a detail object's extra fields into a search listing object.
 * Called when we have both the search summary and the full detail.
 *
 * @param {object} searchListing  Normalised listing from search results
 * @param {object} rawDetail      Raw FB detail object from getListingDetail()
 * @returns {object}              Merged listing with all available fields
 */
export function mergeDetail(searchListing, rawDetail) {
  if (!rawDetail) return searchListing;

  // Description — detail page always has the full text
  const description =
    rawDetail.redacted_description?.text ||
    rawDetail.description?.text ||
    rawDetail.description ||
    searchListing.description ||
    '';

  // All photos from detail (authoritative — use exclusively when available)
  const detailPhotos =
    rawDetail.listing_photos ||
    rawDetail.photos ||
    rawDetail.media_photos ||
    [];
  const detailPhotoUris = [];
  for (const p of detailPhotos) {
    const uri = p?.image?.uri || p?.image?.url || p?.uri;
    if (uri && !detailPhotoUris.includes(uri)) detailPhotoUris.push(uri);
  }
  // If detail gave us photos, use only those (avoids duplicates from CDN URL variants).
  // Otherwise fall back to whatever the search result had.
  const photos = detailPhotoUris.length > 0 ? detailPhotoUris : [...searchListing.photos];

  // Seller info — detail page always has name
  const sellerRaw =
    rawDetail.marketplace_listing_seller ||
    rawDetail.seller ||
    rawDetail.author ||
    {};
  const sellerName =
    sellerRaw.name ||
    sellerRaw.display_name ||
    searchListing.seller.name;
  const sellerId = sellerRaw.id || searchListing.seller.id;

  // Creation time
  const postedAt =
    rawDetail.creation_time
      ? new Date(rawDetail.creation_time * 1000).toISOString()
      : rawDetail.listed_time
      ? new Date(rawDetail.listed_time * 1000).toISOString()
      : searchListing.postedAt;

  return {
    ...searchListing,
    description,
    photos,
    seller: { ...searchListing.seller, name: sellerName, id: sellerId },
    postedAt,
    _rawDetail: rawDetail,
  };
}

/**
 * Normalise a raw Facebook listing from a search edge into the shared pipeline format.
 *
 * @param {object} fbListing  Raw listing object from Facebook GraphQL search response
 * @returns {object}          Normalised deal object
 */
export function normalizeListing(fbListing) {
  if (!fbListing) return null;

  // ID — can be in several places
  const id = fbListing.id || fbListing.listing_id || fbListing.target?.id || '';

  // Title
  const title =
    fbListing.marketplace_listing_title ||
    fbListing.listing_title ||
    fbListing.name ||
    fbListing.title ||
    '';

  // Price — search results have listing_price; detail may have it differently
  const priceObj = fbListing.listing_price || fbListing.price;
  const priceCents = parseFBPrice(priceObj);
  const priceAmount = priceCents !== null ? priceCents / 100 : null;
  const currency = priceObj?.currency || priceObj?.amount_with_offset_in_currency?.currency || 'EUR';

  // Location
  const locationData =
    fbListing.location?.reverse_geocode ||
    fbListing.listing_location?.reverse_geocode ||
    fbListing.location ||
    {};
  const city =
    locationData.city ||
    locationData.city_page?.name ||
    locationData.neighborhood ||
    '';
  const state =
    locationData.state ||
    locationData.state_abbreviation ||
    locationData.region ||
    '';

  // Seller — may be null in search results (privacy), available in detail
  const sellerRaw =
    fbListing.marketplace_listing_seller ||
    fbListing.seller ||
    fbListing.author ||
    {};
  const sellerName =
    sellerRaw.name || sellerRaw.display_name || '';
  const sellerId = sellerRaw.id || sellerRaw.marketplace_seller_id || '';

  // Photos
  const photos = [];
  // Primary photo
  const primaryUri =
    fbListing.primary_listing_photo?.image?.uri ||
    fbListing.primary_listing_photo?.image?.url ||
    fbListing.cover_photo?.image?.uri;
  if (primaryUri) photos.push(primaryUri);

  // Additional photos
  const allPhotos =
    fbListing.listing_photos ||
    fbListing.photos ||
    fbListing.media_photos ||
    [];
  for (const p of allPhotos) {
    const uri = p?.image?.uri || p?.image?.url || p?.uri;
    if (uri && !photos.includes(uri)) photos.push(uri);
  }

  // Condition from sub-titles
  let condition = null;
  const subTitles = fbListing.custom_sub_titles_with_rendering_flags || [];
  let shippingOffered = Boolean(
    fbListing.is_shipping_offered ||
    fbListing.shipping_offered ||
    fbListing.marketplace_shipping_eligible ||
    fbListing.marketplace_shipping_seller_eligible ||
    fbListing.shipping_eligible
  );
  let shippingText = '';
  for (const sub of subTitles) {
    const text = sub?.subtitle || sub?.text || '';
    if (!condition && /bueno|buen estado|good|fair|excellent|nuevo|new|usado|used|like new/i.test(text)) {
      condition = text.trim();
    }
    if (!shippingOffered && /ship|shipping|delivery|pickup/i.test(text)) {
      shippingOffered = /ship|shipping|delivery/i.test(text);
      shippingText = text.trim();
    }
  }
  // Also try condition from listing directly
  if (!condition) {
    condition =
      fbListing.condition ||
      fbListing.listing_condition?.display_name ||
      null;
  }

  // Description
  const description =
    fbListing.redacted_description?.text ||
    fbListing.description?.text ||
    fbListing.description ||
    '';

  if (!shippingText) {
    shippingText =
      fbListing.shipping_label?.text ||
      fbListing.shipping_label ||
      fbListing.delivery_type ||
      fbListing.delivery_method ||
      '';
  }

  // Creation time — epoch seconds
  const creationTime =
    fbListing.creation_time ||
    fbListing.listed_time ||
    fbListing.created_time ||
    null;

  return {
    id,
    title,
    price: priceAmount,
    currency,
    description,
    photos,
    seller: {
      name: sellerName || 'Unknown',
      id: sellerId,
      location: [city, state].filter(Boolean).join(', '),
    },
    condition,
    postedAt: creationTime ? new Date(creationTime * 1000).toISOString() : null,
    isPending: fbListing.is_pending || false,
    shippingOffered,
    shippingText,
    url: buildListingUrl(id),
    source: 'facebook',
  };
}
