import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FBM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-mercari-platform-"));

const workspace = await import("../../lib/shared-marketplace/workspace.js");

test("Mercari is a supported shared marketplace platform", () => {
  assert.ok(workspace.listSupportedPlatforms().includes("mercari"));
  assert.equal(
    workspace.targetAppliesToPlatform({ query: "iPhone 15", platforms: ["mercari"] }, "mercari"),
    true,
  );
});

test("default phone watchlist includes Mercari as an option", () => {
  const watchlist = workspace.loadWorkspaceWatchlist();
  const iphone = watchlist.find((target) => target.label === "iPhone 15");

  assert.ok(iphone, "expected iPhone 15 default target");
  assert.ok(iphone.platforms.includes("mercari"));
});

test("default PlayStation watchlist includes Mercari as an option", () => {
  const watchlist = workspace.loadWorkspaceWatchlist();
  const ps5 = watchlist.find((target) => target.label === "PS5");

  assert.ok(ps5, "expected PS5 default target");
  assert.ok(ps5.platforms.includes("mercari"));
});
