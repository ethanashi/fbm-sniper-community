const electron = require("electron");
if (!electron || typeof electron === "string" || !electron.app) {
  throw new Error(
    "Electron main-process APIs are unavailable. Start the app with `npm run desktop`."
  );
}

const path = require("path");
const fs   = require("fs");
const { spawn } = require("child_process");
const { app, BrowserWindow, shell } = electron;

// ── Environment setup ────────────────────────────────────────────────────────
// Point all data writes to the OS user-data directory so the packaged app
// (which lives in a read-only bundle) can still read/write its state.
process.env.FBM_DATA_DIR = app.getPath("userData");

// Tell Puppeteer where to find (and cache) the Chrome binary.
// Using userData keeps it in a user-writable location that survives updates.
process.env.PUPPETEER_CACHE_DIR = path.join(app.getPath("userData"), "puppeteer-cache");

const { startServer } = require("./server.cjs");

let mainWindow  = null;
let setupWindow = null;

// ── Setup window (shown while Chrome is downloading) ─────────────────────────
function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 480,
    height: 260,
    resizable: false,
    frame: false,
    backgroundColor: "#101622",
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #101622; color: #e2e8f0; font-family: -apple-system, sans-serif;
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; height: 100vh; gap: 1.25rem; padding: 2rem;
      text-align: center;
    }
    .title { font-size: 1.15rem; font-weight: 700; color: #f8fafc; }
    .sub   { font-size: .82rem; color: #94a3b8; line-height: 1.5; }
    .bar-wrap { width: 100%; background: #1e293b; border-radius: 6px; height: 6px; overflow: hidden; }
    .bar { height: 100%; background: #10b981; border-radius: 6px;
           animation: pulse 1.4s ease-in-out infinite; width: 60%; }
    @keyframes pulse {
      0%,100% { opacity: 1; } 50% { opacity: .45; }
    }
  </style>
</head>
<body>
  <div class="title">FBM Sniper Community Edition</div>
  <div class="sub">
    Downloading Chrome for the first time.<br/>
    This is a one-time setup (~150 MB) and won't happen again.
  </div>
  <div class="bar-wrap"><div class="bar"></div></div>
</body>
</html>`;

  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  setupWindow.loadURL(dataUrl);
}

// ── Ensure Chrome is available, downloading it if necessary ──────────────────
function ensureBrowser() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, "lib", "ensure-browser.mjs");
    const child  = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ensure-browser exited with code ${code}`));
    });
  });
}

// ── Main window ───────────────────────────────────────────────────────────────
async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1040,
    minHeight: 720,
    title: "FBM Sniper Community Edition",
    backgroundColor: "#101622",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 19 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
  });

  mainWindow.setMenu(null);
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

// ── Boot sequence ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // Check if Chrome already exists (fast path — no window shown).
    const cacheDir  = process.env.PUPPETEER_CACHE_DIR;
    const chromeDirs = fs.existsSync(cacheDir)
      ? fs.readdirSync(cacheDir).filter(Boolean)
      : [];
    const needsDownload = chromeDirs.length === 0;

    if (needsDownload) {
      createSetupWindow();
    }

    await ensureBrowser();

    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.close();
      setupWindow = null;
    }

    const port = await startServer(0);
    await createWindow(port);
  } catch (error) {
    console.error("Failed to start FBM Sniper Community Edition:", error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
