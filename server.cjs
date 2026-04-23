const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const url = require("url");

let journalManager = null;
async function initJournal() {
  if (journalManager) return journalManager;
  const mod = await import("./lib/journal-manager.js");
  journalManager = mod.journalManager;
  await journalManager.init();
  return journalManager;
}

const MAX_ACTIVE_TARGETS = 10;
const LIMIT_NOTE = "Max active targets reached (10). Disable a target to enable another.";

const ROOT = __dirname;
// When packaged via Electron, FBM_DATA_DIR points to app.getPath('userData').
const DATA_DIR = process.env.FBM_DATA_DIR || path.join(ROOT, "data");
const UI_DIR = path.join(ROOT, "ui");
const FOUND_FILE = path.join(DATA_DIR, "found_listings.ndjson");
const REJECTED_FILE = path.join(DATA_DIR, "rejected_listings.csv");
const WATCHLIST_FILE = path.join(DATA_DIR, "watchlist.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const SEEN_IDS_FILE = path.join(DATA_DIR, "seen_ids.json");
const SHARED_FOUND_FILES = {
  facebook: path.join(DATA_DIR, "facebook", "found.ndjson"),
  wallapop: path.join(DATA_DIR, "wallapop", "found.ndjson"),
  vinted: path.join(DATA_DIR, "vinted", "found.ndjson"),
  mercadolibre: path.join(DATA_DIR, "mercadolibre", "found.ndjson"),
  amazon: path.join(DATA_DIR, "amazon", "found.ndjson"),
  arbitrage: path.join(DATA_DIR, "arbitrage", "found.ndjson"),
};
const REJECTED_HEADERS = "timestamp,title,query,target_id,target_label,target_group,listing_price,reason,url,make,model,year,title_status\n";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// When running inside Electron (packaged or dev), use Electron's bundled Node
// so end users don't need Node.js installed on their machine.
const IS_ELECTRON = !!process.versions.electron;

const PROCESSES = {
  "car-sniper": {
    label: "FBM Sniper",
    cmd: process.execPath,
    args: ["lib/scanner.js"],
    proc: null,
    stopping: false,
  },
  "facebook-sniper": {
    label: "Facebook Sniper",
    cmd: process.execPath,
    args: ["lib/facebook-sniper.js"],
    proc: null,
    stopping: false,
  },
  "wallapop-sniper": {
    label: "Wallapop Sniper",
    cmd: process.execPath,
    args: ["lib/wallapop-sniper.js"],
    proc: null,
    stopping: false,
  },
  "vinted-sniper": {
    label: "Vinted Sniper",
    cmd: process.execPath,
    args: ["lib/vinted-sniper.js"],
    proc: null,
    stopping: false,
  },
  "mercadolibre-sniper": {
    label: "MercadoLibre Sniper",
    cmd: process.execPath,
    args: ["lib/mercadolibre-sniper.js"],
    proc: null,
    stopping: false,
  },
  "amazon-sniper": {
    label: "Amazon Sniper",
    cmd: process.execPath,
    args: ["lib/amazon-sniper.js"],
    proc: null,
    stopping: false,
  },
  "arbitrage-engine": {
    label: "Crypto Arbitrage",
    cmd: process.execPath,
    args: ["crypto_arbitrage/main.js"],
    proc: null,
    stopping: false,
  },
};

let workspace = null;
async function initWorkspace() {
  if (workspace) return workspace;
  workspace = await import("./lib/shared-marketplace/workspace.js");
  workspace.ensureWorkspaceFiles();
  return workspace;
}

const logs = {};
const stopTimers = {};
for (const key of Object.keys(PROCESSES)) logs[key] = [];

const server = createServer(handleRequest);
const wss = new WebSocketServer({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

function appendLog(name, line) {
  const entry = { ts: Date.now(), line };
  logs[name].push(entry);
  if (logs[name].length > 800) logs[name].shift();
  broadcast({ type: "log", process: name, ...entry });
}

function startProcess(name, extraArgs = []) {
  const def = PROCESSES[name];
  if (!def) return { error: "Unknown process" };
  if (def.proc) return { error: "Already running" };

  const cfg = readConfig();
  const proxyEnv = {};
  if (cfg.proxy) {
    try {
      const u = new URL(cfg.proxy);
      if (u.hostname) {
        proxyEnv.PROXY_ENABLED = "true";
        proxyEnv.PROXY_HOST = u.hostname;
        proxyEnv.PROXY_PORT = u.port || "8080";
        if (u.username) proxyEnv.PROXY_USER = decodeURIComponent(u.username);
        if (u.password) proxyEnv.PROXY_PASS = decodeURIComponent(u.password);
      }
    } catch { /* invalid proxy URL — skip */ }
  }

  const proc = spawn(def.cmd, [...def.args, ...extraArgs], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...(IS_ELECTRON ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      ...proxyEnv,
    },
    windowsHide: true,
  });

  def.proc = proc;
  def.stopping = false;
  if (stopTimers[name]) {
    clearTimeout(stopTimers[name]);
    delete stopTimers[name];
  }
  appendLog(name, `▶ Started ${def.label}`);
  broadcast({ type: "status", process: name, running: true, stopping: false });

  proc.stdout.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) appendLog(name, line);
  });
  proc.stderr.on("data", (chunk) => {
    for (const line of chunk.toString().split("\n").filter(Boolean)) appendLog(name, `[err] ${line}`);
  });
  proc.on("error", (error) => {
    if (stopTimers[name]) {
      clearTimeout(stopTimers[name]);
      delete stopTimers[name];
    }
    appendLog(name, `[err] Failed to launch ${def.label}: ${error.message}`);
    def.proc = null;
    def.stopping = false;
    broadcast({ type: "status", process: name, running: false, stopping: false });
  });
  proc.on("close", (code) => {
    if (stopTimers[name]) {
      clearTimeout(stopTimers[name]);
      delete stopTimers[name];
    }
    def.proc = null;
    def.stopping = false;
    appendLog(name, `■ Exited (code ${code})`);
    broadcast({ type: "status", process: name, running: false, stopping: false });
  });

  return { ok: true };
}

function stopProcess(name) {
  const def = PROCESSES[name];
  if (!def) return { error: "Unknown process" };
  if (!def.proc) return { error: "Not running" };
  if (def.stopping) return { ok: true, alreadyStopping: true };
  def.stopping = true;
  appendLog(name, "⏳ Stop requested — waiting for the current step to finish.");
  broadcast({ type: "status", process: name, running: true, stopping: true });
  def.proc.kill("SIGTERM");

  stopTimers[name] = setTimeout(() => {
    if (!def.proc) return;
    appendLog(name, "⚠ Stop grace period expired — forcing shutdown.");
    try {
      def.proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  }, 8000);

  return { ok: true };
}

function parseCSVRows(file) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return [];
    const rows = [];
    let row = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        row.push(cur);
        cur = "";
        continue;
      }
      if ((ch === "\n" || ch === "\r") && !inQ) {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cur);
        cur = "";
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        continue;
      }
      cur += ch;
    }
    row.push(cur);
    if (row.some((value) => value !== "")) rows.push(row);
    return rows;
  } catch {
    return [];
  }
}

function readFoundDeals() {
  try {
    const text = fs.readFileSync(FOUND_FILE, "utf8").trim();
    if (!text) return [];
    const watchlist = readWatchlist();
    const watchById = new Map(watchlist.map((target) => [target.id, target]));
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((deal) => keepFoundDeal(deal, watchById))
      .reverse();
  } catch {
    return [];
  }
}

function readNdjsonTail(file, limit = 50) {
  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return [];
    const entries = [];
    const lines = text.split("\n").filter(Boolean);
    for (let index = lines.length - 1; index >= 0 && entries.length < limit; index -= 1) {
      try {
        entries.push(JSON.parse(lines[index]));
      } catch {
        // Skip malformed or partially-written NDJSON lines and keep valid entries.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function getSharedPlatformFile(platform) {
  const key = String(platform || "").trim().toLowerCase();
  return SHARED_FOUND_FILES[key] || null;
}

function inferTargetType(target) {
  const explicit = String(target?.targetType || "").toLowerCase();
  if (explicit) return explicit;
  const raw = `${target?.group || ""} ${target?.label || ""} ${target?.query || ""}`.toLowerCase();
  if (/\biphone\b|\bipad\b|\bmacbook\b|\bplaystation\b|\bxbox\b|\bphone\b|\blaptop\b|\bcamera\b/.test(raw)) return "electronics";
  if (/\bvehicle\b|\bcar\b|\bsuv\b|\bsedan\b|\btruck\b/.test(raw)) return "vehicle";
  return "general";
}

function normalizeYear(value) {
  const year = Number(value);
  if (!Number.isFinite(year)) return null;
  if (year < 1990 || year > 2055) return null;
  return Math.round(year);
}

function sanitizeTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;

  const targetType = inferTargetType(target);
  const sanitized = {
    ...target,
    targetType,
    aliases: Array.isArray(target.aliases) ? target.aliases.filter(Boolean) : [],
    mustInclude: Array.isArray(target.mustInclude) ? target.mustInclude.filter(Boolean) : [],
    mustAvoid: Array.isArray(target.mustAvoid)
      ? target.mustAvoid.filter(Boolean)
      : Array.isArray(target.avoidKeywords)
      ? target.avoidKeywords.filter(Boolean)
      : [],
  };

  const yearStart = normalizeYear(target.yearStart);
  const yearEnd = normalizeYear(target.yearEnd);
  const baselineYear = normalizeYear(target.baselineYear);

  if (targetType === "vehicle") {
    if (yearStart) sanitized.yearStart = yearStart;
    else delete sanitized.yearStart;
    if (yearEnd) sanitized.yearEnd = yearEnd;
    else delete sanitized.yearEnd;
    if (baselineYear) sanitized.baselineYear = baselineYear;
    else if (yearStart) sanitized.baselineYear = yearStart;
    else delete sanitized.baselineYear;
  } else {
    delete sanitized.yearStart;
    delete sanitized.yearEnd;
    delete sanitized.baselineYear;
    sanitized.baselineMiles = 0;
    sanitized.mileagePenaltyPer10k = 0;
    sanitized.mileageBonusPer10k = 0;
    sanitized.maxMileage = 0;
  }

  return sanitized;
}

function keepFoundDeal(deal, watchById) {
  const targetId = deal?.target?.id;
  const target = targetId ? watchById.get(targetId) : null;
  if (!target) return true;

  const year = Number(deal?.vehicle?.year);
  const yearStart = Number(target?.yearStart);
  const yearEnd = Number(target?.yearEnd);
  if (Number.isFinite(year) && yearStart >= 1990 && year < yearStart) return false;
  if (Number.isFinite(year) && yearEnd >= 1990 && year > yearEnd) return false;

  const targetType = inferTargetType(target);
  if (targetType !== "vehicle") {
    const price = Number(deal?.listing?.price);
    const maxPrice = Number(target?.maxPrice);
    if (Number.isFinite(price) && Number.isFinite(maxPrice) && price > maxPrice * 1.2) return false;
  }

  return true;
}

function readRejected() {
  const rows = parseCSVRows(REJECTED_FILE);
  if (!rows.length) return [];
  const [headers, ...data] = rows;
  return data
    .map((cols) => Object.fromEntries(headers.map((h, i) => [h, cols[i] ?? ""])))
    .map(sanitizeRejectedDeal)
    .filter(Boolean)
    .reverse();
}

function sanitizeRejectedDeal(row) {
  const parts = String(row?.reason || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^margin floor not met$/i.test(part));

  const cleanedReason = parts.join("; ");
  if (!cleanedReason) return null;

  return {
    ...row,
    reason: cleanedReason,
  };
}

function readWatchlist() {
  try {
    if (!fs.existsSync(WATCHLIST_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(WATCHLIST_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.map(sanitizeTarget).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function countEnabled(list) {
  return list.filter((target) => target.enabled !== false).length;
}

function readConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      ...parsed,
      location: {
        ...(parsed.location || {}),
      },
    };
  } catch {
    return {};
  }
}

function saveJSON(file, payload) {
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function persistWatchlist(list) {
  const sanitized = (Array.isArray(list) ? list : [])
    .map(sanitizeTarget)
    .filter(Boolean);
  saveJSON(WATCHLIST_FILE, sanitized);
  broadcast({ type: "car-watchlist-updated", ts: Date.now() });
  return sanitized;
}

function buildStats(foundDeals) {
  const buyNow = foundDeals.filter((deal) => deal.underwriting?.verdict === "buy_now");
  const maybe = foundDeals.filter((deal) => deal.underwriting?.verdict === "maybe");
  const margins = foundDeals
    .map((deal) => Number(deal.market?.estimatedMargin))
    .filter((value) => Number.isFinite(value));
  const avgMargin = margins.length ? Math.round(margins.reduce((sum, value) => sum + value, 0) / margins.length) : 0;
  const recallFlags = foundDeals.reduce((sum, deal) => sum + Number(deal.market?.recallCount || 0), 0);
  return {
    buyNow: buyNow.length,
    maybe: maybe.length,
    avgMargin,
    recallFlags,
    totalFound: foundDeals.length,
  };
}

function buildGroups(watchlist) {
  const groups = [...new Set(
    watchlist
      .map((item) => item.group || "General")
      .filter(Boolean)
  )];
  return groups.sort((a, b) => a.localeCompare(b));
}

function buildLimits(watchlist) {
  const enabled = countEnabled(watchlist);
  return {
    maxActiveTargets: MAX_ACTIVE_TARGETS,
    enabledCount: enabled,
    atLimit: enabled >= MAX_ACTIVE_TARGETS,
    limitNote: LIMIT_NOTE,
  };
}

let watchersStarted = false;
const watchedFiles = new Set();
function watchDataFile(file, eventType, extra = {}) {
  if (!fs.existsSync(file)) return;
  watchedFiles.add(file);
  fs.watchFile(file, { interval: 1500 }, (curr, prev) => {
    if (curr.mtimeMs === 0 || curr.mtimeMs === prev.mtimeMs) return;
    broadcast({ type: eventType, ts: Date.now(), ...extra });
  });
}

function startWatchers() {
  if (watchersStarted) return;
  watchersStarted = true;
  watchDataFile(CONFIG_FILE, "car-config-updated");
  watchDataFile(FOUND_FILE, "car-found-updated");
  watchDataFile(REJECTED_FILE, "car-rejected-updated");
  watchDataFile(WATCHLIST_FILE, "car-watchlist-updated");
  Object.entries(SHARED_FOUND_FILES).forEach(([platform, file]) => {
    watchDataFile(file, "shared-found-updated", { platform });
  });
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

async function handleRequest(req, res) {
  let parsedUrl;
  try {
    parsedUrl = url.parse(req.url, true);
  } catch (e) {
    res.statusCode = 400;
    res.end("Bad Request");
    return;
  }
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Static files
  if (method === "GET" && !pathname.startsWith("/api")) {
    let filePath = path.join(UI_DIR, pathname === "/" ? "index.html" : pathname);
    if (!path.relative(UI_DIR, filePath).startsWith("..") && !path.isAbsolute(path.relative(UI_DIR, filePath))) {
      // Valid path within UI_DIR
    } else {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, content) => {
      if (err) {
        res.statusCode = 404;
        res.end("Not found");
      } else {
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(content);
      }
    });
    return;
  }

  // API Helper
  function sendJson(data, status = 200) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  }

  async function getBody() {
    return new Promise((resolve, reject) => {
      let body = "";
      const MAX_SIZE = 512 * 1024; // 512KB limit
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > MAX_SIZE) {
          res.statusCode = 413;
          res.end("Payload Too Large");
          req.destroy();
          reject(new Error("Payload Too Large"));
        }
      });
      req.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (e) {
          res.statusCode = 400;
          res.end("Invalid JSON");
          reject(new Error("Invalid JSON"));
        }
      });
    });
  }

  // API Routes
  if (pathname === "/api/journal" && method === "GET") {
    const jm = await initJournal();
    const data = await jm.getJournal();
    return sendJson(data);
  }

  if (pathname === "/api/journal/add" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const jm = await initJournal();
    const result = await jm.recordTrade(body);
    return sendJson(result);
  }

  if (pathname === "/api/status" && method === "GET") {
    const foundDeals = readFoundDeals();
    const watchlist = readWatchlist();
    const processes = {};
    for (const [key, value] of Object.entries(PROCESSES)) {
      processes[key] = { label: value.label, running: !!value.proc, stopping: !!value.stopping };
    }
    return sendJson({
      edition: "community",
      processes,
      stats: buildStats(foundDeals),
      watchlistCount: watchlist.length,
      targetGroups: buildGroups(watchlist),
      limits: buildLimits(watchlist),
    });
  }

  if (pathname === "/api/watchlist" && method === "GET") {
    return sendJson(readWatchlist());
  }

  if (pathname === "/api/watchlist/toggle" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { id, enabled } = body;
    if (!id) return sendJson({ error: "id required" }, 400);
    const list = readWatchlist();
    const index = list.findIndex((t) => t.id === id);
    if (index === -1) return sendJson({ error: "not found" }, 404);
    if (enabled !== false && list[index].enabled === false && countEnabled(list) >= MAX_ACTIVE_TARGETS) {
      return sendJson({ error: LIMIT_NOTE, code: "target_limit" }, 403);
    }
    list[index].enabled = enabled !== false;
    const updated = persistWatchlist(list);
    return sendJson({ ok: true, target: updated.find((t) => t.id === id) });
  }

  if (pathname === "/api/watchlist/delete" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { id } = body;
    const list = readWatchlist();
    const filtered = list.filter((t) => t.id !== id);
    if (filtered.length === list.length) return sendJson({ error: "not found" }, 404);
    persistWatchlist(filtered);
    return sendJson({ ok: true });
  }

  if (pathname === "/api/watchlist/move" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { id, group } = body;
    if (!id || !group) return sendJson({ error: "id and group required" }, 400);
    const list = readWatchlist();
    const index = list.findIndex((t) => t.id === id);
    if (index === -1) return sendJson({ error: "not found" }, 404);
    list[index].group = group.trim();
    const updated = persistWatchlist(list);
    return sendJson({ ok: true, target: updated.find((t) => t.id === id) });
  }

  if (pathname === "/api/watchlist/rename-group" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { from, to } = body;
    if (!from || !to) return sendJson({ error: "from and to required" }, 400);
    const list = readWatchlist();
    let changed = 0;
    const updated = list.map((t) => {
      if ((t.group || "General") === from.trim()) { changed++; return { ...t, group: to.trim() }; }
      return t;
    });
    if (!changed) return sendJson({ error: "not found" }, 404);
    const saved = persistWatchlist(updated);
    return sendJson({ ok: true, changed, groups: buildGroups(saved) });
  }

  if (pathname === "/api/config" && method === "GET") {
    return sendJson(readConfig());
  }

  if (pathname === "/api/settings" && method === "GET") {
    const wl = readWatchlist();
    return sendJson({ config: readConfig(), watchlist: wl, limits: buildLimits(wl) });
  }

  if (pathname === "/api/settings" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { config, watchlist } = body;
    if (!config || !Array.isArray(watchlist)) return sendJson({ error: "invalid data" }, 400);
    saveJSON(CONFIG_FILE, config);
    persistWatchlist(watchlist);
    broadcast({ type: "car-config-updated", ts: Date.now() });
    return sendJson({ ok: true });
  }

  if (pathname === "/api/found" && method === "GET") {
    return sendJson(readFoundDeals());
  }

  if (pathname.startsWith("/api/shared/found/") && method === "GET") {
    const platform = pathname.split("/").pop();
    const file = getSharedPlatformFile(platform);
    if (!file) return sendJson({ error: "unsupported" }, 400);
    const limit = Math.max(1, Math.min(200, Number(parsedUrl.query.limit) || 50));
    return sendJson(readNdjsonTail(file, limit));
  }

  if (pathname === "/api/rejected" && method === "GET") {
    return sendJson(readRejected());
  }

  if (pathname.startsWith("/api/logs/") && method === "GET") {
    const name = pathname.split("/").pop();
    if (!logs[name]) return sendJson({ error: "unknown" }, 404);
    return sendJson(logs[name]);
  }

  if (pathname === "/api/process/start" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { process: name, flags } = body;
    return sendJson(startProcess(name, flags));
  }

  if (pathname === "/api/process/stop" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { process: name } = body;
    return sendJson(stopProcess(name));
  }

  if (pathname.match(/^\/api\/process\/[^\/]+\/start$/) && method === "POST") {
    const name = pathname.split("/")[3];
    return sendJson(startProcess(name));
  }

  if (pathname.match(/^\/api\/process\/[^\/]+\/stop$/) && method === "POST") {
    const name = pathname.split("/")[3];
    return sendJson(stopProcess(name));
  }

  if (pathname === "/api/reset-memory" && method === "POST") {
    try {
      fs.writeFileSync(FOUND_FILE, "", "utf8");
      fs.writeFileSync(REJECTED_FILE, REJECTED_HEADERS, "utf8");
      fs.writeFileSync(SEEN_IDS_FILE, "[]", "utf8");
      broadcast({ type: "car-found-updated", ts: Date.now() });
      broadcast({ type: "car-rejected-updated", ts: Date.now() });
      return sendJson({ ok: true });
    } catch (e) {
      return sendJson({ error: e.message }, 500);
    }
  }

  if (pathname === "/api/watchlist/add" && method === "POST") {
    let body;
    try { body = await getBody(); } catch { return; }
    const { target } = body;
    const sanitized = sanitizeTarget(target);
    if (!sanitized) return sendJson({ error: "invalid" }, 400);
    const list = readWatchlist();
    if (sanitized.enabled !== false && countEnabled(list) >= MAX_ACTIVE_TARGETS) sanitized.enabled = false;
    if (list.some((t) => t.id === sanitized.id)) sanitized.id += `-${Date.now()}`;
    list.push(sanitized);
    const updated = persistWatchlist(list);
    return sendJson({ ok: true, target: updated.find((t) => t.id === sanitized.id) || sanitized, limitReached: sanitized.enabled === false });
  }

  if (pathname === "/api/shared/settings" && method === "GET") {
    const ws = await initWorkspace();
    return sendJson({ config: ws.loadWorkspaceConfig(), watchlist: ws.loadWorkspaceWatchlist(), groups: ws.buildWatchlistGroups(ws.loadWorkspaceWatchlist()) });
  }

  if (pathname === "/api/shared/settings" && method === "POST") {
    const ws = await initWorkspace();
    let body;
    try { body = await getBody(); } catch { return; }
    const { config, watchlist } = body;
    if (!config || !Array.isArray(watchlist)) return sendJson({ error: "invalid" }, 400);
    ws.saveWorkspaceConfig(config);
    ws.saveWorkspaceWatchlist(watchlist);
    broadcast({ type: "shared-config-updated", ts: Date.now() });
    broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
    return sendJson({ ok: true });
  }

  if (pathname === "/api/shared/watchlist" && method === "GET") {
    const ws = await initWorkspace();
    return sendJson(ws.loadWorkspaceWatchlist());
  }

  if (pathname === "/api/shared/watchlist/add" && method === "POST") {
    const ws = await initWorkspace();
    let body;
    try { body = await getBody(); } catch { return; }
    const entry = ws.normalizeWatchlistEntry(body.target);
    if (!entry) return sendJson({ error: "invalid" }, 400);
    const list = ws.loadWorkspaceWatchlist();
    if (list.some((t) => t.id === entry.id)) entry.id += `-${Date.now()}`;
    list.push(entry);
    const saved = ws.saveWorkspaceWatchlist(list);
    broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
    return sendJson({ ok: true, target: saved.find((t) => t.id === entry.id) || entry });
  }

  if (pathname === "/api/shared/watchlist/toggle" && method === "POST") {
    const ws = await initWorkspace();
    let body;
    try { body = await getBody(); } catch { return; }
    const { id, enabled } = body;
    const list = ws.loadWorkspaceWatchlist();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return sendJson({ error: "not found" }, 404);
    list[idx].enabled = enabled !== false;
    const saved = ws.saveWorkspaceWatchlist(list);
    broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
    return sendJson({ ok: true, target: saved[idx] });
  }

  if (pathname === "/api/shared/watchlist/update" && method === "POST") {
    const ws = await initWorkspace();
    let body;
    try { body = await getBody(); } catch { return; }
    const { id, patch } = body;
    const list = ws.loadWorkspaceWatchlist();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return sendJson({ error: "not found" }, 404);
    const current = list[idx];
    const merged = { ...current, ...patch };
    if (patch.platformOverrides) {
      merged.platformOverrides = { ...current.platformOverrides, ...patch.platformOverrides };
      for (const k of Object.keys(merged.platformOverrides)) if (!merged.platformOverrides[k] || (merged.platformOverrides[k].minPrice == null && merged.platformOverrides[k].maxPrice == null)) delete merged.platformOverrides[k];
    }
    list[idx] = merged;
    const saved = ws.saveWorkspaceWatchlist(list);
    broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
    return sendJson({ ok: true, target: saved[idx] });
  }

  if (pathname === "/api/shared/watchlist/delete" && method === "POST") {
    const ws = await initWorkspace();
    let body;
    try { body = await getBody(); } catch { return; }
    const { id } = body;
    const list = ws.loadWorkspaceWatchlist();
    const filtered = list.filter((t) => t.id !== id);
    if (filtered.length === list.length) return sendJson({ error: "not found" }, 404);
    ws.saveWorkspaceWatchlist(filtered);
    broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
    return sendJson({ ok: true });
  }

  if (pathname === "/api/shared/watchlist/move" && method === "POST") {
    const ws = await initWorkspace();
    let body;
    try { body = await getBody(); } catch { return; }
    const { id, group } = body;
    const list = ws.loadWorkspaceWatchlist();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) return sendJson({ error: "not found" }, 404);
    list[idx].group = group.trim();
    const saved = ws.saveWorkspaceWatchlist(list);
    broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
    return sendJson({ ok: true, target: saved[idx] });
  }

  if (pathname === "/api/shared/watchlist/rename-group" && method === "POST") {
    const ws = await initWorkspace();
    let body;
    try { body = await getBody(); } catch { return; }
    const { from, to } = body;
    const list = ws.loadWorkspaceWatchlist();
    let changed = 0;
    const updated = list.map((t) => {
      if ((t.group || "General") === from.trim()) { changed++; return { ...t, group: to.trim() }; }
      return t;
    });
    if (!changed) return sendJson({ error: "not found" }, 404);
    const saved = ws.saveWorkspaceWatchlist(updated);
    broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
    return sendJson({ ok: true, changed, groups: ws.buildWatchlistGroups(saved) });
  }

  res.statusCode = 404;
  res.end("Not found");
}

wss.on("connection", (ws) => {
  const processes = {};
  for (const [key, value] of Object.entries(PROCESSES)) {
    processes[key] = { label: value.label, running: !!value.proc, stopping: !!value.stopping };
  }
  ws.send(JSON.stringify({
    type: "init",
    edition: "community",
    processes,
    logs,
    stats: buildStats(readFoundDeals()),
    watchlistCount: readWatchlist().length,
    targetGroups: buildGroups(readWatchlist()),
    limits: buildLimits(readWatchlist()),
  }));
});

async function startServer(port) {
  await initWorkspace();
  return new Promise((resolve, reject) => {
    server.on("error", (e) => reject(e));
    server.listen(port || 0, "127.0.0.1", () => {
      startWatchers();
      resolve(server.address().port);
    });
  });
}

async function stopServer() {
  for (const file of watchedFiles) fs.unwatchFile(file);
  watchedFiles.clear();
  return new Promise((resolve, reject) => {
    server.close((e) => (e ? reject(e) : resolve()));
  });
}

module.exports = { startServer, stopServer };

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3340;
  startServer(port).then((resolvedPort) => {
    console.log(`\n  FBM Sniper Community Edition running at http://localhost:${resolvedPort}\n`);
  });
}
