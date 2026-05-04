import { spawn } from "node:child_process";
import { loadWorkspaceConfig } from "./workspace.js";

const GRADE_GREEN = new Set(["A", "B"]);

export function resolveNotificationConfig(config = loadWorkspaceConfig()) {
  const notifications = config?.notifications || {};
  return {
    includePhotos: notifications.includePhotos !== false,
    maxPhotos: Math.min(5, Math.max(1, Number(notifications.maxPhotos || 3) || 3)),
    autoOpenBrowser: String(notifications.autoOpenBrowser || "none").trim().toLowerCase() || "none",
  };
}

function maybeOpenBrowser(url, notifications) {
  if (!url || notifications?.autoOpenBrowser !== "default") return;
  if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

export async function notify(record, options = {}) {
  // We strictly disable all auto-opening of browsers in notifier to satisfy "decided by user" request.
  return { sent: false, routes: [] };
}
