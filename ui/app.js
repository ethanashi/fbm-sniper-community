/* ── State ──────────────────────────────────────────────────────────────────── */
let ws = null;
let wsRetryTimer = null;
let processState = {};
let appConfig = {};
let sharedConfig = {};
let sharedWatchlist = [];
let sharedGroups = [];
let targetGroups = [];
let sharedSettingsDirty = false;
const FOUND_LISTINGS_STORAGE_KEY = "fbm-found-listings-columns";
const TOOLS_CONFIG_KEY = "fbm-tools-config";

let toolsConfig = {
  deepLinks: false,
  tradeJournal: false
};

function loadToolsConfig() {
  try {
    const raw = localStorage.getItem(TOOLS_CONFIG_KEY);
    if (raw) toolsConfig = { ...toolsConfig, ...JSON.parse(raw) };
  } catch (e) {}
}

function saveToolsConfig() {
  localStorage.setItem(TOOLS_CONFIG_KEY, JSON.stringify(toolsConfig));
}

function toggleTool(key, enabled) {
  toolsConfig[key] = enabled;
  saveToolsConfig();

  // Re-render only necessary parts instead of everything if possible,
  // but for reliability during Phase 9 implementation:
  const platform = currentTopTab;
  if (PLATFORM_META[platform]) {
    renderMarketplaceTab(platform);
  }
}

function getDeepLink(platform, asset, fiat, side) {
  if (platform === 'binance') {
    const bSide = side === 'BUY' ? 'BUY' : 'SELL';
    return `https://p2p.binance.com/en/trade/${bSide}/${asset}?fiat=${fiat}&payment=all-payments`;
  }
  if (platform === 'eldorado') {
    return 'https://eldorado.io/p2p/';
  }
  if (platform === 'airtm') {
    return 'https://app.airtm.com/p2p';
  }
  return '';
}

function triggerEmergencyHalt() {
  if (!confirm("🚨 ATTENTION: This will immediately stop ALL arbitrage engines. Continue?")) return;

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ command: "EMERGENCY_HALT" }));
  }
}

async function markAsTraded(deal) {
  try {
    const res = await fetch("/api/journal/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deal),
    });
    if (res.ok) {
      showToast("Trade recorded in journal.");
    } else {
      throw new Error("Failed to record trade.");
    }
  } catch (err) {
    showToast(`Journal error: ${err.message}`, "err");
  }
}
const sharedFoundDeals = {
  facebook: [],
  vinted: [],
  mercadolibre: [],
  amazon: [],
  arbitrage: [],
  anomalia: [],
};
const foundListingsLoaded = {
  facebook: false,
  vinted: false,
  mercadolibre: false,
  amazon: false,
  arbitrage: false,
  anomalia: false,
};
// In-memory grade filter per platform. Set of selected letter grades; empty Set = show all.
const sharedGradeFilter = {
  facebook: new Set(),
  vinted: new Set(),
  mercadolibre: new Set(),
  amazon: new Set(),
  arbitrage: new Set(),
  anomalia: new Set(),
};
const SHARED_GRADE_LETTERS = ["A", "B", "C", "D", "F"];
let currentTopTab = "facebook";
let currentLogProcess = "facebook-sniper";
let currentSharedWatchGroup = "all";
const sharedReloadTimers = {
  facebook: null,
  vinted: null,
  mercadolibre: null,
  amazon: null,
  arbitrage: null,
  anomalia: null,
};
const terminalBuffers = {};
let activeDealModal = null;
let activeTextPrompt = null;
let draggedTargetId = null;

const PLATFORM_META = {
  facebook: {
    label: "Facebook",
    process: "facebook-sniper",
    description: "Shared Facebook Marketplace sniper using the shared watchlist settings.",
  },
  vinted: {
    label: "Vinted",
    process: "vinted-sniper",
    description: "Shared Vinted loop with optional cookie override, photos.",
  },
  mercadolibre: {
    label: "MercadoLibre",
    process: "mercadolibre-sniper",
    description: "MercadoLibre search loop with site selection and optional access token.",
  },
  amazon: {
    label: "Amazon",
    process: "amazon-sniper",
    description: "Amazon search scraper using Puppeteer for anti-bot bypass and site selection.",
  },
  arbitrage: {
    label: "Arbitrage",
    process: "arbitrage-engine",
    description: "P2P Crypto Arbitrage (Currency Dropshipping) between configured fiat pairs using Binance BAPI.",
    profile_id: "PRINCIPAL"
  },
  anomalia: {
    label: "Radar Inverso",
    process: "arbitrage-engine",
    description: "Anomalous market scenarios or reverse routes (buying ARS/VES and selling COP).",
    profile_id: "ANOMALIA"
  },
};

let arbitrageChart = null;
let arbitrageSpreadSeries = {}; // Map of fiat -> series
let arbitrageVolumeSeries = null;

let anomaliaChart = null;
let anomaliaSpreadSeries = {};
let anomaliaVolumeSeries = null;

let radarChart = null;
let radarAskSeries = null;
let radarBidSeries = null;
let currentSpotMode = 'spatial';
let currentFeedProvider = 'binance-bybit';
let analyticsHeatmap = null;
let radarMuted = false;
const radarChime = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YT9vT18AZmZtZnx+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+');

const FOUND_LISTINGS_META = [
  ...Object.entries(PLATFORM_META).filter(([id]) => id !== 'arbitrage' && id !== 'anomalia').map(([id, meta]) => ({
    id,
    label: meta.label,
    process: meta.process,
    description: meta.description,
  })),
];

function readFoundListingsColumnVisibility() {
  const defaults = Object.fromEntries(FOUND_LISTINGS_META.map((column) => [column.id, true]));
  try {
    const raw = localStorage.getItem(FOUND_LISTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    return FOUND_LISTINGS_META.reduce((acc, column) => {
      acc[column.id] = parsed[column.id] !== false;
      return acc;
    }, {});
  } catch {
    return defaults;
  }
}

let foundListingsColumnVisibility = readFoundListingsColumnVisibility();

function showToast(message, tone = "ok") {
  const host = document.getElementById("toastHost");
  if (!host || !message) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  host.appendChild(toast);

  const dismiss = () => {
    toast.classList.add("toast-out");
    window.setTimeout(() => toast.remove(), 220);
  };
  window.setTimeout(dismiss, 2800);
}

const DEFAULT_SHARED_CONFIG = {
  appName: "FBM Sniper Community",
  proxy: "",
  proxyPool: [],
  location: {
    latitude: null,
    longitude: null,
    confirmed: false,
  },
  notifications: {
    includePhotos: true,
    maxPhotos: 3,
    autoOpenBuyNow: false,
    autoOpenBrowser: "default",

  },
  bots: {
    facebook: { pollIntervalSec: 90 },
    vinted: { pollIntervalSec: 45, cookie: "", userAgent: "", domain: "" },
    mercadolibre: { pollIntervalSec: 60, siteId: "MLA", accessToken: "" },
    amazon: { pollIntervalSec: 300, country: "US" },
    arbitrage: { pollIntervalSec: 60 },
    anomalia: { pollIntervalSec: 60 },
  },
};

/* ── Carousel state ─────────────────────────────────────────────────────────── */
// cardId → current photo index
const photoIndexes = {};

const MERCADOLIBRE_SITES = [
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

function buildMercadoLibreSiteOptions(selected) {
  const current = String(selected || "MLA").trim().toUpperCase();
  return MERCADOLIBRE_SITES.map((s) => {
    const sel = s.id === current ? "selected" : "";
    return `<option value="${escAttr(s.id)}" ${sel}>${escHtml(s.country)} (${escHtml(s.id)})</option>`;
  }).join("");
}

const AMAZON_SITES = [
  { id: "US", country: "United States" },
  { id: "ES", country: "Spain" },
  { id: "UK", country: "United Kingdom" },
  { id: "DE", country: "Germany" },
  { id: "FR", country: "France" },
  { id: "IT", country: "Italy" },
  { id: "MX", country: "Mexico" },
  { id: "BR", country: "Brazil" },
  { id: "CA", country: "Canada" },
];

function buildAmazonSiteOptions(selected) {
  const current = String(selected || "US").trim().toUpperCase();
  return AMAZON_SITES.map((s) => {
    const sel = s.id === current ? "selected" : "";
    return `<option value="${escAttr(s.id)}" ${sel}>${escHtml(s.country)} (${escHtml(s.id)})</option>`;
  }).join("");
}

const VINTED_DOMAINS = [
  { domain: "www.vinted.com",   country: "United States" },
  { domain: "www.vinted.es",    country: "Spain" },
  { domain: "www.vinted.fr",    country: "France" },
  { domain: "www.vinted.de",    country: "Germany" },
  { domain: "www.vinted.co.uk", country: "United Kingdom" },
  { domain: "www.vinted.it",    country: "Italy" },
  { domain: "www.vinted.nl",    country: "Netherlands" },
  { domain: "www.vinted.be",    country: "Belgium" },
  { domain: "www.vinted.pl",    country: "Poland" },
  { domain: "www.vinted.cz",    country: "Czechia" },
  { domain: "www.vinted.sk",    country: "Slovakia" },
  { domain: "www.vinted.at",    country: "Austria" },
  { domain: "www.vinted.pt",    country: "Portugal" },
  { domain: "www.vinted.lu",    country: "Luxembourg" },
  { domain: "www.vinted.lt",    country: "Lithuania" },
  { domain: "www.vinted.fi",    country: "Finland" },
  { domain: "www.vinted.se",    country: "Sweden" },
  { domain: "www.vinted.dk",    country: "Denmark" },
  { domain: "www.vinted.hu",    country: "Hungary" },
  { domain: "www.vinted.hr",    country: "Croatia" },
  { domain: "www.vinted.gr",    country: "Greece" },
  { domain: "www.vinted.ro",    country: "Romania" },
  { domain: "www.vinted.ie",    country: "Ireland" },
];

function buildVintedDomainOptions(selected) {
  const current = String(selected || "").trim().toLowerCase();
  const placeholder = `<option value="" ${current ? "" : "selected"}>— Select country —</option>`;
  const rows = VINTED_DOMAINS.map((d) => {
    const sel = d.domain === current ? "selected" : "";
    return `<option value="${escAttr(d.domain)}" ${sel}>${escHtml(d.country)} (${escHtml(d.domain)})</option>`;
  }).join("");
  return placeholder + rows;
}

/* ── Tab navigation ─────────────────────────────────────────────────────────── */
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTopTab(btn.dataset.tab);
  });
});

document.querySelectorAll(".car-subnav-btn").forEach((btn) => {
});

function setActiveTopTab(tab) {
  currentTopTab = tab;
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node.id === `tab-${tab}`));

  if (tab === "settings") {
    loadSharedSettings();
    return;
  }
  if (tab === "logs") {
    flushTerminal();
    return;
  }
  if (tab === "watchlist") {
    loadSharedSettings();
    renderSharedWatchlistTab();
    return;
  }
  if (tab === "found-listings") {
    loadFoundListingsDashboard();
    return;
  }
  if (tab === "analytics") {
    refreshAnalytics();
    return;
  }
  if (PLATFORM_META[tab]) {
    loadSharedFound(tab);
    renderMarketplaceTab(tab);
    flushSniperTerminal(PLATFORM_META[tab].process);
    if (tab === 'arbitrage') {
      setTimeout(initArbitrageChart, 100);
    }
    if (tab === 'anomalia') {
      loadSharedFound('anomalia');
      setTimeout(() => initArbitrageChart('anomalia'), 100);
    }
  }
}

/* ── WebSocket ──────────────────────────────────────────────────────────────── */
function connectWS() {
  const token = document.querySelector('meta[name="session-token"]')?.content || "";
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}?token=${token}`);

  ws.onopen = () => {
    document.getElementById("wsIndicator")?.classList.add("connected");
    clearTimeout(wsRetryTimer);
  };

  ws.onclose = () => {
    document.getElementById("wsIndicator")?.classList.remove("connected");
    wsRetryTimer = setTimeout(connectWS, 3000);
  };

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.type === "system-status" && msg.status === "System Halted") {
      document.querySelectorAll(".system-halted-banner").forEach(b => b.style.display = "block");
      showToast("SYSTEM HALTED - EMERGENCY STOP TRIGGERED", "err");
      return;
    }

    if (msg.type === "init") {
      processState = msg.processes || {};
      targetGroups = Array.isArray(msg.targetGroups) ? msg.targetGroups : [];
      Object.entries(msg.logs || {}).forEach(([name, entries]) => {
        entries.forEach((e) => appendLogLine(name, e.line, e.ts));
      });
      renderProcessGrid();
      renderAllMarketplaceTabs();
      renderFoundListingsTab();
      refreshStatus();
      // Ensure backend is synced with default spot mode
      switchSpotMode(currentSpotMode);
      return;
    }

    if (msg.type === "status" && processState[msg.process]) {
      processState[msg.process].running  = msg.running;
      processState[msg.process].stopping = msg.stopping || false;
      renderProcessGrid();
      renderAllMarketplaceTabs();
      renderFoundListingsTab();
      return;
    }

    if (msg.type === "crypto_opportunities") {
      renderSpotArbitrage(msg.data);
      return;
    }

    if (msg.type === "spot_radar_feed") {
      if (msg.mode === currentSpotMode) {
        handleRadarUpdate(msg.data);
      }
      return;
    }

    if (msg.type === "log") {
      appendLogLine(msg.process, msg.line, msg.ts);
      return;
    }


    if (msg.type === "shared-config-updated" || msg.type === "shared-watchlist-updated") {
      loadSharedSettings();
      return;
    }

    if (msg.type === "shared-found-updated" && PLATFORM_META[msg.platform]) {
      clearTimeout(sharedReloadTimers[msg.platform]);
      sharedReloadTimers[msg.platform] = setTimeout(() => {
        loadSharedFound(msg.platform);
        // Update chart if it's arbitrage or anomalia
        if (msg.platform === 'arbitrage') {
          // Filter latest arbitrage by profile_id
          const principal = sharedFoundDeals.arbitrage.find(d => d.profile_id === 'PRINCIPAL');
          if (principal) updateArbitrageChart(principal, 'arbitrage');

          const anomalia = sharedFoundDeals.arbitrage.find(d => d.profile_id === 'ANOMALIA');
          if (anomalia) {
             sharedFoundDeals.anomalia = sharedFoundDeals.arbitrage.filter(d => d.profile_id === 'ANOMALIA');
             updateArbitrageChart(anomalia, 'anomalia');
             renderMarketplaceTab('anomalia');
          }
        }
      }, 250);
    }
  };
}

/* ── Log terminal ───────────────────────────────────────────────────────────── */
function appendLogLine(procName, line, ts) {
  if (!terminalBuffers[procName]) terminalBuffers[procName] = [];
  const div = document.createElement("div");
  div.className = "log-line";

  const time = document.createElement("span");
  time.className = "log-ts";
  time.textContent = new Date(ts).toLocaleTimeString();

  const text = document.createElement("span");
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
  if (/\[err\]|error/i.test(line)) text.className = "log-err";
  else if (/^\s*[✓▶?]/.test(line) || /\bBUY NOW\b/.test(line)) text.className = "log-ok";
  text.textContent = clean;

  div.appendChild(time);
  div.appendChild(text);
  terminalBuffers[procName].push(div);
  if (terminalBuffers[procName].length > 1000) terminalBuffers[procName].shift();
  if (procName === currentLogProcess) flushTerminal();
  flushSniperTerminal(procName);
}

function flushTerminal() {
  const terminal = document.getElementById("terminal");
  if (!terminal) return;
  terminal.innerHTML = "";
  (terminalBuffers[currentLogProcess] || []).forEach((node) => terminal.appendChild(node.cloneNode(true)));
  if (document.getElementById("autoScroll")?.checked) terminal.scrollTop = terminal.scrollHeight;
}

function flushSniperTerminal(procName) {
  const platform = Object.keys(PLATFORM_META).find((p) => PLATFORM_META[p].process === procName);
  if (!platform) return;
  const terminal = document.getElementById(`sniper-terminal-${platform}`);
  if (!terminal) return;
  terminal.innerHTML = "";
  (terminalBuffers[procName] || []).forEach((node) => terminal.appendChild(node.cloneNode(true)));
  if (document.getElementById(`sniperAutoScroll-${platform}`)?.checked) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

function clearLog() {
  terminalBuffers[currentLogProcess] = [];
  flushTerminal();
}

document.getElementById("logProcess")?.addEventListener("change", (e) => {
  currentLogProcess = e.target.value;
  flushTerminal();
});

/* ── Process grid ───────────────────────────────────────────────────────────── */
function renderProcessGrid() {
  // Cars process grid removed
}

/* ── Status ─────────────────────────────────────────────────────────────────── */
async function refreshStatus() {
  try {
    const data = await fetch("/api/status").then((r) => r.json());
    processState = data.processes || {};
    renderProcessGrid();
    renderAllMarketplaceTabs();
  } catch {}
}

async function startProcess(name) {
  await startNamedProcess(name);
}

async function stopProcess(name) {
  await stopNamedProcess(name);
}

async function startNamedProcess(name) {
  const res = await fetch(`/api/process/${name}/start`, { method: "POST" });
  if (res.ok && processState[name]) {
    processState[name].running = true;
    processState[name].stopping = false;
    renderProcessGrid();
    renderAllMarketplaceTabs();
  }
  refreshStatus();
}

async function stopNamedProcess(name) {
  const res = await fetch(`/api/process/${name}/stop`, { method: "POST" });
  if (res.ok && processState[name]) {
    processState[name].running = true;
    processState[name].stopping = true;
    renderProcessGrid();
    renderAllMarketplaceTabs();
  }
  refreshStatus();
}

function goToLogs(name) {
  setActiveTopTab("logs");
  const sel = document.getElementById("logProcess");
  if (sel) sel.value = name;
  currentLogProcess = name;
  flushTerminal();
}

/* ── Shared marketplace tabs ───────────────────────────────────────────────── */
function normalizeSharedConfig(config = {}) {
  return {
    ...DEFAULT_SHARED_CONFIG,
    ...(config && typeof config === "object" ? config : {}),
    location: {
      ...DEFAULT_SHARED_CONFIG.location,
      ...((config && config.location) || {}),
    },
    notifications: {
      ...DEFAULT_SHARED_CONFIG.notifications,
      ...((config && config.notifications) || {}),

    },
    filters: {
      ...DEFAULT_SHARED_CONFIG.filters,
      ...((config && config.filters) || {}),
    },
    bots: {
      facebook: {
        ...DEFAULT_SHARED_CONFIG.bots.facebook,
        ...(((config && config.bots) || {}).facebook || {}),
      },
      vinted: {
        ...DEFAULT_SHARED_CONFIG.bots.vinted,
        ...(((config && config.bots) || {}).vinted || {}),
      },
      mercadolibre: {
        ...DEFAULT_SHARED_CONFIG.bots.mercadolibre,
        ...(((config && config.bots) || {}).mercadolibre || {}),
      },
      amazon: {
        ...DEFAULT_SHARED_CONFIG.bots.amazon,
        ...(((config && config.bots) || {}).amazon || {}),
      },
      arbitrage: {
        ...DEFAULT_SHARED_CONFIG.bots.arbitrage,
        ...(((config && config.bots) || {}).arbitrage || {}),
      },
      anomalia: {
        ...DEFAULT_SHARED_CONFIG.bots.anomalia,
        ...(((config && config.bots) || {}).anomalia || {}),
      },
    },
  };
}

function sharedConfigHasLocation(config = sharedConfig) {
  const loc = config && config.location;
  if (!loc) return false;
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return true;
}

function sharedConfigNeedsLocationReview(config = sharedConfig) {
  if (!sharedConfigHasLocation(config)) return true;
  return config?.location?.confirmed !== true;
}

function updateLocationBanner() {
  const banner = document.getElementById("locationBanner");
  if (!banner) return;
  banner.hidden = !sharedConfigNeedsLocationReview();
}

function openLocationSettings() {
  setActiveTopTab("settings");
  window.setTimeout(() => {
    const input = document.getElementById("sharedLatitude");
    if (input) {
      input.scrollIntoView({ behavior: "smooth", block: "center" });
      input.focus();
    }
  }, 120);
}

async function loadSharedSettings() {
  try {
    const data = await fetchJson("/api/shared/settings");
    sharedConfig = normalizeSharedConfig(data.config || {});
    sharedWatchlist = Array.isArray(data.watchlist) ? data.watchlist : [];
    sharedGroups = Array.isArray(data.groups) ? data.groups : buildSharedGroups(sharedWatchlist);
    updateLocationBanner();
    renderAllMarketplaceTabs();
    if (sharedSettingsDirty) {
      if (currentTopTab === "settings") {
        setSharedSettingsStatus("Detected newer shared settings on disk. Your unsaved edits were kept; use Reload to refresh.", "");
      }
      return;
    }
    renderSharedSettings();
    sharedSettingsDirty = false;
  } catch (err) {
    setSharedSettingsStatus(`Failed to load shared settings: ${err.message}`, "err");
  }
}

async function loadSharedFound(platform) {
  if (!PLATFORM_META[platform]) return;
  try {
    const apiPlatform = platform === 'anomalia' ? 'arbitrage' : platform;
    let deals = await fetch(`/api/shared/found/${apiPlatform}`).then((response) => response.json());

    if (platform === 'arbitrage') {
      sharedFoundDeals.arbitrage = deals.filter(d => d.profile_id === 'PRINCIPAL' || !d.profile_id);
    } else if (platform === 'anomalia') {
      sharedFoundDeals.anomalia = deals.filter(d => d.profile_id === 'ANOMALIA');
    } else {
      sharedFoundDeals[platform] = deals;
    }

    foundListingsLoaded[platform] = true;
    renderMarketplaceTab(platform);
  } catch {
    sharedFoundDeals[platform] = [];
    foundListingsLoaded[platform] = true;
    renderMarketplaceTab(platform);
  }
  renderFoundListingsTab();
}

function persistFoundListingsColumnVisibility() {
  try {
    localStorage.setItem(FOUND_LISTINGS_STORAGE_KEY, JSON.stringify(foundListingsColumnVisibility));
  } catch {
    // localStorage can be unavailable in some embedded contexts.
  }
}

function getFoundListingsColumns() {
  return FOUND_LISTINGS_META
    .filter((column) => foundListingsColumnVisibility[column.id] !== false)
    .map((column) => {
      const deals = Array.isArray(sharedFoundDeals[column.id]) ? sharedFoundDeals[column.id] : [];
      const process = processState[column.process] || { running: false, stopping: false };
      const loaded = typeof foundListingsLoaded === "object" && Object.prototype.hasOwnProperty.call(foundListingsLoaded, column.id)
        ? Boolean(foundListingsLoaded[column.id])
        : true;
      return {
        ...column,
        deals,
        count: deals.length,
        process,
        loaded,
      };
    });
}

function loadFoundListingsDashboard() {
  renderFoundListingsTab();
  Object.keys(PLATFORM_META).forEach((platform) => loadSharedFound(platform));
}

function toggleFoundListingsColumn(columnId) {
  const willEnable = foundListingsColumnVisibility[columnId] === false;
  foundListingsColumnVisibility = {
    ...foundListingsColumnVisibility,
    [columnId]: willEnable,
  };
  persistFoundListingsColumnVisibility();
  renderFoundListingsTab();
  const label = FOUND_LISTINGS_META.find((column) => column.id === columnId)?.label || "Column";
  showToast(`${label} column ${willEnable ? "shown" : "hidden"}.`);
}

const foundListingsFilters = {
  search: "",
  platform: "all",
  grade: "all",
};

function collectFoundListingsDeals() {
  const all = [];
  FOUND_LISTINGS_META.forEach((column) => {
    if (foundListingsColumnVisibility[column.id] === false) return;
    const deals = Array.isArray(sharedFoundDeals[column.id]) ? sharedFoundDeals[column.id] : [];
    deals.forEach((deal) => all.push({ platform: column.id, deal }));
  });
  return all;
}

function dealMatchesFoundListingsFilters({ platform, deal }) {
  if (foundListingsFilters.platform !== "all" && foundListingsFilters.platform !== platform) return false;
  if (foundListingsFilters.grade !== "all") {
    const { tier } = classifyDealTier(deal, deal?.grade);
    if (foundListingsFilters.grade === "good" && tier !== "good") return false;
    if (foundListingsFilters.grade === "okay" && tier !== "good" && tier !== "okay") return false;
  }
  const search = foundListingsFilters.search.trim().toLowerCase();
  if (search) {
    const title = String(
      deal?.title
        || deal?.listing?.title
        || deal?.item?.title
        || deal?.model
        || ""
    ).toLowerCase();
    if (!title.includes(search)) return false;
  }
  return true;
}

function dealTimestampValue(deal) {
  const raw = deal?.timestamp
    || deal?.created_at
    || deal?.createdAt
    || deal?.item?.created_at
    || deal?.listing?.created_at;
  if (!raw) return 0;
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return num < 1e12 ? num * 1000 : num;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function renderFoundListingsTab() {
  const toggleBar = document.getElementById("foundListingsColumnToggles");
  const grid = document.getElementById("foundListingsGrid");
  if (!toggleBar || !grid) return;

  toggleBar.innerHTML = FOUND_LISTINGS_META.map((column) => {
    const active = foundListingsColumnVisibility[column.id] !== false;
    const count = Array.isArray(sharedFoundDeals[column.id]) ? sharedFoundDeals[column.id].length : 0;
    return `
      <button class="chip-btn found-column-chip ${active ? "active" : ""}" onclick="toggleFoundListingsColumn('${column.id}')">
        ${escHtml(column.label)} <strong>${count}</strong>
      </button>
    `;
  }).join("");

  wireFoundListingsFilterInputs();

  const anyColumnVisible = FOUND_LISTINGS_META.some((column) => foundListingsColumnVisibility[column.id] !== false);
  if (!anyColumnVisible) {
    grid.innerHTML = '<div class="sniper-empty found-board-empty">Enable at least one platform chip to see listings.</div>';
    return;
  }

  const deals = collectFoundListingsDeals()
    .filter(dealMatchesFoundListingsFilters)
    .sort((a, b) => dealTimestampValue(b.deal) - dealTimestampValue(a.deal));

  if (!deals.length) {
    grid.innerHTML = '<div class="sniper-empty found-board-empty">No listings match your filters yet.</div>';
    return;
  }

  grid.innerHTML = deals.slice(0, 120).map(({ platform, deal }) => {
    return buildSharedDealCard(platform, deal);
  }).join("");
}

function wireFoundListingsFilterInputs() {
  const searchEl = document.getElementById("foundListingsSearch");
  if (searchEl && !searchEl.dataset.wired) {
    searchEl.value = foundListingsFilters.search;
    searchEl.addEventListener("input", () => {
      foundListingsFilters.search = searchEl.value;
      renderFoundListingsTab();
    });
    searchEl.dataset.wired = "1";
  }
  const platformEl = document.getElementById("foundListingsPlatformFilter");
  if (platformEl && !platformEl.dataset.wired) {
    platformEl.value = foundListingsFilters.platform;
    platformEl.addEventListener("change", () => {
      foundListingsFilters.platform = platformEl.value;
      renderFoundListingsTab();
    });
    platformEl.dataset.wired = "1";
  }
  const gradeEl = document.getElementById("foundListingsGradeFilter");
  if (gradeEl && !gradeEl.dataset.wired) {
    gradeEl.value = foundListingsFilters.grade;
    gradeEl.addEventListener("change", () => {
      foundListingsFilters.grade = gradeEl.value;
      renderFoundListingsTab();
    });
    gradeEl.dataset.wired = "1";
  }
}

function renderAllMarketplaceTabs() {
  Object.keys(PLATFORM_META).forEach((platform) => renderMarketplaceTab(platform));
  renderSharedWatchlistTab();
  updateSpotArbitrageStatus();
  initRadarChart();
  renderSpotTableHead();
}

function toggleMute() {
  radarMuted = !radarMuted;
  const btn = document.getElementById('radarMuteBtn');
  if (btn) {
    btn.innerHTML = radarMuted ? '🔇 Muted' : '🔊 Unmuted';
    btn.classList.toggle('btn-danger', radarMuted);
    btn.classList.toggle('btn-secondary', !radarMuted);
  }
}

function toggleNoiseFilter(enabled) {
  const container = document.getElementById('radarThresholdContainer');
  if (container) container.style.display = enabled ? 'flex' : 'none';
}

function playRadarChime() {
  if (radarMuted) return;
  radarChime.currentTime = 0;
  radarChime.play().catch(() => {
    // Browser might block audio until first interaction
  });
}

function updateSpotArbitrageStatus() {
  const container = document.getElementById('spotArbitrageProcess');
  if (!container) return;
  const state = processState['spot-arbitrage'];
  if (!state) return;

  const pill = container.querySelector('.status-pill');
  const startBtn = container.querySelector('.start-btn');
  const stopBtn = container.querySelector('.stop-btn');

  if (state.running) {
    pill.textContent = state.stopping ? 'STOPPING...' : 'RUNNING';
    pill.className = 'status-pill status-running';
    startBtn.disabled = true;
    stopBtn.disabled = state.stopping;
  } else {
    pill.textContent = 'STOPPED';
    pill.className = 'status-pill status-stopped';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

function renderSpotArbitrage(data) {
  const tbody = document.getElementById('spotOpportunitiesTable');
  if (!tbody) return;

  // Filter by Noise Threshold
  const noiseEnabled = document.getElementById('radarNoiseFilter')?.checked;
  const minProfit = parseFloat(document.getElementById('radarMinProfit')?.value || 0);

  let filteredData = data || [];
  if (noiseEnabled && !isNaN(minProfit)) {
    filteredData = filteredData.filter(opp => {
      const roi = currentSpotMode === 'spatial' ? opp.netSpread : opp.netROI;
      return roi >= minProfit;
    });
  }

  if (filteredData.length > 0 && data && data.length > 0) {
    // Check if the best ROI is above threshold and higher than previous best to avoid spam
    const bestROI = currentSpotMode === 'spatial' ? filteredData[0].netSpread : filteredData[0].netROI;
    if (bestROI >= minProfit) {
      playRadarChime();
    }
  }

  if (!filteredData || filteredData.length === 0) {
    const cols = currentSpotMode === 'spatial' ? 7 : 7;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="text-center text-dim">No opportunities match filters. Scanning...</td></tr>`;
    return;
  }

  if (currentSpotMode === 'spatial') {
    tbody.innerHTML = filteredData.map(opp => `
      <tr>
        <td><span class="symbol-pill">${opp.symbol}</span></td>
        <td>
          <div class="route-display">
            <span class="exchange-name">${opp.buyExchange}</span>
            <span class="arrow">→</span>
            <span class="exchange-name">${opp.sellExchange}</span>
          </div>
        </td>
        <td>
          <div class="price-copy-group">
            <span class="price-val">${opp.buyPrice.toFixed(4)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${opp.buyPrice}', this)" title="Copy Buy Price">📋</button>
          </div>
        </td>
        <td>
          <div class="price-copy-group">
            <span class="price-val">${opp.sellPrice.toFixed(4)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${opp.sellPrice}', this)" title="Copy Sell Price">📋</button>
          </div>
        </td>
        <td>
          <div class="price-copy-group">
            <span class="price-val">${opp.volume.toFixed(4)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${opp.volume}', this)" title="Copy Volume">📋</button>
          </div>
        </td>
        <td><span class="roi-pill ${opp.netSpread > 0 ? 'roi-positive' : ''}">${opp.netSpread.toFixed(2)}%</span></td>
        <td>
          <div class="action-btns">
            <a href="${opp.buyUrl}" target="_blank" class="btn btn-xs btn-execute">Buy</a>
            <a href="${opp.sellUrl}" target="_blank" class="btn btn-xs btn-journal">Sell</a>
          </div>
        </td>
      </tr>
    `).join('');
  } else {
    // Triangular
    tbody.innerHTML = filteredData.map(opp => `
      <tr>
        <td><span class="symbol-pill">${opp.exchange}</span></td>
        <td><span class="route-val">${opp.route}</span></td>
        <td>
          <div class="price-copy-group">
            <span class="price-val">${opp.step1.toFixed(4)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${opp.step1}', this)">📋</button>
          </div>
        </td>
        <td>
          <div class="price-copy-group">
            <span class="price-val">${opp.step2.toFixed(4)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${opp.step2}', this)">📋</button>
          </div>
        </td>
        <td>
          <div class="price-copy-group">
            <span class="price-val">${opp.step3.toFixed(4)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${opp.step3}', this)">📋</button>
          </div>
        </td>
        <td><span class="roi-pill roi-positive">${opp.netROI.toFixed(2)}%</span></td>
        <td>
          <div class="action-btns">
            <a href="${opp.actions[0]}" target="_blank" class="btn btn-xs btn-primary">Trade</a>
          </div>
        </td>
      </tr>
    `).join('');
  }
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const originalText = btn.textContent;
    btn.textContent = '✔️';
    btn.classList.add('copy-success');
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('copy-success');
    }, 1000);
  } catch (err) {
    showToast("Failed to copy", "err");
  }
}


/**
 * TradingView Advanced Widget Fallback
 * Injects the official TV script and replaces the container with a full-featured widget.
 */
function triggerTradingViewFallback(containerId, symbol = "BINANCE:BTCUSDT") {
  console.log(`[UI] Triggering TradingView Advanced Fallback for ${containerId} (${symbol})`);
  const container = document.getElementById(containerId);
  if (!container) return;

  // Clear container
  container.innerHTML = '<div class="loading-tv">Initializing Advanced Engine...</div>';

  const script = document.createElement('script');
  script.src = 'https://s3.tradingview.com/tv.js';
  script.async = true;
  script.onload = () => {
    if (typeof TradingView !== 'undefined') {
      new TradingView.widget({
        "autosize": true,
        "symbol": symbol,
        "interval": "D",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "toolbar_bg": "#f1f3f6",
        "enable_publishing": false,
        "allow_symbol_change": true,
        "container_id": containerId
      });
    }
  };
  document.head.appendChild(script);
}

function initRadarChart() {
  const container = document.getElementById('spot-radar-chart');
  if (!container || radarChart) return;

  try {
    radarChart = LightweightCharts.createChart(container, {
    width: container.clientWidth,
    height: 400,
    layout: {
      backgroundColor: '#131722',
      textColor: '#d1d4dc',
    },
    grid: {
      vertLines: { color: '#242a3a' },
      horzLines: { color: '#242a3a' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    timeScale: {
      timeVisible: true,
      secondsVisible: true,
    },
  });
  } catch (err) {
    console.error("Lightweight Charts failed to initialize:", err);
    triggerTradingViewFallback(containerId, "BINANCE:BTCUSDT");
  }

  radarAskSeries = radarChart.addLineSeries({
    color: '#4f7ef8',
    lineWidth: 2,
    title: 'Buy Ask',
  });

  radarBidSeries = radarChart.addLineSeries({
    color: '#2ecf7a',
    lineWidth: 2,
    title: 'Sell Bid',
  });

  new ResizeObserver(entries => {
    if (entries.length === 0 || !entries[0].contentRect) return;
    radarChart.applyOptions({ width: entries[0].contentRect.width });
  }).observe(container);
}

function handleRadarUpdate(data) {
  if (!data) return;

  // 1. Update Chart (Spatial only)
  if (currentSpotMode === 'spatial') {
    const timestamp = Math.floor(data.timestamp / 1000);
    const askPrice = data.prices.kraken?.ask || data.prices.binance?.ask;
    const bidPrice = data.prices.coinbase?.bid || data.prices.bybit?.bid;

    if (radarAskSeries && askPrice) {
      radarAskSeries.update({ time: timestamp, value: askPrice });
    }
    if (radarBidSeries && bidPrice) {
      radarBidSeries.update({ time: timestamp, value: bidPrice });
    }
  }

  // 2. Update Table
  renderSpotArbitrage(data.opportunities);
}

function switchSpotMode(mode) {
  currentSpotMode = mode;

  // UI Updates
  document.querySelectorAll('[data-spot-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.spotMode === mode);
  });

  document.getElementById('spatial-chart-wrapper').style.display = (mode === 'spatial') ? 'block' : 'none';

  renderSpotTableHead();

  // Clear table
  document.getElementById('spotOpportunitiesTable').innerHTML = `<tr><td colspan="7" class="text-center text-dim">Switching modes...</td></tr>`;

  // Backend Update
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ command: "SUBSCRIBE_MODE", mode, provider: currentFeedProvider }));
  }
}

function switchFeedProvider(provider) {
  currentFeedProvider = provider;

  // Clear table
  document.getElementById('spotOpportunitiesTable').innerHTML = `<tr><td colspan="7" class="text-center text-dim">Switching providers...</td></tr>`;

  // Update chart titles if needed
  const chartTitle = document.getElementById('radarChartTitle');
  if (chartTitle) {
    if (provider === 'binance-bybit') {
      chartTitle.textContent = 'Real-Time Spread Gap (Ask Binance vs Bid Bybit)';
    } else {
      chartTitle.textContent = 'Real-Time Spread Gap (Ask Kraken vs Bid Coinbase)';
    }
  }

  // Backend Update
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ command: "SUBSCRIBE_MODE", mode: currentSpotMode, provider }));
  }
}

async function refreshAnalytics() {
  try {
    const history = await fetch("/api/analytics/history").then(r => r.json());
    const stats = await fetch("/api/analytics/stats").then(r => r.json());

    renderHeatmap(history);
    renderAnalyticsStats(stats);
  } catch (err) {
    console.error("Failed to refresh analytics:", err);
  }
}

function renderHeatmap(data) {
  const container = document.getElementById('analytics-heatmap');
  if (!container) return;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const series = days.map((day, dayIdx) => {
    const dayData = Array.from({ length: 24 }, (_, hour) => {
      const entry = data.find(d => d.day === dayIdx && d.hour === hour);
      return { x: `${hour}:00`, y: entry ? entry.count : 0 };
    });
    return { name: day, data: dayData };
  });

  const options = {
    series: series,
    chart: { height: 350, type: 'heatmap', toolbar: { show: false } },
    dataLabels: { enabled: false },
    colors: ["#4f7ef8"],
    plotOptions: {
      heatmap: {
        shadeIntensity: 0.5,
        radius: 0,
        useFillColorAsStroke: true,
        colorScale: {
          ranges: [
            { from: 0, to: 0, color: '#131722', name: 'None' },
            { from: 1, to: 5, color: '#1e3a8a', name: 'Low' },
            { from: 6, to: 15, color: '#3b82f6', name: 'Medium' },
            { from: 16, to: 1000, color: '#60a5fa', name: 'High' }
          ]
        }
      }
    },
    theme: { mode: 'dark' },
    xaxis: { type: 'category' }
  };

  if (analyticsHeatmap) {
    analyticsHeatmap.updateOptions(options);
  } else {
    analyticsHeatmap = new ApexCharts(container, options);
    analyticsHeatmap.render();
  }
}

function renderAnalyticsStats(stats) {
  const tbody = document.getElementById('analyticsStatsTable');
  if (!tbody) return;

  if (!stats || stats.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-dim">Gathering intelligence... No profitable patterns detected yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = stats.map(s => {
    // Basic probability score based on volume and spread
    const prob = Math.min(100, (s.total_opps * s.avg_spread * 10)).toFixed(0);
    return `
      <tr>
        <td><span class="symbol-pill">${s.pair}</span></td>
        <td><strong>${s.total_opps}</strong></td>
        <td><span class="roi-pill roi-positive">${s.avg_spread.toFixed(2)}%</span></td>
        <td><span class="badge badge-running">${s.peak_hour}:00</span></td>
        <td>
          <div class="ranking-bar-bg" style="width: 100px;">
            <div class="ranking-bar-fill" style="width: ${prob}%"></div>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function renderSpotTableHead() {
  const head = document.getElementById('spot-table-head');
  if (!head) return;

  if (currentSpotMode === 'spatial') {
    head.innerHTML = `
      <tr>
        <th>Symbol</th>
        <th>Route (Buy → Sell)</th>
        <th>Buy Price</th>
        <th>Sell Price</th>
        <th>Max Vol</th>
        <th>Net ROI</th>
        <th>Actions</th>
      </tr>
    `;
  } else {
    head.innerHTML = `
      <tr>
        <th>Exchange</th>
        <th>Route (A → B → C)</th>
        <th>Step 1</th>
        <th>Step 2</th>
        <th>Step 3</th>
        <th>Net ROI</th>
        <th>Actions</th>
      </tr>
    `;
  }
}

function initArbitrageChart(platform = 'arbitrage') {
  const containerId = `${platform}-chart-container`;
  const container = document.getElementById(containerId);
  if (!container) return;

  if (platform === 'arbitrage' && arbitrageChart) return;
  if (platform === 'anomalia' && anomaliaChart) return;

  let chart;
  try {
    chart = LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: 300,
      layout: {
        backgroundColor: '#1e222d',
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#334158' },
        horzLines: { color: '#334158' },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
      },
    });
  } catch (err) {
    console.error("Arbitrage chart failed:", err);
    triggerTradingViewFallback(containerId, "CURRENCYCOM:USDTCOP");
    return;
  }

  const colors = ['#2196f3', '#ff9800', '#4caf50', '#f44336', '#9c27b0'];

  const spreadSeries = {};

  let destinations = (sharedConfig.filters?.arbitrageDestinations || 'ARS,VES,MXN,BRL').split(',');
  if (platform === 'anomalia') destinations = ['COP'];

  destinations.forEach((fiat, i) => {
    spreadSeries[fiat] = chart.addLineSeries({
      color: colors[i % colors.length],
      lineWidth: 2,
      title: `${fiat} ROI%`,
    });
  });

  const volumeSeries = chart.addHistogramSeries({
    color: '#26a69a',
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    title: 'Volume (USDT)',
  });

  volumeSeries.priceScale().applyOptions({
    scaleMargins: {
      top: 0.8,
      bottom: 0,
    },
  });

  if (platform === 'arbitrage') {
    arbitrageChart = chart;
    arbitrageSpreadSeries = spreadSeries;
    arbitrageVolumeSeries = volumeSeries;
  } else {
    anomaliaChart = chart;
    anomaliaSpreadSeries = spreadSeries;
    anomaliaVolumeSeries = volumeSeries;
  }

  window.addEventListener('resize', () => {
    chart.resize(container.clientWidth, 300);
  });
}

function updateArbitrageChart(deal, platform = 'arbitrage') {
  const chartSpreadSeries = platform === 'arbitrage' ? arbitrageSpreadSeries : anomaliaSpreadSeries;
  const chartVolumeSeries = platform === 'arbitrage' ? arbitrageVolumeSeries : anomaliaVolumeSeries;

  if (!chartVolumeSeries) return;
  const time = Math.floor(new Date(deal.timestamp).getTime() / 1000);

  if (deal.all_results) {
    deal.all_results.forEach(res => {
      if (chartSpreadSeries[res.fiat]) {
        chartSpreadSeries[res.fiat].update({
          time,
          value: res.roi
        });
      }
    });

    // Update Top Summary
    const sorted = [...deal.all_results].sort((a,b) => b.roi - a.roi);
    const best = sorted[0];
    const summary = document.getElementById(`${platform}-best-summary`);
    if (summary) {
      summary.innerHTML = `
        <div class="stat-card" style="background: var(--bg-surface); border-left: 4px solid var(--accent); display: flex; justify-content: space-between; align-items: center; padding: 1rem;">
          <div>
            <div class="stat-label">Best Global Spread</div>
            <div class="stat-value" style="color: var(--accent);">${best.roi.toFixed(2)}%</div>
          </div>
          <div style="text-align: center">
            <div class="stat-label">Top Route</div>
            <div class="stat-value" style="font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem; justify-content: center;">
              <span class="exchange-badge exchange-badge-buy">${best.source_exchange || 'binance'}</span>
              <span style="opacity: 0.5">→</span>
              <span class="exchange-badge exchange-badge-sell">${best.destination_exchange || 'binance'}</span>
            </div>
          </div>
          <div style="text-align: right">
            <div class="stat-label">Currency Path</div>
            <div class="stat-value" style="font-size: 1.2rem;">${best.fiat_origin || 'Origin'} → ${best.fiat}</div>
          </div>
          <div>
            <div class="stat-label">Tradable Volume</div>
            <div class="stat-value">${formatNumber(best.volume)} USDT</div>
          </div>
          <div>
            <button class="btn btn-primary btn-sm" onclick="openInBrowser('https://p2p.binance.com/')">Trade Now</button>
          </div>
        </div>
      `;
    }

    // Update Top 5 Ranking
    const rankingContainer = document.getElementById(`${platform}-ranking-container`);
    if (rankingContainer) {
      const top5 = sorted.slice(0, 5);
      const maxRoi = Math.max(...top5.map(r => r.roi), 1);

      rankingContainer.innerHTML = top5.map(r => `
        <div class="arbitrage-ranking-item">
          <div class="ranking-item-top">
            <div class="ranking-route">
              <span class="exchange-badge exchange-badge-buy">${r.source_exchange}</span>
              <span style="opacity: 0.5; margin: 0 0.2rem">→</span>
              <span class="exchange-badge exchange-badge-sell">${r.destination_exchange}</span>
              <span style="margin-left: 0.5rem; opacity: 0.8">${r.fiat_origin || 'Origin'} → ${r.fiat}</span>
            </div>
            <div class="ranking-roi">${r.roi.toFixed(2)}%</div>
          </div>
          <div class="ranking-bar-bg">
            <div class="ranking-bar-fill" style="width: ${(r.roi / maxRoi * 100).toFixed(0)}%"></div>
          </div>
        </div>
      `).join('');
    }
  }

  chartVolumeSeries.update({
    time,
    value: deal.volume || 0,
  });
}

function renderMarketplaceTab(platform) {
  const mount = document.getElementById(`${platform}Panel`);
  if (!mount) return;

  loadToolsConfig();

  const meta = PLATFORM_META[platform];
  const info = processState[meta.process] || { running: false, stopping: false, label: `${meta.label} Sniper` };
  const botConfig = normalizeSharedConfig(sharedConfig).bots[platform];
  const allDeals = Array.isArray(sharedFoundDeals[platform]) ? sharedFoundDeals[platform] : [];
  const gradeCounts = countDealsByGrade(allDeals);
  const activeGrades = sharedGradeFilter[platform] instanceof Set ? sharedGradeFilter[platform] : new Set();

  let deals = activeGrades.size === 0
    ? allDeals
    : allDeals.filter((d) => activeGrades.has(String(d?.grade || "").toUpperCase()));

  if (platform === 'arbitrage' || platform === 'anomalia') {
    const minROIInput = document.getElementById(`arbitrage-min-roi-${platform}`);
    const minROI = minROIInput ? parseFloat(minROIInput.value) : -100;
    deals = deals.filter(d => (d.roi || 0) >= minROI);
  }
  const enabledTargets = sharedWatchlist.filter((target) => target.enabled !== false && targetAppliesToPlatform(target, platform)).length;
  const badgeClass = info.running ? (info.stopping ? "badge-stopping" : "badge-running") : "badge-stopped";
  const badgeText = info.running ? (info.stopping ? "Stopping" : "Running") : "Stopped";
  const proxyCount = Array.isArray(sharedConfig.proxyPool) ? sharedConfig.proxyPool.length : 0;
  const proxyBadgeClass = proxyCount ? "sniper-proxy-ok" : "sniper-proxy-none";
  const proxyBadgeText = proxyCount ? `${proxyCount} proxy${proxyCount === 1 ? "" : "ies"}` : "No proxies";

  const onboarding = buildOnboardingHtml(platform);
  const isMarketplace = ["facebook", "vinted", "mercadolibre", "amazon"].includes(platform);

  mount.innerHTML = `
    <div class="sniper-shell">
      ${onboarding}
      <div class="sniper-top">
        ${isMarketplace ? `
          <div class="quick-target-box" style="margin-bottom: 1.5rem; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 1.25rem;">
            <h4 style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">🎯 Quick Target Monitor</h4>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
              <div class="field-group">
                <label style="display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 0.4rem;">Label (Identifier)</label>
                <input type="text" id="quick-target-input-${platform}" class="quick-input" placeholder="iPhone 15 Pro..." style="width: 100%">
              </div>
              <div class="field-group">
                <label style="display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 0.4rem;">Search Query (Optional)</label>
                <input type="text" id="quick-target-query-${platform}" class="quick-input" placeholder="Leave empty for Label..." style="width: 100%">
              </div>
              <div class="field-group">
                <label style="display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 0.4rem;">Price Range (Min - Max)</label>
                <div style="display: flex; gap: 0.5rem;">
                  <input type="number" id="quick-target-minPrice-${platform}" class="quick-input" placeholder="Min" style="width: 50%">
                  <input type="number" id="quick-target-maxPrice-${platform}" class="quick-input" placeholder="Max" style="width: 50%">
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 1rem; align-items: flex-end; flex-wrap: wrap;">
              <div class="field-group" style="flex: 1; min-width: 250px;">
                <label style="display: block; font-size: 0.75rem; color: var(--muted); margin-bottom: 0.4rem;">Must Include Keywords (comma separated)</label>
                <input type="text" id="quick-target-mustInclude-${platform}" class="quick-input" placeholder="256gb, blue, unlocked..." style="width: 100%">
              </div>
              <div class="field-group" style="padding-bottom: 0.5rem;">
                <label class="control control-checkbox" style="font-size: 0.85rem; margin: 0;">
                  Allow Shipping
                  <input type="checkbox" id="quick-target-shipping-${platform}" checked>
                  <div class="control_indicator"></div>
                </label>
              </div>
              <button class="btn btn-primary" style="height: 38px; padding: 0 1.5rem;" onclick="addQuickTarget('${platform}')">+ Activate Target</button>
            </div>
          </div>
        ` : ''}
        <div class="sniper-control">
          <div>
            <div class="process-name">${escHtml(meta.label)} Sniper</div>
            <div class="process-desc">${escHtml(meta.description)}</div>
          </div>
          <div class="sniper-control-actions">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <button class="btn btn-start" ${info.running ? "disabled" : ""} onclick="startNamedProcess('${meta.process}')">Start</button>
            <button class="btn btn-stop" ${!info.running || info.stopping ? "disabled" : ""} onclick="stopNamedProcess('${meta.process}')">Stop</button>
          </div>
        </div>
        <div class="sniper-settings-strip">
          <div class="sniper-setting-item">
            <label for="sniper-${platform}-poll">Poll every</label>
            <input type="number" id="sniper-${platform}-poll" min="5" max="600" step="1" value="${formatNumber(botConfig.pollIntervalSec || 60)}" />
            <span class="sniper-setting-unit">s</span>
          </div>
          ${platform === "vinted" ? buildVintedExtraSettings(botConfig) : ""}
          ${platform === "mercadolibre" ? buildMercadoLibreExtraSettings(botConfig) : ""}
          ${platform === "amazon" ? buildAmazonExtraSettings(botConfig) : ""}
          <div class="sniper-setting-item">
            <button class="btn btn-secondary btn-sm" onclick="applyBotSettings('${platform}')">Apply</button>
            <span class="sniper-setting-hint">Takes effect on next Start</span>
          </div>
          <div class="sniper-setting-item sniper-setting-meta">
            <span class="sniper-proxy-badge ${proxyBadgeClass}">${proxyBadgeText}</span>
            <span class="sniper-proxy-badge sniper-proxy-info">${enabledTargets} target${enabledTargets === 1 ? "" : "s"}</span>
          </div>
        </div>
      </div>

      <div class="sniper-body">
        ${(platform === 'arbitrage' || platform === 'anomalia') ? `
          <div class="tools-panel" style="flex-wrap: wrap; height: auto; gap: 1rem;">
            <button class="btn btn-secondary btn-sm" onclick="triggerTradingViewFallback('${platform}-chart-container', 'CURRENCYCOM:USDTCOP')" style="position: absolute; right: 2rem; top: 1rem;">Chart Fallback</button>
            <div class="tool-group" style="background: rgba(0,0,0,0.2); padding: 0.5rem 1rem; border-radius: 6px;">
              <span class="tool-label">Capital (USD)</span>
              <input type="number" id="arbitrage-capital-${platform}" class="quick-input" style="width: 100px;" value="1000" onchange="renderMarketplaceTab('${platform}')">
            </div>
            <div class="tool-group" style="background: rgba(0,0,0,0.2); padding: 0.5rem 1rem; border-radius: 6px;">
              <span class="tool-label">Min ROI %</span>
              <input type="number" id="arbitrage-min-roi-${platform}" class="quick-input" style="width: 80px;" value="0.5" onchange="renderMarketplaceTab('${platform}')">
            </div>
            <div class="tool-group">
              <span class="tool-label">Enable Deep Links</span>
              <label class="switch">
                <input type="checkbox" class="toggle-deep-links" onchange="toggleTool('deepLinks', this.checked)" ${toolsConfig.deepLinks ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <div class="tool-group">
              <span class="tool-label">Enable Trade Journal</span>
              <label class="switch">
                <input type="checkbox" class="toggle-trade-journal" onchange="toggleTool('tradeJournal', this.checked)" ${toolsConfig.tradeJournal ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
            </div>
            <button class="btn btn-emergency" onclick="triggerEmergencyHalt()">EMERGENCY STOP</button>
          </div>

          <div class="system-halted-banner">⚠️ SYSTEM HALTED: EMERGENCY STOP ACTIVE</div>

          <div id="${platform}-best-summary" class="arbitrage-best-summary" style="margin-bottom: 1rem;"></div>

          <section class="sniper-pane arbitrage-ranking-pane" style="margin-bottom: 1rem;">
            <div class="sniper-pane-head">
              <h3>Top 5 Profitable Routes</h3>
              <span class="live-pill">Live Cross-Exchange Ranking</span>
            </div>
            <div id="${platform}-ranking-container" class="arbitrage-ranking-container" style="padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
              <div class="sniper-empty">Waiting for data...</div>
            </div>
          </section>

          <section class="sniper-pane sniper-chart">
            <div class="sniper-pane-head">
              <h3>Market Performance</h3>
              <span class="live-pill">Real-time Multi-Region ROI & Global Volume</span>
            </div>
            <div id="${platform}-chart-container" class="arbitrage-chart-container" style="height: 300px; margin: 1rem 0; background: #1e222d; border-radius: 8px;"></div>
          </section>
        ` : ''}
        <section class="sniper-pane sniper-deals">
          <div class="sniper-pane-head">
            <h3>Live Deals</h3>
            <span class="live-pill">Newest first</span>
            <button class="btn btn-secondary btn-sm" onclick="loadSharedFound('${platform}')" style="margin-left:auto">Refresh</button>
          </div>
          <div class="sniper-grade-filters" role="group" aria-label="Filter ${escAttr(meta.label)} deals by grade (multi-select)">
            <button class="chip-btn grade-chip ${activeGrades.size === 0 ? "active" : ""}"
              onclick="clearSharedGradeFilter('${platform}')"
              title="Show every grade">All <strong>${allDeals.length}</strong></button>
            ${SHARED_GRADE_LETTERS.map((g) => {
              const count = gradeCounts[g] || 0;
              const active = activeGrades.has(g) ? "active" : "";
              const tierCls = ` grade-chip-${g.toLowerCase()}`;
              return `<button class="chip-btn grade-chip${tierCls} ${active}"
                aria-pressed="${activeGrades.has(g) ? "true" : "false"}"
                onclick="toggleSharedGradeFilter('${platform}','${g}')"
                title="Toggle Grade ${g}">Grade ${g} <strong>${count}</strong></button>`;
            }).join("")}
          </div>
          <div id="sniper-deals-${platform}" class="sniper-card-grid">
            ${deals.length
              ? deals.map((deal) => buildSharedDealCard(platform, deal)).join("")
              : `<div class="sniper-empty">${
                  allDeals.length
                    ? `No ${escHtml(meta.label)} deals match <strong>${escHtml(activeGrades.size ? Array.from(activeGrades).map((g) => "Grade " + g).join(" + ") : "the filter")}</strong>.`
                    : `Waiting for the first ${escHtml(meta.label)} hit…`
                }</div>`}
          </div>
        </section>

        <section class="sniper-pane sniper-logs">
          <div class="sniper-pane-head">
            <h3>Live Log</h3>
            <label class="autoscroll">
              <input type="checkbox" id="sniperAutoScroll-${platform}" checked />
              Auto-scroll
            </label>
          </div>
          <div id="sniper-terminal-${platform}" class="terminal sniper-terminal"></div>
        </section>
      </div>
    </div>
  `;

  flushSniperTerminal(meta.process);
}

function buildAmazonExtraSettings(botConfig) {
  const country = botConfig.country || "US";
  return `
    <div class="sniper-setting-item">
      <label for="sniper-amazon-country">Site</label>
      <select id="sniper-amazon-country">
        ${buildAmazonSiteOptions(country)}
      </select>
    </div>
  `;
}

function buildMercadoLibreExtraSettings(botConfig) {
  const siteId = botConfig.siteId || "MLA";
  const accessToken = botConfig.accessToken || "";
  return `
    <div class="sniper-setting-item">
      <label for="sniper-mercadolibre-site">Site</label>
      <select id="sniper-mercadolibre-site">
        ${buildMercadoLibreSiteOptions(siteId)}
      </select>
    </div>
    <div class="sniper-setting-item sniper-setting-cookie">
      <label for="sniper-mercadolibre-token">Access Token</label>
      <input type="password" id="sniper-mercadolibre-token" placeholder="Optional App Access Token" autocomplete="off" value="${escAttr(accessToken)}" />
    </div>
  `;
}

function buildOnboardingHtml(platform) {
  let content = "";
  let title = "";

  if (platform === 'arbitrage') {
    title = "📖 P2P Arbitrage Guide";
    content = `
      <div class="onboarding-step">
        <h4>What is P2P Arbitrage?</h4>
        <p>This tool monitors Binance P2P for price differences (spreads) between various fiat currencies (Currency Dropshipping). It identifies paths where you can buy USDT in one currency (e.g., COP) and sell it for another (e.g., ARS) at a higher effective dollar rate.</p>
      </div>
      <div class="onboarding-step">
        <h4>Understanding Results</h4>
        <p><strong>Route:</strong> The exchange path (e.g., Binance → Binance).
           <strong>ROI:</strong> Your net percentage return after estimated platform fees.
           <strong>Volume:</strong> Total liquidity available for this trade.
           <strong>Max Profit:</strong> The absolute profit in USD if you trade the entire volume.</p>
      </div>
      <div class="onboarding-step">
        <h4>How to Interpret</h4>
        <p>High ROI deals (>3%) are great but check liquidity (Volume). Low volume means you can only trade small amounts. Use the "Exec Buy/Sell" links to jump straight to the trade page.</p>
      </div>
    `;
  } else if (platform === 'anomalia') {
    title = "📖 Radar Inverso Guide";
    content = `
      <div class="onboarding-step">
        <h4>Reverse Radar Strategy</h4>
        <p>Identifies market anomalies where it's actually cheaper to buy USDT using "weak" currencies (ARS/VES) and sell back to your primary currency (COP). These gaps are rare and usually happen during volatile market movements.</p>
      </div>
      <div class="onboarding-step">
        <h4>Components</h4>
        <p>This view uses the same math as the main Arbitrage tab but focuses on "Reverse" routes that standard bots often ignore.</p>
      </div>
    `;
  } else if (PLATFORM_META[platform]) {
    title = `📖 ${PLATFORM_META[platform].label} Sniper Guide`;
    content = `
      <div class="onboarding-step">
        <h4>How the Sniper Works</h4>
        <p>This bot continuously polls ${PLATFORM_META[platform].label} for new listings matching your "Quick Monitor" or "Config" targets. It uses a mathematical scoring engine to rank deals based on price, condition, and market average.</p>
      </div>
      <div class="onboarding-step">
        <h4>Interpreting Grades</h4>
        <p><strong>Grade A/B:</strong> High potential profit deals. Recommended for quick action.
           <strong>Grade C/D:</strong> Average deals, may require negotiation or have higher risk.
           <strong>Grade F:</strong> High risk or low profit potential.</p>
      </div>
    `;
  }

  if (!content) return "";

  return `
    <div class="onboarding-panel">
      <details>
        <summary>${title}</summary>
        <div class="onboarding-content">
          ${content}
        </div>
      </details>
    </div>
  `;
}

async function addQuickTarget(platform) {
  const label = document.getElementById(`quick-target-input-${platform}`)?.value.trim();
  if (!label) {
    showToast("Please enter an item name.", "err");
    return;
  }

  const query = document.getElementById(`quick-target-query-${platform}`)?.value.trim() || label;
  const min = parseFloat(document.getElementById(`quick-target-minPrice-${platform}`)?.value);
  const max = parseFloat(document.getElementById(`quick-target-maxPrice-${platform}`)?.value);
  const must = document.getElementById(`quick-target-mustInclude-${platform}`)?.value.split(",").map(s => s.trim()).filter(Boolean);
  const ship = document.getElementById(`quick-target-shipping-${platform}`)?.checked !== false;

  const target = {
    id: `quick-${platform}-${Date.now()}`,
    label: label,
    query: query,
    minPrice: isNaN(min) ? null : min,
    maxPrice: isNaN(max) ? null : max,
    mustInclude: must,
    allowShipping: ship,
    group: "Quick Targets",
    enabled: true,
    product: "electronics",
    platforms: [platform],
    aliases: [],
    mustAvoid: [],
    platformOverrides: {},
  };

  try {
    const res = await fetch("/api/shared/watchlist/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    if (res.ok) {
      showToast(`Added monitoring for "${label}"`);
      input.value = "";
      await loadSharedSettings();
    } else {
      throw new Error("Failed to add target");
    }
  } catch (err) {
    showToast(`Error: ${err.message}`, "err");
  }
}

function buildVintedExtraSettings(botConfig) {
  const cookie = botConfig.cookie || "";
  const ua = botConfig.userAgent || "";
  const domain = botConfig.domain || "";
  return `
    <div class="sniper-setting-item">
      <label for="sniper-vinted-domain">Country</label>
      <select id="sniper-vinted-domain">
        ${buildVintedDomainOptions(domain)}
      </select>
    </div>
    <div class="sniper-setting-item sniper-setting-cookie">
      <label for="sniper-vinted-cookie">Cookie</label>
      <input type="password" id="sniper-vinted-cookie" placeholder="Paste access_token_web=... cookie" autocomplete="off" value="${escAttr(cookie)}" />
    </div>
    <div class="sniper-setting-item sniper-setting-cookie">
      <label for="sniper-vinted-ua">User-Agent</label>
      <input type="text" id="sniper-vinted-ua" placeholder="Paste matching browser UA" autocomplete="off" value="${escAttr(ua)}" />
    </div>
  `;
}

async function applyBotSettings(platform) {
  if (!PLATFORM_META[platform]) return;
  const pollEl = document.getElementById(`sniper-${platform}-poll`);
  const pollRaw = Number(pollEl?.value || 0);
  const poll = Number.isFinite(pollRaw) && pollRaw > 0 ? Math.round(pollRaw) : undefined;
  const nextBot = {
    ...normalizeSharedConfig(sharedConfig).bots[platform],
  };
  if (poll) nextBot.pollIntervalSec = poll;
  if (platform === "vinted") {
    nextBot.cookie = document.getElementById("sniper-vinted-cookie")?.value.trim() || "";
    nextBot.userAgent = document.getElementById("sniper-vinted-ua")?.value.trim() || "";
    nextBot.domain = document.getElementById("sniper-vinted-domain")?.value.trim() || "";
  }
  if (platform === "mercadolibre") {
    nextBot.siteId = document.getElementById("sniper-mercadolibre-site")?.value.trim() || "MLA";
    nextBot.accessToken = document.getElementById("sniper-mercadolibre-token")?.value.trim() || "";
  }
  if (platform === "amazon") {
    nextBot.country = document.getElementById("sniper-amazon-country")?.value.trim() || "US";
  }
  const nextConfig = normalizeSharedConfig({
    ...sharedConfig,
    bots: { ...normalizeSharedConfig(sharedConfig).bots, [platform]: nextBot },
  });
  try {
    const res = await fetch("/api/shared/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: nextConfig, watchlist: sharedWatchlist }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    sharedConfig = nextConfig;
    renderMarketplaceTab(platform);
    showToast(`${PLATFORM_META[platform].label} sniper settings saved.`);
  } catch (err) {
    alert(`Failed to save ${platform} settings: ${err.message}`);
  }
}

function renderSharedWatchlistTab() {
  const container = document.getElementById("sharedWatchlistCards");
  if (!container) return;

  const statsPill = document.getElementById("sharedWatchStatsPill");
  if (statsPill) {
    const active = sharedWatchlist.filter((t) => t.enabled !== false).length;
    statsPill.textContent = `${active}/${sharedWatchlist.length} active`;
  }

  const groups = buildSharedGroups(sharedWatchlist);
  const counts = {};
  for (const t of sharedWatchlist) {
    const g = t.group || "General";
    counts[g] = (counts[g] || 0) + 1;
  }
  renderGroupFilters("sharedWatchGroupFilters", currentSharedWatchGroup, (group) => {
    currentSharedWatchGroup = group;
    renderSharedWatchlistTab();
  }, counts);

  if (!sharedWatchlist.length) {
    container.innerHTML = '<div class="empty">No shared targets yet. Add one to start sniping Facebook, Vinted, or Amazon.</div>';
    return;
  }

  const filtered = sharedWatchlist.filter(
    (t) => currentSharedWatchGroup === "all" || (t.group || "General") === currentSharedWatchGroup
  );
  if (!filtered.length) {
    container.innerHTML = '<div class="empty">No shared targets in this group.</div>';
    return;
  }

  const visibleGroups = [...new Set(filtered.map((t) => t.group || "General"))];
  container.innerHTML = visibleGroups.map((group) => {
    const targets = filtered.filter((t) => (t.group || "General") === group);
    return `
      <div class="watch-group-block">
        <div class="watch-group-head">
          <div class="watch-group-head-left">
            <span class="watch-group-title">${escHtml(group)}</span>
            <span class="watch-group-meta">${targets.length} target${targets.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div class="watch-grid" data-group="${escAttr(group)}">
          ${targets.map((target) => buildSharedWatchCard(target)).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function buildSharedWatchCard(target) {
  const globallyOff = target.enabled === false;
  const platforms = ["facebook", "vinted", "mercadolibre", "amazon"];
  const chipsHtml = platforms.map((p) => buildSharedWatchSiteChip(target, p)).join("");

  const facts = [];
  if (target.minPrice != null || target.maxPrice != null) {
    facts.push(`<div class="watch-fact">Search band <strong>${formatEuro(target.minPrice)}</strong> to <strong>${formatEuro(target.maxPrice)}</strong></div>`);
  }
  if ((target.mustInclude || []).length) {
    facts.push(`<div class="watch-fact">Must include: <strong>${escHtml(target.mustInclude.join(", "))}</strong></div>`);
  }
  if ((target.mustAvoid || []).length) {
    facts.push(`<div class="watch-fact">Must avoid: <strong>${escHtml(target.mustAvoid.join(", "))}</strong></div>`);
  }
  if ((target.aliases || []).length) {
    facts.push(`<div class="watch-fact">Aliases: <strong>${escHtml(target.aliases.slice(0, 4).join(", "))}</strong></div>`);
  }

  return `
    <article class="watch-card shared-watch-card" data-target-id="${escAttr(target.id)}">
      <div class="watch-top">
        <div>
          <div class="watch-title">${escHtml(target.label)}${globallyOff ? ' <span class="pill pill-warn">Globally off</span>' : ""}</div>
          <div class="watch-query">Query: ${escHtml(target.query || "(none)")}</div>
        </div>
        <div class="watch-badges">
          <span class="badge ${globallyOff ? "badge-disabled" : "badge-enabled"}">${globallyOff ? "Off" : "On"}</span>
          <button class="watch-toggle-btn ${globallyOff ? "off" : "on"}" onclick="toggleSharedTargetEnabled('${escAttr(target.id)}', ${globallyOff ? "true" : "false"})">
            ${globallyOff ? "Turn On" : "Turn Off"}
          </button>
        </div>
      </div>
      <div class="watch-site-chips">${chipsHtml}</div>
      <div class="watch-facts">${facts.join("")}</div>
      <div class="watch-card-actions">
        <span class="watch-drag-hint">${escHtml(target.group || "General")}</span>
        <button class="watch-action-btn danger" onclick="deleteSharedTarget('${escAttr(target.id)}')">Delete</button>
      </div>
    </article>
  `;
}

function buildSharedWatchSiteChip(target, platform) {
  const meta = PLATFORM_META[platform];
  const on = targetAppliesToPlatform(target, platform);
  const override = (target.platformOverrides || {})[platform] || {};
  const globalMin = target.minPrice == null ? "" : target.minPrice;
  const globalMax = target.maxPrice == null ? "" : target.maxPrice;
  const minVal = override.minPrice == null ? "" : override.minPrice;
  const maxVal = override.maxPrice == null ? "" : override.maxPrice;

  return `
    <div class="watch-site-chip ${on ? "is-on" : "is-off"}" data-platform="${platform}">
      <label class="watch-site-chip-head">
        <input type="checkbox" ${on ? "checked" : ""}
          onchange="togglePlatformForTarget('${escAttr(target.id)}', '${platform}', this.checked)" />
        <span class="watch-site-chip-name">${escHtml(meta.label)}</span>
      </label>
      <div class="watch-site-chip-prices">
        <label>
          <span>Min €</span>
          <input type="number" min="0" step="1" value="${escAttr(minVal)}"
            placeholder="${escAttr(globalMin === "" ? "—" : String(globalMin))}"
            onchange="setPlatformPriceOverride('${escAttr(target.id)}', '${platform}', 'minPrice', this.value)"
            ${on ? "" : "disabled"} />
        </label>
        <label>
          <span>Max €</span>
          <input type="number" min="0" step="1" value="${escAttr(maxVal)}"
            placeholder="${escAttr(globalMax === "" ? "—" : String(globalMax))}"
            onchange="setPlatformPriceOverride('${escAttr(target.id)}', '${platform}', 'maxPrice', this.value)"
            ${on ? "" : "disabled"} />
        </label>
      </div>
    </div>
  `;
}

async function toggleSharedTargetEnabled(targetId, enabled) {
  await postWatchlistUpdate(targetId, { enabled });
}

function openSharedAddTargetEmpty() {
  openAddTargetForPlatform("facebook");
}

async function togglePlatformForTarget(targetId, platform, enabled) {
  const target = sharedWatchlist.find((t) => t.id === targetId);
  if (!target) return;
  const current = Array.isArray(target.platforms) ? target.platforms.slice() : [];
  const next = enabled
    ? [...new Set([...current, platform])]
    : current.filter((p) => p !== platform);
  await postWatchlistUpdate(targetId, { platforms: next });
}

let pricePatchTimer = null;
async function setPlatformPriceOverride(targetId, platform, field, rawValue) {
  const target = sharedWatchlist.find((t) => t.id === targetId);
  if (!target) return;
  const trimmed = String(rawValue ?? "").trim();
  const existing = (target.platformOverrides || {})[platform] || { minPrice: null, maxPrice: null };
  const nextValue = trimmed === "" ? null : Number(trimmed);
  if (trimmed !== "" && !Number.isFinite(nextValue)) return;
  const nextOverride = { ...existing, [field]: nextValue };
  await postWatchlistUpdate(targetId, { platformOverrides: { [platform]: nextOverride } });
}

async function deleteSharedTarget(targetId) {
  const target = sharedWatchlist.find((t) => t.id === targetId);
  if (!target) return;
  if (!confirm(`Delete "${target.label}" from the shared watchlist? This removes it from all platforms.`)) return;
  const response = await fetch("/api/shared/watchlist/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: targetId }),
  });
  if (!response.ok) return;
  await loadSharedSettings();
  renderAllMarketplaceTabs();
  showToast(`Deleted ${target.label}.`);
}

async function postWatchlistUpdate(targetId, patch) {
  const response = await fetch("/api/shared/watchlist/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: targetId, patch }),
  });
  if (!response.ok) return;
  const data = await response.json();
  if (data?.target) {
    const idx = sharedWatchlist.findIndex((t) => t.id === targetId);
    if (idx !== -1) sharedWatchlist[idx] = data.target;
    renderAllMarketplaceTabs();
    const patchKeys = Object.keys(patch || {});
    if (patchKeys.some((key) => key === "enabled" || key === "platforms")) {
      showToast("Shared watchlist updated.");
    }
  }
}

function openAddTargetForPlatform(platform) {
  const sample = {
    label: "",
    query: "",
    group: "General",
    enabled: true,
    product: "iphone",
    platforms: [platform],
    aliases: [],
    mustInclude: [],
    mustAvoid: [],
    minPrice: null,
    maxPrice: null,
    allowShipping: true,
    platformOverrides: {},
  };
  openSharedAddTarget(sample);
}

function openSharedAddTarget(preset) {
  const drawer = document.getElementById("addTargetDrawer");
  const textarea = document.getElementById("manualTargetJson");
  if (!drawer || !textarea) return;
  textarea.value = JSON.stringify(preset, null, 2);
  textarea.dataset.mode = "shared";
  drawer.classList.add("open");
}

function renderSharedSettings() {
  const panel = document.getElementById("sharedSettingsPanel");
  if (!panel) return;

  const config = normalizeSharedConfig(sharedConfig);
  panel.innerHTML = `
    <div class="platform-shell">
      <section class="settings-panel">
        <div class="platform-header">
          <div>
            <h2>Shared Marketplace Settings</h2>
            <p class="panel-copy">These settings power Facebook, Vinted, Amazon, and MercadoLibre together. and the save action posts both config and watchlist JSON to <code>/api/shared/settings</code>.</p>
          </div>
          <div class="header-actions">
            <button class="btn btn-secondary" onclick="reloadSharedSettings()">Reload</button>
            <button class="btn btn-primary" onclick="saveSharedSettings()">Save Shared Settings</button>
          </div>
        </div>

        <div class="settings-meta">
          <span class="hint-pill">${sharedWatchlist.length} shared target${sharedWatchlist.length === 1 ? "" : "s"}</span>
          <span class="hint-pill">${sharedGroups.length} group${sharedGroups.length === 1 ? "" : "s"}</span>
          <span class="hint-pill">Automated</span>
        </div>

        <form id="sharedSettingsForm" class="settings-form-grid" onsubmit="event.preventDefault(); saveSharedSettings();">
          <div class="form-field">
            <label for="sharedProxy">Proxy URL</label>
            <input id="sharedProxy" class="quick-input" type="text" value="${escAttr(config.proxy || "")}" placeholder="http://user:pass@host:port" />
          </div>
          <div class="form-field form-field-wide">
            <label for="sharedProxyPool">Proxy Pool</label>
            <textarea id="sharedProxyPool" class="quick-input quick-textarea" rows="4" placeholder="One proxy URL per line">${escHtml((config.proxyPool || []).join("\n"))}</textarea>
          </div>
          <div class="form-field">
            <label for="sharedLatitude">Latitude</label>
            <input id="sharedLatitude" class="quick-input" type="number" step="0.0001" value="${escAttr(config.location?.latitude ?? "")}" />
          </div>
          <div class="form-field">
            <label for="sharedLongitude">Longitude</label>
            <input id="sharedLongitude" class="quick-input" type="number" step="0.0001" value="${escAttr(config.location?.longitude ?? "")}" />
          </div>
          <div class="form-field checkbox-field">
            <label for="sharedIncludePhotos">Include Photos In Alerts</label>
            <input id="sharedIncludePhotos" type="checkbox" ${config.notifications?.includePhotos !== false ? "checked" : ""} />
          </div>
          <div class="form-field">
            <label for="sharedMaxPhotos">Max Photos</label>
            <input id="sharedMaxPhotos" class="quick-input" type="number" min="1" max="5" step="1" value="${escAttr(config.notifications?.maxPhotos ?? 3)}" />
          </div>
          <div class="form-field">
            <label for="sharedAutoOpenBrowser">Browser Opening</label>
            <select id="sharedAutoOpenBrowser" class="quick-input">
              <option value="default" ${config.notifications?.autoOpenBrowser === "default" ? "selected" : ""}>Open listing after alert</option>
              <option value="none" ${config.notifications?.autoOpenBrowser !== "default" ? "selected" : ""}>Never auto-open</option>
            </select>
          </div>
          <div class="form-field checkbox-field">
            <label for="sharedAutoOpenBuyNow">Auto Open Buy Now</label>
            <input id="sharedAutoOpenBuyNow" type="checkbox" ${config.notifications?.autoOpenBuyNow ? "checked" : ""} />
          </div>



          <div class="form-field">
            <label for="sharedMinProfit">Min Profit ($)</label>
            <input id="sharedMinProfit" class="quick-input" type="number" step="1" value="${escAttr(config.filters?.minProfit ?? 50)}" />
          </div>
          <div class="form-field">
            <label for="sharedMinROI">Min ROI (%)</label>
            <input id="sharedMinROI" class="quick-input" type="number" step="1" value="${escAttr(config.filters?.minROI ?? 30)}" />
          </div>
          <div class="form-field">
            <label for="sharedZScoreThreshold">Z-Score Threshold</label>
            <input id="sharedZScoreThreshold" class="quick-input" type="number" step="0.1" value="${escAttr(config.filters?.zScoreThreshold ?? -2.0)}" />
          </div>
          <div class="form-field checkbox-field">
            <label for="sharedZScoreEnabled">Enable Z-Score Trigger</label>
            <input id="sharedZScoreEnabled" type="checkbox" ${config.filters?.zScoreEnabled ? "checked" : ""} />
          </div>
          <div class="form-field form-field-wide">
            <label for="sharedGlobalMustAvoid">Global Blacklist (comma separated)</label>
            <textarea id="sharedGlobalMustAvoid" class="quick-input quick-textarea" rows="2">${escHtml((config.filters?.globalMustAvoid || []).join(", "))}</textarea>
          </div>
          <div class="form-field form-field-wide">
            <label for="sharedGlobalPriorityKeywords">Global Whitelist (comma separated)</label>
            <textarea id="sharedGlobalPriorityKeywords" class="quick-input quick-textarea" rows="2">${escHtml((config.filters?.globalPriorityKeywords || []).join(", "))}</textarea>
          </div>
          <div class="form-field form-field-wide">
            <label for="sharedArbitrageDestinations">Arbitrage Destinations (comma separated fiat codes)</label>
            <input id="sharedArbitrageDestinations" class="quick-input" type="text" value="${escAttr(config.filters?.arbitrageDestinations ?? 'ARS,VES,MXN,BRL')}" />
          </div>
          ${Object.keys(PLATFORM_META).map((platform) => buildBotFieldset(platform, config.bots[platform] || {})).join("")}
        </form>
      </section>

      <section class="settings-panel">
        <div class="platform-header">
          <div>
            <h2>Shared Watchlist JSON</h2>
            <p class="panel-copy">Use raw JSON when you want full control over groups, aliases, per-platform targeting, shipping, and price ranges.</p>
          </div>
        </div>
        <textarea id="sharedWatchlistEditor" class="settings-editor settings-editor-tall" spellcheck="false">${escHtml(JSON.stringify(sharedWatchlist, null, 2))}</textarea>
      </section>

      <div id="sharedSettingsStatus" class="settings-status"></div>
    </div>
  `;
}

function buildBotFieldset(platform, botConfig) {
  const meta = PLATFORM_META[platform];
  return `
    <fieldset class="bot-settings-card">
      <legend>${escHtml(meta.label)} Bot</legend>
      <div class="form-field">
        <label for="bot-${platform}-poll">Poll Interval (sec)</label>
        <input id="bot-${platform}-poll" class="quick-input" type="number" min="5" step="5" value="${escAttr(botConfig.pollIntervalSec ?? "")}" />
      </div>
      ${platform === "vinted" ? `
        <div class="form-field">
          <label for="bot-vinted-domain">Vinted Country</label>
          <select id="bot-vinted-domain" class="quick-input">
            ${buildVintedDomainOptions(botConfig.domain)}
          </select>
        </div>
        <div class="form-field form-field-wide">
          <label for="bot-vinted-cookie">Vinted Cookie</label>
          <textarea id="bot-vinted-cookie" class="quick-input quick-textarea" rows="4" placeholder="Optional manual cookie override (must contain access_token_web=...). Must match the country you selected above.">${escHtml(botConfig.cookie || "")}</textarea>
        </div>
        <div class="form-field form-field-wide">
          <label for="bot-vinted-ua">Vinted User-Agent</label>
          <input id="bot-vinted-ua" class="quick-input" type="text" value="${escAttr(botConfig.userAgent || "")}" placeholder="Paste the exact UA the cookie was minted in (DevTools → Network → any request → Headers → user-agent). Leave blank for mobile Safari default." />
        </div>
      ` : ""}
      ${platform === "mercadolibre" ? `
        <div class="form-field">
          <label for="bot-mercadolibre-site">MercadoLibre Site</label>
          <select id="bot-mercadolibre-site" class="quick-input">
            ${buildMercadoLibreSiteOptions(botConfig.siteId)}
          </select>
        </div>
        <div class="form-field form-field-wide">
          <label for="bot-mercadolibre-token">Access Token</label>
          <input id="bot-mercadolibre-token" class="quick-input" type="password" value="${escAttr(botConfig.accessToken || "")}" placeholder="Optional App Access Token" />
        </div>
      ` : ""}
      ${platform === "amazon" ? `
        <div class="form-field">
          <label for="bot-amazon-country">Amazon Site</label>
          <select id="bot-amazon-country" class="quick-input">
            ${buildAmazonSiteOptions(botConfig.country)}
          </select>
        </div>
      ` : ""}
    </fieldset>
  `;
}

function readSharedSettingsForm() {
  const base = normalizeSharedConfig(sharedConfig);
  const maxPhotos = clampNumber(document.getElementById("sharedMaxPhotos")?.value, 1, 5, base.notifications.maxPhotos);
  const rawLat = (document.getElementById("sharedLatitude")?.value || "").trim();
  const rawLng = (document.getElementById("sharedLongitude")?.value || "").trim();
  const latNum = rawLat === "" ? null : Number(rawLat);
  const lngNum = rawLng === "" ? null : Number(rawLng);
  const latValid = latNum !== null && Number.isFinite(latNum);
  const lngValid = lngNum !== null && Number.isFinite(lngNum);
  const location = {
    latitude: latValid ? latNum : null,
    longitude: lngValid ? lngNum : null,
  };
  location.confirmed = latValid && lngValid;

  return {
    ...base,
    proxy: document.getElementById("sharedProxy")?.value.trim() || "",
    proxyPool: (document.getElementById("sharedProxyPool")?.value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    location,
    notifications: {
      ...base.notifications,
      includePhotos: document.getElementById("sharedIncludePhotos")?.checked !== false,
      maxPhotos,
      autoOpenBuyNow: !!document.getElementById("sharedAutoOpenBuyNow")?.checked,
      autoOpenBrowser: document.getElementById("sharedAutoOpenBrowser")?.value || "default",

    },
    filters: {
      minProfit: Number(document.getElementById("sharedMinProfit")?.value || 50),
      minROI: Number(document.getElementById("sharedMinROI")?.value || 30),
      zScoreThreshold: Number(document.getElementById("sharedZScoreThreshold")?.value || -2.0),
      zScoreEnabled: !!document.getElementById("sharedZScoreEnabled")?.checked,
      globalMustAvoid: (document.getElementById("sharedGlobalMustAvoid")?.value || "").split(",").map(s => s.trim()).filter(Boolean),
      globalPriorityKeywords: (document.getElementById("sharedGlobalPriorityKeywords")?.value || "").split(",").map(s => s.trim()).filter(Boolean),
      arbitrageDestinations: document.getElementById("sharedArbitrageDestinations")?.value.trim() || 'ARS,VES,MXN,BRL',
    },
    bots: {
      facebook: {
        ...base.bots.facebook,
        pollIntervalSec: clampNumber(document.getElementById("bot-facebook-poll")?.value, 5, 3600, base.bots.facebook.pollIntervalSec),
      },
      vinted: {
        ...base.bots.vinted,
        pollIntervalSec: clampNumber(document.getElementById("bot-vinted-poll")?.value, 5, 3600, base.bots.vinted.pollIntervalSec),
        cookie: document.getElementById("bot-vinted-cookie")?.value.trim() || "",
        userAgent: document.getElementById("bot-vinted-ua")?.value.trim() || "",
        domain: document.getElementById("bot-vinted-domain")?.value.trim() || "",
      },
      mercadolibre: {
        ...base.bots.mercadolibre,
        pollIntervalSec: clampNumber(document.getElementById("bot-mercadolibre-poll")?.value, 5, 3600, base.bots.mercadolibre.pollIntervalSec),
        siteId: document.getElementById("bot-mercadolibre-site")?.value.trim() || "MLA",
        accessToken: document.getElementById("bot-mercadolibre-token")?.value.trim() || "",
      },
      amazon: {
        ...base.bots.amazon,
        pollIntervalSec: clampNumber(document.getElementById("bot-amazon-poll")?.value, 5, 3600, base.bots.amazon.pollIntervalSec),
        country: document.getElementById("bot-amazon-country")?.value.trim() || "US",
      },
      arbitrage: {
        ...base.bots.arbitrage,
        pollIntervalSec: clampNumber(document.getElementById("bot-arbitrage-poll")?.value, 5, 3600, base.bots.arbitrage.pollIntervalSec),
      },
      anomalia: {
        ...base.bots.anomalia,
        pollIntervalSec: clampNumber(document.getElementById("bot-anomalia-poll")?.value, 5, 3600, base.bots.anomalia.pollIntervalSec),
      },
    },
  };
}

async function saveSharedSettings() {
  let nextWatchlist;
  try {
    nextWatchlist = JSON.parse(document.getElementById("sharedWatchlistEditor")?.value || "[]");
  } catch (err) {
    setSharedSettingsStatus(`Invalid watchlist JSON: ${err.message}`, "err");
    return;
  }

  if (!Array.isArray(nextWatchlist)) {
    setSharedSettingsStatus("Shared watchlist must be a JSON array.", "err");
    return;
  }

  const config = readSharedSettingsForm();
  const response = await fetch("/api/shared/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, watchlist: nextWatchlist }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    setSharedSettingsStatus(data.error || "Failed to save shared settings.", "err");
    return;
  }

  sharedConfig = normalizeSharedConfig(config);
  sharedWatchlist = nextWatchlist;
  sharedGroups = buildSharedGroups(sharedWatchlist);
  sharedSettingsDirty = false;
  updateLocationBanner();
  renderSharedSettings();
  renderAllMarketplaceTabs();
  setSharedSettingsStatus("Shared marketplace settings saved.", "ok");
  showToast("Shared marketplace settings saved.");
}

function reloadSharedSettings() {
  sharedSettingsDirty = false;
  loadSharedSettings();
}

function setSharedSettingsStatus(msg, tone = "") {
  const node = document.getElementById("sharedSettingsStatus");
  if (!node) return;
  node.textContent = msg;
  node.className = `settings-status ${tone}`.trim();
}

function buildSharedGroups(items) {
  return [...new Set((Array.isArray(items) ? items : []).map((item) => item?.group || "General").filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function targetAppliesToPlatform(target, platform) {
  const platforms = Array.isArray(target?.platforms || target?.sources)
    ? (target.platforms || target.sources).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  return (platforms.length ? platforms : ["facebook"]).includes(platform);
}

function classifyDealTier(deal, grade) {
  const price = [
    deal?.listing_price,
    deal?.listingPrice,
    deal?.listing?.price,
    deal?.item?.price,
    deal?.price,
  ].map(Number).find((value) => Number.isFinite(value) && value > 0);
  const ceiling = [
    deal?.ceiling,
    deal?.max_buy_all_in,
    deal?.max_buy,
    deal?.maxBuy,
    deal?.target?.maxPrice,
    deal?.market?.maxBuy,
  ].map(Number).find((value) => Number.isFinite(value) && value > 0);
  if (Number.isFinite(price) && Number.isFinite(ceiling) && ceiling > 0) {
    const ratio = price / ceiling;
    if (ratio <= 0.85) return { tier: "good", label: "Great deal" };
    if (ratio <= 1.0)  return { tier: "okay", label: "Fair price" };
    return { tier: "steep", label: "Above ceiling" };
  }
  return { tier: "", label: "" };
}

function foundPlatformBadgeClass(platform) {
  if (platform === "vinted") return "badge-platform-vinted";
  if (platform === "mercadolibre") return "badge-platform-mercadolibre";
  if (platform === "amazon") return "badge-platform-amazon";
  if (platform === "arbitrage") return "badge-platform-vinted";
  if (platform === "anomalia") return "badge-platform-vinted";
  return "badge-platform-facebook";
}

function formatFoundPlatformLabel(platform) {
  return PLATFORM_META[platform]?.label || platform || "Unknown";
}

function buildSharedDealCard(platform, deal) {
  const title = deal?.title || deal?.listing?.title || deal?.item?.title || deal?.model || "Marketplace deal";
  const grade = String(deal?.grade || "?" ).toUpperCase();
  const reasons = normalizeReasonList(deal?.reasons).slice(0, 3);
  const photos = collectSharedPhotoUrls(deal);
  const price = deal?.listing_price ?? deal?.listing?.price ?? deal?.item?.price ?? deal?.price;
  const currency = deal?.currency || deal?.currency_id || (platform === "mercadolibre" || platform === "amazon" ? "" : "EUR");
  const sellerBits = [
    deal?.seller?.name,
    deal?.seller?.rating != null ? `${deal.seller.rating}★` : "",
    deal?.condition,
  ].filter(Boolean);
  const targetLabel = deal?.target?.label || deal?.query || "Custom target";
  const groupLabel = deal?.target?.group || "General";
  const url = deal?.url || deal?.listing?.url || deal?.item?.url || "";
  const timestamp = deal?.timestamp || deal?.created_at || deal?.createdAt || deal?.item?.created_at;
  const platformLabel = formatFoundPlatformLabel(platform);
  const platformBadgeClass = foundPlatformBadgeClass(platform);
  const { tier, label: tierLabel } = classifyDealTier(deal, grade);

  let capital = 1000;
  let expectedProfit = 0;
  if (platform === 'arbitrage' || platform === 'anomalia') {
    const capInput = document.getElementById(`arbitrage-capital-${platform}`);
    if (capInput) capital = parseFloat(capInput.value) || 1000;
    expectedProfit = (capital * (deal.roi || 0)) / 100;
  }

  const tierClass = tier ? `deal-tier-${tier}` : "";
  const tierPill = tier ? `<span class="deal-tier-pill ${tier}">${escHtml(tierLabel)}</span>` : "";
  const cardId = `shared-${platform}-${deal?.item?.id || deal?.listing?.id || deal?.id || String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const photoHtml = photos.length
    ? `
      <div class="car-img-wrap shared-photo-wrap" data-card-id="${escAttr(cardId)}" data-photos='${escAttr(JSON.stringify(photos))}' onclick="cyclePhoto(event, this, 1)">
        <img class="car-img shared-photo-img" src="${escAttr(photos[0])}" alt="${escAttr(title)}" onerror="this.parentElement.querySelector('.car-img-placeholder') && (this.style.display='none')" />
        ${photos.length > 1 ? `
          <button type="button" class="img-nav img-nav-prev" aria-label="Previous photo" onclick="cyclePhoto(event, this.parentElement, -1)">‹</button>
          <button type="button" class="img-nav img-nav-next" aria-label="Next photo" onclick="cyclePhoto(event, this.parentElement, 1)">›</button>
          <div class="img-dots">
            ${photos.map((_, index) => `<span class="img-dot${index === 0 ? " active" : ""}"></span>`).join("")}
          </div>
          <span class="img-count">1 / ${photos.length}</span>
        ` : ""}
      </div>
    `
    : `
      <div class="car-img-wrap shared-photo-wrap shared-photo-wrap-empty">
        <div class="car-img-placeholder">No photo</div>
      </div>
    `;

  return `
    <article class="deal-card market-deal-card ${tierClass}">
      ${photoHtml}
      <div class="market-deal-body">
        <div class="market-deal-top">
          <div>
            <div class="found-card-kicker">
              <span class="badge ${platformBadgeClass}">${escHtml(platformLabel)}</span>
              <span>Found Listing</span>
            </div>
            <div class="process-name">${escHtml(title)}</div>
            <div class="process-desc">${escHtml(sellerBits.join(" · ") || targetLabel)}</div>
          </div>
          <div class="market-deal-badges">
            ${tierPill}
            <span class="badge ${gradeBadgeClass(grade)}">${escHtml(grade)}</span>
          </div>
        </div>
        <div class="marketplace-metrics compact">
          <div class="market-metric">
            <span class="market-metric-label">Listed</span>
            <strong>${formatPrice(price, currency)}</strong>
          </div>
          ${platform === 'arbitrage' ? `
            <div class="market-metric">
              <span class="market-metric-label">Route</span>
              <div style="display: flex; align-items: center; gap: 0.3rem; margin-top: 0.2rem;">
                <span class="exchange-badge exchange-badge-buy">${deal.source_exchange || 'binance'}</span>
                <span style="opacity: 0.5">→</span>
                <span class="exchange-badge exchange-badge-sell">${deal.destination_exchange || 'binance'}</span>
              </div>
            </div>
            <div class="market-metric">
              <span class="market-metric-label">Volume</span>
              <strong>${deal?.volume ? formatNumber(deal.volume) : '–'} USDT</strong>
            </div>
            <div class="market-metric">
              <span class="market-metric-label">Profit @ ${formatMoney(capital)}</span>
              <strong class="good">${formatMoney(expectedProfit)}</strong>
            </div>
            <div class="market-metric">
              <span class="market-metric-label">ROI</span>
              <strong class="good">${(deal.roi || 0).toFixed(2)}%</strong>
            </div>
          ` : `
            <div class="market-metric">
              <span class="market-metric-label">Score</span>
              <strong>${deal?.score != null ? escHtml(String(deal.score)) : "–"}</strong>
            </div>
          `}
          <div class="market-metric">
            <span class="market-metric-label">Target</span>
            <strong>${escHtml(targetLabel)}</strong>
          </div>
          <div class="market-metric">
            <span class="market-metric-label">Group</span>
            <strong>${escHtml(groupLabel)}</strong>
          </div>
        </div>
        ${reasons.length ? `<div class="car-notes">${escHtml(reasons.join(" • "))}</div>` : ""}
        <div class="car-footer">
          <div class="car-target-label">${escHtml(timestamp ? new Date(timestamp).toLocaleString() : "Latest shared deal")}</div>
          <div class="car-actions" data-deal='${escAttr(JSON.stringify({
            profile_id: deal.profile_id,
            source_exchange: deal.source_exchange,
            destination_exchange: deal.destination_exchange,
            fiat_origin: deal.fiat_origin,
            fiat_destination: deal.fiat,
            buyPriceUSD: deal.buyPriceUSD,
            sellPriceUSD: deal.sellPriceUSD,
            netProfit: deal.netProfit,
            roi: deal.roi,
            volume: deal.volume,
            timestamp: deal.timestamp
          }))}'>
            ${(platform === 'arbitrage' || platform === 'anomalia') && toolsConfig.deepLinks ? `
              <button class="car-open-btn btn-execute" onclick="openInBrowser('${escAttr(getDeepLink(deal.source_exchange, 'USDT', deal.fiat_origin, 'BUY'))}')">Exec Buy ↗</button>
              <button class="car-open-btn btn-execute" onclick="openInBrowser('${escAttr(getDeepLink(deal.destination_exchange, 'USDT', deal.fiat, 'SELL'))}')">Exec Sell ↗</button>
            ` : ''}
            ${(platform === 'arbitrage' || platform === 'anomalia') && toolsConfig.tradeJournal ? `
              <button class="car-open-btn btn-journal" onclick="markAsTraded(this.parentElement.dataset.deal ? JSON.parse(this.parentElement.dataset.deal) : {})">Mark Traded</button>
            ` : ''}
            <button class="car-open-btn" onclick="openInBrowser('${escAttr(url)}')">Open ↗</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

function collectSharedPhotoUrls(deal) {
  const seen = new Set();
  const pools = [
    ...(Array.isArray(deal?.listing?.photos) ? deal.listing.photos : []),
    ...(Array.isArray(deal?.photos) ? deal.photos : []),
    ...(Array.isArray(deal?.item?.photos) ? deal.item.photos : []),
    ...(Array.isArray(deal?.item?.images) ? deal.item.images : []),
    ...(Array.isArray(deal?.images) ? deal.images : []),
  ];

  return pools
    .map((photo) => {
      if (typeof photo === "string") return photo;
      return photo?.full_size_url
        || photo?.full_url
        || photo?.url
        || photo?.imageUrl
        || photo?.image?.uri
        || photo?.image?.url
        || photo?.uri
        || photo?.urls?.original
        || photo?.urls?.big
        || photo?.urls?.medium
        || photo?.urls?.small
        || "";
    })
    .filter((photo) => {
      if (!photo || seen.has(photo)) return false;
      seen.add(photo);
      return true;
    })
    .slice(0, 6);
}

function gradeBadgeClass(grade) {
  if (["A", "B"].includes(grade)) return "badge-running";
  if (["C", "D"].includes(grade)) return "badge-stopping";
  return "badge-stopped";
}

function countDealsByGrade(deals) {
  return deals.reduce((acc, d) => {
    const g = String(d?.grade || "").toUpperCase();
    if (g) acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {});
}

function toggleSharedGradeFilter(platform, grade) {
  if (!PLATFORM_META[platform]) return;
  if (!SHARED_GRADE_LETTERS.includes(grade)) return;
  let set = sharedGradeFilter[platform];
  if (!(set instanceof Set)) {
    set = new Set();
    sharedGradeFilter[platform] = set;
  }
  if (set.has(grade)) set.delete(grade);
  else set.add(grade);
  renderMarketplaceTab(platform);
}

function clearSharedGradeFilter(platform) {
  if (!PLATFORM_META[platform]) return;
  sharedGradeFilter[platform] = new Set();
  renderMarketplaceTab(platform);
}

/* ── Watchlist ──────────────────────────────────────────────────────────────── */
/* ── Periodic refresh ───────────────────────────────────────────────────────── */
function refreshVisible() {
  if (document.visibilityState !== "visible") return;
  if (currentTopTab === "settings") {
    loadSharedSettings();
    return;
  }
  if (PLATFORM_META[currentTopTab]) {
    loadSharedFound(currentTopTab);
  }
}

/* ── Add Target Drawer ──────────────────────────────────────────────────────── */
const MANUAL_TARGET_TEMPLATE = {
  id: "my-target",
  label: "My Target",
  group: "General",
  enabled: true,
  targetType: "general",
  make: "",
  model: "",
  aliases: [],
  query: "",
  minPrice: 200,
  maxPrice: 900,
  radiusKM: 75,
  allowShipping: false,
  retailBase: 600,
  baselineYear: null,
  yearlyAdjustment: 0,
  baselineMiles: 0,
  mileagePenaltyPer10k: 0,
  mileageBonusPer10k: 0,
  maxMileage: 0,
  feesReserve: 40,
  reconBase: 40,
  marginFloor: 100,
  customPrompt: "",
  mustInclude: [],
  mustAvoid: [],
  trimBoostKeywords: [],
  avoidKeywords: ["parts only", "not working", "locked", "stock photos"],
};

/* ── Boot ───────────────────────────────────────────────────────────────────── */
connectWS();
refreshStatus();
loadSharedSettings();
Object.keys(PLATFORM_META).forEach((platform) => loadSharedFound(platform));
setInterval(refreshVisible, 15000);
document.addEventListener("visibilitychange", refreshVisible);

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escAttr(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatPrice(val, currency = "EUR") {
  if (val == null || val === "") return "—";
  const num = Number(val);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR" }).format(num);
}

function formatNumber(val) {
  if (val == null || val === "") return "—";
  const num = Number(val);
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("de-DE").format(num);
}

function formatMoney(val) {
  return formatPrice(val, "USD");
}

function formatEuro(val) {
  return formatPrice(val, "EUR");
}

function clampNumber(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function normalizeReasonList(reasons) {
  if (!reasons) return [];
  if (Array.isArray(reasons)) return reasons.filter(Boolean);
  if (typeof reasons === "string") return reasons.split(";").map(s => s.trim()).filter(Boolean);
  return [];
}

function openInBrowser(url) {
  if (!url) return;
  window.open(url, "_blank");
}

function buildGroups(items) {
  return buildSharedGroups(items);
}

function buildLimits(watchlist) {
  const active = watchlist.filter(t => t.enabled !== false).length;
  return {
    enabledCount: active,
    maxActiveTargets: 10,
    atLimit: active >= 10
  };
}

function buildStats(deals) {
  return {
    totalFound: deals.length
  };
}

function cyclePhoto(event, wrapper, delta) {
  if (event) event.stopPropagation();
  const cardId = wrapper.dataset.cardId;
  const photos = JSON.parse(wrapper.dataset.photos || "[]");
  if (!photos.length) return;

  let idx = photoIndexes[cardId] || 0;
  idx = (idx + delta + photos.length) % photos.length;
  photoIndexes[cardId] = idx;

  const img = wrapper.querySelector(".car-img");
  if (img) img.src = photos[idx];

  const count = wrapper.querySelector(".img-count");
  if (count) count.textContent = `${idx + 1} / ${photos.length}`;

  const dots = wrapper.querySelectorAll(".img-dot");
  dots.forEach((dot, i) => dot.classList.toggle("active", i === idx));
}

function closeAddTarget() {
  document.getElementById("addTargetDrawer")?.classList.remove("open");
}

function closeDealModal() {
  document.getElementById("dealModal")?.classList.remove("open");
}

function closeTextPromptModal() {
  document.getElementById("textPromptModal")?.classList.remove("open");
}

function addTarget() {
  const mode = document.getElementById("manualTargetJson").dataset.mode;
  const raw = document.getElementById("manualTargetJson").value;
  let target;
  try { target = JSON.parse(raw); } catch(e) { alert("Invalid JSON"); return; }

  const url = mode === "shared" ? "/api/shared/watchlist/add" : "/api/watchlist/add";
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target })
  }).then(r => r.json()).then(data => {
    if (data.ok) {
      closeAddTarget();
      loadSharedSettings();
    } else {
      alert(data.error || "Failed to add target");
    }
  });
}

function renderGroupFilters(containerId, activeGroup, onSelect, counts = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const groups = ["all", ...sharedGroups];
  container.innerHTML = groups.map(g => {
    const active = g === activeGroup ? "active" : "";
    const count = g === "all" ? sharedWatchlist.length : (counts[g] || 0);
    return `<button class="chip-btn ${active}" onclick="(${onSelect.toString()})('${g}')">${g} <strong>${count}</strong></button>`;
  }).join("");
}
