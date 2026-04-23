import fetch from 'node-fetch';

/**
 * MercadoLibre Electronics Sniper — Community Edition
 *
 * Programmatic price-band scoring for MercadoLibre listings.
 * Supports any country/site configured in the shared watchlist.
 *
 * Usage:
 *   node lib/mercadolibre-sniper.js
 *   node lib/mercadolibre-sniper.js --test
 */

import chalk from "chalk";
import { HttpsProxyAgent } from "https-proxy-agent";
import fs from "fs";
import { MERCADOLIBRE_DATA_DIR, MERCADOLIBRE_FOUND_FILE, MERCADOLIBRE_SEEN_FILE } from "./paths.js";
import { loadWorkspaceConfig, loadWorkspaceWatchlist, ensureWorkspaceFiles, resolveTargetForPlatform, hasConfirmedLocation, mercadolibreSiteInfo, MERCADOLIBRE_SITES } from "./shared-marketplace/workspace.js";
import { getActivePlatformTargets, targetMatchesText, summarizeTarget } from "./shared-marketplace/target-utils.js";
import { scoreElectronicsListing } from "./shared-marketplace/programmatic-scorer.js";
import { notify } from "./shared-marketplace/notifier.js";
import { mapLimit } from "./shared-marketplace/concurrency.js";
import { matchesRegexFilter, calculateProfitability, evaluateTriggers, calculateZScore } from "./shared-marketplace/logic.js";
import { isListingSeen, markListingSeen, recordPrice } from "./database.js";

const FLAG_TEST = process.argv.includes("--test");
const LOWBALL_MAX_RATIO = 1.8;

// ─── Max-Buy Table (iPhones, EUR/USD/Local equivalent) ─────────────────────
// The scorer uses these as reference. Since MercadoLibre uses local currencies,
// the programmatic scorer will compare local price to local ceiling.
// Users should set their maxPrice in the watchlist in local currency.

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

function normalize(text) {
  return String(text || "").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim();
}

function detectModel(title) {
  const n = normalize(title);
  const models = [
    "iphone 16 pro max", "iphone 16 pro", "iphone 16 plus", "iphone 16",
    "iphone 15 pro max", "iphone 15 pro", "iphone 15 plus", "iphone 15",
    "iphone 14 pro max", "iphone 14 pro", "iphone 14 plus", "iphone 14",
    "iphone 13 pro max", "iphone 13 pro", "iphone 13 mini", "iphone 13",
  ];
  for (const key of models) if (n.includes(key)) return key;
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

// ─── API Helpers ─────────────────────────────────────────────────────────────

let proxyPool = [];
let proxyIndex = 0;

function parseProxyUrl(raw) {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.href;
  } catch { return undefined; }
}

function initProxies(workspaceConfig) {
  const pool = Array.isArray(workspaceConfig?.proxyPool) ? workspaceConfig.proxyPool : [];
  proxyPool = pool.map(parseProxyUrl).filter(Boolean);
  const single = workspaceConfig?.proxy;
  if (!proxyPool.length && single) {
    const p = parseProxyUrl(single);
    if (p) proxyPool = [p];
  }
}

function nextProxyAgent() {
  if (!proxyPool.length) return undefined;
  return new HttpsProxyAgent(proxyPool[(proxyIndex++) % proxyPool.length]);
}

async function searchListings(siteId, query, accessToken) {
  const baseUrl = `https://api.mercadolibre.com/sites/${siteId}/search`;
  const params = new URLSearchParams({ q: query, sort: "price_asc", limit: "50" });
  const url = `${baseUrl}?${params.toString()}`;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
  };
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, { headers, signal: controller.signal, agent: nextProxyAgent() });
    if (res.status === 403) {
      console.error(chalk.red(`[mercadolibre] 403 Forbidden. Try providing an ACCESS_TOKEN in Settings.`));
      return [];
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.results || [];
  } catch (err) {
    console.error(chalk.red(`[mercadolibre] API error: ${err.message}`));
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function loadSeenIds() {
  try {
    if (fs.existsSync(MERCADOLIBRE_SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(MERCADOLIBRE_SEEN_FILE, "utf8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { /* start fresh */ }
  return new Set();
}

function saveSeenIds(seenIds) {
  let arr = Array.from(seenIds);
  if (arr.length > 10000) arr = arr.slice(arr.length - 10000);
  fs.mkdirSync(MERCADOLIBRE_DATA_DIR, { recursive: true });
  fs.writeFileSync(MERCADOLIBRE_SEEN_FILE, JSON.stringify(arr), "utf8");
}

function appendFound(record) {
  fs.mkdirSync(MERCADOLIBRE_DATA_DIR, { recursive: true });
  fs.appendFileSync(MERCADOLIBRE_FOUND_FILE, JSON.stringify(record) + "\n", "utf8");
}

// ─── Scan Cycle ───────────────────────────────────────────────────────────────

let seenIds = new Set();
let cycleCount = 0;

async function runTargetQuery(target, siteId, accessToken, workspaceConfig) {
  const keyword = target?.query || target?.label || "iphone";
  const items = await searchListings(siteId, keyword, accessToken);

  for (const item of items) {
    const id = item.id;
    if (!id || await isListingSeen(String(id))) continue;

    const price = item.price;
    if (!price || price <= 0) continue;

    await recordPrice("mercadolibre", keyword, price);

    // Filter by watchlist price band if set
    if (target.minPrice != null && price < target.minPrice) continue;
    if (target.maxPrice != null && price > target.maxPrice) continue;

    const text = `${item.title || ""} ${item.condition || ""}`.toLowerCase();
    if (!targetMatchesText(target, text)) continue;

    // Regex Advanced Filter
    const regexResult = matchesRegexFilter("", item.title, target, workspaceConfig.filters || {});
    if (regexResult.rejected) {
      console.log(chalk.gray(`  [mercadolibre] rejected ${item.id}: ${regexResult.reason}`));
      continue;
    }

    // Grading
    const verdict = scoreElectronicsListing({
      title: item.title,
      description: "", // Search API doesn't provide description
      price: price,
      maxBuy: target.maxPrice, // Use target maxPrice as reference since we don't have local market tables for all countries
    });

    // ROI / Profit Trigger
    const estSellingPrice = target.maxPrice || (price * 1.2);
    const profitability = calculateProfitability(price, estSellingPrice, 10);
    const zScore = await calculateZScore("mercadolibre", keyword, price);
    const triggerResult = evaluateTriggers(profitability, workspaceConfig.filters || {}, zScore);

    if (!verdict.go && !triggerResult.triggered) continue;

    const url = item.permalink;
    const modelKey = detectModel(item.title);
    const storageGb = detectStorageGb(item.title);
    const savings = target.maxPrice ? target.maxPrice - price : 0;

    const record = {
      timestamp: new Date().toISOString(),
      platform: "mercadolibre",
      product: target.product || "iphone",
      model: modelKey ? modelKey.toUpperCase() : "Unknown",
      storage_gb: storageGb,
      listing_price: price,
      currency: item.currency_id,
      max_buy: target.maxPrice,
      savings,
      grade: verdict.grade,
      score: verdict.score,
      reasons: verdict.reasons,
      url,
      title: item.title,
      query: target.query,
      target: summarizeTarget(target),
      seller: {
        id: item.seller?.id,
        nickname: item.seller?.nickname,
      },
      item,
    };

    if (verdict.grade === "A" || verdict.grade === "B") {
      const border = "═".repeat(55);
      console.log(chalk.green(border));
      console.log(chalk.green(`🔥 MERCADOLIBRE DEAL [Grade ${verdict.grade}]`));
      console.log(chalk.green(`📱 ${record.model}${storageGb ? " " + storageGb + "GB" : ""} — ${record.currency} ${price}`));
      console.log(chalk.green(`🔗 ${url}`));
      console.log(chalk.green(border));
      process.stdout.write("\x07");
    } else {
      console.log(chalk.yellow(`🎯 [ml/${verdict.grade}] ${record.model} — ${record.currency} ${price}`));
    }

    appendFound(record);
    await notify(record);
    await markListingSeen(String(item.id), "mercadolibre");
  }

  console.log(chalk.gray(`  [mercadolibre] "${keyword}" — ${items.length} checked`));
}

async function runCycle(workspaceConfig) {
  cycleCount++;
  console.log(chalk.cyan(`\n[mercadolibre] Cycle #${cycleCount} — ${new Date().toLocaleTimeString()}`));

  ensureWorkspaceFiles();
  const freshConfig = loadWorkspaceConfig();
  const watchlist = loadWorkspaceWatchlist();
  const targets = getActivePlatformTargets(watchlist, "mercadolibre");

  if (!targets.length) {
    console.log(chalk.yellow("[mercadolibre] No enabled MercadoLibre targets in watchlist."));
    return;
  }

  const siteId = freshConfig.bots?.mercadolibre?.siteId || "MLA";
  const accessToken = freshConfig.bots?.mercadolibre?.accessToken || "";

  // MercadoLibre API can be sensitive to rate limits, but up to 3 should be fine
  await mapLimit(targets, 3, async (target) => {
    await runTargetQuery(resolveTargetForPlatform(target, "mercadolibre"), siteId, accessToken, freshConfig);
    await new Promise((r) => setTimeout(r, 1000));
  });

  saveSeenIds(seenIds);
  console.log(chalk.gray(`[mercadolibre] Cycle #${cycleCount} done. Seen IDs: ${seenIds.size}`));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  ensureWorkspaceFiles();
  const workspaceConfig = loadWorkspaceConfig();
  initProxies(workspaceConfig);
  const loc = workspaceConfig.location || {};
  const intervalSec = workspaceConfig.bots?.mercadolibre?.pollIntervalSec ?? 60;
  const siteId = workspaceConfig.bots?.mercadolibre?.siteId || "MLA";
  const site = mercadolibreSiteInfo(siteId);

  seenIds = loadSeenIds();
  fs.mkdirSync(MERCADOLIBRE_DATA_DIR, { recursive: true });

  const border = "═".repeat(55);
  console.log(chalk.blueBright(border));
  console.log(chalk.blueBright("  🔍 FBM Sniper Community — MercadoLibre Bot"));
  console.log(chalk.blueBright(`  🌍 Site: ${site ? site.country : siteId} (${siteId}) | ⏱  ${intervalSec}s interval`));
  console.log(chalk.blueBright(`  🤖 Scoring: programmatic`));
  console.log(chalk.blueBright(border));

  if (FLAG_TEST) console.log(chalk.yellow("  ⚠️  TEST MODE — one cycle then exit"));

  let running = true;
  process.on("SIGINT",  () => { running = false; process.exit(0); });
  process.on("SIGTERM", () => { running = false; process.exit(0); });

  await runCycle(workspaceConfig);
  if (FLAG_TEST) { console.log(chalk.green("[mercadolibre] Test complete.")); process.exit(0); }

  while (running) {
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
    if (running) await runCycle(workspaceConfig);
  }
}

main().catch((err) => {
  console.error(chalk.red(`[mercadolibre] fatal: ${err.message}`));
  process.exit(1);
});
