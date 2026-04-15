import fs from "fs";
import { CAR_WATCHLIST_FILE } from "./paths.js";
import { inferTargetType } from "./target-utils.js";

export const DEFAULT_WATCHLIST = [
  {
    id: "honda-civic-2016-2021",
    label: "Honda Civic 2016-2021",
    group: "Reliable Sedans",
    enabled: true,
    make: "Honda",
    model: "Civic",
    aliases: ["honda civic", "civic sport", "civic touring", "civic ex"],
    query: "Honda Civic",
    yearStart: 2016,
    yearEnd: 2021,
    retailBase: 14500,
    baselineYear: 2019,
    yearlyAdjustment: 900,
    baselineMiles: 85000,
    mileagePenaltyPer10k: 450,
    mileageBonusPer10k: 225,
    maxMileage: 145000,
    feesReserve: 650,
    reconBase: 900,
    marginFloor: 2200,
    customPrompt: "Prefer clean-title commuter trims with strong retail demand and straightforward resale.",
    mustInclude: [],
    trimBoostKeywords: ["touring", "sport touring", "si"],
    avoidKeywords: ["salvage", "rebuilt", "mechanic special", "flood", "frame damage", "parts only"],
  },
  {
    id: "toyota-camry-2015-2021",
    label: "Toyota Camry 2015-2021",
    group: "Reliable Sedans",
    enabled: true,
    make: "Toyota",
    model: "Camry",
    aliases: ["toyota camry", "camry se", "camry xse", "camry xle"],
    query: "Toyota Camry",
    yearStart: 2015,
    yearEnd: 2021,
    retailBase: 17250,
    baselineYear: 2019,
    yearlyAdjustment: 950,
    baselineMiles: 90000,
    mileagePenaltyPer10k: 425,
    mileageBonusPer10k: 200,
    maxMileage: 155000,
    feesReserve: 700,
    reconBase: 950,
    marginFloor: 2500,
    customPrompt: "Focus on clean-title Camrys with strong family-car demand and low cosmetic risk.",
    mustInclude: [],
    trimBoostKeywords: ["xse", "xle", "trd"],
    avoidKeywords: ["salvage", "rebuilt", "engine knock", "transmission slip", "flood", "parts only"],
  },
  {
    id: "toyota-corolla-2016-2022",
    label: "Toyota Corolla 2016-2022",
    group: "Reliable Sedans",
    enabled: true,
    make: "Toyota",
    model: "Corolla",
    aliases: ["toyota corolla", "corolla se", "corolla xse", "corolla le"],
    query: "Toyota Corolla",
    yearStart: 2016,
    yearEnd: 2022,
    retailBase: 13750,
    baselineYear: 2020,
    yearlyAdjustment: 850,
    baselineMiles: 80000,
    mileagePenaltyPer10k: 350,
    mileageBonusPer10k: 180,
    maxMileage: 150000,
    feesReserve: 650,
    reconBase: 850,
    marginFloor: 2100,
    customPrompt: "Entry-level flip target. Bias toward easy-turn commuter inventory.",
    mustInclude: [],
    trimBoostKeywords: ["xse", "se apex", "hatchback"],
    avoidKeywords: ["salvage", "rebuilt", "flood", "parts only", "no title"],
  },
  {
    id: "honda-accord-2016-2021",
    label: "Honda Accord 2016-2021",
    group: "Reliable Sedans",
    enabled: false,
    make: "Honda",
    model: "Accord",
    aliases: ["honda accord", "accord sport", "accord ex", "accord touring"],
    query: "Honda Accord",
    yearStart: 2016,
    yearEnd: 2021,
    retailBase: 18800,
    baselineYear: 2019,
    yearlyAdjustment: 1025,
    baselineMiles: 85000,
    mileagePenaltyPer10k: 450,
    mileageBonusPer10k: 220,
    maxMileage: 150000,
    feesReserve: 700,
    reconBase: 950,
    marginFloor: 2600,
    customPrompt: "Prioritize clean-title higher trims with retail-friendly color combos.",
    mustInclude: [],
    trimBoostKeywords: ["touring", "2.0t", "sport 2.0t"],
    avoidKeywords: ["salvage", "rebuilt", "airbags deployed", "frame damage", "flood"],
  },
  {
    id: "mazda-cx5-2017-2021",
    label: "Mazda CX-5 2017-2021",
    group: "SUVs",
    enabled: false,
    make: "Mazda",
    model: "CX-5",
    aliases: ["mazda cx-5", "mazda cx5", "cx-5 touring", "cx5 grand touring"],
    query: "Mazda CX-5",
    yearStart: 2017,
    yearEnd: 2021,
    retailBase: 19600,
    baselineYear: 2020,
    yearlyAdjustment: 1100,
    baselineMiles: 75000,
    mileagePenaltyPer10k: 500,
    mileageBonusPer10k: 240,
    maxMileage: 145000,
    feesReserve: 725,
    reconBase: 1000,
    marginFloor: 2700,
    customPrompt: "Prefer Grand Touring and Signature trims with clean title and tidy interior.",
    mustInclude: [],
    trimBoostKeywords: ["grand touring", "signature", "carbon edition"],
    avoidKeywords: ["salvage", "rebuilt", "rod knock", "transmission", "flood"],
  },
  {
    id: "ford-f150-2015-2020",
    label: "Ford F-150 2015-2020",
    group: "Trucks",
    enabled: false,
    make: "Ford",
    model: "F-150",
    aliases: ["ford f150", "ford f-150", "f150 xlt", "f-150 xlt"],
    query: "Ford F-150",
    yearStart: 2015,
    yearEnd: 2020,
    retailBase: 23800,
    baselineYear: 2018,
    yearlyAdjustment: 1350,
    baselineMiles: 105000,
    mileagePenaltyPer10k: 575,
    mileageBonusPer10k: 260,
    maxMileage: 180000,
    feesReserve: 850,
    reconBase: 1400,
    marginFloor: 3200,
    customPrompt: "Target 4x4 and nicer trims with clean title. Be skeptical of drivetrain issues.",
    mustInclude: [],
    trimBoostKeywords: ["lariat", "fx4", "4x4", "crew cab"],
    avoidKeywords: ["salvage", "rebuilt", "rust", "frame damage", "ecoboost timing", "flood"],
  },
];

function normalizeWatchlistEntry(entry) {
  const targetType = inferTargetType(entry);
  const mustAvoid = Array.isArray(entry?.mustAvoid)
    ? entry.mustAvoid
    : Array.isArray(entry?.avoidKeywords)
    ? entry.avoidKeywords
    : [];
  const yearStart = normalizeYear(entry?.yearStart);
  const yearEnd = normalizeYear(entry?.yearEnd);
  const baselineYear = normalizeYear(entry?.baselineYear);

  const normalized = {
    group: "General",
    enabled: true,
    targetType,
    aliases: [],
    mustInclude: [],
    mustAvoid,
    customPrompt: "",
    notes: "",
    ...entry,
    targetType: inferTargetType({ targetType, ...entry }),
    aliases: Array.isArray(entry?.aliases) ? entry.aliases.filter(Boolean) : [],
    mustInclude: Array.isArray(entry?.mustInclude) ? entry.mustInclude.filter(Boolean) : [],
    mustAvoid,
  };

  if (targetType === "vehicle") {
    if (yearStart) normalized.yearStart = yearStart;
    else delete normalized.yearStart;
    if (yearEnd) normalized.yearEnd = yearEnd;
    else delete normalized.yearEnd;
    if (baselineYear) normalized.baselineYear = baselineYear;
    else if (yearStart) normalized.baselineYear = yearStart;
    else delete normalized.baselineYear;
  } else {
    delete normalized.yearStart;
    delete normalized.yearEnd;
    delete normalized.baselineYear;
    normalized.baselineMiles = 0;
    normalized.mileagePenaltyPer10k = 0;
    normalized.mileageBonusPer10k = 0;
    normalized.maxMileage = 0;
  }

  return normalized;
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  if (year < 1990 || year > 2055) return null;
  return Math.round(year);
}

export function ensureWatchlistFile() {
  if (!fs.existsSync(CAR_WATCHLIST_FILE)) {
    fs.writeFileSync(CAR_WATCHLIST_FILE, JSON.stringify(DEFAULT_WATCHLIST, null, 2), "utf8");
  }
}

export function loadWatchlist() {
  ensureWatchlistFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(CAR_WATCHLIST_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.map(normalizeWatchlistEntry) : DEFAULT_WATCHLIST.map(normalizeWatchlistEntry);
  } catch {
    return DEFAULT_WATCHLIST.map(normalizeWatchlistEntry);
  }
}
