
/* ── State ──────────────────────────────────────────────────────────────────── */
let ws = null;
let wsRetryTimer = null;
let processState = {};
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
const sharedReloadTimers = {};
const terminalBuffers = {};
let activeDealModal = null;

let radarChart = null; // Will stay null as we use TV Widget
let radarAskSeries = null;
let radarBidSeries = null;
let currentSpotMode = 'spatial';
let currentFeedProvider = 'binance-bybit';
let analyticsHeatmap = null;
let radarMuted = false;
const radarChime = new Audio('data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YT9vT18AZmZtZnx+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+fn5+');

const PLATFORM_META = {
  facebook: {
    label: "Facebook",
    process: "facebook-sniper",
    description: "Marketplace sniper using the shared watchlist settings.",
  },
  vinted: {
    label: "Vinted",
    process: "vinted-sniper",
    description: "Vinted loop with site selection and optional cookies.",
  },
  mercadolibre: {
    label: "MercadoLibre",
    process: "mercadolibre-sniper",
    description: "MercadoLibre search loop with site selection.",
  },
  amazon: {
    label: "Amazon",
    process: "amazon-sniper",
    description: "Amazon search scraper using Puppeteer Stealth.",
  },
  arbitrage: {
    label: "Arbitrage",
    process: "arbitrage-engine",
    description: "P2P Crypto Arbitrage (USDT) between configured fiat pairs.",
    profile_id: "PRINCIPAL"
  },
  anomalia: {
    label: "Radar Inverso",
    process: "arbitrage-engine",
    description: "Anomalous market scenarios or reverse routes.",
    profile_id: "ANOMALIA"
  },
};

const FOUND_LISTINGS_META = Object.entries(PLATFORM_META)
  .filter(([id]) => id !== 'arbitrage' && id !== 'anomalia')
  .map(([id, meta]) => ({
    id,
    label: meta.label,
    process: meta.process,
    description: meta.description,
  }));

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
    autoOpenBrowser: "none",
  },
  filters: {
    minProfit: 50,
    minROI: 30,
    zScoreThreshold: 2.0,
    globalMustAvoid: [],
    globalPriorityKeywords: [],
    arbitrageDestinations: 'ARS,VES,MXN,BRL',
  },
  bots: {
    facebook: { pollIntervalSec: 90 },
    vinted: { pollIntervalSec: 45, domain: "vinted.es" },
    mercadolibre: { pollIntervalSec: 60, siteId: "MLA" },
    amazon: { pollIntervalSec: 300, country: "US" },
    arbitrage: { pollIntervalSec: 60 },
    anomalia: { pollIntervalSec: 60 },
  },
};

/* ── Utilities ──────────────────────────────────────────────────────────────── */
function escHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escAttr(str) {
  if (!str) return "";
  return String(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatPrice(val, currency = "EUR") {
  if (val == null) return "–";
  const num = Number(val);
  if (!Number.isFinite(num)) return "–";
  return num.toLocaleString(undefined, { style: "currency", currency: currency || "EUR" });
}
function formatNumber(val) { return Number(val || 0).toLocaleString(); }
function formatMoney(val) { return "$" + Number(val || 0).toFixed(2); }
function formatEuro(val) { return formatPrice(val, "EUR"); }

function clampNumber(val, min, max, fallback) {
  const n = parseFloat(val);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function fetchJson(url, options) {
  return fetch(url, options).then((res) => {
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  });
}

function showToast(message, tone = "ok") {
  const host = document.getElementById("toastHost");
  if (!host || !message) return;
  const toast = document.createElement("div");
  toast.className = 'toast toast-' + tone;
  toast.setAttribute("role", "status");
  toast.textContent = message;
  host.appendChild(toast);
  const dismiss = () => {
    toast.classList.add("toast-out");
    window.setTimeout(() => toast.remove(), 220);
  };
  window.setTimeout(dismiss, 2800);
}

function openInBrowser(url) {
  if (!url) return;
  window.open(url, "_blank");
}

/* ── UI Logic ──────────────────────────────────────────────────────────────── */

function triggerTradingViewFallback(containerId, symbol = "BINANCE:BTCUSDT") {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (container.dataset.tvLoaded === "true") return;
  container.dataset.tvLoaded = "true";

  console.log('[UI] Initializing Advanced Chart for ' + containerId);
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
        "enable_publishing": false,
        "allow_symbol_change": true,
        "container_id": containerId
      });
    }
  };
  document.head.appendChild(script);
}

function initRadarChart() {
  triggerTradingViewFallback("spot-radar-chart", "BINANCE:BTCUSDT");
}

function initArbitrageChart(platform = 'arbitrage') {
  const containerId = platform + "-chart-container";
  const symbol = (platform === 'anomalia') ? "BINANCE:BTCUSDT" : "BINANCE:BTCUSDT";
  triggerTradingViewFallback(containerId, symbol);
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
            <h2>Configuración del Sistema</h2>
            <p class="panel-copy">Gestiona las opciones globales y de los snipers.</p>
          </div>
          <div class="header-actions">
            <button class="btn btn-secondary" onclick="reloadSharedSettings()">Reload</button>
            <button class="btn btn-primary" onclick="saveSharedSettings()">Save Shared Settings</button>
          </div>
        </div>

        <form id="sharedSettingsForm" class="settings-form-grid" onsubmit="event.preventDefault(); saveSharedSettings();">
          <div class="form-field">
            <label for="sharedLatitude">Latitude</label>
            <input id="sharedLatitude" class="quick-input" type="number" step="0.0001" value="${escAttr(config.location?.latitude ?? "")}" />
          </div>
          <div class="form-field">
            <label for="sharedLongitude">Longitude</label>
            <input id="sharedLongitude" class="quick-input" type="number" step="0.0001" value="${escAttr(config.location?.longitude ?? "")}" />
          </div>
          <div class="form-field">
            <label for="sharedProxy">Proxy Principal</label>
            <input id="sharedProxy" class="quick-input" type="text" value="${escAttr(config.proxy || "")}" placeholder="http://user:pass@host:port" />
          </div>
          <div class="form-field">
            <label for="sharedMinProfit">Min Profit ($)</label>
            <input id="sharedMinProfit" class="quick-input" type="number" value="${escAttr(config.filters?.minProfit ?? 50)}" />
          </div>
        </form>
      </section>
    </div>
  `;
}

async function loadSharedSettings() {
  try {
    const data = await fetchJson("/api/shared/settings");
    sharedConfig = data.config || {};
    sharedWatchlist = data.watchlist || [];

    if (!document.activeElement || !document.activeElement.closest('#sharedSettingsForm')) {
        renderSharedSettings();
    }
    renderAllMarketplaceTabs();
  } catch (err) {
    console.error("Failed to load settings", err);
  }
}

async function saveSharedSettings() {
  const config = {
    location: {
      latitude: parseFloat(document.getElementById("sharedLatitude")?.value),
      longitude: parseFloat(document.getElementById("sharedLongitude")?.value),
    },
    proxy: document.getElementById("sharedProxy")?.value.trim(),
    filters: {
      minProfit: parseFloat(document.getElementById("sharedMinProfit")?.value),
    }
  };

  try {
    await fetch("/api/shared/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, watchlist: sharedWatchlist }),
    });
    showToast("Settings saved successfully.");
    loadSharedSettings();
  } catch (err) {
    showToast("Error saving settings", "err");
  }
}

function reloadSharedSettings() { loadSharedSettings(); }

function normalizeSharedConfig(config = {}) {
  return { ...DEFAULT_SHARED_CONFIG, ...config };
}

function buildSharedDealCard(platform, deal) {
  const title = deal.title || deal.model || "Deal";
  const price = deal.listing_price || deal.price || 0;
  const currency = deal.currency || deal.currency_id || "EUR";
  const grade = (deal.grade || "?").toUpperCase();
  const url = deal.url || "#";
  const photos = Array.isArray(deal.photos) ? deal.photos : [];

  let expectedProfit = 0;
  if (platform === 'arbitrage' || platform === 'anomalia') {
    const capInput = document.getElementById('arbitrage-capital-' + platform);
    const capital = capInput ? (parseFloat(capInput.value) || 1000) : 1000;
    expectedProfit = (capital * (deal.roi || 0)) / 100;
  }

  return `
    <article class="deal-card market-deal-card">
      <div class="deal-img-wrap">
        ${photos[0] ? `<img class="deal-img" src="${escAttr(photos[0])}" />` : '<div class="deal-img-placeholder">No Photo</div>'}
      </div>
      <div class="market-deal-body">
        <div class="market-deal-top">
            <div class="process-name">${escHtml(title)}</div>
            <span class="badge">${grade}</span>
        </div>
        <div class="marketplace-metrics compact">
          <div class="market-metric">
            <span class="market-metric-label">Precio</span>
            <strong>${formatPrice(price, currency)}</strong>
          </div>
          ${expectedProfit > 0 ? `
            <div class="market-metric">
              <span class="market-metric-label">Est. Profit</span>
              <strong style="color: #3fb950">${formatMoney(expectedProfit)}</strong>
            </div>
          ` : ''}
        </div>
        <div class="deal-actions">
           <button class="btn btn-primary btn-sm" onclick="openInBrowser('${escAttr(url)}')">Abrir Oferta ↗</button>
        </div>
      </div>
    </article>
  `;
}

function renderMarketplaceTab(platform) {
  const mount = document.getElementById(platform + 'Panel');
  if (!mount) return;

  const meta = PLATFORM_META[platform];
  const allDeals = sharedFoundDeals[platform] || [];
  const info = processState[meta.process] || { running: false };

  // Use Advanced Widget by default
  const isChartTab = (platform === 'arbitrage' || platform === 'anomalia');

  if (mount.querySelector('.sniper-shell') && (mount.querySelector('[data-tv-loaded="true"]') || !isChartTab)) {
      // Periodic update
      const grid = document.getElementById('sniper-deals-' + platform);
      if (grid) grid.innerHTML = allDeals.map(d => buildSharedDealCard(platform, d)).join("");
      return;
  }

  mount.innerHTML = `
    <div class="sniper-shell">
      <div class="sniper-top">
        <div class="sniper-control">
          <div>
            <div class="process-name">${escHtml(meta.label)}</div>
            <div class="process-desc">${escHtml(meta.description)}</div>
          </div>
          <div class="sniper-control-actions">
            <button class="btn btn-start" ${info.running ? "disabled" : ""} onclick="startNamedProcess('${meta.process}')">Start</button>
            <button class="btn btn-stop" ${!info.running ? "disabled" : ""} onclick="stopNamedProcess('${meta.process}')">Stop</button>
          </div>
        </div>
        ${isChartTab ? `
          <div class="tools-panel">
            <div class="tool-group">
                <span class="tool-label">Capital (USD)</span>
                <input type="number" id="arbitrage-capital-${platform}" class="quick-input" style="width: 100px;" value="1000" onchange="renderMarketplaceTab('${platform}')">
            </div>
            <button class="btn btn-emergency" onclick="triggerEmergencyHalt()">EMERGENCY STOP</button>
          </div>
        ` : ''}
      </div>

      <div class="sniper-body">
        ${isChartTab ? `<div id="${platform}-chart-container" style="height: 350px; margin-bottom: 1rem; background: #131722; border-radius: 8px;"></div>` : ''}
        <section class="sniper-pane sniper-deals">
          <div class="sniper-pane-head"><h3>Live Deals</h3></div>
          <div id="sniper-deals-${platform}" class="sniper-card-grid">
            ${allDeals.map(d => buildSharedDealCard(platform, d)).join("")}
          </div>
        </section>
      </div>
    </div>
  `;
  if (isChartTab) initArbitrageChart(platform);
}

function renderAllMarketplaceTabs() {
  Object.keys(PLATFORM_META).forEach(renderMarketplaceTab);
}

function startNamedProcess(name) {
  fetch("/api/process/" + name + "/start", { method: "POST" })
    .then(() => showToast("Started " + name));
}
function stopNamedProcess(name) {
  fetch("/api/process/" + name + "/stop", { method: "POST" })
    .then(() => showToast("Stopped " + name));
}

function triggerEmergencyHalt() {
  if (confirm("Stop all engines?")) {
    ws.send(JSON.stringify({ command: "EMERGENCY_HALT" }));
  }
}

/* ── Core Loop ─────────────────────────────────────────────────────────────── */

function setActiveTopTab(tab) {
  currentTopTab = tab;
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach(n => n.classList.toggle("active", n.id === "tab-" + tab));

  if (tab === "settings") { loadSharedSettings(); return; }
  if (tab === "spot-arbitrage") { initRadarChart(); return; }
  if (tab === "logs") { flushTerminal(); return; }
  if (tab === "watchlist") { loadSharedSettings(); renderSharedWatchlistTab(); return; }
  if (tab === "found-listings") { renderFoundListingsTab(); return; }
  if (tab === "analytics") { refreshAnalytics(); return; }

  if (PLATFORM_META[tab]) {
      loadSharedFound(tab);
      renderMarketplaceTab(tab);
  }
}

async function loadSharedFound(platform) {
  try {
    const apiPlatform = (platform === 'anomalia') ? 'arbitrage' : platform;
    const deals = await fetchJson("/api/shared/found/" + apiPlatform);
    if (platform === 'arbitrage') {
        sharedFoundDeals.arbitrage = deals.filter(d => d.profile_id === 'PRINCIPAL' || !d.profile_id);
    } else if (platform === 'anomalia') {
        sharedFoundDeals.anomalia = deals.filter(d => d.profile_id === 'ANOMALIA');
    } else {
        sharedFoundDeals[platform] = deals;
    }
    renderMarketplaceTab(platform);
  } catch (e) {}
}

function connectWS() {
  const token = document.querySelector('meta[name="session-token"]')?.content || "";
  ws = new WebSocket("ws://" + location.host + "?token=" + token);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "init") {
      processState = m.processes;
      loadSharedSettings();
    }
    if (m.type === "status") {
      processState[m.process].running = m.running;
      renderAllMarketplaceTabs();
    }
    if (m.type === "shared-found-updated") {
      loadSharedFound(m.platform);
    }
  };
}

document.querySelectorAll(".nav-btn").forEach(b => {
  b.onclick = () => setActiveTopTab(b.dataset.tab);
});

connectWS();
setInterval(() => {
  if (document.visibilityState === "visible") {
      if (currentTopTab === "settings") {
           if (!document.activeElement || !document.activeElement.closest('#sharedSettingsForm')) loadSharedSettings();
      } else if (PLATFORM_META[currentTopTab]) {
           loadSharedFound(currentTopTab);
      }
  }
}, 15000);

/* Default View */
setActiveTopTab("facebook");

function flushTerminal() {
  const term = document.getElementById("terminal");
  if (term) term.innerHTML = "Terminal logic removed for stability.";
}
function renderSharedWatchlistTab() {
  const container = document.getElementById("sharedWatchlistCards");
  if (container) container.innerHTML = '<div class="sniper-empty">Targets view simplified. Use Settings to edit config.</div>';
}
function renderFoundListingsTab() {
  const grid = document.getElementById("foundListingsGrid");
  if (grid) grid.innerHTML = '<div class="sniper-empty">Cross-platform Matches view. Use individual tabs for live hits.</div>';
}
function refreshAnalytics() {
  const heat = document.getElementById("analytics-heatmap");
  if (heat) heat.innerHTML = '<div class="sniper-empty">Analytics history loading...</div>';
}
function buildOnboardingHtml(p) { return ""; }
