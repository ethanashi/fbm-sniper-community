import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const scannerPath = path.resolve("lib/scanner.js");
const source = fs.readFileSync(scannerPath, "utf8");

function locationHelpers() {
  const constantsStart = source.indexOf("const MIN_INTERVAL_SECONDS");
  const constantsEnd = source.indexOf("let stopRequested");
  const helpersStart = source.indexOf("function coerceNumber");
  const helpersEnd = source.indexOf("function resolveSearchCenter");

  assert.notEqual(constantsStart, -1, "Could not find scanner constants");
  assert.notEqual(constantsEnd, -1, "Could not find scanner state marker");
  assert.notEqual(helpersStart, -1, "Could not find scanner location helpers");
  assert.notEqual(helpersEnd, -1, "Could not find scanner resolveSearchCenter");

  return vm.runInNewContext(
    `${source.slice(constantsStart, constantsEnd)}\n${source.slice(helpersStart, helpersEnd)}\n({ normalizeLocation, hasConfirmedLocation, mergeSharedLocationConfig });`,
    { process: { argv: ["node", "lib/scanner.js"] } },
  );
}

test("car scanner migrates legacy Madrid config to unconfirmed Dallas starter", () => {
  const { normalizeLocation, hasConfirmedLocation } = locationHelpers();
  const location = normalizeLocation({
    label: "Madrid, Spain",
    latitude: 40.4032,
    longitude: -3.7037,
  });

  assert.equal(location.label, "Dallas, TX");
  assert.equal(location.latitude, 32.7767);
  assert.equal(location.longitude, -96.797);
  assert.equal(location.confirmed, false);
  assert.equal(hasConfirmedLocation(location), false);
});

test("car scanner treats custom saved coordinates as confirmed", () => {
  const { normalizeLocation, hasConfirmedLocation } = locationHelpers();
  const location = normalizeLocation({
    label: "Dallas Suburbs",
    latitude: 33.0198,
    longitude: -96.6989,
  });

  assert.equal(location.confirmed, true);
  assert.equal(hasConfirmedLocation(location), true);
});

test("car scanner preserves confirmed Madrid when intentionally saved", () => {
  const { normalizeLocation, hasConfirmedLocation } = locationHelpers();
  const location = normalizeLocation({
    label: "Madrid, Spain",
    latitude: 40.4032,
    longitude: -3.7037,
    confirmed: true,
  });

  assert.equal(location.label, "Madrid, Spain");
  assert.equal(location.confirmed, true);
  assert.equal(hasConfirmedLocation(location), true);
});

test("car scanner can inherit confirmed shared marketplace location", () => {
  const { mergeSharedLocationConfig } = locationHelpers();
  const config = mergeSharedLocationConfig(
    {
      proxyPool: [],
      location: {
        label: "Dallas, TX",
        latitude: 32.7767,
        longitude: -96.797,
        confirmed: false,
      },
    },
    {
      proxy: "http://proxy.test:8080",
      proxyPool: ["http://proxy-a.test:8080"],
      location: {
        latitude: 40.4168,
        longitude: -3.7038,
        confirmed: true,
      },
    },
  );

  assert.equal(config.location.label, "Shared marketplace location");
  assert.equal(config.location.latitude, 40.4168);
  assert.equal(config.location.longitude, -3.7038);
  assert.equal(config.location.confirmed, true);
  assert.equal(config.proxy, "http://proxy.test:8080");
  assert.deepEqual(config.proxyPool, ["http://proxy-a.test:8080"]);
});

test("car scanner keeps explicitly confirmed car location over shared location", () => {
  const { mergeSharedLocationConfig } = locationHelpers();
  const config = mergeSharedLocationConfig(
    {
      location: {
        label: "Dallas Cars",
        latitude: 32.7767,
        longitude: -96.797,
        confirmed: true,
      },
    },
    {
      location: {
        latitude: 40.4168,
        longitude: -3.7038,
        confirmed: true,
      },
    },
  );

  assert.equal(config.location.label, "Dallas Cars");
  assert.equal(config.location.latitude, 32.7767);
  assert.equal(config.location.longitude, -96.797);
});

test("car scanner reuses located Facebook session for listing details", () => {
  assert.match(source, /preloadMarketplaceMetadata\(/);
  assert.match(source, /metadataSession:\s*marketplaceMetadataSession/);
  assert.match(source, /fallbackToDirectOnProxyRateLimit:\s*true/);
  assert.match(source, /getCachedSession\(proxyUrl,\s*bootstrapLocation\)\?\.cookies/);
  assert.match(source, /getCachedSession\(null,\s*bootstrapLocation\)\?\.cookies/);
  assert.match(source, /getListingDetail\(\s*baseListing\.id,\s*sessionCookies,\s*proxyUrl,\s*bootstrapLocation,\s*marketplaceMetadataSession,\s*\)/);
});
