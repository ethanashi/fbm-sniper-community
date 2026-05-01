/**
 * Mercari Electronics Sniper - Community Edition
 *
 * AI-free: captures Mercari's public search GraphQL response from a real
 * browser session, then uses the shared watchlist and programmatic scoring.
 *
 * Usage:
 *   node lib/mercari-sniper.js
 *   node lib/mercari-sniper.js --test
 */

import chalk from "chalk";
import fs from "fs";
import { MERCARI_DATA_DIR, MERCARI_FOUND_FILE, MERCARI_SEEN_FILE } from "./paths.js";
import { createMercariSession, MercariBlockedError } from "./mercari-client.js";
import { loadWorkspaceConfig, loadWorkspaceWatchlist, ensureWorkspaceFiles, resolveTargetForPlatform } from "./shared-marketplace/workspace.js";
import { getActivePlatformTargets, targetMatchesText, summarizeTarget } from "./shared-marketplace/target-utils.js";
import { scoreElectronicsListing, scoreGenericListing } from "./shared-marketplace/programmatic-scorer.js";
import { notify } from "./shared-marketplace/notifier.js";
import { resolveTargetPriceBand, resolveTargetReferencePrice } from "./shared-marketplace/price-band.js";
import { convertPriceBandForCurrency, createCurrencyConverter, nativeCurrencyForPlatform } from "./shared-marketplace/currency.js";

const FLAG_TEST = process.argv.includes("--test");
const LOWBALL_MAX_RATIO = 1.8;
const MERCARI_PRODUCTS = new Set(["iphone", "playstation", "console"]);

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
  "iphone 17 pro max", "iphone 17 pro", "iphone 17 plus", "iphone 17",
  "iphone 16 pro max", "iphone 16 pro", "iphone 16 plus", "iphone 16",
  "iphone 15 pro max", "iphone 15 pro", "iphone 15 plus", "iphone 15",
  "iphone 14 pro max", "iphone 14 pro", "iphone 14 plus", "iphone 14",
  "iphone 13 pro max", "iphone 13 pro", "iphone 13 mini", "iphone 13",
];

const PS_MAX_BUY = {
  "ps4": 85, "ps4 slim": 95, "ps4 pro": 130,
  "ps5 digital": 250, "ps5 disc": 290, "ps5 pro": 445,
};

const PS_PATTERNS = [
  { key: "ps5 pro",     re: /ps[\s-]?5[\s-]?pro|playstation[\s-]?5[\s-]?pro/i },
  { key: "ps5 digital", re: /ps[\s-]?5[\s-]?digital|playstation[\s-]?5[\s-]?digital/i },
  { key: "ps5 disc",    re: /ps[\s-]?5[\s-]?dis[ck]o?|ps[\s-]?5(?![\s-]?pro)(?![\s-]?digital)|playstation[\s-]?5(?![\s-]?pro)(?![\s-]?digital)/i },
  { key: "ps4 pro",     re: /ps[\s-]?4[\s-]?pro|playstation[\s-]?4[\s-]?pro/i },
  { key: "ps4 slim",    re: /ps[\s-]?4[\s-]?slim|playstation[\s-]?4[\s-]?slim/i },
  { key: "ps4",         re: /ps[\s-]?4(?![\s-]?pro)(?![\s-]?slim)|playstation[\s-]?4(?![\s-]?pro)(?![\s-]?slim)/i },
];

function normalize(text) {
  return String(text || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/promax/g, "pro max")
    .replace(/\s+/g, " ").trim();
}

function detectPSModel(text) {
  const n = normalize(text);
  for (const { key, re } of PS_PATTERNS) if (re.test(n)) return key;
  return null;
}

function detectModel(title, product) {
  const p = String(product || "").toLowerCase();
  if (p === "playstation" || p === "console") return detectPSModel(title);

  const n = normalize(title);
  for (const key of MODEL_KEYS) if (n.includes(key)) return key;
  return null;
}

function isSpecializedMercariProduct(product) {
  return MERCARI_PRODUCTS.has(String(product || "").toLowerCase());
}

function isLikelyPlaystationConsole(item, text) {
  const title = normalize(item?.title || text);
  const category = normalize(item?.category);
  const combined = normalize(`${title} ${category} ${text || ""}`);
  const hasConsoleCue = /\b(console|system|bundle|for parts|parts|repair|broken|disc edition|digital edition)\b/.test(combined);
  const hasAccessoryCue = /\b(controller|controllers|remote|headset|headphones|earbuds|pulse|charging|charger|dock|stand|cover|skin|case|faceplate|plates?|cable|cord|hdmi|ssd|shell|accessor(?:y|ies)|backbone|portal)\b/.test(combined);
  const hasGameCue = /\b(video game|games?|game lot|sealed copy|factory sealed|new sealed|dlc|steelbook)\b/.test(combined);
  const nonConsoleCategory = /\b(games?|accessories|action figures|controllers?|headsets?)\b/.test(category);
  const genericConsoleTitle = /^(ps[\s-]?[45]|playstation[\s-]?[45])$/.test(title);
  const price = Number(item?.price);

  if (hasAccessoryCue && !hasConsoleCue) return false;
  if (hasGameCue && !hasConsoleCue) return false;
  if (nonConsoleCategory && !hasConsoleCue) return false;
  if (Number.isFinite(price) && price < 100 && !hasConsoleCue && !genericConsoleTitle) return false;
  return true;
}

function detectStorageGb(text) {
  const n = normalize(text);
  const tb = n.match(/(\d+)\s*(?:tb|tera)/);
  if (tb) return parseInt(tb[1], 10) * 1024;
  const gb = n.match(/(\d+)\s*(?:gb|gbs|go|giga)/);
  if (gb) {
    const v = parseInt(gb[1], 10);
    if ([64, 128, 256, 512, 1024].includes(v)) return v;
  }
  return null;
}

function defaultStorageForModel(modelKey) {
  const sizes = Object.keys(MAX_BUY)
    .filter((key) => key.startsWith(modelKey))
    .map((key) => parseInt(key.split(" ").pop(), 10))
    .filter(Boolean)
    .sort((a, b) => a - b);
  return sizes[0] || 128;
}

function resolveMaxBuy(product, modelKey, storageGb) {
  if (!modelKey) return null;
  const p = String(product || "").toLowerCase();
  if (p === "playstation" || p === "console") return PS_MAX_BUY[modelKey] ?? null;

  const storage = storageGb || defaultStorageForModel(modelKey);
  const exact = `${modelKey} ${storage}`;
  if (MAX_BUY[exact] != null) return MAX_BUY[exact];

  const candidates = Object.keys(MAX_BUY).filter((key) => key.startsWith(modelKey));
  if (!candidates.length) return null;

  let best = candidates[0];
  let bestDiff = Infinity;
  for (const key of candidates) {
    const size = parseInt(key.split(" ").pop(), 10);
    if (size <= storage && storage - size < bestDiff) {
      bestDiff = storage - size;
      best = key;
    }
  }
  return MAX_BUY[best];
}

function titleCaseModel(modelKey) {
  return modelKey.split(" ").map((word) => {
    if (word === "iphone") return "iPhone";
    if (/^ps\d$/i.test(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

function storageLabel(gb) {
  return gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`;
}

function genericListingLabel(target, item) {
  return String(target?.label || target?.query || item?.title || "Mercari item").trim() || "Mercari item";
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function formatUsd(value) { return `$${Number(value).toFixed(2).replace(/\.00$/, "")}`; }

function defaultCurrencyConverter() {
  return {
    displayCurrency: "USD",
    toDisplay: (value) => value,
    fromDisplay: (value) => value,
    format: formatUsd,
  };
}

function resolveMercariProxy(workspaceConfig) {
  const pool = Array.isArray(workspaceConfig?.proxyPool)
    ? workspaceConfig.proxyPool.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  return workspaceConfig?.proxy || pool[0] || process.env.MERCARI_PROXY || "";
}

function loadSeenIds() {
  try {
    if (fs.existsSync(MERCARI_SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(MERCARI_SEEN_FILE, "utf8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch {
    // start fresh
  }
  return new Set();
}

function saveSeenIds(seenIds) {
  let arr = Array.from(seenIds);
  if (arr.length > 10000) arr = arr.slice(arr.length - 10000);
  fs.mkdirSync(MERCARI_DATA_DIR, { recursive: true });
  fs.writeFileSync(MERCARI_SEEN_FILE, JSON.stringify(arr), "utf8");
}

function appendFound(record) {
  fs.mkdirSync(MERCARI_DATA_DIR, { recursive: true });
  fs.appendFileSync(MERCARI_FOUND_FILE, JSON.stringify(record) + "\n", "utf8");
}

let seenIds = new Set();
let cycleCount = 0;
let backoffSec = 0;

async function runTargetQuery(target, session, money = defaultCurrencyConverter()) {
  const keyword = target?.query || target?.label || "iphone";
  const priceBand = resolveTargetPriceBand(target);
  const nativeCurrency = nativeCurrencyForPlatform("mercari");
  const nativePriceBand = convertPriceBandForCurrency(priceBand, money, nativeCurrency);
  let items = [];
  try {
    items = await session.search(keyword, { limit: 100, sortBy: 2 });
    backoffSec = 0;
  } catch (error) {
    if (error instanceof MercariBlockedError || error?.code === "MERCARI_BLOCKED") {
      backoffSec = backoffSec === 0 ? 45 : Math.min(backoffSec * 2, 300);
      console.log(chalk.red(`[mercari] Search blocked on "${keyword}" - cooling off ${backoffSec}s`));
      await new Promise((resolve) => setTimeout(resolve, backoffSec * 1000));
      return;
    }
    console.log(chalk.red(`[mercari] "${keyword}": ${error.message}`));
    return;
  }

  let newCount = 0;
  let scoredCount = 0;

  for (const item of items) {
    const id = String(item?.id || "");
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    newCount++;

    if (item.status && item.status !== "on_sale") continue;

    const nativePrice = Number(item.price);
    if (!Number.isFinite(nativePrice) || nativePrice <= 0) continue;
    if (nativePrice < nativePriceBand.minPrice || nativePrice > nativePriceBand.maxPrice) continue;
    const price = money.toDisplay(nativePrice, nativeCurrency);
    if (!Number.isFinite(price) || price < priceBand.minPrice || price > priceBand.maxPrice) continue;

    const text = `${item.title || ""} ${item.condition || ""} ${item.category || ""}`;
    if (!targetMatchesText(target, text)) continue;

    const product = String(target?.product || "general").toLowerCase();
    const isSpecialized = isSpecializedMercariProduct(product);

    let modelKey = null;
    let storageGb = null;
    let maxBuy = resolveTargetReferencePrice(target);
    let listingLabel = genericListingLabel(target, item);

    if (isSpecialized) {
      modelKey = detectModel(text, product);
      if (!modelKey) continue;

      if ((product === "playstation" || product === "console") && !isLikelyPlaystationConsole(item, text)) {
        continue;
      }

      const isPhone = product === "iphone";
      storageGb = isPhone ? (detectStorageGb(text) || defaultStorageForModel(modelKey)) : null;
      const nativeMaxBuy = resolveMaxBuy(product, modelKey, storageGb);
      maxBuy = nativeMaxBuy === null ? maxBuy : money.toDisplay(nativeMaxBuy, nativeCurrency);
      const modelLabel = titleCaseModel(modelKey);
      listingLabel = storageGb ? `${modelLabel} ${storageLabel(storageGb)}` : modelLabel;
    }

    if (maxBuy !== null && price > maxBuy * LOWBALL_MAX_RATIO) continue;

    const verdict = (isSpecialized ? scoreElectronicsListing : scoreGenericListing)({
      title: item.title || "",
      description: `${item.condition || ""} ${item.category || ""}`,
      price,
      maxBuy,
    });
    if (!verdict.go) continue;

    scoredCount++;
    const savings = maxBuy !== null ? Math.round((maxBuy - price) * 100) / 100 : null;

    if (verdict.grade === "A" || verdict.grade === "B") {
      const border = "=".repeat(51);
      console.log(chalk.green(border));
      console.log(chalk.green(`MERCARI DEAL [Grade ${verdict.grade}]`));
      console.log(chalk.green(`${listingLabel} - ${money.format(price)}`));
      if (maxBuy && savings !== null) console.log(chalk.green(`Max buy: ${money.format(maxBuy)} | Save: ${money.format(savings)}`));
      if (item.condition) console.log(chalk.green(`Condition: ${item.condition}`));
      console.log(chalk.green(item.url));
      console.log(chalk.green(border));
      process.stdout.write("\x07");
    } else {
      const savingsStr = savings !== null ? (savings >= 0 ? ` save ${money.format(savings)}` : ` offer ${money.format(maxBuy)}`) : "";
      console.log(chalk.yellow(`[mc/${verdict.grade}] ${listingLabel} - ${money.format(price)}${savingsStr ? ` - ${savingsStr}` : ""}`));
      console.log(chalk.gray(`   ${item.url}`));
    }

    const record = {
      timestamp: new Date().toISOString(),
      platform: "mercari",
      product,
      model: listingLabel,
      storage_gb: storageGb,
      listing_price: price,
      currency: money.displayCurrency,
      native_listing_price: nativePrice,
      native_currency: nativeCurrency,
      max_buy: maxBuy,
      savings,
      grade: verdict.grade,
      score: verdict.score,
      reasons: verdict.reasons,
      condition: item.condition,
      category: item.category,
      brand: item.brand,
      photo_count: item.photoUrls?.length || 0,
      photoUrls: item.photoUrls || [],
      url: item.url,
      title: item.title,
      query: target.query,
      target: summarizeTarget(target),
      seller: item.seller,
      item: item.raw || item,
    };

    appendFound(record);
    await notify(record);
  }

  console.log(chalk.gray(`  [mc] "${keyword}" - ${items.length} checked, ${newCount} new, ${scoredCount} scored`));
}

async function runCycle(session, money) {
  cycleCount++;
  console.log(chalk.cyan(`\n[mercari] Cycle #${cycleCount} - ${new Date().toLocaleTimeString()}`));

  ensureWorkspaceFiles();
  const watchlist = loadWorkspaceWatchlist();
  const targets = getActivePlatformTargets(watchlist, "mercari");

  if (!targets.length) {
    console.log(chalk.yellow("[mercari] No enabled Mercari targets in watchlist."));
    return;
  }

  for (let i = 0; i < targets.length; i++) {
    await runTargetQuery(resolveTargetForPlatform(targets[i], "mercari"), session, money);
    if (i < targets.length - 1) await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  saveSeenIds(seenIds);
  console.log(chalk.gray(`[mercari] Cycle #${cycleCount} done. Seen IDs: ${seenIds.size}`));
}

async function main() {
  ensureWorkspaceFiles();
  const workspaceConfig = loadWorkspaceConfig();
  const intervalSec = workspaceConfig.bots?.mercari?.pollIntervalSec ?? 60;
  const userAgent = workspaceConfig.bots?.mercari?.userAgent || process.env.MERCARI_USER_AGENT || "";
  const proxy = resolveMercariProxy(workspaceConfig);
  const money = await createCurrencyConverter({
    displayCurrency: workspaceConfig.displayCurrency,
    sourceCurrencies: [nativeCurrencyForPlatform("mercari")],
  });

  seenIds = loadSeenIds();
  fs.mkdirSync(MERCARI_DATA_DIR, { recursive: true });

  const border = "=".repeat(51);
  console.log(chalk.blueBright(border));
  console.log(chalk.blueBright("  FBM Sniper Community - Mercari Bot"));
  console.log(chalk.blueBright(`  Sort: newest | Interval: ${intervalSec}s`));
  console.log(chalk.blueBright("  Setup: public browser session, no user cookies"));
  console.log(chalk.blueBright("  Scoring: programmatic (no AI)"));
  console.log(chalk.blueBright(border));
  if (FLAG_TEST) console.log(chalk.yellow("  TEST MODE - one cycle then exit"));

  let session = null;
  let running = true;
  process.on("SIGINT", () => { running = false; process.exit(0); });
  process.on("SIGTERM", () => { running = false; process.exit(0); });

  try {
    session = await createMercariSession({
      proxy,
      userAgent,
      headless: process.env.MERCARI_HEADLESS === "false" ? false : "new",
    });

    await runCycle(session, money);
    if (FLAG_TEST) {
      console.log(chalk.green("[mercari] Test complete."));
      return;
    }

    while (running) {
      await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000));
      if (running) await runCycle(session, money);
    }
  } finally {
    if (session) await session.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(chalk.red(`[mercari] fatal: ${error.message}`));
  process.exit(1);
});
