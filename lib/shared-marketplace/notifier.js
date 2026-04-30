import fetch from 'node-fetch';
import { spawn } from "node:child_process";

import { loadWorkspaceConfig } from "./workspace.js";

const GRADE_GREEN = new Set(["A", "B"]);
const GRADE_YELLOW = new Set(["C", "D"]);

export function resolveNotificationConfig(config = loadWorkspaceConfig()) {
  const notifications = config?.notifications && typeof config.notifications === "object"
    ? config.notifications
    : {};

  const includePhotos = notifications.includePhotos !== false;
  const maxPhotos = Math.min(5, Math.max(1, Number(notifications.maxPhotos || 3) || 3));
  const autoOpenBrowser = String(notifications.autoOpenBrowser || "default").trim().toLowerCase() || "default";

  return {
    enabled: true,
    includePhotos,
    maxPhotos,
    autoOpenBrowser,
  };
}

function maybeOpenBrowser(url, notifications) {
  if (!url || notifications?.autoOpenBrowser !== "default") return;
  if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
}

export async function notify(record, options = {}) {
  const notifications = options.config || resolveNotificationConfig(loadWorkspaceConfig());
  const openBrowser = typeof options.openBrowser === "function" ? options.openBrowser : maybeOpenBrowser;

  // We only handle browser opening now
  if (record?.url) {
    const isHighGrade = GRADE_GREEN.has(String(record?.grade || "").toUpperCase());
    if (isHighGrade) {
       openBrowser(record.url, notifications);
    }
  }

  return { sent: false, routes: [] };
}
