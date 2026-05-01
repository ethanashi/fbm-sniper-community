import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { normalizeProxyInput } from "./shared-marketplace/proxy.js";

export const MERCARI_BASE_URL = "https://www.mercari.com";
export const MERCARI_DEFAULT_SORT_BY = 2;

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let stealthRegistered = false;

function registerStealth() {
  if (stealthRegistered) return;
  puppeteer.use(StealthPlugin());
  stealthRegistered = true;
}

export class MercariBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "MercariBlockedError";
    this.code = "MERCARI_BLOCKED";
  }
}

export class MercariSearchTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "MercariSearchTimeoutError";
    this.code = "MERCARI_SEARCH_TIMEOUT";
  }
}

export function buildMercariSearchUrl(keyword, { sortBy = MERCARI_DEFAULT_SORT_BY } = {}) {
  const url = new URL("/search/", MERCARI_BASE_URL);
  url.searchParams.set("keyword", String(keyword || "").trim());
  url.searchParams.set("sortBy", String(sortBy || MERCARI_DEFAULT_SORT_BY));
  return url.toString();
}

export function isMercariSearchApiUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "www.mercari.com" &&
      url.pathname === "/v1/api" &&
      url.searchParams.get("operationName") === "searchFacetQuery";
  } catch {
    return false;
  }
}

function centsToDollars(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed / 100) * 100) / 100;
}

function collectPhotoUrls(item) {
  return (Array.isArray(item?.photos) ? item.photos : [])
    .map((photo) => photo?.imageUrl || photo?.fullSizeUrl || photo?.thumbnail)
    .filter(Boolean);
}

function normalizeSeller(seller) {
  if (!seller || typeof seller !== "object") return null;
  const id = seller.sellerId ?? seller.id ?? null;
  return id == null ? null : { id };
}

export function normalizeMercariItems(payload) {
  const source = Array.isArray(payload)
    ? payload
    : payload?.data?.search?.itemsList || payload?.itemsList || [];

  return (Array.isArray(source) ? source : [])
    .map((item) => {
      const id = String(item?.id || "").trim();
      const title = String(item?.name || item?.title || "").trim();
      if (!id || !title) return null;

      const photoUrls = collectPhotoUrls(item);
      return {
        id,
        title,
        status: item?.status || "",
        price: centsToDollars(item?.price),
        originalPrice: centsToDollars(item?.originalPrice),
        url: `${MERCARI_BASE_URL}/us/item/${id}/`,
        photoUrl: photoUrls[0] || null,
        photoUrls,
        seller: normalizeSeller(item?.seller),
        brand: item?.brand?.name || null,
        condition: item?.itemCondition?.name || null,
        category: item?.categoryTitle || item?.itemCategory?.name || null,
        raw: item,
      };
    })
    .filter(Boolean);
}

export function parseProxyUrl(raw) {
  const proxy = normalizeProxyInput(raw);
  if (!proxy) return null;
  return {
    server: proxy.server,
    username: proxy.username,
    password: proxy.password,
  };
}

async function scrapeDomListings(page) {
  const rows = await page.evaluate(() => {
    const priceRe = /\$[\d,]+(?:\.\d{2})?/g;
    return [...document.links]
      .filter((anchor) => anchor.href.includes("/us/item/") || anchor.href.includes("/item/"))
      .map((anchor) => {
        const text = anchor.textContent.trim().replace(/\s+/g, " ");
        const prices = text.match(priceRe) || [];
        const id = (anchor.href.match(/\/(?:us\/)?item\/([^/?#]+)/) || [])[1] || "";
        const priceText = prices[0] || "";
        const title = priceText ? text.slice(0, text.indexOf(priceText)).trim() : text;
        return { id, href: anchor.href, title, priceText };
      })
      .filter((row) => row.id && row.title && row.priceText);
  });

  const seen = new Set();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .map((row) => ({
      id: row.id,
      title: row.title,
      status: "on_sale",
      price: Number(row.priceText.replace(/[$,]/g, "")),
      originalPrice: null,
      url: row.href.split("?")[0],
      photoUrl: null,
      photoUrls: [],
      seller: null,
      brand: null,
      condition: null,
      category: null,
      raw: row,
    }));
}

export async function createMercariSession({
  proxy = "",
  userAgent = DEFAULT_USER_AGENT,
  headless = "new",
  timeoutMs = 60000,
} = {}) {
  registerStealth();
  const parsedProxy = parseProxyUrl(proxy);
  const args = ["--no-sandbox", "--disable-setuid-sandbox"];
  if (parsedProxy?.server) args.push(`--proxy-server=${parsedProxy.server}`);

  const browser = await puppeteer.launch({ headless, args });

  async function configurePage(page) {
    await page.setViewport({ width: 1365, height: 900 });
    await page.setUserAgent(userAgent || DEFAULT_USER_AGENT);
    if (parsedProxy?.username) {
      await page.authenticate({
        username: parsedProxy.username,
        password: parsedProxy.password || "",
      });
    }
  }

  async function search(keyword, { limit = 100, sortBy = MERCARI_DEFAULT_SORT_BY } = {}) {
    const page = await browser.newPage();
    await configurePage(page);

    let settled = false;
    let timer = null;
    const apiPayloadPromise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new MercariSearchTimeoutError(`Timed out waiting for Mercari search API for "${keyword}"`));
      }, timeoutMs);

      page.on("response", async (response) => {
        if (settled || !isMercariSearchApiUrl(response.url())) return;
        const status = response.status();
        let text = "";
        try {
          text = await response.text();
        } catch (error) {
          settled = true;
          clearTimeout(timer);
          reject(error);
          return;
        }

        if (status === 403 || /Just a moment|cf-mitigated|Cloudflare/i.test(text)) {
          settled = true;
          clearTimeout(timer);
          reject(new MercariBlockedError("Mercari blocked the public search API request."));
          return;
        }
        if (status >= 400) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Mercari search API returned HTTP ${status}`));
          return;
        }

        try {
          settled = true;
          clearTimeout(timer);
          resolve(JSON.parse(text));
        } catch (error) {
          reject(error);
        }
      });
    });

    try {
      await page.goto(buildMercariSearchUrl(keyword, { sortBy }), {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs,
      });
      const payload = await apiPayloadPromise;
      return normalizeMercariItems(payload).slice(0, limit);
    } catch (error) {
      const fallbackItems = await scrapeDomListings(page).catch(() => []);
      if (fallbackItems.length) return fallbackItems.slice(0, limit);
      throw error;
    } finally {
      clearTimeout(timer);
      await page.close().catch(() => {});
    }
  }

  return {
    search,
    close: () => browser.close(),
  };
}

export async function fetchMercariSearchItems(keyword, options = {}) {
  const session = await createMercariSession(options);
  try {
    return await session.search(keyword, options);
  } finally {
    await session.close();
  }
}
