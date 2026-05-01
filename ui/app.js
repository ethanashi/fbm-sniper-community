/* ── State ──────────────────────────────────────────────────────────────────── */
let ws = null;
let wsRetryTimer = null;
let processState = {};
let appConfig = {};
let foundDeals = [];
let rejectedDeals = [];
let watchlist = [];
let targetGroups = [];
let sharedConfig = {};
let sharedWatchlist = [];
let sharedGroups = [];
let carSettingsDirty = false;
let sharedSettingsDirty = false;
const FOUND_LISTINGS_STORAGE_KEY = "fbm-found-listings-columns";
const sharedFoundDeals = {
  facebook: [],
  wallapop: [],
  vinted: [],
  mercari: [],
};
const foundListingsLoaded = {
  cars: false,
  facebook: false,
  wallapop: false,
  vinted: false,
  mercari: false,
};
// In-memory grade filter per platform. Set of selected letter grades; empty Set = show all.
const sharedGradeFilter = {
  facebook: new Set(),
  wallapop: new Set(),
  vinted: new Set(),
  mercari: new Set(),
};
const SHARED_GRADE_LETTERS = ["A", "B", "C", "D", "F"];
let currentTopTab = "cars";
let currentCarView = "overview";
let currentLogProcess = "car-sniper";
let currentWatchGroup = "all";
let currentSharedWatchGroup = "all";
let currentFoundGroup = "all";
let currentRejectedGroup = "all";
let foundReloadTimer = null;
let rejectedReloadTimer = null;
const sharedReloadTimers = {
  facebook: null,
  wallapop: null,
  vinted: null,
  mercari: null,
};
const terminalBuffers = {};
let activeDealModal = null;
let activeTextPrompt = null;
let draggedTargetId = null;

const PLATFORM_META = {
  facebook: {
    label: "Facebook",
    process: "facebook-sniper",
    description: "Shared Facebook Marketplace sniper using the shared watchlist and Discord settings below.",
  },
  wallapop: {
    label: "Wallapop",
    process: "wallapop-sniper",
    description: "Shared Wallapop polling loop with per-bot interval controls and recent matches.",
  },
  vinted: {
    label: "Vinted",
    process: "vinted-sniper",
    description: "Shared Vinted loop with optional cookie override, photos, and Discord routing.",
  },
  mercari: {
    label: "Mercari",
    process: "mercari-sniper",
    description: "Shared Mercari loop using a public browser session, newest search, and no user cookies.",
  },
};

const FOUND_LISTINGS_META = [
  {
    id: "cars",
    label: "Cars",
    process: "car-sniper",
    description: "Facebook car feed with automatic session capture and full underwriting cards.",
  },
  ...Object.entries(PLATFORM_META).map(([id, meta]) => ({
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
  displayCurrency: "USD",
  location: {
    latitude: null,
    longitude: null,
    confirmed: false,
  },
  fbMarketplaceLocationUrl: "",
  fbMarketplaceLocationId: "",
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
  bots: {
    facebook: { pollIntervalSec: 90 },
    wallapop: { pollIntervalSec: 60 },
    vinted: { pollIntervalSec: 45, cookie: "", userAgent: "", domain: "" },
    mercari: { pollIntervalSec: 60, userAgent: "" },
  },
};

const DISPLAY_CURRENCY_OPTIONS = [
  { code: "USD", label: "United States Dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "British Pound" },
  { code: "CAD", label: "Canadian Dollar" },
  { code: "AUD", label: "Australian Dollar" },
  { code: "JPY", label: "Japanese Yen" },
  { code: "PLN", label: "Polish Zloty" },
  { code: "SEK", label: "Swedish Krona" },
  { code: "DKK", label: "Danish Krone" },
  { code: "CZK", label: "Czech Koruna" },
  { code: "RON", label: "Romanian Leu" },
  { code: "HUF", label: "Hungarian Forint" },
];

function normalizeCurrencyForUi(value, fallback = DEFAULT_SHARED_CONFIG.displayCurrency) {
  const code = String(value || "").trim().toUpperCase();
  if (DISPLAY_CURRENCY_OPTIONS.some((entry) => entry.code === code)) return code;
  if (fallback === "" || fallback === null) return "";
  const safeFallback = String(fallback || DEFAULT_SHARED_CONFIG.displayCurrency).trim().toUpperCase();
  return DISPLAY_CURRENCY_OPTIONS.some((entry) => entry.code === safeFallback)
    ? safeFallback
    : DEFAULT_SHARED_CONFIG.displayCurrency;
}

function buildDisplayCurrencyOptions(selected) {
  const current = normalizeCurrencyForUi(selected);
  return DISPLAY_CURRENCY_OPTIONS.map((entry) => {
    const label = `${entry.code} - ${entry.label}`;
    return `<option value="${escAttr(entry.code)}" ${entry.code === current ? "selected" : ""}>${escHtml(label)}</option>`;
  }).join("");
}

function nativeCurrencyForUiPlatform(platform, deal = {}) {
  const explicit = normalizeCurrencyForUi(deal?.native_currency || deal?.currency || "", "");
  if (explicit) return explicit;
  const key = String(platform || "").toLowerCase();
  if (key === "mercari") return "USD";
  if (key === "wallapop" || key === "vinted") return "EUR";
  return normalizeSharedConfig(sharedConfig).displayCurrency;
}

/* ── Carousel state ─────────────────────────────────────────────────────────── */
// cardId → current photo index
const photoIndexes = {};

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
  btn.addEventListener("click", () => {
    setActiveCarView(btn.dataset.carView);
  });
});

function setActiveTopTab(tab) {
  currentTopTab = tab;
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((node) => node.classList.toggle("active", node.id === `tab-${tab}`));

  if (tab === "cars") {
    loadCarsViewData();
    return;
  }
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
  if (PLATFORM_META[tab]) {
    loadSharedFound(tab);
    renderMarketplaceTab(tab);
    flushSniperTerminal(PLATFORM_META[tab].process);
  }
}

function setActiveCarView(view) {
  currentCarView = view;
  document.querySelectorAll(".car-subnav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.carView === view));
  document.querySelectorAll(".car-view").forEach((node) => node.classList.toggle("active", node.id === `car-view-${view}`));

  if (view === "watchlist") loadWatchlist();
  if (view === "found") loadFoundDeals();
  if (view === "rejected") loadRejectedDeals();
  if (view === "settings") loadSettings();
}

function loadCarsViewData() {
  refreshStatus();
  if (currentCarView === "watchlist") loadWatchlist();
  if (currentCarView === "found") loadFoundDeals();
  if (currentCarView === "rejected") loadRejectedDeals();
  if (currentCarView === "settings") loadSettings();
}

/* ── WebSocket ──────────────────────────────────────────────────────────────── */
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

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

    if (msg.type === "log") {
      appendLogLine(msg.process, msg.line, msg.ts);
      return;
    }

    if (msg.type === "car-found-updated") {
      clearTimeout(foundReloadTimer);
      foundReloadTimer = setTimeout(() => { loadFoundDeals(); refreshStatus(); }, 250);
      return;
    }

    if (msg.type === "car-rejected-updated") {
      clearTimeout(rejectedReloadTimer);
      rejectedReloadTimer = setTimeout(loadRejectedDeals, 250);
      return;
    }

    if (msg.type === "car-watchlist-updated" || msg.type === "car-config-updated") {
      loadSettings();
      refreshStatus();
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
  const container = document.getElementById("processGrid");
  if (!container) return;
  container.innerHTML = "";

  const info = processState["car-sniper"];
  if (!info) return;

  const badgeClass = info.running ? (info.stopping ? "badge-stopping" : "badge-running") : "badge-stopped";
  const badgeText  = info.running ? (info.stopping ? "Stopping" : "Running") : "Stopped";
  const card = document.createElement("div");
  card.className = "process-card";
  card.innerHTML = `
    <div class="process-header">
      <div>
        <div class="process-name">${escHtml(info.label)}</div>
        <div class="process-desc">Car scan loop using the automatic Facebook session capture, local car watchlist, found, rejected, and config views.</div>
      </div>
      <span class="badge ${badgeClass}">${badgeText}</span>
    </div>
    <div class="process-actions">
      <button class="btn btn-start"  ${info.running ? "disabled" : ""} onclick="startNamedProcess('car-sniper')">Start</button>
      <button class="btn btn-stop"   ${!info.running || info.stopping ? "disabled" : ""} onclick="stopNamedProcess('car-sniper')">Stop</button>
      <button class="btn btn-logs"   onclick="goToLogs('car-sniper')">Logs</button>
    </div>
  `;
  container.appendChild(card);
}

/* ── Status ─────────────────────────────────────────────────────────────────── */
async function refreshStatus() {
  try {
    const data = await fetch("/api/status").then((r) => r.json());
    processState = data.processes || {};
    targetGroups = Array.isArray(data.targetGroups) ? data.targetGroups : targetGroups;
    renderProcessGrid();
    renderAllMarketplaceTabs();
    setText("statBuyNow",   data.stats?.buyNow    ?? 0);
    setText("statMaybe",    data.stats?.maybe     ?? 0);
    setText("statAvgMargin", `$${formatNumber(data.stats?.avgMargin ?? 0)}`);
    setText("statRecalls",  data.stats?.recallFlags ?? 0);
    const g = targetGroups.length;
    setText("watchlistSummary", `${data.watchlistCount ?? 0} targets across ${g} group${g === 1 ? "" : "s"}`);
    const limits = data.limits || {};
    const enabled = limits.enabledCount ?? 0;
    const max = limits.maxActiveTargets ?? 10;
    const pill = document.getElementById("limitPill");
    if (pill) {
      pill.textContent = `Active: ${enabled}/${max}`;
      pill.classList.toggle("limit-pill-full", enabled >= max);
    }
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
    displayCurrency: normalizeCurrencyForUi(config?.displayCurrency, DEFAULT_SHARED_CONFIG.displayCurrency),
    location: {
      ...DEFAULT_SHARED_CONFIG.location,
      ...((config && config.location) || {}),
    },
    notifications: {
      ...DEFAULT_SHARED_CONFIG.notifications,
      ...((config && config.notifications) || {}),
      discord: {
        ...DEFAULT_SHARED_CONFIG.notifications.discord,
        ...(((config && config.notifications) || {}).discord || {}),
      },
    },
    bots: {
      facebook: {
        ...DEFAULT_SHARED_CONFIG.bots.facebook,
        ...(((config && config.bots) || {}).facebook || {}),
      },
      wallapop: {
        ...DEFAULT_SHARED_CONFIG.bots.wallapop,
        ...(((config && config.bots) || {}).wallapop || {}),
      },
      vinted: {
        ...DEFAULT_SHARED_CONFIG.bots.vinted,
        ...(((config && config.bots) || {}).vinted || {}),
      },
      mercari: {
        ...DEFAULT_SHARED_CONFIG.bots.mercari,
        ...(((config && config.bots) || {}).mercari || {}),
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
    sharedFoundDeals[platform] = await fetch(`/api/shared/found/${platform}`).then((response) => response.json());
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
      const deals = column.id === "cars"
        ? (Array.isArray(foundDeals) ? foundDeals : [])
        : (Array.isArray(sharedFoundDeals[column.id]) ? sharedFoundDeals[column.id] : []);
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
  loadFoundDeals();
  Object.keys(PLATFORM_META).forEach((platform) => loadSharedFound(platform));
}

function toggleFoundListingsColumn(columnId) {
  if (!FOUND_LISTINGS_META.some((column) => column.id === columnId)) return;
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
    const deals = column.id === "cars"
      ? (Array.isArray(foundDeals) ? foundDeals : [])
      : (Array.isArray(sharedFoundDeals[column.id]) ? sharedFoundDeals[column.id] : []);
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
    const count = column.id === "cars"
      ? (Array.isArray(foundDeals) ? foundDeals.length : 0)
      : (Array.isArray(sharedFoundDeals[column.id]) ? sharedFoundDeals[column.id].length : 0);
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
    if (platform === "cars") return buildFoundCarDealCard(deal, foundDeals.indexOf(deal));
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
}

function renderMarketplaceTab(platform) {
  const mount = document.getElementById(`${platform}Panel`);
  if (!mount) return;

  const meta = PLATFORM_META[platform];
  const info = processState[meta.process] || { running: false, stopping: false, label: `${meta.label} Sniper` };
  const botConfig = normalizeSharedConfig(sharedConfig).bots[platform];
  const allDeals = Array.isArray(sharedFoundDeals[platform]) ? sharedFoundDeals[platform] : [];
  const gradeCounts = countDealsByGrade(allDeals);
  const activeGrades = sharedGradeFilter[platform] instanceof Set ? sharedGradeFilter[platform] : new Set();
  const deals = activeGrades.size === 0
    ? allDeals
    : allDeals.filter((d) => activeGrades.has(String(d?.grade || "").toUpperCase()));
  const enabledTargets = sharedWatchlist.filter((target) => target.enabled !== false && targetAppliesToPlatform(target, platform)).length;
  const badgeClass = info.running ? (info.stopping ? "badge-stopping" : "badge-running") : "badge-stopped";
  const badgeText = info.running ? (info.stopping ? "Stopping" : "Running") : "Stopped";
  const proxyCount = Array.isArray(sharedConfig.proxyPool) ? sharedConfig.proxyPool.length : 0;
  const hasProxyUrl = !!String(sharedConfig.proxy || "").trim();
  const proxyBadgeClass = proxyCount || hasProxyUrl ? "sniper-proxy-ok" : "sniper-proxy-none";
  const proxyBadgeText = proxyCount
    ? `${proxyCount} proxy${proxyCount === 1 ? "" : "ies"}`
    : hasProxyUrl ? "1 proxy URL" : "No proxies";

  mount.innerHTML = `
    <div class="sniper-shell">
      <div class="sniper-top">
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
          ${platform === "mercari" ? buildMercariExtraSettings(botConfig) : ""}
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

function buildMercariExtraSettings(botConfig) {
  const ua = botConfig.userAgent || "";
  return `
    <div class="sniper-setting-item sniper-setting-cookie">
      <label for="sniper-mercari-ua">User-Agent</label>
      <input type="text" id="sniper-mercari-ua" placeholder="Optional browser UA override" autocomplete="off" value="${escAttr(ua)}" />
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
  if (platform === "mercari") {
    nextBot.userAgent = document.getElementById("sniper-mercari-ua")?.value.trim() || "";
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
    container.innerHTML = '<div class="empty">No shared targets yet. Add one to start sniping Facebook, Wallapop, Vinted, or Mercari.</div>';
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
  const platforms = ["facebook", "wallapop", "vinted", "mercari"];
  const chipsHtml = platforms.map((p) => buildSharedWatchSiteChip(target, p)).join("");
  const displayCurrency = normalizeSharedConfig(sharedConfig).displayCurrency;

  const facts = [];
  if (target.minPrice != null || target.maxPrice != null) {
    facts.push(`<div class="watch-fact">Search band <strong>${formatCurrencyForUi(target.minPrice, displayCurrency)}</strong> to <strong>${formatCurrencyForUi(target.maxPrice, displayCurrency)}</strong></div>`);
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
  const displayCurrency = normalizeSharedConfig(sharedConfig).displayCurrency;
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
          <span>Min ${escHtml(displayCurrency)}</span>
          <input type="number" min="0" step="1" value="${escAttr(minVal)}"
            placeholder="${escAttr(globalMin === "" ? "—" : String(globalMin))}"
            onchange="setPlatformPriceOverride('${escAttr(target.id)}', '${platform}', 'minPrice', this.value)"
            ${on ? "" : "disabled"} />
        </label>
        <label>
          <span>Max ${escHtml(displayCurrency)}</span>
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
    product: "general",
    targetType: "general",
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
            <p class="panel-copy">These settings power Facebook, Wallapop, and Vinted together. Discord webhooks are optional, and the save action posts both config and watchlist JSON to <code>/api/shared/settings</code>.</p>
          </div>
          <div class="header-actions">
            <button class="btn btn-secondary" onclick="reloadSharedSettings()">Reload</button>
            <button class="btn btn-primary" onclick="saveSharedSettings()">Save Shared Settings</button>
          </div>
        </div>

        <div class="settings-meta">
          <span class="hint-pill">${sharedWatchlist.length} shared target${sharedWatchlist.length === 1 ? "" : "s"}</span>
          <span class="hint-pill">${sharedGroups.length} group${sharedGroups.length === 1 ? "" : "s"}</span>
          <span class="hint-pill">Discord optional</span>
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
            <label for="sharedDisplayCurrency">Display Currency</label>
            <select id="sharedDisplayCurrency" class="quick-input">
              ${buildDisplayCurrencyOptions(config.displayCurrency)}
            </select>
          </div>
          <div class="form-field">
            <label for="sharedLatitude">Latitude</label>
            <input id="sharedLatitude" class="quick-input" type="number" step="0.0001" value="${escAttr(config.location?.latitude ?? "")}" />
          </div>
          <div class="form-field">
            <label for="sharedLongitude">Longitude</label>
            <input id="sharedLongitude" class="quick-input" type="number" step="0.0001" value="${escAttr(config.location?.longitude ?? "")}" />
          </div>
          <div class="form-field form-field-wide">
            <label for="sharedFbMarketplaceUrl">Facebook Marketplace Location URL</label>
            <input id="sharedFbMarketplaceUrl" class="quick-input" type="text" value="${escAttr(config.fbMarketplaceLocationUrl || "")}" placeholder="Paste your facebook.com/marketplace/<id>/ URL — visit Marketplace, copy the URL after FB picks your city" />
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
          <div class="form-field form-field-wide">
            <label for="sharedDiscordAll">Discord Webhook: All Deals</label>
            <input id="sharedDiscordAll" class="quick-input" type="url" value="${escAttr(config.notifications?.discord?.allWebhookUrl || "")}" placeholder="Optional" />
          </div>
          <div class="form-field form-field-wide">
            <label for="sharedDiscordBuy">Discord Webhook: Buy Now</label>
            <input id="sharedDiscordBuy" class="quick-input" type="url" value="${escAttr(config.notifications?.discord?.buyNowWebhookUrl || "")}" placeholder="Optional" />
          </div>
          <div class="form-field form-field-wide">
            <label for="sharedDiscordMaybe">Discord Webhook: Maybe</label>
            <input id="sharedDiscordMaybe" class="quick-input" type="url" value="${escAttr(config.notifications?.discord?.maybeWebhookUrl || "")}" placeholder="Optional" />
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
      ${platform === "mercari" ? `
        <div class="form-field form-field-wide">
          <label for="bot-mercari-ua">Mercari User-Agent</label>
          <input id="bot-mercari-ua" class="quick-input" type="text" value="${escAttr(botConfig.userAgent || "")}" placeholder="Optional browser UA override. Leave blank for the built-in desktop Chrome UA." />
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

  const fbMarketplaceLocationUrl = (document.getElementById("sharedFbMarketplaceUrl")?.value || "").trim();
  const fbIdMatch = fbMarketplaceLocationUrl.match(/facebook\.com\/marketplace\/(\d{6,})(?:\/|\?|$)/i);
  const fbMarketplaceLocationId = fbIdMatch
    ? fbIdMatch[1]
    : (/^\d{6,}$/.test(fbMarketplaceLocationUrl) ? fbMarketplaceLocationUrl : "");

  return {
    ...base,
    proxy: document.getElementById("sharedProxy")?.value.trim() || "",
    proxyPool: (document.getElementById("sharedProxyPool")?.value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    displayCurrency: normalizeCurrencyForUi(document.getElementById("sharedDisplayCurrency")?.value, base.displayCurrency),
    location,
    fbMarketplaceLocationUrl,
    fbMarketplaceLocationId,
    notifications: {
      ...base.notifications,
      includePhotos: document.getElementById("sharedIncludePhotos")?.checked !== false,
      maxPhotos,
      autoOpenBuyNow: !!document.getElementById("sharedAutoOpenBuyNow")?.checked,
      autoOpenBrowser: document.getElementById("sharedAutoOpenBrowser")?.value || "default",
      discord: {
        allWebhookUrl: document.getElementById("sharedDiscordAll")?.value.trim() || "",
        buyNowWebhookUrl: document.getElementById("sharedDiscordBuy")?.value.trim() || "",
        maybeWebhookUrl: document.getElementById("sharedDiscordMaybe")?.value.trim() || "",
      },
    },
    bots: {
      facebook: {
        ...base.bots.facebook,
        pollIntervalSec: clampNumber(document.getElementById("bot-facebook-poll")?.value, 5, 3600, base.bots.facebook.pollIntervalSec),
      },
      wallapop: {
        ...base.bots.wallapop,
        pollIntervalSec: clampNumber(document.getElementById("bot-wallapop-poll")?.value, 5, 3600, base.bots.wallapop.pollIntervalSec),
      },
      vinted: {
        ...base.bots.vinted,
        pollIntervalSec: clampNumber(document.getElementById("bot-vinted-poll")?.value, 5, 3600, base.bots.vinted.pollIntervalSec),
        cookie: document.getElementById("bot-vinted-cookie")?.value.trim() || "",
        userAgent: document.getElementById("bot-vinted-ua")?.value.trim() || "",
        domain: document.getElementById("bot-vinted-domain")?.value.trim() || "",
      },
      mercari: {
        ...base.bots.mercari,
        pollIntervalSec: clampNumber(document.getElementById("bot-mercari-poll")?.value, 5, 3600, base.bots.mercari.pollIntervalSec),
        userAgent: document.getElementById("bot-mercari-ua")?.value.trim() || "",
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
  if (platform === "cars") return "badge-platform-cars";
  if (platform === "wallapop") return "badge-platform-wallapop";
  if (platform === "vinted") return "badge-platform-vinted";
  if (platform === "mercari") return "badge-platform-mercari";
  return "badge-platform-facebook";
}

function formatFoundPlatformLabel(platform) {
  if (platform === "cars") return "Cars";
  return PLATFORM_META[platform]?.label || platform || "Unknown";
}

function formatSharedPrice(platform, deal, value) {
  const currency = normalizeCurrencyForUi(deal?.currency, nativeCurrencyForUiPlatform(platform, deal));
  return formatCurrencyForUi(value, currency);
}

function buildSharedDealCard(platform, deal) {
  const title = deal?.title || deal?.listing?.title || deal?.item?.title || deal?.model || "Marketplace deal";
  const grade = String(deal?.grade || "?" ).toUpperCase();
  const reasons = normalizeReasonList(deal?.reasons).slice(0, 3);
  const photos = collectSharedPhotoUrls(deal);
  const price = deal?.listing_price ?? deal?.listing?.price ?? deal?.item?.price ?? deal?.price;
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
            <strong>${formatSharedPrice(platform, deal, price)}</strong>
          </div>
          <div class="market-metric">
            <span class="market-metric-label">Score</span>
            <strong>${deal?.score != null ? escHtml(String(deal.score)) : "–"}</strong>
          </div>
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
          <div class="car-actions">
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
    ...(Array.isArray(deal?.photoUrls) ? deal.photoUrls : []),
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
async function loadWatchlist() {
  watchlist = await fetch("/api/watchlist").then((r) => r.json());
  syncTargetGroups();
  renderWatchlist();
}

function syncTargetGroups() {
  const groups = [...new Set(
    watchlist.map((t) => t.group || "General").filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
  targetGroups = groups;
  if (currentWatchGroup !== "all"    && !targetGroups.includes(currentWatchGroup))    currentWatchGroup = "all";
  if (currentFoundGroup !== "all"    && !targetGroups.includes(currentFoundGroup))    currentFoundGroup = "all";
  if (currentRejectedGroup !== "all" && !targetGroups.includes(currentRejectedGroup)) currentRejectedGroup = "all";
}

function renderWatchlist() {
  const container = document.getElementById("watchlistCards");
  renderGroupFilters("watchGroupFilters", currentWatchGroup, (g) => {
    currentWatchGroup = g;
    renderWatchlist();
  }, countByGroup(watchlist, (t) => t.group || "General"));

  if (!watchlist.length) {
    container.innerHTML = '<div class="empty">No targets yet — add them in Settings.</div>';
    return;
  }

  const filtered = watchlist.filter((t) => currentWatchGroup === "all" || (t.group || "General") === currentWatchGroup);
  if (!filtered.length) {
    container.innerHTML = '<div class="empty">No targets in this group.</div>';
    return;
  }

  const groups = [...new Set(filtered.map((t) => t.group || "General"))];
  container.innerHTML = groups.map((group) => {
    const items = filtered.filter((t) => (t.group || "General") === group);
    return `
      <div class="watch-group-block">
        <div class="watch-group-head">
          <div class="watch-group-head-left">
            <span class="watch-group-title">${escHtml(group)}</span>
            <span class="watch-group-meta">${items.length} target${items.length === 1 ? "" : "s"}</span>
          </div>
          <div class="watch-group-actions">
            <button class="watch-action-btn" onclick="renameGroup('${escAttr(group)}')">Rename</button>
          </div>
        </div>
        <div class="watch-grid" data-group="${escAttr(group)}" ondragover="handleGroupDragOver(event, '${escAttr(group)}')" ondragleave="handleGroupDragLeave(event, '${escAttr(group)}')" ondrop="handleGroupDrop(event, '${escAttr(group)}')">
          ${items.map((t) => `
            <article class="watch-card" draggable="true" ondragstart="startTargetDrag(event, '${escAttr(t.id)}')" ondragend="endTargetDrag()">
              <div class="watch-top">
                <div>
                  <div class="watch-title">${escHtml(t.label)}</div>
                  <div class="watch-query">Query: ${escHtml(t.query)}</div>
                </div>
                <div class="watch-badges">
                  <span class="badge ${t.enabled === false ? "badge-disabled" : "badge-enabled"}">${t.enabled === false ? "Off" : "On"}</span>
                  <button class="watch-toggle-btn ${t.enabled === false ? "off" : "on"}" onclick="toggleTarget('${escAttr(t.id)}', ${t.enabled === false ? "true" : "false"})">
                    ${t.enabled === false ? "Turn On" : "Turn Off"}
                  </button>
                </div>
              </div>
              <div class="watch-facts">${renderWatchFacts(t)}</div>
              ${t.customPrompt ? `<div class="car-notes">${escHtml(t.customPrompt)}</div>` : ""}
              <div class="watch-card-actions">
                <span class="watch-drag-hint">Drag to move</span>
                <button class="watch-action-btn danger" onclick="deleteTarget('${escAttr(t.id)}', '${escAttr(t.label)}')">Delete</button>
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

/* ── Found deals ────────────────────────────────────────────────────────────── */
async function loadFoundDeals() {
  foundDeals = await fetch("/api/found").then((r) => r.json());
  foundListingsLoaded.cars = true;
  renderFoundDeals();
  renderFoundListingsTab();
}

function renderFoundDeals() {
  const container = document.getElementById("foundCards");
  const search  = document.getElementById("foundSearch")?.value.toLowerCase() || "";
  const verdict = document.getElementById("verdictFilter")?.value || "";

  const baseMatches = foundDeals.filter((d) => {
    const hay = `${d.vehicle?.year ?? ""} ${d.vehicle?.make ?? ""} ${d.vehicle?.model ?? ""} ${d.listing?.title ?? ""}`.toLowerCase();
    return (!search || hay.includes(search)) && (!verdict || d.underwriting?.verdict === verdict);
  });

  renderGroupFilters("foundGroupFilters", currentFoundGroup, (g) => {
    currentFoundGroup = g;
    renderFoundDeals();
  }, countByGroup(baseMatches, getTargetGroup));

  const filtered = baseMatches.filter((d) => currentFoundGroup === "all" || getTargetGroup(d) === currentFoundGroup);

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">No finds match your filters yet.</div>';
    return;
  }

  container.innerHTML = filtered.map((deal) => buildCarCard(deal, foundDeals.indexOf(deal))).join("");
}

function buildFoundCarDealCard(deal, dealIndex) {
  const id = deal.listing?.id || `car-${Number.isFinite(dealIndex) ? dealIndex : Math.random()}`;
  const photos = Array.isArray(deal.listing?.photos) ? deal.listing.photos.filter(Boolean) : [];
  const verdict = deal.underwriting?.verdict || "pass";
  const targetType = getTargetType(deal);
  const issues = [...new Set([...(deal.vehicle?.issues || []), ...(deal.ai_analysis?.visible_issues || [])])].slice(0, 3);
  const margin = deal.market?.estimatedMargin ?? null;
  const risk = deal.underwriting?.riskScore ?? null;
  const notes = deal.ai_analysis?.notes || deal.underwriting?.notes || deal.underwriting?.summary || "No underwriting summary.";
  const subline = buildDealSubline(deal);
  const specsHtml = buildDealSpecPills(deal, targetType);
  const openUrl = deal.sources?.listingUrl || deal.listing?.url || "";
  const tierClass = verdict === "buy_now" ? "deal-tier-good" : verdict === "maybe" ? "deal-tier-okay" : "";
  const tierPill = verdict === "buy_now"
    ? '<span class="deal-tier-pill good">Buy now</span>'
    : verdict === "maybe"
      ? '<span class="deal-tier-pill okay">Maybe</span>'
      : "";
  const marginTone = margin === null ? "" : margin >= 2000 ? "good" : margin >= 500 ? "warn" : "bad";
  const riskTone = risk === null ? "" : risk < 40 ? "good" : risk < 65 ? "warn" : "bad";

  const photoHtml = photos.length
    ? `
      <div class="car-img-wrap shared-photo-wrap" data-card-id="${escAttr(id)}" data-photos='${escAttr(JSON.stringify(photos))}' onclick="cyclePhoto(event, this, 1)">
        <img class="car-img shared-photo-img" src="${escAttr(photos[0])}" alt="${escAttr(vehicleLabel(deal))}" onerror="this.parentElement.querySelector('.car-img-placeholder') && (this.style.display='none')" />
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
    <article class="deal-card market-deal-card found-board-card ${tierClass}" onclick="openFoundDealModal(${Number.isFinite(dealIndex) ? dealIndex : -1})">
      ${photoHtml}
      <div class="market-deal-body">
        <div class="market-deal-top">
          <div>
            <div class="found-card-kicker">
              <span class="badge ${foundPlatformBadgeClass("cars")}">Cars</span>
              <span>Found Listing</span>
            </div>
            <div class="process-name">${escHtml(vehicleLabel(deal))}</div>
            <div class="process-desc">${escHtml(subline || deal.target?.label || deal.query || "Car sniper hit")}</div>
          </div>
          <div class="market-deal-badges">
            ${tierPill}
            <span class="badge badge-${escAttr(verdict)}">${escHtml(labelVerdict(verdict))}</span>
          </div>
        </div>

        <div class="marketplace-metrics compact">
          <div class="market-metric">
            <span class="market-metric-label">Listed</span>
            <strong>${formatMoney(deal.listing?.price)}</strong>
          </div>
          <div class="market-metric">
            <span class="market-metric-label">Max Buy</span>
            <strong>${formatMoney(deal.market?.maxBuy)}</strong>
          </div>
          <div class="market-metric">
            <span class="market-metric-label">Margin</span>
            <strong class="${marginTone}">${formatMoney(deal.market?.estimatedMargin)}</strong>
          </div>
          <div class="market-metric">
            <span class="market-metric-label">Risk</span>
            <strong class="${riskTone}">${risk !== null ? `${risk}/100` : "–"}</strong>
          </div>
        </div>

        ${specsHtml ? `<div class="car-specs">${specsHtml}</div>` : ""}
        ${issues.length ? `<div class="car-issues">${issues.map((issue) => `<span class="issue-tag">${escHtml(issue)}</span>`).join("")}</div>` : ""}
        <div class="car-notes">${escHtml(notes)}</div>

        <div class="car-footer">
          <div class="car-target-label">
            ${escHtml(deal.target?.label || deal.query || "Custom Target")}
            ${deal.target?.group ? ` &middot; ${escHtml(deal.target.group)}` : ""}
          </div>
          <button class="car-open-btn" onclick="event.stopPropagation(); openInBrowser('${escAttr(openUrl)}')">Open ↗</button>
        </div>
      </div>
    </article>
  `;
}

function buildCarCard(deal, dealIndex) {
  const id       = deal.listing?.id || String(Math.random());
  const photos   = Array.isArray(deal.listing?.photos) ? deal.listing.photos.filter(Boolean) : [];
  const verdict  = deal.underwriting?.verdict || "pass";
  const targetType = getTargetType(deal);
  const issues   = [...new Set([...(deal.vehicle?.issues || []), ...(deal.ai_analysis?.visible_issues || [])])].slice(0, 4);
  const margin   = deal.market?.estimatedMargin ?? null;
  const risk     = deal.underwriting?.riskScore ?? null;
  const notes    = deal.ai_analysis?.notes || deal.underwriting?.notes || deal.underwriting?.summary || "No underwriting summary.";
  const subline  = buildDealSubline(deal);

  const imgHtml = photos.length
    ? `
      <div class="car-img-wrap" data-card-id="${escAttr(id)}" data-photos='${escAttr(JSON.stringify(photos))}' onclick="cyclePhoto(event, this, 1)">
        <img class="car-img" src="${escAttr(photos[0])}" alt="listing photo" onerror="this.parentElement.querySelector('.car-img-placeholder') && (this.style.display='none')" />
        ${photos.length > 1 ? `
          <button type="button" class="img-nav img-nav-prev" aria-label="Previous photo" onclick="cyclePhoto(event, this.parentElement, -1)">‹</button>
          <button type="button" class="img-nav img-nav-next" aria-label="Next photo" onclick="cyclePhoto(event, this.parentElement, 1)">›</button>
          <div class="img-dots">
            ${photos.map((_, i) => `<span class="img-dot${i === 0 ? " active" : ""}"></span>`).join("")}
          </div>
          <span class="img-count">1 / ${photos.length}</span>
        ` : ""}
      </div>`
    : `<div class="car-img-wrap"><div class="car-img-placeholder">No photo</div></div>`;

  const marginTone = margin === null ? "" : margin >= 2000 ? "good" : margin >= 500 ? "warn" : "bad";
  const riskTone   = risk === null ? "" : risk < 40 ? "good" : risk < 65 ? "warn" : "bad";
  const specsHtml = buildDealSpecPills(deal, targetType);

  const issuesHtml = issues.length
    ? `<div class="car-issues">${issues.map((i) => `<span class="issue-tag">${escHtml(i)}</span>`).join("")}</div>`
    : "";

  return `
    <article class="car-card${verdict === "buy_now" ? " verdict-buy_now" : ""}" onclick="openFoundDealModal(${Number.isFinite(dealIndex) ? dealIndex : -1})">
      ${imgHtml}
      <div class="car-body">
        <div class="car-header">
          <div>
            <div class="car-model">${escHtml(vehicleLabel(deal))}</div>
            <div class="car-sub">${escHtml(subline)}</div>
          </div>
          <span class="badge badge-${verdict}">${labelVerdict(verdict)}</span>
        </div>

        <div class="car-prices">
          <div class="price-item">
            <div class="price-label">Listed</div>
            <div class="price-value">${formatMoney(deal.listing?.price)}</div>
          </div>
          <div class="price-item">
            <div class="price-label">Max Buy</div>
            <div class="price-value good">${formatMoney(deal.market?.maxBuy)}</div>
          </div>
          <div class="price-item">
            <div class="price-label">Margin</div>
            <div class="price-value ${marginTone}">${formatMoney(deal.market?.estimatedMargin)}</div>
          </div>
          <div class="price-item">
            <div class="price-label">Risk</div>
            <div class="price-value ${riskTone}">${risk !== null ? `${risk}/100` : "–"}</div>
          </div>
        </div>

        ${specsHtml ? `<div class="car-specs">${specsHtml}</div>` : ""}
        ${issuesHtml}

        <div class="car-notes">${escHtml(notes)}</div>

        <div class="car-footer">
          <div class="car-target-label">
            ${escHtml(deal.target?.label || deal.query || "Custom Target")}
            ${deal.target?.group ? ` &middot; ${escHtml(deal.target.group)}` : ""}
            ${targetType ? ` &middot; ${escHtml(formatTargetType(targetType))}` : ""}
          </div>
          <button class="car-open-btn" onclick="event.stopPropagation(); openInBrowser('${escAttr(deal.sources?.listingUrl || deal.listing?.url || "")}')">Open ↗</button>
        </div>
      </div>
    </article>`;
}

/* ── Photo carousel ─────────────────────────────────────────────────────────── */
function cyclePhoto(event, wrap, step = 1) {
  if (event) event.stopPropagation();
  const id = wrap.dataset.cardId;
  let photos;
  try { photos = JSON.parse(wrap.dataset.photos); } catch { return; }
  if (!photos || photos.length < 2) return;

  const current = photoIndexes[id] ?? 0;
  const idx = ((current + step) % photos.length + photos.length) % photos.length;
  photoIndexes[id] = idx;

  const img = wrap.querySelector(".car-img");
  if (img) img.src = photos[idx];

  const dots = wrap.querySelectorAll(".img-dot");
  dots.forEach((d, i) => d.classList.toggle("active", i === idx));

  const count = wrap.querySelector(".img-count");
  if (count) count.textContent = `${idx + 1} / ${photos.length}`;
}

/* ── Rejected deals ─────────────────────────────────────────────────────────── */
async function loadRejectedDeals() {
  rejectedDeals = await fetch("/api/rejected").then((r) => r.json());
  renderRejectedDeals();
}

function renderRejectedDeals() {
  const container = document.getElementById("rejectedCards");
  const search = document.getElementById("rejectedSearch")?.value.toLowerCase() || "";

  const baseMatches = rejectedDeals.filter((d) => {
    const hay = `${d.title ?? ""} ${d.reason ?? ""} ${d.make ?? ""} ${d.model ?? ""}`.toLowerCase();
    return !search || hay.includes(search);
  });

  renderGroupFilters("rejectedGroupFilters", currentRejectedGroup, (g) => {
    currentRejectedGroup = g;
    renderRejectedDeals();
  }, countByGroup(baseMatches, getRejectedGroup));

  const filtered = baseMatches.filter((d) => currentRejectedGroup === "all" || getRejectedGroup(d) === currentRejectedGroup);

  if (!filtered.length) {
    container.innerHTML = '<div class="empty">No rejected finds match your filter.</div>';
    return;
  }

  container.innerHTML = filtered.map((d) => `
    <article class="reject-card" onclick="openRejectedDealModal(${rejectedDeals.indexOf(d)})">
      <div class="reject-header">
        <div>
          <div class="reject-title">${escHtml(d.title || `${d.year ?? ""} ${d.make ?? ""} ${d.model ?? ""}`.trim() || "Rejected listing")}</div>
          <div class="reject-sub">${escHtml(getRejectedGroup(d))} &middot; ${formatMoney(d.listing_price)}</div>
        </div>
      </div>
      <div class="car-specs">
        ${specPill("Target", d.target_label || d.query || "Unknown")}
        ${d.title_status && d.title_status !== "unknown" ? specPill("Title", formatTitleStatus(d.title_status), titleTone(d.title_status)) : ""}
      </div>
      <div class="reject-reason">${escHtml(d.reason || "No rejection reason saved.")}</div>
      <div class="reject-footer">
        <button class="car-open-btn" onclick="event.stopPropagation(); openInBrowser('${escAttr(d.url || "")}')">Open ↗</button>
      </div>
    </article>
  `).join("");
}

function openFoundDealModal(index) {
  const deal = foundDeals[index];
  if (!deal) return;
  const targetType = getTargetType(deal);
  const reasons = normalizeReasonList(deal.underwriting?.reasons);
  const notes = deal.ai_analysis?.notes || deal.underwriting?.notes || deal.underwriting?.summary || "No explanation saved.";
  const metrics = [
    metricRow("Listed", formatMoney(deal.listing?.price)),
    metricRow("Est. Retail", formatMoney(deal.market?.estRetail)),
    metricRow("Max Buy", formatMoney(deal.market?.maxBuy)),
    metricRow("Margin", formatMoney(deal.market?.estimatedMargin)),
    metricRow("Recon", formatMoney(deal.market?.reconReserve)),
    metricRow("Fees", formatMoney(deal.market?.feesReserve)),
    metricRow("Risk", deal.underwriting?.riskScore != null ? `${deal.underwriting.riskScore}/100` : "–"),
  ];
  if (Number(deal.market?.targetMarginFloor) > 0) {
    metrics.push(metricRow("Target Profit Goal", formatMoney(deal.market?.targetMarginFloor)));
  }

  const modalPhotos = Array.isArray(deal.listing?.photos) ? deal.listing.photos.filter(Boolean) : [];
  const modalPhotoId = `modal-${deal.listing?.id || Math.random()}`;
  const photo = modalPhotos.length
    ? `
      <div class="car-img-wrap deal-modal-photo-wrap" data-card-id="${escAttr(modalPhotoId)}" data-photos='${escAttr(JSON.stringify(modalPhotos))}' onclick="cyclePhoto(event, this, 1)">
        <img class="car-img deal-modal-photo" src="${escAttr(modalPhotos[0])}" alt="listing photo" />
        ${modalPhotos.length > 1 ? `
          <button type="button" class="img-nav img-nav-prev" aria-label="Previous photo" onclick="cyclePhoto(event, this.parentElement, -1)">‹</button>
          <button type="button" class="img-nav img-nav-next" aria-label="Next photo" onclick="cyclePhoto(event, this.parentElement, 1)">›</button>
          <div class="img-dots">
            ${modalPhotos.map((_, i) => `<span class="img-dot${i === 0 ? " active" : ""}"></span>`).join("")}
          </div>
          <span class="img-count">1 / ${modalPhotos.length}</span>
        ` : ""}
      </div>`
    : "";

  const specs = buildModalSpecPills(deal, targetType);
  const visibleIssues = [...new Set([...(deal.vehicle?.issues || []), ...(deal.ai_analysis?.visible_issues || [])])];

  openDealModal({
    eyebrow: `${labelVerdict(deal.underwriting?.verdict || "pass")} · ${formatTargetType(targetType)}`,
    title: vehicleLabel(deal),
    body: `
      ${photo}
      <div class="deal-modal-grid">
        ${metrics.join("")}
      </div>
      ${specs ? `<div class="deal-modal-section"><div class="deal-modal-section-title">Signals</div><div class="car-specs">${specs}</div></div>` : ""}
      <div class="deal-modal-section">
        <div class="deal-modal-section-title">Why It Looks ${deal.underwriting?.verdict === "buy_now" ? "Good" : deal.underwriting?.verdict === "maybe" ? "Interesting" : "Risky"}</div>
        <div class="deal-modal-copy">${escHtml(notes)}</div>
      </div>
      ${reasons.length ? `<div class="deal-modal-section"><div class="deal-modal-section-title">Decision Factors</div><div class="deal-modal-list">${reasons.map((reason) => `<div class="deal-modal-list-item">${escHtml(reason)}</div>`).join("")}</div></div>` : ""}
      ${visibleIssues.length ? `<div class="deal-modal-section"><div class="deal-modal-section-title">Visible / Parsed Issues</div><div class="deal-modal-list">${visibleIssues.map((issue) => `<div class="deal-modal-list-item">${escHtml(formatConditionLabel(issue) || issue)}</div>`).join("")}</div></div>` : ""}
      <div class="deal-modal-section">
        <div class="deal-modal-section-title">Listing</div>
        <div class="deal-modal-copy">${escHtml(buildDealSubline(deal))}</div>
      </div>
      <div class="deal-modal-actions">
        <button class="btn btn-secondary" onclick="closeDealModal()">Close</button>
        <button class="btn btn-primary" onclick="openInBrowser('${escAttr(deal.sources?.listingUrl || deal.listing?.url || "")}')">Open In Browser</button>
      </div>
    `,
  });
}

function openRejectedDealModal(index) {
  const deal = rejectedDeals[index];
  if (!deal) return;
  const reasons = normalizeReasonList(deal.reason);

  openDealModal({
    eyebrow: "Rejected Listing",
    title: deal.title || `${deal.year ?? ""} ${deal.make ?? ""} ${deal.model ?? ""}`.trim() || "Rejected listing",
    body: `
      <div class="deal-modal-grid">
        ${metricRow("Listed", formatMoney(deal.listing_price))}
        ${metricRow("Target", escHtml(deal.target_label || deal.query || "Unknown"))}
        ${metricRow("Group", escHtml(getRejectedGroup(deal)))}
        ${deal.year ? metricRow("Year", escHtml(String(deal.year))) : ""}
        ${deal.make ? metricRow("Make", escHtml(deal.make)) : ""}
        ${deal.model ? metricRow("Model", escHtml(deal.model)) : ""}
        ${deal.title_status ? metricRow("Title", escHtml(formatTitleStatus(deal.title_status))) : ""}
      </div>
      <div class="deal-modal-section">
        <div class="deal-modal-section-title">Why It Was Rejected</div>
        <div class="deal-modal-list">${reasons.map((reason) => `<div class="deal-modal-list-item">${escHtml(reason)}</div>`).join("") || '<div class="deal-modal-copy">No rejection reason saved.</div>'}</div>
      </div>
      <div class="deal-modal-actions">
        <button class="btn btn-secondary" onclick="closeDealModal()">Close</button>
        <button class="btn btn-primary" onclick="openInBrowser('${escAttr(deal.url || "")}')">Open In Browser</button>
      </div>
    `,
  });
}

function openDealModal({ eyebrow, title, body }) {
  activeDealModal = { eyebrow, title, body };
  document.getElementById("dealModalEyebrow").textContent = eyebrow || "Listing Review";
  document.getElementById("dealModalTitle").textContent = title || "Listing Details";
  document.getElementById("dealModalBody").innerHTML = body || "";
  document.getElementById("dealModal").classList.add("open");
}

function closeDealModal() {
  activeDealModal = null;
  document.getElementById("dealModal").classList.remove("open");
}

/* ── Settings ───────────────────────────────────────────────────────────────── */
async function loadSettings() {
  try {
    const data = await fetchJson("/api/settings");
    appConfig  = data.config || {};
    watchlist  = Array.isArray(data.watchlist) ? data.watchlist : [];
    syncTargetGroups();
    renderWatchlist();
    renderFoundDeals();
    renderRejectedDeals();

    if (carSettingsDirty) {
      if (currentTopTab === "cars" && currentCarView === "settings") {
        setSettingsStatus("Detected newer car settings on disk. Your unsaved edits were kept; use Reload to refresh.", "");
      }
      return;
    }

    document.getElementById("configEditor").value   = JSON.stringify(appConfig, null, 2);
    document.getElementById("watchlistEditor").value = JSON.stringify(watchlist, null, 2);

    // Populate quick settings fields
    document.getElementById("qsInterval").value = Math.max(180, appConfig.intervalSeconds ?? 180);
    document.getElementById("qsRadius").value = appConfig.radiusKM ?? 120;
    document.getElementById("qsAllowShipping").value = appConfig.allowShipping === false ? "false" : "true";
    document.getElementById("qsLocationLabel").value = appConfig.location?.label || "";
    document.getElementById("qsLatitude").value = appConfig.location?.latitude ?? "";
    document.getElementById("qsLongitude").value = appConfig.location?.longitude ?? "";
    document.getElementById("qsSearchConcurrency").value = appConfig.searchConcurrency ?? 2;
    document.getElementById("qsDetailConcurrency").value = appConfig.detailConcurrency ?? 3;
    document.getElementById("qsProxy").value    = appConfig.proxy || "";
    document.getElementById("qsProxyPool").value = Array.isArray(appConfig.proxyPool) ? appConfig.proxyPool.join("\n") : "";
    updateProxyWarning();

    carSettingsDirty = false;
    setSettingsStatus("Loaded current settings from disk.", "ok");
  } catch (err) {
    setSettingsStatus(`Failed to load settings: ${err.message}`, "err");
  }
}

function updateProxyWarning() {
  const proxy = document.getElementById("qsProxy").value.trim();
  const proxyPool = document.getElementById("qsProxyPool")?.value.trim() || "";
  document.getElementById("proxyWarning").style.display = (proxy || proxyPool) ? "none" : "";
}

async function saveQuickSettings() {
  // Merge quick fields into whatever is currently in the config editor
  let nextConfig;
  try {
    nextConfig = JSON.parse(document.getElementById("configEditor").value);
  } catch {
    nextConfig = { ...appConfig };
  }

  const interval = parseInt(document.getElementById("qsInterval").value, 10);
  const radius = parseFloat(document.getElementById("qsRadius").value);
  const allowShipping = document.getElementById("qsAllowShipping").value === "true";
  const locationLabel = document.getElementById("qsLocationLabel").value.trim();
  const latitude = parseFloat(document.getElementById("qsLatitude").value);
  const longitude = parseFloat(document.getElementById("qsLongitude").value);
  const searchConcurrency = parseInt(document.getElementById("qsSearchConcurrency").value, 10);
  const detailConcurrency = parseInt(document.getElementById("qsDetailConcurrency").value, 10);
  const proxy   = document.getElementById("qsProxy").value.trim();
  const proxyPool = document.getElementById("qsProxyPool").value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  delete nextConfig.gemini_api_key;
  delete nextConfig.geminiConcurrency;

  if (!isNaN(interval)) nextConfig.intervalSeconds = Math.max(180, interval);
  if (!isNaN(radius) && radius >= 1) nextConfig.radiusKM = radius;
  if (!isNaN(searchConcurrency) && searchConcurrency >= 1) nextConfig.searchConcurrency = searchConcurrency;
  if (!isNaN(detailConcurrency) && detailConcurrency >= 1) nextConfig.detailConcurrency = detailConcurrency;
  nextConfig.allowShipping = allowShipping;

  nextConfig.location = {
    ...(nextConfig.location || {}),
    label: locationLabel,
  };
  if (!isNaN(latitude)) nextConfig.location.latitude = latitude;
  if (!isNaN(longitude)) nextConfig.location.longitude = longitude;
  nextConfig.location.confirmed = Number.isFinite(Number(nextConfig.location.latitude))
    && Number.isFinite(Number(nextConfig.location.longitude));

  if (proxy) nextConfig.proxy = proxy;
  else delete nextConfig.proxy;
  nextConfig.proxyPool = proxyPool;

  // Keep the raw editor in sync
  document.getElementById("configEditor").value = JSON.stringify(nextConfig, null, 2);

  const res    = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: nextConfig, watchlist }),
  });
  const result = await res.json();

  if (!res.ok || !result.ok) {
    setSettingsStatus(result.error || "Failed to save.", "err");
    return;
  }

  appConfig = nextConfig;
  updateProxyWarning();
  renderWatchlist();
  setSettingsStatus("Quick settings saved. Restart the scan loop to apply.", "ok");
  showToast("Quick settings saved.");
}

async function saveSettings() {
  let nextConfig, nextWatchlist;
  try {
    nextConfig   = JSON.parse(document.getElementById("configEditor").value);
    nextWatchlist = JSON.parse(document.getElementById("watchlistEditor").value);
  } catch (e) {
    setSettingsStatus(`Invalid JSON: ${e.message}`, "err");
    return;
  }

  if (!nextConfig || typeof nextConfig !== "object" || Array.isArray(nextConfig)) {
    setSettingsStatus("Config must be a JSON object.", "err");
    return;
  }
  if (!Array.isArray(nextWatchlist)) {
    setSettingsStatus("Targets must be a JSON array.", "err");
    return;
  }

  const res    = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: nextConfig, watchlist: nextWatchlist }),
  });
  const result = await res.json();

  if (!res.ok || !result.ok) {
    setSettingsStatus(result.error || "Failed to save settings.", "err");
    return;
  }

  appConfig  = nextConfig;
  watchlist  = nextWatchlist;
  syncTargetGroups();
  renderWatchlist();
  renderFoundDeals();
  renderRejectedDeals();
  refreshStatus();
  carSettingsDirty = false;
  setSettingsStatus("Saved. Restart the scan loop to apply immediately.", "ok");
  showToast("Car settings saved.");
}

async function toggleTarget(id, enabled) {
  const res = await fetch("/api/watchlist/toggle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, enabled }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    setSettingsStatus(data.error || "Failed to toggle target.", "err");
    return;
  }

  await loadSettings();
  refreshStatus();
  showToast(`Target ${enabled ? "enabled" : "disabled"}.`);
}

async function deleteTarget(id, label) {
  if (!confirm(`Delete "${label}" from the watchlist?`)) return;
  const res = await fetch("/api/watchlist/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    setSettingsStatus(data.error || "Failed to delete target.", "err");
    return;
  }
  await loadSettings();
  refreshStatus();
  setSettingsStatus(`Deleted ${label}.`, "ok");
  showToast(`Deleted ${label}.`);
}

async function moveTargetToGroup(id, trimmed) {
  const res = await fetch("/api/watchlist/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, group: trimmed }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    setSettingsStatus(data.error || "Failed to move target.", "err");
    return;
  }
  await loadSettings();
  refreshStatus();
  setSettingsStatus(`Moved target to ${trimmed}.`, "ok");
  showToast(`Moved target to ${trimmed}.`);
}

async function renameGroup(group) {
  openTextPromptModal({
    eyebrow: "Rename Category",
    title: `Rename ${group}`,
    label: "New category name",
    value: group,
    onSubmit: async (trimmed) => {
      if (!trimmed || trimmed === group) return;
      const res = await fetch("/api/watchlist/rename-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: group, to: trimmed }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSettingsStatus(data.error || "Failed to rename category.", "err");
        return false;
      }
      await loadSettings();
      refreshStatus();
      setSettingsStatus(`Renamed ${group} to ${trimmed}.`, "ok");
      showToast(`Renamed ${group} to ${trimmed}.`);
      return true;
    },
  });
}

function startTargetDrag(event, id) {
  draggedTargetId = id;
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}

function endTargetDrag() {
  draggedTargetId = null;
  document.querySelectorAll(".watch-grid.drag-over").forEach((node) => node.classList.remove("drag-over"));
}

function handleGroupDragOver(event, group) {
  if (!draggedTargetId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  document.querySelector(`.watch-grid[data-group='${cssEscape(group)}']`)?.classList.add("drag-over");
}

function handleGroupDragLeave(_event, group) {
  document.querySelector(`.watch-grid[data-group='${cssEscape(group)}']`)?.classList.remove("drag-over");
}

async function handleGroupDrop(event, group) {
  event.preventDefault();
  const id = draggedTargetId || event.dataTransfer?.getData("text/plain");
  document.querySelector(`.watch-grid[data-group='${cssEscape(group)}']`)?.classList.remove("drag-over");
  if (!id) return;
  const target = watchlist.find((item) => item.id === id);
  if (!target || (target.group || "General") === group) {
    draggedTargetId = null;
    return;
  }
  await moveTargetToGroup(id, group);
  draggedTargetId = null;
}

function openTextPromptModal({ eyebrow, title, label, value = "", onSubmit }) {
  activeTextPrompt = { onSubmit };
  document.getElementById("textPromptEyebrow").textContent = eyebrow || "Edit";
  document.getElementById("textPromptTitle").textContent = title || "Update Value";
  document.getElementById("textPromptLabel").textContent = label || "Value";
  const input = document.getElementById("textPromptInput");
  input.value = value || "";
  document.getElementById("textPromptModal").classList.add("open");
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

function closeTextPromptModal() {
  activeTextPrompt = null;
  document.getElementById("textPromptModal").classList.remove("open");
}

async function submitTextPromptModal() {
  const input = document.getElementById("textPromptInput");
  const value = input.value.trim();
  if (!activeTextPrompt?.onSubmit) {
    closeTextPromptModal();
    return;
  }
  const shouldClose = await activeTextPrompt.onSubmit(value);
  if (shouldClose !== false) closeTextPromptModal();
}

function reloadSettings() {
  carSettingsDirty = false;
  loadSettings();
}

function setSettingsStatus(msg, tone = "") {
  const node = document.getElementById("settingsStatus");
  node.textContent = msg;
  node.className = `settings-status ${tone}`.trim();
}

async function resetMemory() {
  if (!confirm("Wipe found listings, rejected log, and seen-IDs cache? This cannot be undone.")) return;
  try {
    const resp = await fetch("/api/reset-memory", { method: "POST" });
    const data = await resp.json();
    if (!resp.ok || !data.ok) throw new Error(data.error || "Reset failed");
    setSettingsStatus("Memory wiped. Restart the sniper to start fresh.", "ok");
    await Promise.all([loadFoundDeals(), loadRejectedDeals()]);
    showToast("Memory wiped.");
  } catch (err) {
    setSettingsStatus(`Reset failed: ${err.message}`, "err");
  }
}

/* ── Group filters ──────────────────────────────────────────────────────────── */
const groupFilterHandlers = {};

function renderGroupFilters(containerId, current, onSelect, counts = {}) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const allCount = Object.values(counts).reduce((s, n) => s + n, 0);
  container.innerHTML = ["all", ...targetGroups].map((g) => {
    const label = g === "all" ? "All" : g;
    const count = g === "all" ? allCount : (counts[g] || 0);
    return `<button class="chip-btn ${current === g ? "active" : ""}" onclick="setGroupFilter('${containerId}','${escAttr(g)}')">${escHtml(label)} <strong>${count}</strong></button>`;
  }).join("");
  groupFilterHandlers[containerId] = onSelect;
}

function setGroupFilter(containerId, value) {
  if (groupFilterHandlers[containerId]) groupFilterHandlers[containerId](value);
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */
function getTargetGroup(deal)    { return deal.target?.group || "General"; }
function getRejectedGroup(deal)  { return deal.target_group  || "General"; }

function getTargetType(entity) {
  const explicit = String(entity?.target?.targetType || entity?.targetType || "").toLowerCase();
  if (explicit) return explicit;

  const raw = `${entity?.target?.group || entity?.group || ""} ${entity?.target?.label || entity?.label || ""} ${entity?.target?.query || entity?.query || ""} ${entity?.vehicle?.make || entity?.make || ""} ${entity?.vehicle?.model || entity?.model || ""} ${entity?.listing?.title || ""}`.toLowerCase();
  if (/\biphone\b|\bipad\b|\bmacbook\b|\bairpods\b|\bplaystation\b|\bps[45]\b|\bxbox\b|\bnintendo\b|\bcamera\b|\blaptop\b|\bphone\b|\btablet\b|\bconsole\b/.test(raw)) return "electronics";
  if (/\bcar\b|\bvehicle\b|\bsedan\b|\bsuv\b|\btruck\b|\bcoupe\b|\bhatchback\b/.test(raw) || Number(entity?.maxMileage || entity?.baselineMiles || entity?.vehicle?.mileageMiles) > 0) return "vehicle";
  return "general";
}

function formatTargetType(value) {
  if (value === "electronics") return "Electronics";
  if (value === "vehicle") return "Vehicle";
  return "General";
}

function countByGroup(items, picker) {
  return items.reduce((acc, item) => {
    const g = picker(item) || "General";
    acc[g] = (acc[g] || 0) + 1;
    return acc;
  }, {});
}

function vehicleLabel(deal) {
  if (getTargetType(deal) !== "vehicle") {
    return deal.listing?.title || deal.target?.label || deal.query || "Unknown Listing";
  }
  return [deal.vehicle?.year, deal.vehicle?.make, deal.vehicle?.model, deal.vehicle?.trim]
    .filter(Boolean).join(" ") || deal.listing?.title || "Unknown Vehicle";
}

function hasMeaningfulYear(value) {
  const year = Number(value);
  return Number.isFinite(year) && year >= 1990 && year <= 2055;
}

function renderWatchFacts(target) {
  const targetType = getTargetType(target);
  const facts = [];
  const avoidTerms = getAvoidTerms(target);
  const hasStartYear = hasMeaningfulYear(target.yearStart);
  const hasEndYear = hasMeaningfulYear(target.yearEnd);

  if (targetType === "vehicle") {
    facts.push(`<div class="watch-fact"><strong>${hasStartYear ? target.yearStart : "?"}&ndash;${hasEndYear ? target.yearEnd : "?"}</strong> model years &middot; max <strong>${formatNumber(target.maxMileage)} mi</strong></div>`);
  } else if (hasStartYear || hasEndYear) {
    facts.push(`<div class="watch-fact"><strong>${hasStartYear ? target.yearStart : "?"}&ndash;${hasEndYear ? target.yearEnd : "?"}</strong> release years</div>`);
  }

  facts.push(`<div class="watch-fact">Retail base <strong>$${formatNumber(target.retailBase)}</strong> &middot; profit goal <strong>$${formatNumber(target.marginFloor)}</strong></div>`);
  facts.push(`<div class="watch-fact">Fees <strong>$${formatNumber(target.feesReserve)}</strong> &middot; recon <strong>$${formatNumber(target.reconBase)}</strong></div>`);
  if (target.minPrice != null || target.maxPrice != null) {
    facts.push(`<div class="watch-fact">Search band <strong>$${formatNumber(target.minPrice)}</strong> to <strong>$${formatNumber(target.maxPrice)}</strong></div>`);
  }
  if (target.radiusKM != null || target.allowShipping != null) {
    const shippingLabel = target.allowShipping === false ? "Local only" : "Shipping OK";
    facts.push(`<div class="watch-fact">Search radius <strong>${formatNumber(target.radiusKM || appConfig.radiusKM)} km</strong> &middot; ${escHtml(shippingLabel)}</div>`);
  }
  if ((target.mustInclude || []).length) {
    facts.push(`<div class="watch-fact">Must include: <strong>${escHtml((target.mustInclude || []).join(", "))}</strong></div>`);
  }
  if (avoidTerms.length) {
    facts.push(`<div class="watch-fact">Must avoid: <strong>${escHtml(avoidTerms.join(", "))}</strong></div>`);
  }
  if ((target.aliases || []).length) {
    facts.push(`<div class="watch-fact">Aliases: <strong>${escHtml((target.aliases || []).slice(0, 4).join(", "))}</strong></div>`);
  }

  return facts.join("");
}

function buildDealSubline(deal) {
  const seller = deal.listing?.seller?.name;
  const location = deal.listing?.location || deal.listing?.seller?.location || seller || "FB Marketplace";
  const targetType = getTargetType(deal);

  if (targetType === "vehicle") {
    return `${location} · ${formatMiles(deal.vehicle?.mileageMiles)}`;
  }

  const bits = [location];
  const screen = formatConditionLabel(deal.ai_analysis?.screen_condition);
  const battery = deal.ai_analysis?.battery_health_value || deal.vehicle?.batteryHealthValue || "";
  const storage = deal.ai_analysis?.storage_gb || deal.vehicle?.storageGb || "";
  if (screen) bits.push(`Screen ${screen}`);
  if (battery) bits.push(`Battery ${battery}`);
  if (storage) bits.push(`${storage}GB`);
  return bits.join(" · ");
}

function buildDealSpecPills(deal, targetType) {
  if (targetType === "vehicle") {
    return [
      deal.vehicle?.titleStatus && deal.vehicle.titleStatus !== "unknown" ? specPill("Title", formatTitleStatus(deal.vehicle.titleStatus), titleTone(deal.vehicle.titleStatus)) : "",
      deal.vehicle?.drivetrain && deal.vehicle.drivetrain !== "Unknown" ? specPill("Drive", deal.vehicle.drivetrain) : "",
      deal.vehicle?.transmission && deal.vehicle.transmission !== "Unknown" ? specPill("Trans", deal.vehicle.transmission) : "",
      deal.vehicle?.fuelType ? specPill("Fuel", deal.vehicle.fuelType) : "",
      deal.market?.recallCount ? specPill("Recalls", String(deal.market.recallCount), "warn") : "",
      deal.ai_analysis?.stock_photos_only ? specPill("Stock", "Photos", "warn") : "",
    ].filter(Boolean).join("");
  }

  return [
    formatConditionLabel(deal.ai_analysis?.screen_condition) ? specPill("Screen", formatConditionLabel(deal.ai_analysis?.screen_condition), deal.ai_analysis?.screen_condition === "cracked" ? "bad" : "") : "",
    formatConditionLabel(deal.ai_analysis?.body_condition) ? specPill("Body", formatConditionLabel(deal.ai_analysis?.body_condition), /damaged|dented/.test(String(deal.ai_analysis?.body_condition || "")) ? "bad" : "") : "",
    deal.ai_analysis?.battery_health_value || deal.vehicle?.batteryHealthValue ? specPill("Battery", deal.ai_analysis?.battery_health_value || deal.vehicle?.batteryHealthValue) : "",
    deal.ai_analysis?.storage_gb || deal.vehicle?.storageGb ? specPill("Storage", `${deal.ai_analysis?.storage_gb || deal.vehicle?.storageGb}GB`) : "",
    deal.ai_analysis?.stock_photos_only ? specPill("Stock", "Photos", "warn") : "",
  ].filter(Boolean).join("");
}

function buildModalSpecPills(deal, targetType) {
  const base = buildDealSpecPills(deal, targetType);
  if (base) return base;
  return [
    deal.target?.label ? specPill("Target", deal.target.label) : "",
    deal.target?.group ? specPill("Group", deal.target.group) : "",
    deal.underwriting?.confidence ? specPill("Confidence", formatConditionLabel(deal.underwriting.confidence)) : "",
  ].filter(Boolean).join("");
}

function normalizeReasonList(input) {
  const parts = Array.isArray(input) ? input : String(input || "").split(";");
  return [...new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))];
}

function metricRow(label, value) {
  return `
    <div class="deal-metric">
      <div class="deal-metric-label">${escHtml(label)}</div>
      <div class="deal-metric-value">${typeof value === "string" ? value : escHtml(String(value ?? "–"))}</div>
    </div>
  `;
}

function getAvoidTerms(target) {
  const mustAvoid = Array.isArray(target?.mustAvoid) ? target.mustAvoid.filter(Boolean) : [];
  if (mustAvoid.length) return mustAvoid;
  return Array.isArray(target?.avoidKeywords) ? target.avoidKeywords.filter(Boolean) : [];
}

function labelVerdict(v) {
  if (v === "buy_now") return "Buy Now";
  if (v === "maybe")   return "Maybe";
  return "Pass";
}

function titleTone(status) {
  if (!status || status === "clean") return "";
  if (status === "rebuilt" || status === "salvage") return "bad";
  return "warn";
}

function specPill(label, value, tone = "") {
  return `<span class="spec-pill ${tone}"><strong>${escHtml(value)}</strong> <span style="opacity:.65">${escHtml(label)}</span></span>`;
}

function formatNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : "–";
}

function formatMoney(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString()}` : "–";
}

function formatCurrencyForUi(v, currency) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "–";
  const code = normalizeCurrencyForUi(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: ["JPY", "HUF"].includes(code) ? 0 : 2,
    }).format(n);
  } catch {
    return `${code} ${n.toLocaleString()}`;
  }
}

function formatEuro(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `EUR ${n.toLocaleString()}` : "–";
}

function formatMiles(v) {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString()} mi` : "mileage unknown";
}

function formatTitleStatus(s) {
  return String(s || "unknown").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatConditionLabel(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "null" || raw === "unknown" || raw === "not_visible") return "";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function setText(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}

function openInBrowser(url) {
  if (!url) return;
  try { window.open(new URL(url).toString(), "_blank", "noopener,noreferrer"); }
  catch { window.open(url, "_blank", "noopener,noreferrer"); }
}

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(v) {
  return String(v ?? "").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  let data = null;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    throw new Error(`Invalid JSON response from ${url}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data;
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value ?? ""));
  }
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

function parseOptionalNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const str = String(value).trim();
  if (str === "") return fallback;
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/* ── Search / filter listeners ──────────────────────────────────────────────── */
document.getElementById("foundSearch")?.addEventListener("input", renderFoundDeals);
document.getElementById("verdictFilter")?.addEventListener("change", renderFoundDeals);
document.getElementById("rejectedSearch")?.addEventListener("input", renderRejectedDeals);

/* ── Periodic refresh ───────────────────────────────────────────────────────── */
function refreshVisible() {
  if (document.visibilityState !== "visible") return;
  if (currentTopTab === "cars") {
    refreshStatus();
    if (currentCarView === "watchlist") loadWatchlist();
    if (currentCarView === "found") loadFoundDeals();
    if (currentCarView === "rejected") loadRejectedDeals();
    if (currentCarView === "settings") loadSettings();
    return;
  }
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

function openAddTarget() {
  document.getElementById("addTargetDrawer").classList.add("open");
  document.getElementById("drawerStatus").textContent = "";
  document.getElementById("drawerStatus").className = "drawer-status";
  const manualField = document.getElementById("manualTargetJson");
  manualField.dataset.mode = "car";
  if (!manualField.value.trim()) {
    manualField.value = JSON.stringify(MANUAL_TARGET_TEMPLATE, null, 2);
  }
  setDrawerStatus("", "");
}

function closeAddTarget() {
  document.getElementById("addTargetDrawer").classList.remove("open");
}

async function addTarget() {
  const textarea = document.getElementById("manualTargetJson");
  const raw = textarea.value.trim();
  if (!raw) {
    setDrawerStatus("Target JSON is empty.", "err");
    return;
  }

  let target;
  try {
    target = JSON.parse(raw);
  } catch (e) {
    setDrawerStatus(`Invalid JSON: ${e.message}`, "err");
    return;
  }

  if (!target || typeof target !== "object" || Array.isArray(target)) {
    setDrawerStatus("Must be a JSON object.", "err");
    return;
  }

  const mode = textarea.dataset.mode === "shared" ? "shared" : "car";
  const endpoint = mode === "shared" ? "/api/shared/watchlist/add" : "/api/watchlist/add";

  const btn = document.getElementById("addTargetBtn");
  btn.disabled = true;
  btn.textContent = "Adding…";

  try {
    const res  = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      setDrawerStatus(data.error || "Failed to add target.", "err");
      return;
    }

    closeAddTarget();

    if (mode === "shared") {
      const platformFromTarget = Array.isArray(target.platforms) && target.platforms[0];
      await loadSharedSettings();
      renderAllMarketplaceTabs();
      if (platformFromTarget && PLATFORM_META[platformFromTarget]) setActiveTopTab(platformFromTarget);
      showToast("Shared target added.");
    } else {
      await loadWatchlist();
      setActiveTopTab("cars");
      setActiveCarView("watchlist");
      showToast("Car target added.");
    }
  } catch (e) {
    setDrawerStatus(`Error: ${e.message}`, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Add to Watchlist";
  }
}

function setDrawerStatus(msg, tone = "") {
  const el = document.getElementById("drawerStatus");
  el.textContent = msg;
  el.className = `drawer-status ${tone}`.trim();
}

/* ── Escape handler ─────────────────────────────────────────────────────────── */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAddTarget();
    closeDealModal();
    closeTextPromptModal();
  }
});

document.getElementById("textPromptInput")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    submitTextPromptModal();
  }
});

function trackEditorDirtyState(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("#car-view-settings")) carSettingsDirty = true;
  if (target.closest("#sharedSettingsPanel")) sharedSettingsDirty = true;
}

document.addEventListener("input", trackEditorDirtyState);
document.addEventListener("change", trackEditorDirtyState);

/* ── Boot ───────────────────────────────────────────────────────────────────── */
connectWS();
refreshStatus();
loadFoundDeals();
loadRejectedDeals();
loadSettings();
loadSharedSettings();
Object.keys(PLATFORM_META).forEach((platform) => loadSharedFound(platform));
setInterval(refreshVisible, 15000);
document.addEventListener("visibilitychange", refreshVisible);
