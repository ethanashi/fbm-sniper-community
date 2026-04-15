import { inferTargetType, listingMatchesTarget, normalizeText } from "./target-utils.js";

function titleCase(text) {
  return String(text || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractYear(text) {
  const years = [...String(text || "").matchAll(/\b(19[9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  return years.length ? years[0] : null;
}

function extractMileage(text) {
  const raw = String(text || "");
  const match = raw.match(/\b(\d{1,3}(?:,\d{3})+|\d{2,6})\s*(miles|mile|mi|km|kilometers|kilometres)\b/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  const unit = match[2].toLowerCase().startsWith("k") ? "km" : "mi";
  const miles = unit === "km" ? Math.round(value * 0.621371) : value;
  return { raw: value, unit, miles };
}

function extractStorage(text) {
  const match = String(text || "").match(/\b(64|128|256|512|1024|1)\s*(gb|tb)\b/i);
  if (!match) return null;
  const raw = Number(match[1]);
  const unit = match[2].toLowerCase();
  return unit === "tb" ? raw * 1024 : raw;
}

function extractBatteryHealth(text) {
  const raw = String(text || "");
  const match = raw.match(/(?:battery(?:\s+health)?|bh)[^0-9]{0,12}(\d{2,3})\s*%/i) ||
    raw.match(/\b(\d{2,3})\s*%\s*(?:battery|bh)\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return `${value}%`;
}

function extractVin(text) {
  const match = String(text || "").toUpperCase().match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  return match ? match[1] : null;
}

function detectTitleStatus(text) {
  const n = normalizeText(text);
  if (/\bsalvage\b/.test(n)) return "salvage";
  if (/\brebuilt\b|\breconstructed\b/.test(n)) return "rebuilt";
  if (/\bclean title\b/.test(n)) return "clean";
  if (/\bbonded\b/.test(n)) return "bonded";
  if (/\bno title\b|\bmissing title\b/.test(n)) return "missing";
  return "unknown";
}

function detectBodyStyle(text) {
  const n = normalizeText(text);
  if (/\bsuv\b|\bcrossover\b/.test(n)) return "SUV";
  if (/\btruck\b|\bcrew cab\b|\bdouble cab\b|\bpickup\b/.test(n)) return "Truck";
  if (/\bcoupe\b/.test(n)) return "Coupe";
  if (/\bhatchback\b/.test(n)) return "Hatchback";
  if (/\bvan\b|\bminivan\b/.test(n)) return "Van";
  if (/\bwagon\b/.test(n)) return "Wagon";
  return "Sedan";
}

function detectTransmission(text) {
  const n = normalizeText(text);
  if (/\bmanual\b|\b6-speed\b|\b5-speed\b/.test(n)) return "Manual";
  if (/\bcvt\b/.test(n)) return "CVT";
  if (/\bautomatic\b|\bauto\b/.test(n)) return "Automatic";
  return "Unknown";
}

function detectDrivetrain(text) {
  const n = normalizeText(text);
  if (/\b4x4\b|\b4wd\b/.test(n)) return "4WD";
  if (/\bawd\b/.test(n)) return "AWD";
  if (/\brwd\b/.test(n)) return "RWD";
  if (/\bfwd\b/.test(n)) return "FWD";
  return "Unknown";
}

function detectFuelType(text) {
  const n = normalizeText(text);
  if (/\bhybrid\b/.test(n)) return "Hybrid";
  if (/\belectric\b|\bev\b/.test(n)) return "Electric";
  if (/\bdiesel\b/.test(n)) return "Diesel";
  return "Gas";
}

function collectVehicleSignals(text) {
  const n = normalizeText(text);
  const signals = [];
  const mappings = [
    ["check engine", 500],
    ["engine knock", 2500],
    ["transmission slip", 2200],
    ["needs tires", 550],
    ["brakes", 450],
    ["hail damage", 900],
    ["accident", 1200],
    ["frame damage", 3500],
    ["airbag", 1400],
    ["flood", 5000],
    ["paint fade", 450],
    ["cracked windshield", 300],
    ["ac not working", 750],
    ["mechanic special", 3000],
    ["no start", 3200],
    ["rebuilt", 2200],
    ["salvage", 4500],
    ["smokes", 3500],
    ["misfire", 1200],
  ];

  for (const [keyword, cost] of mappings) {
    if (n.includes(keyword)) signals.push({ keyword, cost });
  }
  return signals;
}

function collectElectronicsSignals(text) {
  const n = normalizeText(text);
  const signals = [];
  const mappings = [
    ["cracked screen", 180],
    ["screen crack", 180],
    ["scratched", 45],
    ["damaged", 120],
    ["locked", 250],
    ["no icloud", 350],
    ["parts only", 400],
    ["not working", 350],
    ["bad battery", 100],
    ["battery issue", 100],
    ["face id", 75],
  ];

  for (const [keyword, cost] of mappings) {
    if (n.includes(keyword)) signals.push({ keyword, cost });
  }
  return signals;
}

function collectIssueSignals(text, targetType) {
  if (targetType === "electronics") return collectElectronicsSignals(text);
  if (targetType === "vehicle") return collectVehicleSignals(text);
  return [];
}

function matchWatchlist(text, watchlist) {
  const listingText = normalizeText(text);
  for (const watch of watchlist) {
    if (listingMatchesTarget({ title: listingText, description: "" }, watch)) return watch;
  }
  return null;
}

export function extractVehicleProfile(listing, watchlist = [], currentTarget = null) {
  const title = listing?.title || "";
  const description = listing?.description || "";
  const combined = `${title}\n${description}`;
  const matchedWatch = currentTarget || matchWatchlist(combined, watchlist);
  const targetType = inferTargetType(matchedWatch);
  const mileage = targetType === "vehicle" ? extractMileage(combined) : null;
  const year = extractYear(title) || extractYear(description);
  const vin = targetType === "vehicle" ? extractVin(combined) : null;
  const titleStatus = targetType === "vehicle" ? detectTitleStatus(combined) : "unknown";
  const issueSignals = collectIssueSignals(combined, targetType);

  let trim = null;
  if (matchedWatch?.trimBoostKeywords?.length) {
    const n = normalizeText(combined);
    trim = matchedWatch.trimBoostKeywords.find((keyword) => n.includes(normalizeText(keyword))) || null;
  }

  return {
    watchId: matchedWatch?.id || null,
    watchLabel: matchedWatch?.label || null,
    targetType,
    matchesCurrentTarget: currentTarget ? listingMatchesTarget(listing, currentTarget) : !!matchedWatch,
    year,
    make: matchedWatch?.make || null,
    model: matchedWatch?.model || null,
    trim: trim ? titleCase(trim) : null,
    mileage,
    storageGb: targetType === "electronics" ? extractStorage(combined) : null,
    batteryHealthValue: targetType === "electronics" ? extractBatteryHealth(combined) : null,
    vin,
    titleStatus,
    bodyStyle: targetType === "vehicle" ? detectBodyStyle(combined) : null,
    transmission: targetType === "vehicle" ? detectTransmission(combined) : null,
    drivetrain: targetType === "vehicle" ? detectDrivetrain(combined) : null,
    fuelType: targetType === "vehicle" ? detectFuelType(combined) : null,
    issueSignals,
    sourceText: combined,
    matchedWatch,
  };
}
