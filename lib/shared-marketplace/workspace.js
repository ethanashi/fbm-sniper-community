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
