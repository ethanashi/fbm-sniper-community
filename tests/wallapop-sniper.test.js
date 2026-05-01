import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { resolveTargetPriceBand } from "../lib/shared-marketplace/price-band.js";

const sniperPath = path.resolve("lib/wallapop-sniper.js");
const source = fs.readFileSync(sniperPath, "utf8");

function extractFunction(name, context = {}) {
  const asyncMarker = `async function ${name}(`;
  const syncMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start === -1) start = source.indexOf(syncMarker);
  assert.notEqual(start, -1, `Could not find ${name} in ${sniperPath}`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = braceStart; index < source.length; index++) {
    const char = source[index];
    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }

  assert.notEqual(end, -1, `Could not parse ${name} from ${sniperPath}`);
  const fnSource = source.slice(start, end);
  return vm.runInNewContext(`(${fnSource})`, context);
}

test("isSupportedWallapopLocation rejects coordinates outside Wallapop markets", () => {
  const isSupportedWallapopLocation = extractFunction("isSupportedWallapopLocation");

  assert.equal(isSupportedWallapopLocation({ latitude: 45.523064, longitude: -122.676483 }), false);
  assert.equal(isSupportedWallapopLocation({ latitude: 40.4032, longitude: -3.7037 }), true);
  assert.equal(isSupportedWallapopLocation({ latitude: 38.7223, longitude: -9.1393 }), true);
  assert.equal(isSupportedWallapopLocation({ latitude: 41.9028, longitude: 12.4964 }), true);
});

test("runQuery preserves base radius when target radius is null", async () => {
  let receivedCfg = null;
  const runQuery = extractFunction("runQuery", {
    hasNumber: (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)),
    hasPositiveNumber: (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) > 0,
    fetchPage: async (_query, cfg) => {
      receivedCfg = cfg;
      return [];
    },
    convertPriceBandForCurrency: (band) => band,
    nativeCurrencyForPlatform: () => "EUR",
    resolveTargetPriceBand,
    chalk: {
      red: (value) => value,
      gray: (value) => value,
      green: (value) => value,
      yellow: (value) => value,
    },
    console: { log() {} },
    backoffSec: 0,
    seenIds: new Set(),
    WALLAPOP_PRODUCTS: new Set(["iphone", "mac", "ipad", "airpods"]),
    targetMatchesText: () => true,
    detectModel: () => null,
    detectStorage: () => null,
    detectRam: () => null,
    defaultStorageForModel: () => 128,
    resolveMaxBuy: () => null,
    LOWBALL_MAX_RATIO: 1.8,
    scoreElectronicsListing: () => ({ go: false }),
    dayjs: () => ({ fromNow: () => "now" }),
    titleCase: (value) => value,
    storageLabel: (value) => `${value}GB`,
    summarizeTarget: () => null,
    appendFound: () => {},
    notify: async () => {},
    setTimeout,
    Promise,
  });

  await runQuery(
    {
      label: "iPhone 16 Pro Max",
      query: "iPhone 16 Pro Max",
      radiusKM: null,
      minPrice: null,
      maxPrice: null,
    },
    { lat: 40.4, lng: -3.7, radiusKm: 10 },
  );

  assert.ok(receivedCfg, "runQuery should call fetchPage");
  assert.equal(receivedCfg.radiusKm, 10);
  assert.equal(receivedCfg.minPrice, 0);
  assert.equal(receivedCfg.maxPrice, 250000);
});
