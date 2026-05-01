import fs from "fs";
import path from "path";
import { DATA_DIR } from "../paths.js";

export const WORKSPACE_DATA_DIR = path.join(DATA_DIR, "shared-marketplace");
export const WORKSPACE_CONFIG_FILE = path.join(WORKSPACE_DATA_DIR, "config.json");
export const WORKSPACE_WATCHLIST_FILE = path.join(WORKSPACE_DATA_DIR, "watchlist.json");

const SUPPORTED_PLATFORMS = new Set(["facebook", "wallapop", "vinted", "mercadolibre", "amazon"]);
const SUPPORTED_PRODUCTS = new Set(["iphone", "mac", "ipad", "airpods", "playstation", "console"]);

const DEFAULT_LOCATION = {
  latitude: null,
  longitude: null,
  confirmed: false,
};

export function hasValidLocation(loc) {
  if (!loc || typeof loc !== "object") return false;
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  // (0, 0) is Null Island in the Gulf of Guinea — almost always a sign the
  // user left the fields blank and JS coerced "" to 0. Treat as invalid.
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

export function hasConfirmedLocation(loc) {
  return hasValidLocation(loc) && loc.confirmed === true;
}

function normalizeLocation(raw) {
  const loc = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (!hasValidLocation(loc)) {
    return { ...DEFAULT_LOCATION };
  }
  return {
    latitude: Number(loc.latitude),
    longitude: Number(loc.longitude),
    confirmed: loc.confirmed === true,
  };
}

const DEFAULT_BOTS = {
  facebook: { pollIntervalSec: 90 },
  wallapop: { pollIntervalSec: 60 },
  vinted: { pollIntervalSec: 45, cookie: "", userAgent: "", domain: "" },
  mercadolibre: { pollIntervalSec: 60, siteId: "MLA", accessToken: "" },
  amazon: { pollIntervalSec: 300, country: "US" },
};

export const AMAZON_SITES = [
  { id: "US", country: "United States", domain: "amazon.com" },
  { id: "ES", country: "Spain", domain: "amazon.es" },
  { id: "UK", country: "United Kingdom", domain: "amazon.co.uk" },
  { id: "DE", country: "Germany", domain: "amazon.de" },
  { id: "FR", country: "France", domain: "amazon.fr" },
  { id: "IT", country: "Italy", domain: "amazon.it" },
  { id: "MX", country: "Mexico", domain: "amazon.com.mx" },
  { id: "BR", country: "Brazil", domain: "amazon.com.br" },
  { id: "CA", country: "Canada", domain: "amazon.ca" },
];

export function amazonSiteInfo(countryCode) {
  const value = String(countryCode || "").trim().toUpperCase();
  return AMAZON_SITES.find((s) => s.id === value) || null;
}

export const MERCADOLIBRE_SITES = [
  { id: "MLA", country: "Argentina" },
  { id: "MLB", country: "Brazil" },
  { id: "MLM", country: "Mexico" },
  { id: "MLC", country: "Chile" },
  { id: "MCO", country: "Colombia" },
  { id: "MLU", country: "Uruguay" },
  { id: "MPE", country: "Peru" },
  { id: "MEC", country: "Ecuador" },
  { id: "MCR", country: "Costa Rica" },
  { id: "MRD", country: "Dominican Republic" },
  { id: "MHN", country: "Honduras" },
  { id: "MNI", country: "Nicaragua" },
  { id: "MPA", country: "Panama" },
  { id: "MSV", country: "El Salvador" },
  { id: "MGT", country: "Guatemala" },
  { id: "MBO", country: "Bolivia" },
  { id: "MLV", country: "Venezuela" },
];

export function mercadolibreSiteInfo(siteId) {
  const value = String(siteId || "").trim().toUpperCase();
  return MERCADOLIBRE_SITES.find((s) => s.id === value) || null;
}

export const VINTED_DOMAINS = [
  { domain: "www.vinted.com",   country: "United States", lang: "en-US,en;q=0.9" },
  { domain: "www.vinted.es",    country: "Spain",         lang: "es-ES,es;q=0.9" },
  { domain: "www.vinted.fr",    country: "France",        lang: "fr-FR,fr;q=0.9" },
  { domain: "www.vinted.de",    country: "Germany",       lang: "de-DE,de;q=0.9" },
  { domain: "www.vinted.co.uk", country: "United Kingdom", lang: "en-GB,en;q=0.9" },
  { domain: "www.vinted.it",    country: "Italy",         lang: "it-IT,it;q=0.9" },
  { domain: "www.vinted.nl",    country: "Netherlands",   lang: "nl-NL,nl;q=0.9" },
  { domain: "www.vinted.be",    country: "Belgium",       lang: "nl-BE,nl;q=0.9" },
  { domain: "www.vinted.pl",    country: "Poland",        lang: "pl-PL,pl;q=0.9" },
  { domain: "www.vinted.cz",    country: "Czechia",       lang: "cs-CZ,cs;q=0.9" },
  { domain: "www.vinted.sk",    country: "Slovakia",      lang: "sk-SK,sk;q=0.9" },
  { domain: "www.vinted.at",    country: "Austria",       lang: "de-AT,de;q=0.9" },
  { domain: "www.vinted.pt",    country: "Portugal",      lang: "pt-PT,pt;q=0.9" },
  { domain: "www.vinted.lu",    country: "Luxembourg",    lang: "fr-LU,fr;q=0.9" },
  { domain: "www.vinted.lt",    country: "Lithuania",     lang: "lt-LT,lt;q=0.9" },
  { domain: "www.vinted.fi",    country: "Finland",       lang: "fi-FI,fi;q=0.9" },
  { domain: "www.vinted.se",    country: "Sweden",        lang: "sv-SE,sv;q=0.9" },
  { domain: "www.vinted.dk",    country: "Denmark",       lang: "da-DK,da;q=0.9" },
  { domain: "www.vinted.hu",    country: "Hungary",       lang: "hu-HU,hu;q=0.9" },
  { domain: "www.vinted.hr",    country: "Croatia",       lang: "hr-HR,hr;q=0.9" },
  { domain: "www.vinted.gr",    country: "Greece",        lang: "el-GR,el;q=0.9" },
  { domain: "www.vinted.ro",    country: "Romania",       lang: "ro-RO,ro;q=0.9" },
  { domain: "www.vinted.ie",    country: "Ireland",       lang: "en-IE,en;q=0.9" },
];

export function vintedDomainInfo(domain) {
  const value = String(domain || "").trim().toLowerCase();
  return VINTED_DOMAINS.find((d) => d.domain === value) || null;
}

const DEFAULT_CONFIG = {
  appName: "FBM Sniper Community",
  proxy: "",
  proxyPool: [],
  location: DEFAULT_LOCATION,
  notifications: {
    includePhotos: true,
    maxPhotos: 3,
    autoOpenBuyNow: false,
    autoOpenBrowser: "default",

  },
  filters: {
    minProfit: 50,
    minROI: 30,
    zScoreThreshold: -2.0,
    zScoreEnabled: false,
    globalMustAvoid: ["broken", "spare part", "iCloud", "failure", "detail", "clone", "replica", "case", "looking for", "buying"],
    globalPriorityKeywords: ["travel", "clearance", "urgent", "same day", "negotiable", "sealed"],
  },
  bots: DEFAULT_BOTS,
};

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || `target-${Date.now()}`;
}

function buildAliases(query) {
  const raw = String(query || "").trim();
  if (!raw) return [];
  return [raw, raw.toLowerCase()];
}

function makeTarget({
  label,
  query,
  group,
  product,
  platforms,
  enabled = true,
  aliases = [],
}) {
  return {
    id: slugify(label || query),
    label: label || query,
    group,
    enabled,
    product,
    targetType: "electronics",
    platforms,
    query,
    aliases: [...new Set([...buildAliases(query), ...aliases].filter(Boolean))],
    mustInclude: [],
    mustAvoid: [],
    radiusKM: null,
    minPrice: null,
    maxPrice: null,
    allowShipping: true,
  };
}

const PHONE_TARGETS = [
  "iPhone 16 Pro Max",
  "iPhone 16 Pro",
  "iPhone 16",
  "iPhone 15 Pro Max",
  "iPhone 15 Pro",
  "iPhone 15",
  "iPhone 14 Pro Max",
  "iPhone 14 Pro",
  "iPhone 14",
  "iPhone 13 Pro Max",
  "iPhone 13 Pro",
  "iPhone 13",
].map((query) => makeTarget({
  label: query,
  query,
  group: "Phones",
  product: "iphone",
  platforms: ["facebook", "wallapop", "vinted"],
  enabled: true,
}));

const PLAYSTATION_TARGETS = [
  "PS5 Pro",
  "PlayStation 5 Pro",
  "PS5 digital",
  "PS5 disco",
  "PlayStation 5",
  "PS5",
].map((query) => makeTarget({
  label: query,
  query,
  group: "PlayStation",
  product: "playstation",
  platforms: ["facebook"],
  enabled: false,
}));

export const DEFAULT_WATCHLIST = [
  ...PHONE_TARGETS,
  ...PLAYSTATION_TARGETS,
];

function ensureDir() {
  fs.mkdirSync(WORKSPACE_DATA_DIR, { recursive: true });
}

function writeJson(file, payload) {
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function ensureFile(file, fallback) {
  ensureDir();
  if (!fs.existsSync(file)) writeJson(file, fallback);
}

function normalizePlatforms(platforms) {
  const normalized = Array.isArray(platforms)
    ? platforms.map((platform) => String(platform || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const filtered = normalized.filter((platform) => SUPPORTED_PLATFORMS.has(platform));
  return filtered.length ? [...new Set(filtered)] : ["facebook"];
}

function normalizeProduct(product) {
  const normalized = String(product || "").trim().toLowerCase();
  if (SUPPORTED_PRODUCTS.has(normalized)) return normalized;
  return "iphone";
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeBots(parsed) {
  const merged = {};
  for (const key of Object.keys(DEFAULT_BOTS)) {
    merged[key] = { ...DEFAULT_BOTS[key], ...((parsed && parsed[key]) || {}) };
  }
  return merged;
}

function normalizePlatformOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
  for (const platform of SUPPORTED_PLATFORMS) {
    const entry = raw[platform];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const minPrice = normalizeOptionalNumber(entry.minPrice);
    const maxPrice = normalizeOptionalNumber(entry.maxPrice);
    if (minPrice === null && maxPrice === null) continue;
    result[platform] = { minPrice, maxPrice };
  }
  return result;
}

export function normalizeWatchlistEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  const query = String(entry.query || entry.label || "").trim();
  if (!query) return null;

  const aliases = Array.isArray(entry.aliases)
    ? entry.aliases.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const mustInclude = Array.isArray(entry.mustInclude)
    ? entry.mustInclude.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const mustAvoid = Array.isArray(entry.mustAvoid)
    ? entry.mustAvoid.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const priorityKeywords = Array.isArray(entry.priorityKeywords)
    ? entry.priorityKeywords.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  return {
    id: String(entry.id || slugify(entry.label || query)).trim(),
    label: String(entry.label || query).trim(),
    group: String(entry.group || "General").trim() || "General",
    enabled: entry.enabled !== false,
    product: normalizeProduct(entry.product),
    targetType: String(entry.targetType || "electronics").trim() || "electronics",
    platforms: normalizePlatforms(entry.platforms || entry.sources),
    query,
    aliases: [...new Set([...buildAliases(query), ...aliases])],
    mustInclude,
    mustAvoid,
    priorityKeywords,
    radiusKM: normalizeOptionalNumber(entry.radiusKM),
    minPrice: normalizeOptionalNumber(entry.minPrice),
    maxPrice: normalizeOptionalNumber(entry.maxPrice),
    allowShipping: typeof entry.allowShipping === "boolean" ? entry.allowShipping : true,
    platformOverrides: normalizePlatformOverrides(entry.platformOverrides),
  };
}

export function resolveTargetForPlatform(target, platform) {
  if (!target || typeof target !== "object") return target;
  const key = String(platform || "").trim().toLowerCase();
  const override = target.platformOverrides && target.platformOverrides[key];
  if (!override) return target;
  return {
    ...target,
    minPrice: override.minPrice ?? target.minPrice ?? null,
    maxPrice: override.maxPrice ?? target.maxPrice ?? null,
  };
}

const SUPPORTED_PLATFORMS_LIST = [...SUPPORTED_PLATFORMS];
export function listSupportedPlatforms() {
  return SUPPORTED_PLATFORMS_LIST.slice();
}

export function ensureWorkspaceFiles() {
  ensureFile(WORKSPACE_CONFIG_FILE, DEFAULT_CONFIG);
  ensureFile(WORKSPACE_WATCHLIST_FILE, DEFAULT_WATCHLIST);
}

function normalizeWorkspaceConfig(parsed) {
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return {
    ...DEFAULT_CONFIG,
    ...source,
    location: normalizeLocation(source.location),
    notifications: {
      ...DEFAULT_CONFIG.notifications,
      ...((source && source.notifications) || {}),

    },
    filters: {
      ...DEFAULT_CONFIG.filters,
      ...((source && source.filters) || {}),
    },
    bots: mergeBots(source.bots),
  };
}

export function loadWorkspaceConfig() {
  ensureWorkspaceFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_FILE, "utf8"));
    return normalizeWorkspaceConfig(parsed);
  } catch {
    return normalizeWorkspaceConfig(DEFAULT_CONFIG);
  }
}

export function saveWorkspaceConfig(config) {
  const safe = normalizeWorkspaceConfig(config);
  ensureWorkspaceFiles();
  writeJson(WORKSPACE_CONFIG_FILE, safe);
  return loadWorkspaceConfig();
}

export function loadWorkspaceWatchlist() {
  ensureWorkspaceFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(WORKSPACE_WATCHLIST_FILE, "utf8"));
    if (!Array.isArray(parsed)) return DEFAULT_WATCHLIST.map(normalizeWatchlistEntry).filter(Boolean);
    return parsed.map(normalizeWatchlistEntry).filter(Boolean);
  } catch {
    return DEFAULT_WATCHLIST.map(normalizeWatchlistEntry).filter(Boolean);
  }
}

export function saveWorkspaceWatchlist(watchlist) {
  const normalized = (Array.isArray(watchlist) ? watchlist : [])
    .map(normalizeWatchlistEntry)
    .filter(Boolean);
  ensureWorkspaceFiles();
  writeJson(WORKSPACE_WATCHLIST_FILE, normalized);
  return normalized;
}

export function targetAppliesToPlatform(target, platform) {
  const wanted = String(platform || "").trim().toLowerCase();
  return normalizePlatforms(target?.platforms || target?.sources).includes(wanted);
}

export function buildWatchlistGroups(watchlist) {
  return [...new Set(
    (Array.isArray(watchlist) ? watchlist : [])
      .map((item) => item?.group || "General")
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
}
