import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FBM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-shared-"));

const { startServer, stopServer } = await import("../../server.cjs");

async function waitForProcessStopped(port, name) {
  const deadline = Date.now() + 15000;
  let lastStatus = null;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    const status = await response.json();
    lastStatus = status.processes?.[name] || null;
    if (!lastStatus?.running) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${name} to stop; last status: ${JSON.stringify(lastStatus)}`);
}

async function waitForWebSocketEvent(socket, predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for websocket event after ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
    }

    function onMessage(event) {
      const data = JSON.parse(String(event.data));
      if (!predicate(data)) return;
      cleanup();
      resolve(data);
    }

    function onError(event) {
      cleanup();
      reject(event.error || new Error("websocket error"));
    }

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
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

test("GET /api/shared/found/:platform preserves valid entries when one NDJSON line is malformed", async () => {
  const file = path.join(process.env.FBM_DATA_DIR, "facebook", "found.ndjson");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ title: "older-valid", timestamp: "2026-04-18T10:00:00.000Z" }),
      '{"title":"broken"',
      JSON.stringify({ title: "newer-valid", timestamp: "2026-04-18T10:05:00.000Z" }),
    ].join("\n") + "\n",
    "utf8",
  );

  const port = await startServer(0);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/shared/found/facebook`);
    assert.equal(response.status, 200);

    const data = await response.json();
    assert.deepEqual(
      data.map((entry) => entry.title),
      ["newer-valid", "older-valid"],
    );
  } finally {
    await stopServer();
  }
});

test("POST /api/process/facebook-sniper/start uses the named route alias", async () => {
  const port = await startServer(0);
  let started = false;
  let cleanupError = null;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/process/facebook-sniper/start`, {
      method: "POST",
    });
    assert.equal(response.status, 200);
    started = true;

    const data = await response.json();
    assert.equal(data.ok, true);
  } catch (error) {
    cleanupError = error;
  } finally {
    if (started) {
      try {
        await fetch(`http://127.0.0.1:${port}/api/process/facebook-sniper/stop`, {
          method: "POST",
        });
      } catch (error) {
        cleanupError ||= new Error(`failed to request facebook-sniper stop: ${error.message}`);
      }
      try {
        await waitForProcessStopped(port, "facebook-sniper");
      } catch (error) {
        cleanupError ||= error;
      }
    }
    await stopServer();
  }
  if (cleanupError) throw cleanupError;
});

test("shared found file changes broadcast shared-found-updated with the platform", async () => {
  const file = path.join(process.env.FBM_DATA_DIR, "facebook", "found.ndjson");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "", "utf8");

  const port = await startServer(0);
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  try {
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });

    const eventPromise = waitForWebSocketEvent(
      socket,
      (event) => event.type === "shared-found-updated" && event.platform === "facebook",
      7000,
    );

    fs.writeFileSync(
      file,
      JSON.stringify({ title: "updated", timestamp: "2026-04-18T10:10:00.000Z" }) + "\n",
      "utf8",
    );

    const event = await eventPromise;
    assert.equal(event.type, "shared-found-updated");
    assert.equal(event.platform, "facebook");
    assert.equal(typeof event.ts, "number");
  } finally {
    socket.close();
    await stopServer();
  }
});
