/**
 * Amazon Electronics Sniper — Community Edition
 *
 * Scrapes Amazon search results for electronics deals.
 * Uses Puppeteer to bypass anti-bot challenges.
 *
 * Usage:
 *   node lib/amazon-sniper.js
 *   node lib/amazon-sniper.js --test
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import chalk from "chalk";
import fs from "fs";
import { AMAZON_DATA_DIR, AMAZON_FOUND_FILE, AMAZON_SEEN_FILE } from "./paths.js";
import { loadWorkspaceConfig, loadWorkspaceWatchlist, ensureWorkspaceFiles, resolveTargetForPlatform, hasConfirmedLocation, AMAZON_SITES } from "./shared-marketplace/workspace.js";
import { getActivePlatformTargets, targetMatchesText, summarizeTarget } from "./shared-marketplace/target-utils.js";
import { scoreElectronicsListing } from "./shared-marketplace/programmatic-scorer.js";
import { notify } from "./shared-marketplace/notifier.js";
import { mapLimit } from "./shared-marketplace/concurrency.js";
import { matchesRegexFilter, calculateProfitability, evaluateTriggers, calculateZScore } from "./shared-marketplace/logic.js";
import { isListingSeen, markListingSeen, recordPrice } from "./database.js";

puppeteer.use(StealthPlugin());

const FLAG_TEST = process.argv.includes("--test");
const LOWBALL_MAX_RATIO = 1.8;


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

// ─── Scraper ─────────────────────────────────────────────────────────────────

async function scrapeAmazon(domain, query) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

  const results = [];
  try {
    const url = `https://${domain}/s?k=${encodeURIComponent(query)}&s=price-asc-rank`;
    console.log(chalk.gray(`  [amazon] Navigating to ${url}`));
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // Extract items
    const items = await page.evaluate(() => {
      const selectors = [
        "div[data-component-type='s-search-result']",
        ".s-result-item[data-asin]"
      ];
      let nodes = [];
      for (const sel of selectors) {
        nodes = Array.from(document.querySelectorAll(sel));
        if (nodes.length > 0) break;
      }

      return nodes.map(node => {
        const titleEl = node.querySelector("h2 a span");
        const priceWhole = node.querySelector(".a-price-whole");
        const priceFraction = node.querySelector(".a-price-fraction");
        const linkEl = node.querySelector("h2 a");
        const imageEl = node.querySelector(".s-image");

        let price = null;
        if (priceWhole) {
          const whole = priceWhole.innerText.replace(/[^0-9]/g, "");
          const fraction = priceFraction ? priceFraction.innerText.replace(/[^0-9]/g, "") : "00";
          price = parseFloat(`${whole}.${fraction}`);
        }

        return {
          id: node.getAttribute("data-asin"),
          title: titleEl ? titleEl.innerText : "",
          price: price,
          url: linkEl ? linkEl.href : "",
          image: imageEl ? imageEl.src : "",
        };
      }).filter(item => item.id && item.title && item.price);
    });

    results.push(...items);
  } catch (err) {
    console.error(chalk.red(`  [amazon] Scrape failed: ${err.message}`));
  } finally {
    await browser.close();
  }
  return results;
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

function loadSeenIds() {
  try {
    if (fs.existsSync(AMAZON_SEEN_FILE)) {
      const data = JSON.parse(fs.readFileSync(AMAZON_SEEN_FILE, "utf8"));
      return new Set(Array.isArray(data) ? data : []);
    }
  } catch { }
  return new Set();
}

function saveSeenIds(seenIds) {
  let arr = Array.from(seenIds);
  if (arr.length > 10000) arr = arr.slice(arr.length - 10000);
  fs.mkdirSync(AMAZON_DATA_DIR, { recursive: true });
  fs.writeFileSync(AMAZON_SEEN_FILE, JSON.stringify(arr), "utf8");
}

function appendFound(record) {
  fs.mkdirSync(AMAZON_DATA_DIR, { recursive: true });
  fs.appendFileSync(AMAZON_FOUND_FILE, JSON.stringify(record) + "\n", "utf8");
}

// ─── Scan Cycle ───────────────────────────────────────────────────────────────

let seenIds = new Set();
let cycleCount = 0;

async function runTargetQuery(target, domain, workspaceConfig) {
  const keyword = target.query || target.label;
  const items = await scrapeAmazon(domain, keyword);

  for (const item of items) {
    if (await isListingSeen(item.id)) continue;

    if (target.minPrice != null && item.price < target.minPrice) continue;
    if (target.maxPrice != null && item.price > target.maxPrice) continue;

    await recordPrice("amazon", keyword, item.price);

    if (!targetMatchesText(target, item.title)) continue;

    // Regex Advanced Filter
    const regexResult = matchesRegexFilter("", item.title, target, workspaceConfig.filters || {});
    if (regexResult.rejected) {
      console.log(chalk.gray(`  [amazon] rejected ${item.id}: ${regexResult.reason}`));
      continue;
    }

    const verdict = scoreElectronicsListing({
      title: item.title,
      price: item.price,
      maxBuy: target.maxPrice,
    });

    // ROI / Profit Trigger
    const estSellingPrice = target.maxPrice || (item.price * 1.2);
    const profitability = calculateProfitability(item.price, estSellingPrice, 10);
    const zScore = await calculateZScore("amazon", keyword, item.price);
    const triggerResult = evaluateTriggers(profitability, workspaceConfig.filters || {}, zScore);

    if (!verdict.go && !triggerResult.triggered) continue;

    const modelKey = detectModel(item.title);
    const record = {
      timestamp: new Date().toISOString(),
      platform: "amazon",
      product: target.product || "iphone",
      model: modelKey ? modelKey.toUpperCase() : "Unknown",
      listing_price: item.price,
      max_buy: target.maxPrice,
      grade: verdict.grade,
      score: verdict.score,
      reasons: verdict.reasons,
      url: item.url,
      title: item.title,
      query: target.query,
      target: summarizeTarget(target),
      item,
    };

    if (verdict.grade === "A" || verdict.grade === "B") {
      console.log(chalk.green("🔥 AMAZON DEAL! " + item.title + " - " + item.price));
    } else {
      console.log(chalk.yellow("🎯 [am/" + verdict.grade + "] " + item.title + " - " + item.price));
    }

    appendFound(record);
    await notify(record);
    await markListingSeen(item.id, "amazon");
  }
}

async function runCycle(workspaceConfig) {
  cycleCount++;
  console.log(chalk.cyan(`\n[amazon] Cycle #${cycleCount}`));

  const watchlist = loadWorkspaceWatchlist();
  const targets = getActivePlatformTargets(watchlist, "amazon");

  if (!targets.length) {
    console.log(chalk.yellow("[amazon] No enabled Amazon targets."));
    return;
  }

  const country = workspaceConfig.bots?.amazon?.country || "US";
  const site = AMAZON_SITES.find(s => s.id === country) || AMAZON_SITES[0];
  const domain = site.domain;

  // Amazon is resource heavy due to Puppeteer, keep concurrency moderate
  await mapLimit(targets, 2, async (target) => {
    await runTargetQuery(resolveTargetForPlatform(target, "amazon"), domain, workspaceConfig);
  });

  saveSeenIds(seenIds);
}

async function main() {
  ensureWorkspaceFiles();
  const config = loadWorkspaceConfig();
  const intervalSec = config.bots?.amazon?.pollIntervalSec ?? 300;

  seenIds = loadSeenIds();

  await runCycle(config);

  if (FLAG_TEST) process.exit(0);

  setInterval(() => runCycle(loadWorkspaceConfig()), intervalSec * 1000);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
