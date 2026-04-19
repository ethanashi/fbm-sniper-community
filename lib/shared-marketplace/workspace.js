import fs from "fs";
import path from "path";
import { DATA_DIR } from "../paths.js";

export const WORKSPACE_DATA_DIR = path.join(DATA_DIR, "shared-marketplace");
export const WORKSPACE_CONFIG_FILE = path.join(WORKSPACE_DATA_DIR, "config.json");
export const WORKSPACE_WATCHLIST_FILE = path.join(WORKSPACE_DATA_DIR, "watchlist.json");

const SUPPORTED_PLATFORMS = new Set(["facebook", "wallapop", "vinted"]);
const SUPPORTED_PRODUCTS = new Set(["iphone", "mac", "ipad", "airpods", "playstation", "console"]);

const DEFAULT_LOCATION = {
  label: "Madrid, Spain",
  latitude: 40.4032,
  longitude: -3.7037,
};

const DEFAULT_BOTS = {
  facebook: { pollIntervalSec: 90 },
  wallapop: { pollIntervalSec: 60 },
  vinted: { pollIntervalSec: 45, cookie: "", userAgent: "" },
};

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
    discord: {
      allWebhookUrl: "",
      buyNowWebhookUrl: "",
      maybeWebhookUrl: "",
    },
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

export function loadWorkspaceConfig() {
  ensureWorkspaceFiles();
  try {
    const parsed = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_FILE, "utf8"));
    return {
      ...DEFAULT_CONFIG,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      location: {
        ...DEFAULT_CONFIG.location,
        ...((parsed && parsed.location) || {}),
      },
      notifications: {
        ...DEFAULT_CONFIG.notifications,
        ...((parsed && parsed.notifications) || {}),
        discord: {
          ...DEFAULT_CONFIG.notifications.discord,
          ...((parsed && parsed.notifications && parsed.notifications.discord) || {}),
        },
      },
      bots: mergeBots(parsed && parsed.bots),
    };
  } catch {
    return { ...DEFAULT_CONFIG, bots: { ...DEFAULT_BOTS } };
  }
}

export function saveWorkspaceConfig(config) {
  const safe = config && typeof config === "object" && !Array.isArray(config)
    ? config
    : DEFAULT_CONFIG;
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
