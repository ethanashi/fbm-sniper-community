import chalk from "chalk";
import fs from "fs";
import { searchMarketplace, getListingDetail, mergeDetail } from "./fb-scraper.js";
import { gradeListingPhotos } from "./grading.js";
import { decodeVin, getOpenRecalls } from "./nhtsa.js";
import { extractVehicleProfile } from "./vehicle-parser.js";
import { formatTargetLine, inferTargetType, isSearchPlaceholderListing } from "./target-utils.js";
import { underwriteVehicle } from "./underwrite.js";
import {
  CAR_CONFIG_FILE,
  CAR_FOUND_DEALS_FILE,
  CAR_REJECTED_LOG_FILE,
  CAR_SEEN_IDS_FILE,
} from "./paths.js";
import { loadWatchlist } from "./watchlist.js";

const MIN_INTERVAL_SECONDS = 180;
const MAX_ACTIVE_TARGETS = 3;

const args = process.argv.slice(2);
const FLAG_TEST = args.includes("--test");
const FLAG_NO_NHTSA = args.includes("--no-nhtsa");
const FLAG_RESET = args.includes("--reset");

function flagVal(name, fallback) {
  const index = args.indexOf(name);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

const DEFAULT_CONFIG = {
  appName: "FBM Sniper Community Edition",
  source: "facebook_marketplace",
  analysisMode: "rules_with_optional_nhtsa",
  aiProvider: "none",
  analysisPrompt: "Focus on clean-title, easy-turn flips with simple recon and enough spread after fees.",
  radiusKM: 120,
  minPrice: 2500,
  maxPrice: 45000,
  allowShipping: true,
  proxyPool: [],
  searchConcurrency: 2,
  detailConcurrency: 3,
  intervalSeconds: MIN_INTERVAL_SECONDS,
  maxPages: 2,
  maxListingsPerQuery: 10,
  maxAgeHours: 48,
  location: {
    label: "",
    latitude: 40.4032,
    longitude: -3.7037,
  },
};

let stopRequested = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPool(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Number(limit) || 1);
  const executing = new Set();

  for (const item of list) {
    if (stopRequested) break;
    const task = Promise.resolve()
      .then(() => worker(item))
      .catch((error) => {
        console.error(chalk.red(`  Worker error: ${error.message}`));
      });
    executing.add(task);
    task.finally(() => executing.delete(task));
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.allSettled([...executing]);
}

function requestStop(signal) {
  if (stopRequested) return;
  stopRequested = true;
  const source = signal ? ` (${signal})` : "";
  console.log(chalk.yellow(`\n  Stop requested${source}. Finishing the current step and shutting down...`));
}

process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("SIGINT", () => requestStop("SIGINT"));

function ensureFile(file, fallback) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, fallback, "utf8");
}

function loadConfig() {
  ensureFile(CAR_CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  try {
    const parsed = JSON.parse(fs.readFileSync(CAR_CONFIG_FILE, "utf8"));
    const merged = {
      ...DEFAULT_CONFIG,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      location: {
        ...DEFAULT_CONFIG.location,
        ...((parsed && parsed.location) || {}),
      },
    };
    merged.intervalSeconds = Math.max(MIN_INTERVAL_SECONDS, Number(merged.intervalSeconds) || MIN_INTERVAL_SECONDS);
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function loadSeenIds() {
  ensureFile(CAR_SEEN_IDS_FILE, "[]");
  try {
    return new Set(JSON.parse(fs.readFileSync(CAR_SEEN_IDS_FILE, "utf8")));
  } catch {
    return new Set();
  }
}

function saveSeenIds(seen) {
  fs.writeFileSync(CAR_SEEN_IDS_FILE, JSON.stringify([...seen], null, 2), "utf8");
}

function ensureLogFiles() {
  ensureFile(CAR_FOUND_DEALS_FILE, "");
  ensureFile(
    CAR_REJECTED_LOG_FILE,
    "timestamp,title,query,target_id,target_label,target_group,listing_price,reason,url,make,model,year,title_status\n"
  );
}

function resetMemory() {
  const headers = "timestamp,title,query,target_id,target_label,target_group,listing_price,reason,url,make,model,year,title_status\n";
  fs.writeFileSync(CAR_FOUND_DEALS_FILE, "", "utf8");
  fs.writeFileSync(CAR_REJECTED_LOG_FILE, headers, "utf8");
  fs.writeFileSync(CAR_SEEN_IDS_FILE, "[]", "utf8");
  console.log(chalk.cyan("  Memory wiped: found_listings, rejected_listings, seen_ids."));
}

function appendFound(record) {
  fs.appendFileSync(CAR_FOUND_DEALS_FILE, JSON.stringify(record) + "\n", "utf8");
}

function csv(value) {
  const str = String(value ?? "");
  return `"${str.replace(/"/g, '""')}"`;
}

function appendRejected({ listing, query, reason, profile, target }) {
  const row = [
    new Date().toISOString(),
    csv(listing.title || ""),
    csv(query),
    csv(target?.id || ""),
    csv(target?.label || ""),
    csv(target?.group || "General"),
    listing.price ?? "",
    csv(reason),
    csv(listing.url || ""),
    csv(profile.make || ""),
    csv(profile.model || ""),
    profile.year ?? "",
    csv(profile.titleStatus || ""),
  ].join(",");
  fs.appendFileSync(CAR_REJECTED_LOG_FILE, row + "\n", "utf8");
}

function hoursOld(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

function normalizeListing(rawListing) {
  return {
    id: rawListing.id,
    title: rawListing.title,
    price: rawListing.price,
    currency: rawListing.currency,
    description: rawListing.description,
    photos: rawListing.photos || [],
    seller: rawListing.seller || {},
    postedAt: rawListing.postedAt,
    condition: rawListing.condition,
    url: rawListing.url,
    location: rawListing.location,
    shippingOffered: rawListing.shippingOffered === true,
    shippingText: rawListing.shippingText || "",
  };
}

function coerceNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveSearchCenter(config, watch) {
  const watchLocation = watch?.location || {};
  return {
    lat: coerceNumber(watch?.latitude ?? watchLocation.latitude ?? config?.location?.latitude, DEFAULT_CONFIG.location.latitude),
    lng: coerceNumber(watch?.longitude ?? watchLocation.longitude ?? config?.location?.longitude, DEFAULT_CONFIG.location.longitude),
  };
}

function resolveRadius(config, watch) {
  const fallback = coerceNumber(config?.radiusKM, DEFAULT_CONFIG.radiusKM);
  return Math.max(1, coerceNumber(watch?.radiusKM ?? flagVal("--radius", String(fallback)), fallback));
}

function resolveAllowShipping(config, watch) {
  if (typeof watch?.allowShipping === "boolean") return watch.allowShipping;
  if (typeof config?.allowShipping === "boolean") return config.allowShipping;
  return true;
}

function resolveTargetPriceBand(config, watch) {
  const targetType = inferTargetType(watch);
  const configuredMin = watch?.minPrice;
  const configuredMax = watch?.maxPrice;
  const globalMin = coerceNumber(config?.minPrice, DEFAULT_CONFIG.minPrice);
  const globalMax = coerceNumber(config?.maxPrice, DEFAULT_CONFIG.maxPrice);
  const retailBase = coerceNumber(watch?.retailBase, 0);

  let minPrice = coerceNumber(configuredMin, globalMin);
  let maxPrice = coerceNumber(configuredMax, globalMax);

  if (targetType !== "vehicle" && retailBase > 0) {
    if (configuredMin == null) minPrice = Math.max(25, Math.round(retailBase * 0.35));
    if (configuredMax == null) maxPrice = Math.max(minPrice + 25, Math.round(retailBase * 1.35));
  }

  minPrice = Math.max(0, Math.round(minPrice));
  maxPrice = Math.max(minPrice + 10, Math.round(maxPrice));
  return { minPrice, maxPrice };
}

function isShippingListing(listing) {
  if (listing?.shippingOffered === true) return true;
  const text = `${listing?.shippingText || ""} ${listing?.title || ""} ${listing?.description || ""}`.toLowerCase();
  return /\bshipping\b|\bships\b|\bshipped\b|\bdelivery available\b|\bdeliver\b/.test(text);
}

function matchesShippingPreference(listing, allowShipping) {
  if (allowShipping) return true;
  return !isShippingListing(listing);
}

function getProxyPool(config) {
  if (Array.isArray(config?.proxyPool) && config.proxyPool.length) {
    return config.proxyPool.map((proxy) => String(proxy || "").trim()).filter(Boolean);
  }
  if (typeof config?.proxy === "string" && config.proxy.trim()) {
    return [config.proxy.trim()];
  }
  return [];
}

function getProxyForIndex(proxyPool, index) {
  if (!proxyPool.length) return null;
  return proxyPool[index % proxyPool.length] || null;
}

function formatProxyLabel(proxyUrl) {
  if (!proxyUrl) return "direct";
  try {
    const parsed = new URL(proxyUrl);
    return parsed.host || "proxy";
  } catch {
    return "proxy";
  }
}

async function analyzeListing({ listing, query, watchlist, vinCache, recallCache }) {
  const currentTarget = watchlist[0] || null;
  const watch = currentTarget;
  const targetType = inferTargetType(watch);
  const profile = extractVehicleProfile(listing, watchlist, currentTarget);
  const rejectionBase = !watch
    ? "Did not match current target"
    : profile.matchesCurrentTarget === false
    ? `Does not clearly match target "${watch.label}"`
    : "";

  let vinData = null;
  if (targetType === "vehicle" && !FLAG_NO_NHTSA && profile.vin) {
    if (!vinCache.has(profile.vin)) {
      vinCache.set(profile.vin, await decodeVin(profile.vin));
    }
    vinData = vinCache.get(profile.vin);
  }

  const recallKey = JSON.stringify({
    make: vinData?.make || profile.make,
    model: vinData?.model || profile.model,
    year: vinData?.year || profile.year,
  });

  let recalls = [];
  if (targetType === "vehicle" && !FLAG_NO_NHTSA && !recallCache.has(recallKey)) {
    recallCache.set(
      recallKey,
      await getOpenRecalls({
        make: vinData?.make || profile.make,
        model: vinData?.model || profile.model,
        year: vinData?.year || profile.year,
      })
    );
  }
  if (recallCache.has(recallKey)) recalls = recallCache.get(recallKey);

  const aiAnalysis = gradeListingPhotos(listing);

  const underwriting = underwriteVehicle({
    listing,
    profile: {
      ...profile,
      year: profile.year || vinData?.year || null,
      make: profile.make || vinData?.make || null,
      model: profile.model || vinData?.model || null,
      trim: profile.trim || vinData?.trim || null,
      storageGb: profile.storageGb || null,
      batteryHealthValue: profile.batteryHealthValue || null,
    },
    watch,
    vinData,
    recalls,
    aiAnalysis: null,
  });

  return {
    timestamp: new Date().toISOString(),
    query,
    target: {
      id: watch?.id || "",
      label: watch?.label || query,
      group: watch?.group || "General",
      targetType,
      customPrompt: watch?.customPrompt || "",
      notes: watch?.notes || "",
    },
    listing,
    vehicle: {
      year: profile.year || vinData?.year || null,
      make: profile.make || vinData?.make || null,
      model: profile.model || vinData?.model || null,
      trim: profile.trim || vinData?.trim || null,
      mileageMiles: profile.mileage?.miles || null,
      storageGb: profile.storageGb || null,
      batteryHealthValue: profile.batteryHealthValue || null,
      vin: profile.vin || null,
      titleStatus: profile.titleStatus,
      bodyStyle: profile.bodyStyle,
      transmission: profile.transmission,
      drivetrain: profile.drivetrain,
      fuelType: profile.fuelType,
      issues: profile.issueSignals.map((signal) => signal.keyword),
    },
    market: {
      estRetail: underwriting.estRetail,
      maxBuy: underwriting.maxBuy,
      estimatedMargin: underwriting.estimatedMargin,
      feesReserve: underwriting.feesReserve,
      reconReserve: underwriting.reconReserve,
      recallCount: underwriting.recallCount,
      targetMarginFloor: underwriting.targetMarginFloor,
    },
    underwriting: {
      verdict: underwriting.verdict,
      confidence: underwriting.confidence,
      riskScore: underwriting.riskScore,
      reasons: rejectionBase ? [rejectionBase, ...underwriting.reasons] : underwriting.reasons,
      summary: underwriting.summary,
      notes: underwriting.notes,
    },
    ai_analysis: aiAnalysis,
    sources: {
      nhtsaVinDecoded: !!vinData,
      nhtsaVinUrl: profile.vin ? `https://www.nhtsa.gov/vin-decoder/${profile.vin}` : "",
      listingUrl: listing.url,
    },
  };
}

function matchesTargetRules(listing, watch) {
  const text = `${listing.title || ""}\n${listing.description || ""}`.toLowerCase();

  const mustInclude = Array.isArray(watch.mustInclude) ? watch.mustInclude : [];
  const mustAvoid = Array.isArray(watch.mustAvoid) ? watch.mustAvoid : watch.avoidKeywords || [];

  if (mustInclude.length && !mustInclude.every((keyword) => text.includes(String(keyword).toLowerCase()))) {
    return false;
  }

  if (mustAvoid.some((keyword) => text.includes(String(keyword).toLowerCase()))) {
    return false;
  }

  return true;
}

function formatPrice(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toLocaleString()}` : "$?";
}

async function runOnce() {
  ensureLogFiles();
  const config = loadConfig();
  const watchlist = loadWatchlist();
  const enabledTargets = watchlist.filter((watch) => watch.enabled !== false);
  const activeTargets = enabledTargets.slice(0, MAX_ACTIVE_TARGETS);
  const capped = enabledTargets.length > MAX_ACTIVE_TARGETS;
  const seen = loadSeenIds();
  const vinCache = new Map();
  const recallCache = new Map();
  const proxyPool = getProxyPool(config);
  const searchConcurrency = Math.max(1, Number(config.searchConcurrency || 1));
  const detailConcurrency = Math.max(1, Number(config.detailConcurrency || 1));

  console.log(chalk.cyan.bold("\n  FBM Sniper Community Edition"));
  console.log(chalk.dim(`  Active targets: ${activeTargets.length}/${watchlist.length}${capped ? ` (community edition limits to ${MAX_ACTIVE_TARGETS} — upgrade to Pro for unlimited)` : ""}`));
  console.log(chalk.dim(`  Radius: ${config.radiusKM}km | Price band: $${config.minPrice.toLocaleString()}-$${config.maxPrice.toLocaleString()} | Shipping: ${config.allowShipping === false ? "Local only" : "Allowed"}`));
  console.log(chalk.dim(`  Search workers: ${searchConcurrency} | Detail workers: ${detailConcurrency} | Proxies: ${proxyPool.length || 0}`));
  console.log(chalk.dim(`  Photo grading: rules-only (Pro unlocks AI photo grading)`));

  await runPool(activeTargets.map((watch, index) => ({ watch, index })), searchConcurrency, async ({ watch, index }) => {
    if (stopRequested) return;
    console.log(chalk.white(`\n  ▶ Searching ${watch.label} ${watch.group ? chalk.dim(`(${watch.group})`) : ""}`));

    const { lat, lng } = resolveSearchCenter(config, watch);
    const radiusKM = resolveRadius(config, watch);
    const { minPrice, maxPrice } = resolveTargetPriceBand(config, watch);
    const allowShipping = resolveAllowShipping(config, watch);
    const proxyUrl = getProxyForIndex(proxyPool, index);
    const maxPages = Number(watch.maxPages ?? config.maxPages);
    const maxListingsPerQuery = Number(watch.maxListingsPerQuery ?? config.maxListingsPerQuery);
    const daysSinceListed = Number(watch.daysSinceListed ?? 2);
    const conditions = Array.isArray(watch.conditions) && watch.conditions.length
      ? watch.conditions
      : ["used_like_new", "used_good", "used_fair"];

    console.log(chalk.dim(`    Search center: ${lat.toFixed(4)}, ${lng.toFixed(4)} | Radius: ${radiusKM}km | Band: $${minPrice.toLocaleString()}-$${maxPrice.toLocaleString()} | ${allowShipping ? "Shipping OK" : "Local only"} | Proxy: ${formatProxyLabel(proxyUrl)}`));

    const { listings } = await searchMarketplace({
      query: watch.query,
      lat,
      lng,
      radiusKM,
      minPrice: minPrice * 100,
      maxPrice: maxPrice * 100,
      maxPages,
      daysSinceListed,
      conditions,
      proxyUrl,
    });

    await runPool(listings.slice(0, maxListingsPerQuery), detailConcurrency, async (baseListing) => {
      if (stopRequested) return;
      if (!baseListing?.id || seen.has(baseListing.id)) return;
      if (String(baseListing.id).includes("IN_MEMORY_MARKETPLACE_FEED_STORY_ENT")) return;

      const detail = await getListingDetail(baseListing.id, undefined, proxyUrl);
      const merged = normalizeListing(mergeDetail(baseListing, detail));
      if (isSearchPlaceholderListing(merged)) return;
      if (!merged?.title || !Number.isFinite(Number(merged.price))) return;
      if (hoursOld(merged.postedAt) != null && hoursOld(merged.postedAt) > config.maxAgeHours) return;
      if (!matchesTargetRules(merged, watch)) return;
      if (!matchesShippingPreference(merged, allowShipping)) return;
      seen.add(baseListing.id);

      const analyzed = await analyzeListing({
        listing: merged,
        query: watch.query,
        watchlist: [watch],
        vinCache,
        recallCache,
      });

      const verdict = analyzed.underwriting.verdict;
      const line = formatTargetLine(watch, analyzed.vehicle, merged);

      if (verdict === "pass") {
        appendRejected({
          listing: merged,
          query: watch.query,
          reason: analyzed.underwriting.reasons.join("; ") || analyzed.underwriting.summary,
          profile: analyzed.vehicle,
          target: analyzed.target,
        });
        console.log(chalk.red(`  ✗ PASS  ${line}  ${formatPrice(merged.price)}`));
      } else {
        appendFound(analyzed);
        console.log(
          verdict === "buy_now"
            ? chalk.green(`  ✓ BUY NOW  ${line}  list ${formatPrice(merged.price)} | max ${formatPrice(analyzed.market.maxBuy)}`)
            : chalk.yellow(`  ? MAYBE    ${line}  list ${formatPrice(merged.price)} | max ${formatPrice(analyzed.market.maxBuy)}`)
        );
      }
    });
  });

  saveSeenIds(seen);
}

async function main() {
  if (FLAG_RESET) resetMemory();

  if (FLAG_TEST) {
    await runOnce();
    return;
  }

  while (!stopRequested) {
    try {
      await runOnce();
    } catch (error) {
      console.error(chalk.red(`\n  Fatal cycle error: ${error.message}`));
    }

    if (stopRequested) break;
    const config = loadConfig();
    const intervalSeconds = Math.max(MIN_INTERVAL_SECONDS, Number(config.intervalSeconds) || MIN_INTERVAL_SECONDS);
    console.log(chalk.dim(`\n  Sleeping ${intervalSeconds}s before the next scan...`));
    const sleepUntil = Date.now() + intervalSeconds * 1000;
    while (!stopRequested && Date.now() < sleepUntil) {
      await sleep(Math.min(1000, sleepUntil - Date.now()));
    }
  }

  console.log(chalk.dim("\n  FBM Sniper Community Edition stopped."));
}

main().catch((error) => {
  console.error(chalk.red("\nFBM sniper failed:"), error);
  process.exit(1);
});
