const electron = require("electron");
if (!electron || typeof electron === "string" || !electron.app) {
  throw new Error(
    "Electron main-process APIs are unavailable. Start the app with `npm run desktop`."
  );
}

const { app, BrowserWindow, shell } = electron;
const { startServer } = require("./server.cjs");

let mainWindow = null;

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

app.whenReady().then(async () => {
  try {
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
