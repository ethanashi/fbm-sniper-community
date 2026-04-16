/**
 * Run once on first launch (or any time Chrome is missing) to download the
 * Puppeteer-managed Chrome into the app userData folder.
 *
 * Invoked by electron.cjs via:
 *   spawn(process.execPath, ['lib/ensure-browser.mjs'], {
 *     env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
 *   })
 *
 * PUPPETEER_CACHE_DIR must be set in the environment before calling.
 */

import { existsSync } from "fs";
import {
  install,
  detectBrowserPlatform,
  Browser,
  computeExecutablePath,
} from "@puppeteer/browsers";
import { PUPPETEER_REVISIONS } from "puppeteer";

const cacheDir = process.env.PUPPETEER_CACHE_DIR;
if (!cacheDir) {
  console.error("[ensure-browser] PUPPETEER_CACHE_DIR is not set");
  process.exit(1);
}

const platform = detectBrowserPlatform();
// Pin to the exact Chrome version Puppeteer expects — using BrowserTag.STABLE
// resolves to whatever Chrome is current today, which drifts out of sync with
// Puppeteer's pinned version and causes "Could not find Chrome (ver. X)" at
// launch time.
const buildId  = PUPPETEER_REVISIONS.chrome;
const execPath = computeExecutablePath({ browser: Browser.CHROME, buildId, cacheDir, platform });

if (existsSync(execPath)) {
  // Already installed — nothing to do.
  process.exit(0);
}

console.log(`[ensure-browser] Chrome not found. Downloading Chrome ${buildId} for ${platform}…`);

let lastPct = -1;
await install({
  browser: Browser.CHROME,
  buildId,
  cacheDir,
  downloadProgressCallback(downloaded, total) {
    if (!total) return;
    const pct = Math.round((downloaded / total) * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      process.stdout.write(`\r[ensure-browser] Downloading Chrome: ${pct}%   `);
    }
  },
});

process.stdout.write("\n");
console.log("[ensure-browser] Chrome ready.");
process.exit(0);
