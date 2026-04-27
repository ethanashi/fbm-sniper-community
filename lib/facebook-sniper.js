/**
 * Facebook Marketplace Electronics Sniper — Community Edition
 *
 * AI-free version: programmatic price-band scoring replaces Gemini worker threads.
 * Supports any product type configured in the shared watchlist (iPhone, PlayStation, etc.)
 *
 * Usage:
 *   node lib/facebook-sniper.js
 *   node lib/facebook-sniper.js --test      # one cycle then exit
 */

import chalk from "chalk";
import fs from "fs";
import { searchMarketplace, getListingDetail, mergeDetail } from "./fb-scraper.js";
import { getCachedSession } from "./fb-session.js";
import { FACEBOOK_DATA_DIR, FACEBOOK_FOUND_FILE, FACEBOOK_SEEN_FILE } from "./paths.js";
import { loadWorkspaceConfig, loadWorkspaceWatchlist, ensureWorkspaceFiles, resolveTargetForPlatform, hasConfirmedLocation } from "./shared-marketplace/workspace.js";
import { getActivePlatformTargets, targetMatchesText, summarizeTarget } from "./shared-marketplace/target-utils.js";
import { scoreElectronicsListing } from "./shared-marketplace/programmatic-scorer.js";
import { notify } from "./shared-marketplace/notifier.js";
import { mapLimit } from "./shared-marketplace/concurrency.js";
import { matchesRegexFilter, calculateProfitability, evaluateTriggers, calculateZScore } from "./shared-marketplace/logic.js";
import { isListingSeen, markListingSeen, recordPrice } from "./database.js";

const FLAG_TEST = process.argv.includes("--test");
const LOWBALL_MAX_RATIO = 1.8;

// ─── Max-Buy Tables (EUR, Madrid market) ─────────────────────────────────────

const IPHONE_MAX_BUY = {
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

const PS_MAX_BUY = {
  "ps4": 85, "ps4 slim": 95, "ps4 pro": 130,
  "ps5 digital": 250, "ps5 disc": 290, "ps5 pro": 445,
};

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

const PS_PATTERNS = [
  { key: "ps5 pro",     re: /ps[\s-]?5[\s-]?pro|playstation[\s-]?5[\s-]?pro/i },
  { key: "ps5 digital", re: /ps[\s-]?5[\s-]?digital|playstation[\s-]?5[\s-]?digital/i },
  { key: "ps5 disc",    re: /ps[\s-]?5[\s-]?dis[ck]o?|ps[\s-]?5(?![\s-]?pro)(?![\s-]?digital)|playstation[\s-]?5(?![\s-]?pro)(?![\s-]?digital)/i },
  { key: "ps4 pro",     re: /ps[\s-]?4[\s-]?pro|playstation[\s-]?4[\s-]?pro/i },
  { key: "ps4 slim",    re: /ps[\s-]?4[\s-]?slim|playstation[\s-]?4[\s-]?slim/i },
  { key: "ps4",         re: /ps[\s-]?4(?![\s-]?pro)(?![\s-]?slim)|playstation[\s-]?4(?![\s-]?pro)(?![\s-]?slim)/i },
];

function detectIphoneModel(text) {
  const n = normalize(text);
  for (const { key, re } of IPHONE_PATTERNS) if (re.test(n)) return key;
  return null;
}

function detectPSModel(text) {
  const n = normalize(text);
  for (const { key, re } of PS_PATTERNS) if (re.test(n)) return key;
  return null;
}

function detectModel(text, product) {
  const p = String(product || "").toLowerCase();
  if (p === "playstation") return detectPSModel(text);
  return detectIphoneModel(text);
}

function detectStorage(text) {
  const n = normalize(text);
  const tb = n.match(/(\d+)\s*(?:tb|tera)/);
  if (tb) return parseInt(tb[1], 10) * 1024;
  const gb = n.match(/(\d+)\s*(?:gb|go|giga)/);
  if (gb) {
    const v = parseInt(gb[1], 10);
    if ([32, 64, 128, 256, 512].includes(v)) return v;
  }
  return null;
}

function resolveMaxBuy(product, modelKey, storageGb) {
  if (!modelKey) return null;
  const p = String(product || "").toLowerCase();

  if (p === "playstation") return PS_MAX_BUY[modelKey] ?? null;

  // iPhone
  const table = IPHONE_MAX_BUY;
  const exact = `${modelKey} ${storageGb}`;
  if (table[exact] !== undefined) return table[exact];
  const candidates = Object.keys(table).filter((k) => k.startsWith(modelKey));
  if (!candidates.length) return null;
  let best = null, bestDiff = Infinity;
  for (const k of candidates) {
    const s = parseInt(k.split(" ").pop(), 10);
    if (s <= storageGb && storageGb - s < bestDiff) { bestDiff = storageGb - s; best = k; }
  }
  return best ? table[best] : table[candidates[0]];
}

function defaultStorage(modelKey) {
  const keys = Object.keys(IPHONE_MAX_BUY).filter((k) => k.startsWith(modelKey));
  if (!keys.length) return 128;
  return Math.min(...keys.map((k) => parseInt(k.split(" ").pop(), 10)));
}

function storageLabel(gb) { return gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`; }

function titleCase(str) {
  return str.split(" ").map((w) => {
    if (w === "iphone") return "iPhone";
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function loadSeenIds() {
  try {
    if (fs.existsSync(FACEBOOK_SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(FACEBOOK_SEEN_FILE, "utf8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { /* start fresh */ }
  return new Set();
}

function saveSeenIds(seenIds) {
  let arr = Array.from(seenIds);
  if (arr.length > 10000) arr = arr.slice(arr.length - 10000);
  fs.mkdirSync(FACEBOOK_DATA_DIR, { recursive: true });
  fs.writeFileSync(FACEBOOK_SEEN_FILE, JSON.stringify(arr), "utf8");
}

function appendFound(record) {
  fs.mkdirSync(FACEBOOK_DATA_DIR, { recursive: true });
  fs.appendFileSync(FACEBOOK_FOUND_FILE, JSON.stringify(record) + "\n", "utf8");
}

// ─── Scan Cycle ───────────────────────────────────────────────────────────────

let seenIds = new Set();
let cycleCount = 0;

async function runQuery(target, cfg, workspaceConfig) {
  const query = target?.query || target?.label || "";
  let result;
  try {
    result = await searchMarketplace({
      query,
      lat: cfg.lat,
      lng: cfg.lng,
      radiusKM: Number.isFinite(Number(target?.radiusKM)) ? Number(target.radiusKM) : cfg.radiusKM,
      minPrice: Number.isFinite(Number(target?.minPrice)) ? Number(target.minPrice) * 100 : 5000,
      maxPrice: Number.isFinite(Number(target?.maxPrice)) ? Number(target.maxPrice) * 100 : 300000,
      sort: "CREATION_TIME_DESCEND",
      maxPages: 1,
      conditions: ["new", "used_like_new", "used_good"],
      daysSinceListed: 1,
    });
  } catch (err) {
    console.log(chalk.red(`[facebook] "${query}": ${err.message}`));
    return;
  }

  const { listings } = result;

  // Phase 1 — pre-filter
  const candidates = [];
  for (const listing of listings) {
    const { id } = listing;
    if (!id || await isListingSeen(id)) continue;

    if (listing.isPending) continue;
    const text = `${listing.title} ${listing.description || ""}`;
    if (!targetMatchesText(target, text)) continue;

    // Regex Advanced Filter
    const regexResult = matchesRegexFilter(listing.description || "", listing.title, target, workspaceConfig.filters || {});
    if (regexResult.rejected) {
      console.log(chalk.gray(`  [fb] rejected ${listing.id}: ${regexResult.reason}`));
      continue;
    }

    if (listing.postedAt) {
      const ageHours = (Date.now() - new Date(listing.postedAt).getTime()) / 3_600_000;
      if (ageHours > 24) continue;
    }

    const modelKey = detectModel(text, target.product);
    if (!modelKey) continue;

    const { price } = listing;
    if (!price || price < 30) continue;

    await recordPrice("facebook", query, price);

    const storageGb = detectStorage(text) ?? defaultStorage(modelKey);
    const maxBuy = resolveMaxBuy(target.product, modelKey, storageGb);
    if (maxBuy !== null && price > maxBuy * LOWBALL_MAX_RATIO) continue;

    candidates.push({ listing, modelKey, storageGb, maxBuy });
  }

  if (!candidates.length) {
    console.log(chalk.gray(`  [fb] "${query}" — ${listings.length} checked, 0 new`));
    return;
  }

  // Phase 2 — fetch listing details in parallel
  const sessionCookies = getCachedSession()?.cookies;
  const withDetails = await Promise.all(candidates.map(async (c) => {
    try {
      const raw = await getListingDetail(c.listing.id, sessionCookies);
      return { ...c, listing: raw ? mergeDetail(c.listing, raw) : c.listing };
    } catch {
      return c;
    }
  }));

  // Phase 3 — score + log
  for (const { listing, modelKey, storageGb, maxBuy } of withDetails) {
    const verdict = scoreElectronicsListing({
      title: listing.title,
      description: listing.description || "",
      price: listing.price,
      maxBuy,
    });

    // ROI / Profit Trigger
    const estSellingPrice = maxBuy || (listing.price * 1.2); // Fallback estimate
    const profitability = calculateProfitability(listing.price, estSellingPrice, 10);
    const zScore = await calculateZScore("facebook", query, listing.price);
    const triggerResult = evaluateTriggers(profitability, workspaceConfig.filters || {}, zScore);

    if (!verdict.go && !triggerResult.triggered) {
      console.log(chalk.gray(`  [fb] skip ${listing.id}: ${verdict.reasons[0]}`));
      continue;
    }

    const p = String(target.product || "iphone");
    const modelLabel = p === "playstation" ? modelKey.toUpperCase() : titleCase(modelKey);
    const sLabel = p !== "playstation" ? ` ${storageLabel(storageGb)}` : "";
    const savings = maxBuy !== null ? maxBuy - listing.price : null;
    const border = "═".repeat(55);

    if (verdict.grade === "A" || verdict.grade === "B") {
      console.log(chalk.green(border));
      console.log(chalk.green(`🔥 FB DEAL  [Grade ${verdict.grade}]`));
      console.log(chalk.green(`📱 ${modelLabel}${sLabel} — €${listing.price}`));
      if (maxBuy && savings !== null) {
        console.log(chalk.green(`💰 Max buy: €${maxBuy} | Save: €${savings}`));
      }
      console.log(chalk.green(`🔗 ${listing.url}`));
      console.log(chalk.green(border));
      process.stdout.write("\x07");
    } else {
      const savings2 = savings !== null ? (savings >= 0 ? `save €${savings}` : `offer €${maxBuy}`) : "";
      console.log(chalk.yellow(`🎯 [fb/${verdict.grade}] ${modelLabel}${sLabel} — €${listing.price}${savings2 ? " · " + savings2 : ""}`));
      console.log(chalk.gray(`   ${listing.url}`));
    }

    const record = {
      timestamp: new Date().toISOString(),
      platform: "facebook",
      product: p,
      model: modelLabel,
      storage_gb: storageGb,
      listing_price: listing.price,
      max_buy: maxBuy,
      savings,
      grade: verdict.grade,
      score: verdict.score,
      reasons: verdict.reasons,
      url: listing.url,
      title: listing.title,
      query: target.query,
      target: summarizeTarget(target),
      listing,
    };

    appendFound(record);
    await notify(record);
    await markListingSeen(listing.id, "facebook");
  }

  console.log(chalk.gray(`  [fb] "${query}" — ${listings.length} checked, ${candidates.length} scored`));
}

async function runCycle(cfg) {
  cycleCount++;
  console.log(chalk.cyan(`\n[facebook] Cycle #${cycleCount} — ${new Date().toLocaleTimeString()}`));

  ensureWorkspaceFiles();
  const watchlist = loadWorkspaceWatchlist();
  const targets = getActivePlatformTargets(watchlist, "facebook");

  if (!targets.length) {
    console.log(chalk.yellow("[facebook] No enabled Facebook targets in watchlist."));
    return;
  }

  const freshConfig = loadWorkspaceConfig();
  // Execute up to 3 queries simultaneously
  await mapLimit(targets, 3, async (target) => {
    await runQuery(resolveTargetForPlatform(target, "facebook"), cfg, freshConfig);
  });

  saveSeenIds(seenIds);
  console.log(chalk.gray(`[facebook] Cycle #${cycleCount} done. Seen IDs: ${seenIds.size}`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureWorkspaceFiles();
  const workspaceConfig = loadWorkspaceConfig();
  const loc = workspaceConfig.location || {};

  if (!hasConfirmedLocation(loc)) {
    console.error(chalk.red("[facebook] Location needs review. Open Settings, change or confirm your city + coordinates, then start the bot again."));
    process.exit(2);
  }

  const cfg = {
    lat: Number(loc.latitude),
    lng: Number(loc.longitude),
    radiusKM: 65,
    intervalSec: workspaceConfig.bots?.facebook?.pollIntervalSec ?? 90,
  };

  seenIds = loadSeenIds();
  fs.mkdirSync(FACEBOOK_DATA_DIR, { recursive: true });

  const border = "═".repeat(55);
  console.log(chalk.blueBright(border));
  console.log(chalk.blueBright("  🔍 FBM Sniper Community — Facebook Bot"));
  console.log(chalk.blueBright(`  📍 ${cfg.lat},${cfg.lng} | ⏱  ${cfg.intervalSec}s interval`));
  console.log(chalk.blueBright(`  🤖 Scoring: programmatic (no AI)`));
  console.log(chalk.blueBright(border));
  if (FLAG_TEST) console.log(chalk.yellow("  ⚠️  TEST MODE — one cycle then exit"));

  let running = true;
  process.on("SIGINT",  () => { running = false; process.exit(0); });
  process.on("SIGTERM", () => { running = false; process.exit(0); });

  await runCycle(cfg);
  if (FLAG_TEST) { console.log(chalk.green("[facebook] Test complete.")); process.exit(0); }

  while (running) {
    await new Promise((r) => setTimeout(r, cfg.intervalSec * 1000));
    if (running) await runCycle(cfg);
  }
}

main().catch((err) => {
  console.error(chalk.red(`[facebook] fatal: ${err.message}`));
  process.exit(1);
});
