const express = require("express");
const { createServer } = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

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
const REJECTED_HEADERS = "timestamp,title,query,target_id,target_label,target_group,listing_price,reason,url,make,model,year,title_status\n";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(UI_DIR));

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
};

let workspace = null;
async function initWorkspace() {
  if (workspace) return workspace;
  workspace = await import("./lib/shared-marketplace/workspace.js");
  workspace.ensureWorkspaceFiles();
  return workspace;
}
function requireWorkspace(res) {
  if (!workspace) {
    res.status(503).json({ error: "workspace not initialized" });
    return null;
  }
  return workspace;
}

const logs = {};
const stopTimers = {};
for (const key of Object.keys(PROCESSES)) logs[key] = [];

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
      // ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node.js,
      // so the scanner runs without requiring system Node to be installed.
      ...(IS_ELECTRON ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      ...proxyEnv,
    },
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
function watchDataFile(file, eventType) {
  fs.watchFile(file, { interval: 1500 }, (curr, prev) => {
    if (curr.mtimeMs === 0 || curr.mtimeMs === prev.mtimeMs) return;
    broadcast({ type: eventType, ts: Date.now() });
  });
}

function startWatchers() {
  if (watchersStarted) return;
  watchersStarted = true;
  watchDataFile(CONFIG_FILE, "car-config-updated");
  watchDataFile(FOUND_FILE, "car-found-updated");
  watchDataFile(REJECTED_FILE, "car-rejected-updated");
  watchDataFile(WATCHLIST_FILE, "car-watchlist-updated");
}

app.get("/api/status", (_req, res) => {
  const foundDeals = readFoundDeals();
  const watchlist = readWatchlist();
  const processes = {};
  for (const [key, value] of Object.entries(PROCESSES)) {
    processes[key] = { label: value.label, running: !!value.proc, stopping: !!value.stopping };
  }
  res.json({
    edition: "community",
    processes,
    stats: buildStats(foundDeals),
    watchlistCount: watchlist.length,
    targetGroups: buildGroups(watchlist),
    limits: buildLimits(watchlist),
  });
});

app.get("/api/watchlist", (_req, res) => {
  res.json(readWatchlist());
});

app.post("/api/watchlist/toggle", (req, res) => {
  const { id, enabled } = req.body || {};
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "target id is required" });
  }

  const list = readWatchlist();
  const index = list.findIndex((target) => target.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "target not found" });
  }

  const willEnable = enabled !== false;
  if (willEnable && list[index].enabled === false) {
    const enabledCount = countEnabled(list);
    if (enabledCount >= MAX_ACTIVE_TARGETS) {
      return res.status(403).json({ error: LIMIT_NOTE, code: "target_limit" });
    }
  }

  list[index] = {
    ...list[index],
    enabled: willEnable,
  };
  const updated = persistWatchlist(list);
  res.json({ ok: true, target: updated.find((target) => target.id === id) || null });
});

app.post("/api/watchlist/delete", (req, res) => {
  const { id } = req.body || {};
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "target id is required" });
  }

  const list = readWatchlist();
  const filtered = list.filter((target) => target.id !== id);
  if (filtered.length === list.length) {
    return res.status(404).json({ error: "target not found" });
  }

  persistWatchlist(filtered);
  res.json({ ok: true });
});

app.post("/api/watchlist/move", (req, res) => {
  const { id, group } = req.body || {};
  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "target id is required" });
  }
  if (!group || typeof group !== "string" || !group.trim()) {
    return res.status(400).json({ error: "group name is required" });
  }

  const list = readWatchlist();
  const index = list.findIndex((target) => target.id === id);
  if (index === -1) {
    return res.status(404).json({ error: "target not found" });
  }

  list[index] = {
    ...list[index],
    group: group.trim(),
  };
  const updated = persistWatchlist(list);
  res.json({ ok: true, target: updated.find((target) => target.id === id) || null });
});

app.post("/api/watchlist/rename-group", (req, res) => {
  const { from, to } = req.body || {};
  if (!from || typeof from !== "string" || !from.trim()) {
    return res.status(400).json({ error: "current group name is required" });
  }
  if (!to || typeof to !== "string" || !to.trim()) {
    return res.status(400).json({ error: "new group name is required" });
  }

  const fromName = from.trim();
  const toName = to.trim();
  const list = readWatchlist();
  let changed = 0;
  const updatedList = list.map((target) => {
    if ((target.group || "General") !== fromName) return target;
    changed += 1;
    return {
      ...target,
      group: toName,
    };
  });

  if (!changed) {
    return res.status(404).json({ error: "group not found" });
  }

  const updated = persistWatchlist(updatedList);
  res.json({ ok: true, changed, groups: buildGroups(updated) });
});

app.get("/api/config", (_req, res) => {
  res.json(readConfig());
});

app.get("/api/settings", (_req, res) => {
  res.json({
    config: readConfig(),
    watchlist: readWatchlist(),
    limits: buildLimits(readWatchlist()),
  });
});

app.post("/api/settings", (req, res) => {
  const { config, watchlist } = req.body || {};
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return res.status(400).json({ error: "config must be an object" });
  }
  if (!Array.isArray(watchlist)) {
    return res.status(400).json({ error: "watchlist must be an array" });
  }

  saveJSON(CONFIG_FILE, config);
  persistWatchlist(watchlist);
  broadcast({ type: "car-config-updated", ts: Date.now() });
  res.json({ ok: true });
});

app.get("/api/found", (_req, res) => {
  res.json(readFoundDeals());
});

app.get("/api/rejected", (_req, res) => {
  res.json(readRejected());
});

app.get("/api/logs/:name", (req, res) => {
  const entries = logs[req.params.name];
  if (!entries) return res.status(404).json({ error: "Unknown process" });
  res.json(entries);
});

app.post("/api/process/start", (req, res) => {
  const { process: name, flags = [] } = req.body;
  res.json(startProcess(name, flags));
});

app.post("/api/process/stop", (req, res) => {
  const { process: name } = req.body;
  res.json(stopProcess(name));
});

app.post("/api/reset-memory", (_req, res) => {
  try {
    fs.writeFileSync(FOUND_FILE, "", "utf8");
    fs.writeFileSync(REJECTED_FILE, REJECTED_HEADERS, "utf8");
    fs.writeFileSync(SEEN_IDS_FILE, "[]", "utf8");
    broadcast({ type: "car-found-updated", ts: Date.now() });
    broadcast({ type: "car-rejected-updated", ts: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/watchlist/add", (req, res) => {
  const { target } = req.body || {};
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return res.status(400).json({ error: "target object required" });
  }

  const list = readWatchlist();
  const sanitizedTarget = sanitizeTarget(target);
  if (!sanitizedTarget) {
    return res.status(400).json({ error: "invalid target object" });
  }

  if (sanitizedTarget.enabled !== false && countEnabled(list) >= MAX_ACTIVE_TARGETS) {
    sanitizedTarget.enabled = false;
  }

  // Avoid duplicate ids
  if (list.some((t) => t.id === sanitizedTarget.id)) {
    sanitizedTarget.id = `${sanitizedTarget.id}-${Date.now()}`;
  }

  list.push(sanitizedTarget);
  const updated = persistWatchlist(list);
  res.json({
    ok: true,
    target: updated.find((target) => target.id === sanitizedTarget.id) || sanitizedTarget,
    limitReached: sanitizedTarget.enabled === false,
    limitNote: sanitizedTarget.enabled === false ? LIMIT_NOTE : undefined,
  });
});

app.get("/api/shared/settings", (_req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  const config = ws.loadWorkspaceConfig();
  const watchlist = ws.loadWorkspaceWatchlist();
  res.json({
    config,
    watchlist,
    groups: ws.buildWatchlistGroups(watchlist),
  });
});

app.post("/api/shared/settings", (req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  const { config, watchlist } = req.body || {};
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return res.status(400).json({ error: "config must be an object" });
  }
  if (!Array.isArray(watchlist)) {
    return res.status(400).json({ error: "watchlist must be an array" });
  }
  ws.saveWorkspaceConfig(config);
  ws.saveWorkspaceWatchlist(watchlist);
  broadcast({ type: "shared-config-updated", ts: Date.now() });
  broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
  res.json({ ok: true });
});

app.get("/api/shared/watchlist", (_req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  res.json(ws.loadWorkspaceWatchlist());
});

app.post("/api/shared/watchlist/add", (req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  const entry = ws.normalizeWatchlistEntry(req.body?.target);
  if (!entry) return res.status(400).json({ error: "invalid target object" });
  const list = ws.loadWorkspaceWatchlist();
  if (list.some((t) => t.id === entry.id)) entry.id = `${entry.id}-${Date.now()}`;
  list.push(entry);
  const saved = ws.saveWorkspaceWatchlist(list);
  broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
  res.json({ ok: true, target: saved.find((t) => t.id === entry.id) || entry });
});

app.post("/api/shared/watchlist/toggle", (req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  const { id, enabled } = req.body || {};
  if (!id || typeof id !== "string") return res.status(400).json({ error: "target id is required" });
  const list = ws.loadWorkspaceWatchlist();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: "target not found" });
  list[idx] = { ...list[idx], enabled: enabled !== false };
  const saved = ws.saveWorkspaceWatchlist(list);
  broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
  res.json({ ok: true, target: saved.find((t) => t.id === id) || null });
});

app.post("/api/shared/watchlist/delete", (req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  const { id } = req.body || {};
  if (!id || typeof id !== "string") return res.status(400).json({ error: "target id is required" });
  const list = ws.loadWorkspaceWatchlist();
  const filtered = list.filter((t) => t.id !== id);
  if (filtered.length === list.length) return res.status(404).json({ error: "target not found" });
  ws.saveWorkspaceWatchlist(filtered);
  broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
  res.json({ ok: true });
});

app.post("/api/shared/watchlist/move", (req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  const { id, group } = req.body || {};
  if (!id || typeof id !== "string") return res.status(400).json({ error: "target id is required" });
  if (!group || typeof group !== "string" || !group.trim()) return res.status(400).json({ error: "group name is required" });
  const list = ws.loadWorkspaceWatchlist();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return res.status(404).json({ error: "target not found" });
  list[idx] = { ...list[idx], group: group.trim() };
  const saved = ws.saveWorkspaceWatchlist(list);
  broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
  res.json({ ok: true, target: saved.find((t) => t.id === id) || null });
});

app.post("/api/shared/watchlist/rename-group", (req, res) => {
  const ws = requireWorkspace(res);
  if (!ws) return;
  const { from, to } = req.body || {};
  if (!from || !to || !String(from).trim() || !String(to).trim()) {
    return res.status(400).json({ error: "from and to group names required" });
  }
  const fromName = String(from).trim();
  const toName = String(to).trim();
  const list = ws.loadWorkspaceWatchlist();
  let changed = 0;
  const updated = list.map((t) => {
    if ((t.group || "General") !== fromName) return t;
    changed += 1;
    return { ...t, group: toName };
  });
  if (!changed) return res.status(404).json({ error: "group not found" });
  const saved = ws.saveWorkspaceWatchlist(updated);
  broadcast({ type: "shared-watchlist-updated", ts: Date.now() });
  res.json({ ok: true, changed, groups: ws.buildWatchlistGroups(saved) });
});

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
    server.on("error", reject);
    server.listen(port || 0, "127.0.0.1", () => {
      startWatchers();
      resolve(server.address().port);
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  const port = process.env.PORT ? Number(process.env.PORT) : 3340;
  startServer(port).then((resolvedPort) => {
    console.log(`\n  FBM Sniper Community Edition running at http://localhost:${resolvedPort}\n`);
  });
}
