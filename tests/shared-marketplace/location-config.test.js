import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FBM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-location-"));

const workspace = await import("../../lib/shared-marketplace/workspace.js");

test("default shared location is blank and requires confirmation", () => {
  const config = workspace.loadWorkspaceConfig();

  assert.equal(config.location.latitude, null);
  assert.equal(config.location.longitude, null);
  assert.equal(config.location.confirmed, false);
  assert.equal(config.displayCurrency, "USD");
  assert.equal(workspace.hasValidLocation(config.location), false);
  assert.equal(workspace.hasConfirmedLocation(config.location), false);
});

test("shared display currency can be changed", () => {
  workspace.saveWorkspaceConfig({
    displayCurrency: "eur",
  });

  const config = workspace.loadWorkspaceConfig();

  assert.equal(config.displayCurrency, "EUR");
});

test("legacy Madrid config is preserved but requires confirmation", () => {
  fs.mkdirSync(path.dirname(workspace.WORKSPACE_CONFIG_FILE), { recursive: true });
  fs.writeFileSync(
    workspace.WORKSPACE_CONFIG_FILE,
    JSON.stringify({
      appName: "FBM Sniper Community",
      location: {
        label: "Madrid, Spain",
        latitude: 40.4032,
        longitude: -3.7037,
      },
    }, null, 2),
    "utf8",
  );

  const config = workspace.loadWorkspaceConfig();

  assert.equal(config.location.latitude, 40.4032);
  assert.equal(config.location.longitude, -3.7037);
  assert.equal(config.location.confirmed, false);
  assert.equal(workspace.hasConfirmedLocation(config.location), false);
});

test("custom saved coordinates stay active and confirmed", () => {
  workspace.saveWorkspaceConfig({
    location: {
      label: "Austin, TX",
      latitude: 30.2672,
      longitude: -97.7431,
      confirmed: true,
    },
  });

  const config = workspace.loadWorkspaceConfig();

  assert.equal(config.location.latitude, 30.2672);
  assert.equal(config.location.longitude, -97.7431);
  assert.equal(config.location.confirmed, true);
  assert.equal(workspace.hasConfirmedLocation(config.location), true);
});

test("confirmed Madrid location is preserved when a user intentionally saves it", () => {
  workspace.saveWorkspaceConfig({
    location: {
      label: "Madrid, Spain",
      latitude: 40.4032,
      longitude: -3.7037,
      confirmed: true,
    },
  });

  const config = workspace.loadWorkspaceConfig();

  assert.equal(config.location.latitude, 40.4032);
  assert.equal(config.location.longitude, -3.7037);
  assert.equal(config.location.confirmed, true);
  assert.equal(workspace.hasConfirmedLocation(config.location), true);
});
