/**
 * Wallapop Electronics Sniper — Community Edition
 *
 * AI-free: programmatic price-band scoring replaces Gemma vision analysis.
 * Supports iPhone, Mac, iPad, AirPods — any product in the shared watchlist.
 *
 * Usage:
 *   node lib/wallapop-sniper.js
 *   node lib/wallapop-sniper.js --test
 */

import axios from "axios";
import chalk from "chalk";
import crypto from "crypto";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import fs from "fs";
import { WALLAPOP_DATA_DIR, WALLAPOP_FOUND_FILE, WALLAPOP_SEEN_FILE } from "./paths.js";
import { loadWorkspaceConfig, loadWorkspaceWatchlist, ensureWorkspaceFiles, resolveTargetForPlatform } from "./shared-marketplace/workspace.js";
import { getActivePlatformTargets, targetMatchesText, summarizeTarget } from "./shared-marketplace/target-utils.js";
import { scoreElectronicsListing } from "./shared-marketplace/programmatic-scorer.js";
import { notify } from "./shared-marketplace/notifier.js";

dayjs.extend(relativeTime);

const FLAG_TEST = process.argv.includes("--test");
const LOWBALL_MAX_RATIO = 1.8;

// ─── Max-Buy Tables (EUR, Madrid market) ─────────────────────────────────────

const MAX_BUY_IPHONE = {
  "iphone 13 128": 115, "iphone 13 256": 133, "iphone 13 512": 156,
  "iphone 13 pro 128": 163, "iphone 13 pro 256": 180, "iphone 13 pro 512": 202, "iphone 13 pro 1024": 224,
  "iphone 13 pro max 128": 205, "iphone 13 pro max 256": 226, "iphone 13 pro max 512": 252, "iphone 13 pro max 1024": 277,
  "iphone 14 128": 155, "iphone 14 256": 172, "iphone 14 512": 193,
  "iphone 14 pro 128": 205, "iphone 14 pro 256": 226, "iphone 14 pro 512": 252, "iphone 14 pro 1024": 277,
  "iphone 14 pro max 128": 263, "iphone 14 pro max 256": 289, "iphone 14 pro max 512": 322, "iphone 14 pro max 1024": 356,
  "iphone 15 128": 263, "iphone 15 256": 289, "iphone 15 512": 319,
  "iphone 15 pro 128": 348, "iphone 15 pro 256": 382, "iphone 15 pro 512": 420, "iphone 15 pro 1024": 458,
  "iphone 15 pro max 256": 424, "iphone 15 pro max 512": 467, "iphone 15 pro max 1024": 518,
  "iphone 16 128": 322, "iphone 16 256": 351, "iphone 16 512": 385,
  "iphone 16 pro 128": 441, "iphone 16 pro 256": 475, "iphone 16 pro 512": 526, "iphone 16 pro 1024": 577,
  "iphone 16 pro max 256": 534, "iphone 16 pro max 512": 585, "iphone 16 pro max 1024": 653,
};

const MAX_BUY_MAC = {
  "macbook air m1 8 256": 520, "macbook air m1 8 512": 590, "macbook air m1 16 256": 580, "macbook air m1 16 512": 650,
  "macbook air m2 8 256": 650, "macbook air m2 8 512": 720, "macbook air m2 16 256": 720, "macbook air m2 16 512": 800,
  "macbook air m3 8 256": 800, "macbook air m3 8 512": 880, "macbook air m3 16 256": 880, "macbook air m3 16 512": 980,
  "macbook air m4 16 256": 1000, "macbook air m4 16 512": 1100,
  "macbook pro m1 8 256": 700, "macbook pro m1 8 512": 780, "macbook pro m1 16 512": 900, "macbook pro m1 16 1024": 1050,
  "macbook pro m2 8 256": 800, "macbook pro m2 8 512": 880, "macbook pro m2 16 512": 1000, "macbook pro m2 16 1024": 1200,
  "macbook pro m3 8 512": 950, "macbook pro m3 16 512": 1100, "macbook pro m3 16 1024": 1350,
  "macbook pro m4 16 512": 1200, "macbook pro m4 16 1024": 1450,
};

const MAX_BUY_IPAD = {
  "ipad 10 64": 260, "ipad 10 256": 320,
  "ipad mini 6 64": 330, "ipad mini 6 256": 390,
  "ipad mini 7 128": 360, "ipad mini 7 256": 420,
  "ipad air 5 64": 380, "ipad air 5 256": 450,
  "ipad air m2 128": 450, "ipad air m2 256": 530,
  "ipad pro 11 m2 128": 550, "ipad pro 11 m2 256": 630, "ipad pro 11 m2 512": 720,
  "ipad pro 11 m4 256": 700, "ipad pro 11 m4 512": 800,
  "ipad pro 13 m2 128": 700, "ipad pro 13 m2 256": 800,
  "ipad pro 13 m4 256": 900, "ipad pro 13 m4 512": 1050,
};

const MAX_BUY_AIRPODS = {
  "airpods 2": 60, "airpods 3": 90,
  "airpods pro 1": 130, "airpods pro 2": 160,
  "airpods max silver": 280, "airpods max space gray": 280,
};

const WALLAPOP_PRODUCTS = new Set(["iphone", "mac", "ipad", "airpods"]);

function getMaxBuyTable(product) {
  const p = String(product || "").toLowerCase();
  if (p === "mac")     return MAX_BUY_MAC;
  if (p === "ipad")    return MAX_BUY_IPAD;
  if (p === "airpods") return MAX_BUY_AIRPODS;
  return MAX_BUY_IPHONE;
}

// ─── Model + Storage Detection ────────────────────────────────────────────────

function normalize(text) {
  return String(text || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim();
}

const IPHONE_PATTERNS = [
  { key: "iphone 16 pro max", re: /i(?:phone)?[\s-]?16[\s-]?pro[\s-]?max/ },
  { key: "iphone 16 pro",     re: /i(?:phone)?[\s-]?16[\s-]?pro(?!\s*max)/ },
  { key: "iphone 16",         re: /i(?:phone)?[\s-]?16(?!\s*pro)(?!\s*plus)/ },
  { key: "iphone 15 pro max", re: /i(?:phone)?[\s-]?15[\s-]?pro[\s-]?max/ },
  { key: "iphone 15 pro",     re: /i(?:phone)?[\s-]?15[\s-]?pro(?!\s*max)/ },
  { key: "iphone 15",         re: /i(?:phone)?[\s-]?15(?!\s*pro)(?!\s*plus)/ },
  { key: "iphone 14 pro max", re: /i(?:phone)?[\s-]?14[\s-]?pro[\s-]?max/ },
  { key: "iphone 14 pro",     re: /i(?:phone)?[\s-]?14[\s-]?pro(?!\s*max)/ },
  { key: "iphone 14",         re: /i(?:phone)?[\s-]?14(?!\s*pro)(?!\s*plus)/ },
  { key: "iphone 13 pro max", re: /i(?:phone)?[\s-]?13[\s-]?pro[\s-]?max/ },
  { key: "iphone 13 pro",     re: /i(?:phone)?[\s-]?13[\s-]?pro(?!\s*max)/ },
  { key: "iphone 13",         re: /i(?:phone)?[\s-]?13(?!\s*pro)(?!\s*mini)/ },
];

function detectIphoneModel(text) {
  const n = normalize(text);
  for (const { key, re } of IPHONE_PATTERNS) if (re.test(n)) return key;
  return null;
}

function detectMacModel(text) {
  const n = normalize(text);
  const chip = n.match(/\bm([1-4])(?:\s*(pro|max|ultra))?\b/);
  if (!chip) return null;
  const chipStr = `m${chip[1]}${chip[2] ? " " + chip[2] : ""}`;
  if (/macbook\s*pro/.test(n)) return `macbook pro ${chipStr}`;
  if (/macbook/.test(n)) return `macbook air ${chipStr}`;
  return null;
}

function detectIpadModel(text) {
  const n = normalize(text);
  if (/ipad\s*pro/.test(n)) {
    const size = n.match(/\b(11|12\.9|13)\s*(?:inch|"|pulgadas?)?/);
    const chip = n.match(/\bm([1-4])\b/);
    return `ipad pro ${size ? size[1].replace("12.9", "13") : "11"} ${chip ? "m" + chip[1] : "m2"}`;
  }
  if (/ipad\s*air/.test(n)) {
    const chip = n.match(/\bm([12])\b/);
    const gen = n.match(/\b([45])[aª]?\s*gen/) || n.match(/air\s*([45])/);
    if (chip) return `ipad air m${chip[1]}`;
    return `ipad air ${gen ? gen[1] : "5"}`;
  }
  if (/ipad\s*mini/.test(n)) {
    const gen = n.match(/mini\s*([67])/);
    return `ipad mini ${gen ? gen[1] : "6"}`;
  }
  if (/ipad\s*10/.test(n)) return "ipad 10";
  return null;
}

function detectAirpodsModel(text) {
  const n = normalize(text);
  if (/airpods\s*max/.test(n)) return "airpods max silver";
  if (/airpods\s*pro/.test(n)) {
    const gen = n.match(/\b([12])[aª]?\s*gen/) || n.match(/pro\s*([12])/);
    return `airpods pro ${gen ? gen[1] : "2"}`;
  }
  const gen = n.match(/airpods\s*([23])/);
  if (gen) return `airpods ${gen[1]}`;
  if (/airpods/.test(n)) return "airpods 2";
  return null;
}

function detectModel(text, product) {
  const p = String(product || "").toLowerCase();
  if (p === "mac")     return detectMacModel(text);
  if (p === "ipad")    return detectIpadModel(text);
  if (p === "airpods") return detectAirpodsModel(text);
  return detectIphoneModel(text) || detectMacModel(text) || detectIpadModel(text) || detectAirpodsModel(text);
}

function detectStorage(text) {
  const n = normalize(text);
  const tb = n.match(/(\d+)\s*(?:tb|tera)/);
  if (tb) return parseInt(tb[1], 10) * 1024;
  const gb = n.match(/(\d+)\s*(?:gb|go|giga)/);
  if (gb) {
    const v = parseInt(gb[1], 10);
    if ([32, 64, 128, 256, 512].includes(v)) return v;
    if (v >= 1000) return v;
  }
  return null;
}

function detectRam(text) {
  const n = normalize(text);
  const m = n.match(/(\d+)\s*gb\s*(?:ram|memoria|memory|unified)/);
  if (m) return parseInt(m[1], 10);
  const slash = n.match(/(\d+)\s*gb\s*[/|]\s*(\d+)\s*(?:gb|tb)/);
  if (slash) return parseInt(slash[1], 10);
  return null;
}

function resolveMaxBuy(product, modelKey, storageGb, ramGb) {
  if (!modelKey) return null;
  const table = getMaxBuyTable(product);
  const isMac = modelKey.startsWith("macbook");
  const lookupKey = isMac ? `${modelKey} ${ramGb || 8} ${storageGb}` : `${modelKey} ${storageGb}`;
  if (table[lookupKey] !== undefined) return table[lookupKey];

  const candidates = Object.keys(table).filter((k) => k.startsWith(modelKey));
  if (!candidates.length) return null;

  let best = null, bestDiff = Infinity;
  for (const k of candidates) {
    const parts = k.replace(modelKey, "").trim().split(" ");
    const kStorage = parseInt(parts[parts.length - 1], 10);
    if (kStorage <= storageGb && storageGb - kStorage < bestDiff) {
      bestDiff = storageGb - kStorage;
      best = k;
    }
  }
  return best ? table[best] : table[candidates[0]];
}

function defaultStorageForModel(modelKey, product) {
  const table = getMaxBuyTable(product);
  const keys = Object.keys(table).filter((k) => k.startsWith(modelKey));
  if (!keys.length) return 128;
  const storages = keys.map((k) => {
    const parts = k.replace(modelKey, "").trim().split(" ");
    return parseInt(parts[parts.length - 1], 10);
  }).filter(Boolean);
  return Math.min(...storages);
}

function storageLabel(gb) { return gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`; }

function titleCase(str) {
  return str.split(" ").map((w) => {
    if (w === "iphone") return "iPhone";
    if (w === "macbook") return "MacBook";
    if (w === "airpods") return "AirPods";
    if (w === "ipad") return "iPad";
    if (/^m[1-4]/.test(w)) return w.toUpperCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
];

let uaIndex = 0;
const DEVICE_ID = crypto.randomUUID();

function buildHeaders() {
  return {
    "User-Agent": USER_AGENTS[(uaIndex++) % USER_AGENTS.length],
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "x-deviceos": "0",
    "x-appversion": "818810",
    "x-deviceid": DEVICE_ID,
    "Referer": "https://es.wallapop.com/",
    "Origin": "https://es.wallapop.com",
  };
}

async function fetchPage(query, cfg) {
  const response = await axios.get("https://api.wallapop.com/api/v3/search", {
    params: {
      keywords: query,
      latitude: cfg.lat,
      longitude: cfg.lng,
      distance_in_km: cfg.radiusKm,
      order_by: "newest",
      min_sale_price: cfg.minPrice,
      max_sale_price: cfg.maxPrice,
      source: "deep_link",
      time_filter: "today",
      category_id: 24200,
      condition: "NEW,GOOD,AS_GOOD_AS_NEW",
      shipping: true,
    },
    headers: buildHeaders(),
    timeout: 15000,
  });
  const items = response.data?.data?.section?.payload?.items || [];
  return items;
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function loadSeenIds() {
  try {
    if (fs.existsSync(WALLAPOP_SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLAPOP_SEEN_FILE, "utf8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { /* start fresh */ }
  return new Set();
}

function saveSeenIds(seenIds) {
  let arr = Array.from(seenIds);
  if (arr.length > 10000) arr = arr.slice(arr.length - 10000);
  fs.mkdirSync(WALLAPOP_DATA_DIR, { recursive: true });
  fs.writeFileSync(WALLAPOP_SEEN_FILE, JSON.stringify(arr), "utf8");
}

function appendFound(record) {
  fs.mkdirSync(WALLAPOP_DATA_DIR, { recursive: true });
  fs.appendFileSync(WALLAPOP_FOUND_FILE, JSON.stringify(record) + "\n", "utf8");
}

// ─── Scan Cycle ───────────────────────────────────────────────────────────────

let seenIds = new Set();
let cycleCount = 0;
let backoffSec = 0;

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function hasPositiveNumber(value) {
  return hasNumber(value) && Number(value) > 0;
}

async function runQuery(target, cfg) {
  const query = target?.query || target?.label || "";
  let items;
  try {
    items = await fetchPage(query, {
      lat: cfg.lat,
      lng: cfg.lng,
      radiusKm: hasPositiveNumber(target?.radiusKM) ? Number(target.radiusKM) : cfg.radiusKm,
      minPrice: hasNumber(target?.minPrice) ? Number(target.minPrice) : 80,
      maxPrice: hasNumber(target?.maxPrice) ? Number(target.maxPrice) : 3500,
    });
    backoffSec = 0;
  } catch (err) {
    const status = err.response?.status;
    if (status === 429 || status === 403) {
      backoffSec = backoffSec === 0 ? 30 : Math.min(backoffSec * 2, 240);
      console.log(chalk.red(`[wallapop] HTTP ${status} on "${query}" — backoff ${backoffSec}s`));
      await new Promise((r) => setTimeout(r, backoffSec * 1000));
      return;
    }
    console.log(chalk.red(`[wallapop] "${query}": ${err.message}`));
    return;
  }

  let newCount = 0;
  for (const item of items) {
    const id = String(item.id || "");
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    newCount++;

    if (item.reserved?.flag) continue;

    const price = item.price?.amount;
    if (!price || price < 80 || price > 3500) continue;

    const text = `${item.title} ${item.description || ""}`;
    if (!targetMatchesText(target, text)) continue;

    const product = target?.product || "iphone";
    if (!WALLAPOP_PRODUCTS.has(product)) continue;

    const modelKey = detectModel(text, product);
    if (!modelKey) continue;

    const rawStorage = detectStorage(text);
    const rawRam = detectRam(text);
    const storageGb = rawStorage ?? defaultStorageForModel(modelKey, product);
    const maxBuy = resolveMaxBuy(product, modelKey, storageGb, rawRam);

    if (maxBuy !== null && price > maxBuy * LOWBALL_MAX_RATIO) continue;

    const verdict = scoreElectronicsListing({
      title: item.title,
      description: item.description || "",
      price,
      maxBuy,
    });

    if (!verdict.go) continue;

    const url = `https://es.wallapop.com/item/${item.web_slug}`;
    const modelLabel = titleCase(modelKey);
    const sLabel = storageLabel(storageGb);
    const ramStr = rawRam ? `${rawRam}GB RAM / ` : "";
    const savings = maxBuy !== null ? maxBuy - price : null;
    const listedAgo = dayjs(item.created_at).fromNow();

    if (verdict.grade === "A" || verdict.grade === "B") {
      const border = "═".repeat(51);
      console.log(chalk.green(border));
      console.log(chalk.green(`🔥 WALLAPOP DEAL  [Grade ${verdict.grade}]`));
      console.log(chalk.green(`📱 ${modelLabel} ${ramStr}${sLabel} — €${price}`));
      if (maxBuy && savings !== null) console.log(chalk.green(`💰 Max buy: €${maxBuy} | Save: €${savings}`));
      console.log(chalk.green(`🔗 ${url}  ⏰ ${listedAgo}`));
      console.log(chalk.green(border));
      process.stdout.write("\x07");
    } else {
      const savingsStr = savings !== null ? (savings >= 0 ? ` · save €${savings}` : ` · offer €${maxBuy}`) : "";
      console.log(chalk.yellow(`🎯 [wp/${verdict.grade}] ${modelLabel} ${ramStr}${sLabel} — €${price}${savingsStr}`));
      console.log(chalk.gray(`   ${url}`));
    }

    const record = {
      timestamp: new Date().toISOString(),
      platform: "wallapop",
      product,
      model: modelLabel,
      storage_gb: storageGb,
      listing_price: price,
      max_buy: maxBuy,
      savings,
      grade: verdict.grade,
      score: verdict.score,
      reasons: verdict.reasons,
      url,
      title: item.title,
      query: target.query,
      target: summarizeTarget(target),
      item,
    };

    appendFound(record);
    await notify(record);
  }

  console.log(chalk.gray(`  [wp] "${query}" — ${items.length} checked, ${newCount} new`));
}

async function runCycle(cfg) {
  cycleCount++;
  console.log(chalk.cyan(`\n[wallapop] Cycle #${cycleCount} — ${new Date().toLocaleTimeString()}`));

  ensureWorkspaceFiles();
  const watchlist = loadWorkspaceWatchlist();
  const targets = getActivePlatformTargets(watchlist, "wallapop").filter(
    (t) => WALLAPOP_PRODUCTS.has(t.product)
  );

  if (!targets.length) {
    console.log(chalk.yellow("[wallapop] No enabled Wallapop targets in watchlist."));
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    await runQuery(resolveTargetForPlatform(targets[i], "wallapop"), cfg);
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 2000));
  }

  saveSeenIds(seenIds);
  console.log(chalk.gray(`[wallapop] Cycle #${cycleCount} done. Seen IDs: ${seenIds.size}`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureWorkspaceFiles();
  const workspaceConfig = loadWorkspaceConfig();
  const loc = workspaceConfig.location || {};

  const cfg = {
    lat: Number.isFinite(Number(loc.latitude)) ? Number(loc.latitude) : 40.4032,
    lng: Number.isFinite(Number(loc.longitude)) ? Number(loc.longitude) : -3.7037,
    radiusKm: 10,
    intervalSec: workspaceConfig.bots?.wallapop?.pollIntervalSec ?? 60,
  };

  seenIds = loadSeenIds();
  fs.mkdirSync(WALLAPOP_DATA_DIR, { recursive: true });

  const border = "═".repeat(51);
  console.log(chalk.blueBright(border));
  console.log(chalk.blueBright("  🔍 FBM Sniper Community — Wallapop Bot"));
  console.log(chalk.blueBright(`  📍 ${loc.label || "Madrid"} | ⏱  ${cfg.intervalSec}s interval`));
  console.log(chalk.blueBright(`  🤖 Scoring: programmatic (no AI)`));
  console.log(chalk.blueBright(border));
  if (FLAG_TEST) console.log(chalk.yellow("  ⚠️  TEST MODE — one cycle then exit"));

  let running = true;
  process.on("SIGINT",  () => { running = false; process.exit(0); });
  process.on("SIGTERM", () => { running = false; process.exit(0); });

  await runCycle(cfg);
  if (FLAG_TEST) { console.log(chalk.green("[wallapop] Test complete.")); process.exit(0); }

  while (running) {
    await new Promise((r) => setTimeout(r, cfg.intervalSec * 1000));
    if (running) await runCycle(cfg);
  }
}

main().catch((err) => {
  console.error(chalk.red(`[wallapop] fatal: ${err.message}`));
  process.exit(1);
});
