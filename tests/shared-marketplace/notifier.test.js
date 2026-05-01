import test from "node:test";
import assert from "node:assert/strict";
import { resolveNotificationConfig, notify } from "../../lib/shared-marketplace/notifier.js";

test("resolveNotificationConfig returns basic config", () => {
  const config = resolveNotificationConfig({
    notifications: {
      includePhotos: true,
      maxPhotos: 5,
      autoOpenBrowser: "default"
    }
  });
  assert.equal(config.includePhotos, true);
  assert.equal(config.maxPhotos, 5);
  assert.equal(config.autoOpenBrowser, "default");
});

test("notify result is no-op", async () => {
  const result = await notify({ grade: "A", url: "https://test.com" });
  assert.deepEqual(result, { sent: false, routes: [] });
});
