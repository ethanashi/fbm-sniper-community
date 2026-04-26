import fetch from 'node-fetch';

/**
 * Vinted Electronics Sniper — Community Edition
 *
 * AI-free: programmatic price-band scoring replaces Gemini vision review.
 * Searches per target query from the shared watchlist, all-fees-inclusive ceiling.
 *
 * Cookie sources (in priority order):
 *   1. workspace config bots.vinted.cookie (set via Settings UI)
 *   2. VINTED_COOKIE environment variable
 *   3. Auto-fetched from the configured Vinted domain homepage (refreshed every 55 min)
 *
 * Usage:
 *   node lib/vinted-sniper.js
 *   node lib/vinted-sniper.js --test
 */

import chalk from "chalk";
import { HttpsProxyAgent } from "https-proxy-agent";
import fs from "fs";
import { VINTED_DATA_DIR, VINTED_FOUND_FILE, VINTED_SEEN_FILE } from "./paths.js";
import { loadWorkspaceConfig, loadWorkspaceWatchlist, ensureWorkspaceFiles, resolveTargetForPlatform, hasConfirmedLocation, vintedDomainInfo, VINTED_DOMAINS } from "./shared-marketplace/workspace.js";
import { getActivePlatformTargets, targetMatchesText, summarizeTarget } from "./shared-marketplace/target-utils.js";
import { scoreElectronicsListing } from "./shared-marketplace/programmatic-scorer.js";
import { notify } from "./shared-marketplace/notifier.js";
import { mapLimit } from "./shared-marketplace/concurrency.js";
import { matchesRegexFilter, calculateProfitability, evaluateTriggers, calculateZScore } from "./shared-marketplace/logic.js";
import { isListingSeen, markListingSeen, recordPrice } from "./database.js";

const FLAG_TEST = process.argv.includes("--test");

// ─── Constants ────────────────────────────────────────────────────────────────

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

let activeUserAgent = MOBILE_UA;

function resolveUserAgent(workspaceConfig) {
  const fromConfig = workspaceConfig?.bots?.vinted?.userAgent;
  const fromEnv = process.env.VINTED_USER_AGENT;
  const candidate = String(fromConfig || fromEnv || "").trim();
  activeUserAgent = candidate || MOBILE_UA;
  return activeUserAgent;
}

// Populated in main() from workspace config — Vinted is a different host per country.
let VINTED_BASE    = "";
let VINTED_LANG    = "en-US,en;q=0.9";
const CATALOG_PATH = "/api/v2/catalog/items";
const CATALOG_URL  = () => `${VINTED_BASE}${CATALOG_PATH}`;
const ITEM_URL     = (id) => `${VINTED_BASE}/api/v2/items/${id}`;
const COOKIE_URL   = () => `${VINTED_BASE}/`;

const BRAND_IDS     = "54661"; // Apple
const CATALOG_IDS   = "3661";  // Electronics
const STATUS_IDS    = "2,3,1,6";

const COOKIE_TTL_MS = 55 * 60 * 1000;
const LOWBALL_MAX_RATIO = 1.8;

// ─── Vinted Fees ──────────────────────────────────────────────────────────────

const FEE_SHIPPING        = 3.50;
const FEE_ELECTRONICS     = 5.00;
const FEE_PROTECTION_FLAT = 0.70;
const FEE_PROTECTION_PCT  = 0.05;

const VINTED_STATUS_LABELS = { 1: "New with tags", 2: "New without tags", 3: "Very good", 4: "Good", 5: "Acceptable" };

function resolveConditionLabel(status) {
  if (!status) return "Unknown";
  if (typeof status === "object") return status.title || VINTED_STATUS_LABELS[status.id] || "Unknown";
  if (typeof status === "number") return VINTED_STATUS_LABELS[status] || `Status ${status}`;
  return String(status);
}

// Backed-out ceiling: what the listed price must be ≤ to fit within maxBuy all-in
function listedCeiling(maxAllIn) {
  const net = maxAllIn - FEE_SHIPPING - FEE_ELECTRONICS - FEE_PROTECTION_FLAT;
  if (net <= 0) return 0;
  return net / (1 + FEE_PROTECTION_PCT);
}

function computeFees(listed, shippingActual) {
  const protection = FEE_PROTECTION_FLAT + listed * FEE_PROTECTION_PCT;
  const shipping   = shippingActual != null ? shippingActual : FEE_SHIPPING;
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    protection: round2(protection),
    shipping: round2(shipping),
    total: round2(listed + protection + shipping),
    totalWithVerif: round2(listed + protection + shipping + FEE_ELECTRONICS),
  };
}

// ─── Max-Buy Table (iPhones, EUR) ─────────────────────────────────────────────

const MAX_BUY = {
  "iphone 13 128": 115, "iphone 13 256": 133, "iphone 13 512": 156,
  "iphone 13 pro 128": 163, "iphone 13 pro 256": 180, "iphone 13 pro 512": 202, "iphone 13 pro 1024": 224,
  "iphone 13 pro max 128": 205, "iphone 13 pro max 256": 226, "iphone 13 pro max 512": 252, "iphone 13 pro max 1024": 277,
  "iphone 14 128": 155, "iphone 14 256": 172, "iphone 14 512": 193,
  "iphone 14 plus 128": 168, "iphone 14 plus 256": 185,
  "iphone 14 pro 128": 205, "iphone 14 pro 256": 226, "iphone 14 pro 512": 252, "iphone 14 pro 1024": 277,
  "iphone 14 pro max 128": 263, "iphone 14 pro max 256": 289, "iphone 14 pro max 512": 322, "iphone 14 pro max 1024": 356,
  "iphone 15 128": 263, "iphone 15 256": 289, "iphone 15 512": 319,
  "iphone 15 plus 128": 280, "iphone 15 plus 256": 308,
  "iphone 15 pro 128": 348, "iphone 15 pro 256": 382, "iphone 15 pro 512": 420, "iphone 15 pro 1024": 458,
  "iphone 15 pro max 256": 424, "iphone 15 pro max 512": 467, "iphone 15 pro max 1024": 518,
  "iphone 16 128": 322, "iphone 16 256": 351, "iphone 16 512": 385,
  "iphone 16 plus 128": 348, "iphone 16 plus 256": 379,
  "iphone 16 pro 128": 441, "iphone 16 pro 256": 475, "iphone 16 pro 512": 526, "iphone 16 pro 1024": 577,
  "iphone 16 pro max 256": 534, "iphone 16 pro max 512": 585, "iphone 16 pro max 1024": 653,
};

const MODEL_KEYS = [
  "iphone 16 pro max", "iphone 16 pro", "iphone 16 plus", "iphone 16",
  "iphone 15 pro max", "iphone 15 pro", "iphone 15 plus", "iphone 15",
  "iphone 14 pro max", "iphone 14 pro", "iphone 14 plus", "iphone 14",
  "iphone 13 pro max", "iphone 13 pro", "iphone 13 mini", "iphone 13",
];

function normalize(text) {
  return String(text || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/promax/g, "pro max")
    .replace(/\s+/g, " ").trim();
}

function detectModel(title) {
  const n = normalize(title);
  for (const key of MODEL_KEYS) if (n.includes(key)) return key;
  return null;
}

function detectStorageGb(text) {
  const n = normalize(text);
  const tb = n.match(/(\d+)\s*(?:tb|tera)/);
  if (tb) return parseInt(tb[1], 10) * 1024;
  const gb = n.match(/(\d+)\s*(?:gb|go|giga)/);
  if (gb) {
    const v = parseInt(gb[1], 10);
    if ([64, 128, 256, 512, 1024].includes(v)) return v;
  }
  return null;
}

function resolveMaxBuy(modelKey, storageGb) {
  if (!modelKey) return null;
  const storage = storageGb || (() => {
    const sizes = Object.keys(MAX_BUY)
      .filter((k) => k.startsWith(modelKey))
      .map((k) => parseInt(k.split(" ").pop(), 10))
      .sort((a, b) => a - b);
    return sizes[0] || 128;
  })();
  const exact = `${modelKey} ${storage}`;
  if (MAX_BUY[exact] != null) return MAX_BUY[exact];

  const candidates = Object.keys(MAX_BUY).filter((k) => k.startsWith(modelKey));
  if (!candidates.length) return null;
  let best = candidates[0], bestDiff = Infinity;
  for (const key of candidates) {
    const size = parseInt(key.split(" ").pop(), 10);
    if (size <= storage && storage - size < bestDiff) { bestDiff = storage - size; best = key; }
  }
  return MAX_BUY[best];
}

function extractPrice(item) {
  const raw = item?.price;
  if (raw == null) return NaN;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number(raw);
  if (typeof raw === "object") return Number(raw.amount);
  return NaN;
}

function extractBatteryHealth(text) {
  const patterns = [
    /bater[ií]a\D{0,6}(\d{2,3})\s*%/i, /battery\D{0,6}(\d{2,3})\s*%/i,
    /salud\D{0,6}(\d{2,3})\s*%/i, /(\d{2,3})\s*%\s*(?:bater[ií]a|battery|salud)/i,
  ];
  for (const re of patterns) {
    const m = String(text || "").match(re);
    if (m) { const v = parseInt(m[1], 10); if (v >= 60 && v <= 100) return v; }
  }
  return null;
}

function extractShippingPrice(detail) {
  const candidates = [
    detail?.shipment_prices?.default?.amount,
    detail?.shipment_prices?.default,
    detail?.shipping_price?.amount,
    detail?.shipping_price,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const n = Number(typeof c === "object" ? c.amount : c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function collectPhotoUrls(detail, item) {
  const photos = detail?.photos || item?.photos || [];
  return Array.isArray(photos)
    ? photos.map((p) => p.full_size_url || p.url || p.full_url).filter(Boolean)
    : [];
}

// ─── Proxy helpers ────────────────────────────────────────────────────────────

function parseProxyUrl(raw) {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const cfg = { protocol: u.protocol.replace(":", ""), host: u.hostname, port: parseInt(u.port, 10) || 8080 };
    if (u.username) cfg.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || "") };
    return cfg;
  } catch { return undefined; }
}

let proxyPool = [];
let proxyIndex = 0;

function initProxies(workspaceConfig) {
  const pool = Array.isArray(workspaceConfig?.proxyPool) ? workspaceConfig.proxyPool : [];
  proxyPool = pool.map(parseProxyUrl).filter(Boolean);
  const single = workspaceConfig?.proxy || process.env.VINTED_PROXY;
  if (!proxyPool.length && single) {
    const p = parseProxyUrl(single);
    if (p) proxyPool = [p];
  }
  if (proxyPool.length) console.log(chalk.gray(`[vinted] ${proxyPool.length} proxy/proxies loaded`));
}

function nextProxy() {
  if (!proxyPool.length) return undefined;
  return proxyPool[(proxyIndex++) % proxyPool.length];
}

// ─── Cookie management ────────────────────────────────────────────────────────

let cookieCache = { value: null, token: null, fetchedAt: 0 };

function extractToken(cookieStr) {
  const m = String(cookieStr || "").match(/(?:^|;\s*)access_token_web=([^;]+)/);
  return m ? m[1] : null;
}

function loadManualCookie(workspaceConfig) {
  const raw = workspaceConfig?.bots?.vinted?.cookie || process.env.VINTED_COOKIE;
  if (!raw) return null;
  const token = extractToken(raw);
  if (!token) return null;
  console.log(chalk.gray(`[vinted] Using manual cookie (token length=${token.length})`));
  return { value: raw.trim(), token, fetchedAt: Date.now() };
}

async function fetchCookie() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const proxy = nextProxy();
  const agent = proxy ? new HttpsProxyAgent(`http://${proxy.auth ? `${proxy.auth.username}:${proxy.auth.password}@` : ""}${proxy.host}:${proxy.port}`) : undefined;

  try {
    const response = await fetch(COOKIE_URL(), {
      headers: {
        "User-Agent": activeUserAgent,
        "Accept-Language": VINTED_LANG,
        Accept: "text/html,application/xhtml+xml",
        "Upgrade-Insecure-Requests": "1",
      },
      signal: controller.signal,
      redirect: "follow",
      agent,
    });

    const setCookie = response.headers.raw()['set-cookie'] || [];
    const parts = [];
    let token = null;
    for (const entry of setCookie) {
      const pair = entry.split(';')[0];
      parts.push(pair);
      if (pair.startsWith("access_token_web=")) token = pair.slice("access_token_web=".length);
    }
    if (!token) throw new Error(`access_token_web not found (HTTP ${response.status})`);
    const value = parts.join("; ");
    cookieCache = { value, token, fetchedAt: Date.now() };
    console.log(chalk.gray(`[vinted] Cookie refreshed (token length=${token.length})`));
    return cookieCache;
  } finally {
    clearTimeout(timeout);
  }
}

async function getCookie(workspaceConfig, { force = false } = {}) {
  if (!force) {
    const manual = loadManualCookie(workspaceConfig);
    if (manual) { cookieCache = manual; return cookieCache; }
  }
  if (!force && cookieCache.value && Date.now() - cookieCache.fetchedAt < COOKIE_TTL_MS) return cookieCache;
  while (true) {
    try {
      return await fetchCookie();
    } catch (err) {
      const manual = loadManualCookie(workspaceConfig);
      if (manual) { console.log(chalk.yellow(`[vinted] Auto-fetch failed (${err.message}) — using manual cookie`)); cookieCache = manual; return cookieCache; }
      console.error(chalk.red(`[vinted] Cookie fetch failed: ${err.message} — retrying in 30s`));
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
}

function vintedHeaders(cookie) {
  return {
    Cookie: cookie.value,
    Authorization: `Bearer ${cookie.token}`,
    "User-Agent": activeUserAgent,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": VINTED_LANG,
    "X-Requested-With": "XMLHttpRequest",
    Referer: `${VINTED_BASE}/catalog`,
  };
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function searchListings(cookie, { keyword, priceFrom = 0, priceTo = 800 }) {
  const params = new URLSearchParams({
    search_text: keyword,
    brand_ids: BRAND_IDS,
    catalog_ids: CATALOG_IDS,
    status_ids: STATUS_IDS,
    price_from: String(priceFrom),
    price_to: String(priceTo),
    currency: "EUR",
    order: "newest_first",
    per_page: "30",
    page: "1",
  });
  const url = `${CATALOG_URL()}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const proxy = nextProxy();
  const agent = proxy ? new HttpsProxyAgent(`http://${proxy.auth ? `${proxy.auth.username}:${proxy.auth.password}@` : ""}${proxy.host}:${proxy.port}`) : undefined;

  try {
    const response = await fetch(url, {
      headers: vintedHeaders(cookie),
      signal: controller.signal,
      agent,
    });

    if (response.status === 429) {
      console.log(chalk.yellow("[vinted] 429 — cooling off 2 min")); await new Promise((r) => setTimeout(r, 120000)); return [];
    }
    if (response.status === 403) {
      console.log(chalk.yellow("[vinted] 403 — refreshing cookie")); await new Promise((r) => setTimeout(r, 15000));
      return [];
    }
    if (response.status >= 400) {
      console.log(chalk.yellow(`[vinted] search "${keyword}" returned ${response.status}`)); return [];
    }
    const data = await response.json();
    return Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    console.error(chalk.red(`[vinted] search error: ${err.message}`));
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function getItemDetail(itemId, cookie) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const proxy = nextProxy();
  const agent = proxy ? new HttpsProxyAgent(`http://${proxy.auth ? `${proxy.auth.username}:${proxy.auth.password}@` : ""}${proxy.host}:${proxy.port}`) : undefined;

  try {
    let response = await fetch(ITEM_URL(itemId), {
      headers: vintedHeaders(cookie),
      signal: controller.signal,
      agent,
    });
    if (response.status === 403) {
      await new Promise((r) => setTimeout(r, 10000));
      response = await fetch(ITEM_URL(itemId), {
        headers: vintedHeaders(cookie),
        signal: controller.signal,
        agent,
      });
    }
    if (response.status >= 400) return null;
    const data = await response.json();
    return data?.item || null;
  } catch { return null; }
  finally {
    clearTimeout(timeout);
  }
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function loadSeenIds() {
  try {
    if (fs.existsSync(VINTED_SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(VINTED_SEEN_FILE, "utf8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { /* start fresh */ }
  return new Set();
}

function saveSeenIds(seenIds) {
  let arr = Array.from(seenIds);
  if (arr.length > 10000) arr = arr.slice(arr.length - 10000);
  fs.mkdirSync(VINTED_DATA_DIR, { recursive: true });
  fs.writeFileSync(VINTED_SEEN_FILE, JSON.stringify(arr), "utf8");
}

function appendFound(record) {
  fs.mkdirSync(VINTED_DATA_DIR, { recursive: true });
  fs.appendFileSync(VINTED_FOUND_FILE, JSON.stringify(record) + "\n", "utf8");
}

// ─── Scan Cycle ───────────────────────────────────────────────────────────────

let seenIds = new Set();
let cycleCount = 0;

async function runTargetQuery(target, cookie, workspaceConfig) {
  const keyword = target?.query || target?.label || "iphone";
  const items = await searchListings(cookie, {
    keyword,
    priceFrom: Number.isFinite(Number(target?.minPrice)) ? Number(target.minPrice) : 0,
    priceTo: Number.isFinite(Number(target?.maxPrice)) ? Number(target.maxPrice) : 800,
  });

  const candidates = [];
  for (const item of items) {
    const id = item?.id;
    if (!id || await isListingSeen(String(id))) continue;

    const listed = extractPrice(item);
    if (!Number.isFinite(listed) || listed <= 0) continue;

    await recordPrice("vinted", keyword, listed);

    if (!targetMatchesText(target, `${item.title || ""} ${item.description || ""}`)) continue;

    const modelKey = detectModel(item.title || "");
    if (!modelKey) continue;

    const storageGb = detectStorageGb(`${item.title || ""} ${item.description || ""}`);
    const maxAllIn = resolveMaxBuy(modelKey, storageGb);
    if (maxAllIn === null) continue;

    const ceiling = listedCeiling(maxAllIn);

    // Regex Advanced Filter
    const regexResult = matchesRegexFilter(item.description || "", item.title || "", target, workspaceConfig.filters || {});
    if (regexResult.rejected) {
      console.log(chalk.gray(`  [vinted] rejected ${item.id}: ${regexResult.reason}`));
      continue;
    }
    if (listed > ceiling * LOWBALL_MAX_RATIO) continue;

    candidates.push({ item, listed, modelKey, storageGb, maxAllIn, ceiling });
  }

  if (!candidates.length) {
    console.log(chalk.gray(`  [vinted] "${keyword}" — ${items.length} checked, 0 candidates`));
    return;
  }

  // Batch detail fetches
  const details = await Promise.all(candidates.map(({ item }) => getItemDetail(item.id, cookie)));

  for (let i = 0; i < candidates.length; i++) {
    const { item, listed, modelKey, storageGb, maxAllIn, ceiling } = candidates[i];
    const detail = details[i];

    const verdict = scoreElectronicsListing({
      title: item.title || "",
      description: detail?.description || item.description || "",
      price: listed,
      maxBuy: ceiling,
    });

    // ROI / Profit Trigger
    const estSellingPrice = ceiling || (listed * 1.2);
    const profitability = calculateProfitability(listed, estSellingPrice, 10);
    const zScore = await calculateZScore("vinted", keyword, listed);
    const triggerResult = evaluateTriggers(profitability, workspaceConfig.filters || {}, zScore);

    if (!verdict.go && !triggerResult.triggered) continue;

    const url = `${VINTED_BASE}/items/${item.id}`;
    const fees = computeFees(listed, extractShippingPrice(detail));
    const photoUrls = collectPhotoUrls(detail, item);
    const condition = resolveConditionLabel(detail?.status || item?.status);
    const batteryPct = extractBatteryHealth(detail?.description || "");
    const savings = Math.round(ceiling - listed);
    const sellerUser = detail?.user || item?.user || {};
    // Vinted hides the Buy button for swap-only / reserved / closed listings
    const isBuyable = !(detail?.is_for_swap || detail?.is_reserved || detail?.is_closed);

    const modelLabel = modelKey.split(" ").map((w) =>
      w === "iphone" ? "iPhone" : w.charAt(0).toUpperCase() + w.slice(1)
    ).join(" ");
    const storageLbl = storageGb ? (storageGb >= 1024 ? `${storageGb / 1024}TB` : `${storageGb}GB`) : "";

    if (verdict.grade === "A" || verdict.grade === "B") {
      const border = "═".repeat(51);
      console.log(chalk.green(border));
      console.log(chalk.green(`🔥 VINTED DEAL  [Grade ${verdict.grade}]`));
      console.log(chalk.green(`📱 ${modelLabel}${storageLbl ? " " + storageLbl : ""} — €${listed}`));
      console.log(chalk.green(`💰 All-in: €${fees.total} | w/verif: €${fees.totalWithVerif} | Max all-in: €${maxAllIn}`));
      if (savings > 0) console.log(chalk.green(`💸 Under ceiling by €${savings}`));
      console.log(chalk.green(`🏷  Condition: ${condition}${batteryPct != null ? ` | 🔋 ${batteryPct}%` : ""}`));
      console.log(chalk.green(`📸 ${photoUrls.length} photo(s)`));
      console.log(chalk.green(`🔗 ${url}`));
      console.log(chalk.green(border));
      process.stdout.write("\x07");
    } else {
      console.log(chalk.yellow(`🎯 [vt/${verdict.grade}] ${modelLabel}${storageLbl ? " " + storageLbl : ""} — €${listed} · all-in €${fees.totalWithVerif}`));
      console.log(chalk.gray(`   ${url}`));
    }

    const record = {
      timestamp: new Date().toISOString(),
      platform: "vinted",
      product: target?.product || "iphone",
      model: modelLabel,
      storage_gb: storageGb,
      listing_price: listed,
      max_buy_all_in: maxAllIn,
      ceiling,
      savings,
      fees,
      grade: verdict.grade,
      score: verdict.score,
      reasons: verdict.reasons,
      condition,
      battery_health: batteryPct,
      photo_count: photoUrls.length,
      is_buyable: isBuyable,
      url,
      title: item.title,
      query: target.query,
      target: summarizeTarget(target),
      seller: {
        name: sellerUser.login || "unknown",
        rating: sellerUser.feedback_reputation ?? null,
        item_count: sellerUser.item_count ?? null,
      },
      item,
    };

    appendFound(record);
    await notify(record);
    await markListingSeen(String(item.id), "vinted");
  }

  console.log(chalk.gray(`  [vinted] "${keyword}" — ${items.length} checked, ${candidates.length} scored`));
}

async function runCycle(workspaceConfig) {
  cycleCount++;
  console.log(chalk.cyan(`\n[vinted] Cycle #${cycleCount} — ${new Date().toLocaleTimeString()}`));

  // Reload watchlist + runtime config each cycle so live edits take effect immediately
  ensureWorkspaceFiles();
  const freshConfig = loadWorkspaceConfig();
  resolveUserAgent(freshConfig);
  const watchlist = loadWorkspaceWatchlist();
  const targets = getActivePlatformTargets(watchlist, "vinted");

  if (!targets.length) {
    console.log(chalk.yellow("[vinted] No enabled Vinted targets in watchlist."));
    return;
  }

  // Refresh cookie once per cycle (getCookie is idempotent within TTL)
  const cookie = await getCookie(freshConfig);

  // Vinted is VERY aggressive with rate limits/shadowbans, keep concurrency low
  await mapLimit(targets, 2, async (target) => {
    await runTargetQuery(resolveTargetForPlatform(target, "vinted"), cookie, freshConfig);
    await new Promise((r) => setTimeout(r, 2000));
  });

  saveSeenIds(seenIds);
  console.log(chalk.gray(`[vinted] Cycle #${cycleCount} done. Seen IDs: ${seenIds.size}`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureWorkspaceFiles();
  const workspaceConfig = loadWorkspaceConfig();
  resolveUserAgent(workspaceConfig);
  const loc = workspaceConfig.location || {};
  const intervalSec = workspaceConfig.bots?.vinted?.pollIntervalSec ?? 45;

  if (!hasConfirmedLocation(loc)) {
    console.error(chalk.red("[vinted] Location needs review. Open Settings, change or confirm your city + coordinates, then start the bot again."));
    process.exit(2);
  }

  const domainSetting = String(workspaceConfig.bots?.vinted?.domain || "").trim().toLowerCase();
  const domainInfo = vintedDomainInfo(domainSetting);
  if (!domainInfo) {
    console.error(chalk.red("[vinted] No Vinted country selected."));
    console.error(chalk.yellow(`[vinted] Pick your country from the Vinted bot dropdown in Settings.`));
    console.error(chalk.gray(`[vinted] Supported domains: ${VINTED_DOMAINS.map((d) => d.domain).join(", ")}`));
    process.exit(2);
  }
  VINTED_BASE = `https://${domainInfo.domain}`;
  VINTED_LANG = domainInfo.lang;

  initProxies(workspaceConfig);
  seenIds = loadSeenIds();
  fs.mkdirSync(VINTED_DATA_DIR, { recursive: true });

  const border = "═".repeat(51);
  console.log(chalk.blueBright(border));
  console.log(chalk.blueBright("  🔍 FBM Sniper Community — Vinted Bot"));
  console.log(chalk.blueBright(`  📍 ${Number(loc.latitude)},${Number(loc.longitude)} | 🌍 ${domainInfo.country} (${domainInfo.domain}) | ⏱  ${intervalSec}s interval`));
  console.log(chalk.blueBright(`  🤖 Scoring: programmatic (no AI)`));
  console.log(chalk.blueBright(border));
  if (FLAG_TEST) console.log(chalk.yellow("  ⚠️  TEST MODE — one cycle then exit"));

  let running = true;
  process.on("SIGINT",  () => { running = false; process.exit(0); });
  process.on("SIGTERM", () => { running = false; process.exit(0); });

  await runCycle(workspaceConfig);
  if (FLAG_TEST) { console.log(chalk.green("[vinted] Test complete.")); process.exit(0); }

  while (running) {
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
    if (running) await runCycle(workspaceConfig);
  }
}

main().catch((err) => {
  console.error(chalk.red(`[vinted] fatal: ${err.message}`));
  process.exit(1);
});
