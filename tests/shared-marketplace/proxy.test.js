import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProxyInput } from "../../lib/shared-marketplace/proxy.js";

test("normalizeProxyInput adds http scheme for bare host port proxies", () => {
  const proxy = normalizeProxyInput("92.113.180.175:48991");

  assert.equal(proxy.server, "http://92.113.180.175:48991");
  assert.equal(proxy.href, "http://92.113.180.175:48991");
  assert.equal(proxy.host, "92.113.180.175");
  assert.equal(proxy.port, 48991);
  assert.equal(proxy.username, "");
});

test("normalizeProxyInput strips credentials from the Chromium server value", () => {
  const proxy = normalizeProxyInput("http://user:pass@92.113.180.175:48991");

  assert.equal(proxy.server, "http://92.113.180.175:48991");
  assert.equal(proxy.href, "http://user:pass@92.113.180.175:48991");
  assert.equal(proxy.username, "user");
  assert.equal(proxy.password, "pass");
});

test("normalizeProxyInput accepts ip:port:user:pass provider format", () => {
  const proxy = normalizeProxyInput("92.113.180.175:48991:my-user:my-pass");

  assert.equal(proxy.server, "http://92.113.180.175:48991");
  assert.equal(proxy.href, "http://my-user:my-pass@92.113.180.175:48991");
  assert.equal(proxy.username, "my-user");
  assert.equal(proxy.password, "my-pass");
});

test("normalizeProxyInput rejects unsupported proxy schemes", () => {
  assert.equal(normalizeProxyInput("ftp://92.113.180.175:48991"), null);
});
