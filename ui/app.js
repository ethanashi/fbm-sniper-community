/* ── State ──────────────────────────────────────────────────────────────────── */
let ws = null;
let wsRetryTimer = null;
let processState = {};
let appConfig = {};
let foundDeals = [];
let rejectedDeals = [];
let watchlist = [];
let targetGroups = [];
let currentLogProcess = "car-sniper";
let currentWatchGroup = "all";
let currentFoundGroup = "all";
let currentRejectedGroup = "all";
let foundReloadTimer = null;
let rejectedReloadTimer = null;
const terminalBuffers = {};
let activeDealModal = null;
let activeTextPrompt = null;
let draggedTargetId = null;

/* ── Carousel state ─────────────────────────────────────────────────────────── */
// cardId → current photo index
const photoIndexes = {};

/* ── Tab navigation ─────────────────────────────────────────────────────────── */
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("active");

    if (btn.dataset.tab === "watchlist") loadWatchlist();
    if (btn.dataset.tab === "found")     loadFoundDeals();
    if (btn.dataset.tab === "rejected")  loadRejectedDeals();
    if (btn.dataset.tab === "settings")  loadSettings();
  });
});

/* ── WebSocket ──────────────────────────────────────────────────────────────── */
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    document.getElementById("wsIndicator").classList.add("connected");
    clearTimeout(wsRetryTimer);
  };

  ws.onclose = () => {
    document.getElementById("wsIndicator").classList.remove("connected");
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
      refreshStatus();
      return;
    }

    if (msg.type === "status" && processState[msg.process]) {
      processState[msg.process].running  = msg.running;
      processState[msg.process].stopping = msg.stopping || false;
      renderProcessGrid();
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
}

function flushTerminal() {
  const terminal = document.getElementById("terminal");
  terminal.innerHTML = "";
  (terminalBuffers[currentLogProcess] || []).forEach((node) => terminal.appendChild(node.cloneNode(true)));
  if (document.getElementById("autoScroll")?.checked) terminal.scrollTop = terminal.scrollHeight;
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

  Object.entries(processState).forEach(([name, info]) => {
    const badgeClass = info.running ? (info.stopping ? "badge-stopping" : "badge-running") : "badge-stopped";
    const badgeText  = info.running ? (info.stopping ? "Stopping" : "Running") : "Stopped";
    const card = document.createElement("div");
    card.className = "process-card";
    card.innerHTML = `
      <div class="process-header">
        <div>
          <div class="process-name">${escHtml(info.label)}</div>
          <div class="process-desc">Community scan loop — targets from Settings</div>
        </div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="process-actions">
        <button class="btn btn-start"  ${info.running ? "disabled" : ""} onclick="startProcess('${name}')">Start</button>
        <button class="btn btn-stop"   ${!info.running || info.stopping ? "disabled" : ""} onclick="stopProcess('${name}')">Stop</button>
        <button class="btn btn-logs"   onclick="goToLogs('${name}')">Logs</button>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ── Status ─────────────────────────────────────────────────────────────────── */
async function refreshStatus() {
  try {
    const data = await fetch("/api/status").then((r) => r.json());
    processState = data.processes || {};
    targetGroups = Array.isArray(data.targetGroups) ? data.targetGroups : targetGroups;
    renderProcessGrid();
    setText("statBuyNow",   data.stats?.buyNow    ?? 0);
    setText("statMaybe",    data.stats?.maybe     ?? 0);
    setText("statAvgMargin", `$${formatNumber(data.stats?.avgMargin ?? 0)}`);
    setText("statRecalls",  data.stats?.recallFlags ?? 0);
    const g = targetGroups.length;
    setText("watchlistSummary", `${data.watchlistCount ?? 0} targets across ${g} group${g === 1 ? "" : "s"}`);
    const limits = data.limits || {};
    const enabled = limits.enabledCount ?? 0;
    const max = limits.maxActiveTargets ?? 3;
    const pill = document.getElementById("limitPill");
    if (pill) {
      pill.textContent = `Active: ${enabled}/${max}`;
      pill.classList.toggle("limit-pill-full", enabled >= max);
    }
  } catch {}
}

async function startProcess(name) {
  const res = await fetch("/api/process/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ process: name }),
  });
  if (res.ok && processState[name]) {
    processState[name].running = true;
    processState[name].stopping = false;
    renderProcessGrid();
  }
}

async function stopProcess(name) {
  const res = await fetch("/api/process/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ process: name }),
  });
  if (res.ok && processState[name]) {
    processState[name].running = true;
    processState[name].stopping = true;
    renderProcessGrid();
  }
}

function goToLogs(name) {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelector('[data-tab="logs"]')?.classList.add("active");
  document.getElementById("tab-logs")?.classList.add("active");
  const sel = document.getElementById("logProcess");
  if (sel) sel.value = name;
  currentLogProcess = name;
  flushTerminal();
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
  renderFoundDeals();
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
  const data = await fetch("/api/settings").then((r) => r.json());
  appConfig  = data.config || {};
  watchlist  = Array.isArray(data.watchlist) ? data.watchlist : [];
  syncTargetGroups();
  renderWatchlist();
  renderFoundDeals();
  renderRejectedDeals();
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

  setSettingsStatus("Loaded current settings from disk.", "ok");
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

  if (proxy) nextConfig.proxy = proxy;
  else delete nextConfig.proxy;
  nextConfig.proxyPool = proxyPool;

  // Keep the raw editor in sync
  document.getElementById("configEditor").value = JSON.stringify(nextConfig, null, 2);

  let nextWatchlist;
  try {
    nextWatchlist = JSON.parse(document.getElementById("watchlistEditor").value);
  } catch {
    nextWatchlist = watchlist;
  }

  const res    = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: nextConfig, watchlist: nextWatchlist }),
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
  setSettingsStatus("Saved. Restart the scan loop to apply immediately.", "ok");
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

function reloadSettings() { loadSettings(); }

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

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(String(value ?? ""));
  }
  return String(value ?? "").replace(/["\\]/g, "\\$&");
}

/* ── Search / filter listeners ──────────────────────────────────────────────── */
document.getElementById("foundSearch")?.addEventListener("input", renderFoundDeals);
document.getElementById("verdictFilter")?.addEventListener("change", renderFoundDeals);
document.getElementById("rejectedSearch")?.addEventListener("input", renderRejectedDeals);

/* ── Periodic refresh ───────────────────────────────────────────────────────── */
function refreshVisible() {
  if (document.visibilityState !== "visible") return;
  if (document.getElementById("tab-dashboard")?.classList.contains("active")) refreshStatus();
  if (document.getElementById("tab-found")?.classList.contains("active"))     loadFoundDeals();
  if (document.getElementById("tab-rejected")?.classList.contains("active"))  loadRejectedDeals();
  if (document.getElementById("tab-watchlist")?.classList.contains("active")) loadWatchlist();
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
  if (!manualField.value.trim()) {
    manualField.value = JSON.stringify(MANUAL_TARGET_TEMPLATE, null, 2);
  }
  setDrawerStatus("", "");
}

function closeAddTarget() {
  document.getElementById("addTargetDrawer").classList.remove("open");
}

async function addTarget() {
  const raw = document.getElementById("manualTargetJson").value.trim();
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

  const btn = document.getElementById("addTargetBtn");
  btn.disabled = true;
  btn.textContent = "Adding…";

  try {
    const res  = await fetch("/api/watchlist/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      setDrawerStatus(data.error || "Failed to add target.", "err");
      return;
    }

    // Success — reload watchlist, close drawer
    await loadWatchlist();
    closeAddTarget();

    // Switch to watchlist tab to show the new target
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelector('[data-tab="watchlist"]').classList.add("active");
    document.getElementById("tab-watchlist").classList.add("active");
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

/* ── Boot ───────────────────────────────────────────────────────────────────── */
connectWS();
refreshStatus();
loadFoundDeals();
loadRejectedDeals();
loadSettings();
setInterval(refreshVisible, 15000);
document.addEventListener("visibilitychange", refreshVisible);
