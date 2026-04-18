import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FBM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-shared-"));

const { startServer, stopServer } = await import("../../server.cjs");

async function waitForProcessStopped(port, name) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const status = await response.json();
    if (!status.processes?.[name]?.running) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${name} to stop`);
}

test("GET /api/shared/found/:platform returns newest-first deals", async () => {
  const file = path.join(process.env.FBM_DATA_DIR, "facebook", "found.ndjson");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ title: "older", timestamp: "2026-04-18T10:00:00.000Z" }),
      JSON.stringify({ title: "newer", timestamp: "2026-04-18T10:05:00.000Z" }),
    ].join("\n") + "\n",
    "utf8",
  );

  const port = await startServer(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/shared/found/facebook`);
    assert.equal(response.status, 200);

    const data = await response.json();
    assert.equal(data[0].title, "newer");
  } finally {
    await stopServer();
  }
});

test("POST /api/process/facebook-sniper/start uses the named route alias", async () => {
  const port = await startServer(0);
  let started = false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/process/facebook-sniper/start`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    started = true;

    const data = await response.json();
    assert.equal(data.ok, true);
  } finally {
    if (started) {
      await fetch(`http://127.0.0.1:${port}/api/process/facebook-sniper/stop`, {
        method: "POST",
      }).catch(() => {});
      await waitForProcessStopped(port, "facebook-sniper");
    }
    await stopServer();
  }
});
