const electron = require("electron");
if (!electron || typeof electron === "string" || !electron.app) {
  throw new Error(
    "Electron main-process APIs are unavailable. Start the app with `npm run desktop`."
  );
}

const path = require("path");
const fs   = require("fs");
const { spawn } = require("child_process");
const { app, BrowserWindow, shell, dialog } = electron;

// ── Environment setup ────────────────────────────────────────────────────────
process.env.FBM_DATA_DIR = app.getPath("userData");
process.env.PUPPETEER_CACHE_DIR = path.join(app.getPath("userData"), "puppeteer-cache");

const STARTUP_LOG = path.join(app.getPath("userData"), "startup-error.log");

// Persist startup errors so Windows users (who have no console on double-click)
// have a file they can open / share when the app fails to launch.
function writeStartupError(label, error) {
  const stamp = new Date().toISOString();
  const body = error && error.stack ? error.stack : String(error);
  const line = `[${stamp}] ${label}\n${body}\n\n`;
  try {
    fs.mkdirSync(path.dirname(STARTUP_LOG), { recursive: true });
    fs.appendFileSync(STARTUP_LOG, line, "utf8");
  } catch { /* best-effort logging */ }
  try { console.error(label, error); } catch { /* console may not exist on Win GUI */ }
}

process.on("uncaughtException", (error) => {
  writeStartupError("uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  writeStartupError("unhandledRejection", reason);
});

const { startServer } = require("./server.cjs");

let mainWindow = null;
let chromeReady = false;
let chromeError = null;

// ── Chrome download (runs in the background after the UI is up) ──────────────
function ensureBrowser() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, "lib", "ensure-browser.mjs");
    const child  = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stderrBuf = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      try { process.stdout.write(text); } catch { /* no console */ }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("chrome-progress", text);
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      try { process.stderr.write(text); } catch { /* no console */ }
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ensure-browser exited with code ${code}: ${stderrBuf.trim()}`));
    });
  });
}

// ── Main window ──────────────────────────────────────────────────────────────
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

  mainWindow.webContents.on("did-finish-load", () => {
    if (chromeReady) {
      mainWindow.webContents.send("chrome-status", { ready: true });
    } else if (chromeError) {
      mainWindow.webContents.send("chrome-status", { ready: false, error: chromeError.message });
    } else {
      mainWindow.webContents.send("chrome-status", { ready: false, downloading: true });
    }
  });
}

function broadcastChromeStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("chrome-status", {
    ready: chromeReady,
    error: chromeError ? chromeError.message : null,
    downloading: !chromeReady && !chromeError,
  });
}

// Kick off Chrome download without blocking the UI. Failure is non-fatal —
// Vinted/Wallapop snipers work without it; only Facebook + Cars need Chrome.
function startChromeDownload() {
  ensureBrowser()
    .then(() => {
      chromeReady = true;
      chromeError = null;
      broadcastChromeStatus();
    })
    .catch((error) => {
      chromeReady = false;
      chromeError = error;
      writeStartupError("Chrome download failed (non-fatal)", error);
      broadcastChromeStatus();
    });
}

// ── Boot sequence ────────────────────────────────────────────────────────────
async function boot() {
  const port = await startServer(0);
  await createWindow(port);
  startChromeDownload();
}

app.whenReady().then(boot).catch((error) => {
  writeStartupError("Fatal startup error", error);
  try {
    dialog.showErrorBox(
      "FBM Sniper failed to start",
      `The app could not launch.\n\nDetails have been saved to:\n${STARTUP_LOG}\n\nError: ${error && error.message ? error.message : String(error)}`
    );
  } catch { /* dialog unavailable pre-ready */ }
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
