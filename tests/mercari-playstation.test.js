import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const source = fs.readFileSync(path.resolve("lib/mercari-sniper.js"), "utf8");

function extractConstArray(name, context = {}) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find ${name}`);
  const end = source.indexOf("];", start);
  assert.notEqual(end, -1, `Could not parse ${name}`);
  vm.runInNewContext(`${source.slice(start, end + 2)}; this.${name} = ${name};`, context);
  return context;
}

function extractConstObject(name, context = {}) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find ${name}`);
  const end = source.indexOf("};", start);
  assert.notEqual(end, -1, `Could not parse ${name}`);
  vm.runInNewContext(`${source.slice(start, end + 2)}; this.${name} = ${name};`, context);
  return context;
}

function extractConstSet(name, context = {}) {
  const marker = `const ${name} = `;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find ${name}`);
  const end = source.indexOf(");", start);
  assert.notEqual(end, -1, `Could not parse ${name}`);
  vm.runInNewContext(`${source.slice(start, end + 2)}; this.${name} = ${name};`, context);
  return context;
}

function extractFunction(name, context = {}) {
  const asyncMarker = `async function ${name}(`;
  const syncMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start === -1) start = source.indexOf(syncMarker);
  assert.notEqual(start, -1, `Could not find ${name}`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }

  assert.notEqual(end, -1, `Could not parse ${name}`);
  return vm.runInNewContext(`(${source.slice(start, end)})`, context);
}

test("Mercari supports PlayStation targets", () => {
  const context = extractConstSet("MERCARI_PRODUCTS");

  assert.equal(context.MERCARI_PRODUCTS.has("playstation"), true);
  assert.equal(context.MERCARI_PRODUCTS.has("console"), true);
});

test("Mercari detects PS5 models and resolves max buy", () => {
  const context = {};
  const normalize = extractFunction("normalize", context);
  Object.assign(context, { normalize });
  extractConstArray("MODEL_KEYS", context);
  extractConstArray("PS_PATTERNS", context);
  extractConstObject("MAX_BUY", context);
  extractConstObject("PS_MAX_BUY", context);

  const detectPSModel = extractFunction("detectPSModel", context);
  Object.assign(context, { detectPSModel });
  const detectModel = extractFunction("detectModel", context);
  const resolveMaxBuy = extractFunction("resolveMaxBuy", context);

  assert.equal(detectModel("Sony PlayStation 5 Disc Console", "playstation"), "ps5 disc");
  assert.equal(detectModel("PS5 digital edition", "console"), "ps5 digital");
  assert.equal(detectModel("PS5 Pro 2TB", "playstation"), "ps5 pro");
  assert.equal(resolveMaxBuy("playstation", "ps5 pro", null), 445);
});

test("Mercari filters PS5 games and accessories before scoring", () => {
  const context = {};
  const normalize = extractFunction("normalize", context);
  Object.assign(context, { normalize });
  const isLikelyPlaystationConsole = extractFunction("isLikelyPlaystationConsole", context);

  assert.equal(isLikelyPlaystationConsole({
    category: "Games",
    price: 40,
  }, "AstroBot - Sony Playstation 5 PS5 Video Game Games"), false);
  assert.equal(isLikelyPlaystationConsole({
    category: "Consoles",
    price: 100,
  }, "PlayStation Pulse Earbuds PS5 Remote"), false);
  assert.equal(isLikelyPlaystationConsole({
    category: "Consoles",
    price: 341,
  }, "Ps5 Consoles"), true);
  assert.equal(isLikelyPlaystationConsole({
    category: "Consoles",
    price: 50,
  }, "PS5 console parts repair"), true);
});

test("Mercari scores generic custom targets without model detection", async () => {
  const records = [];
  const runTargetQuery = extractFunction("runTargetQuery", {
    resolveTargetPriceBand: () => ({ minPrice: 0, maxPrice: 100 }),
    convertPriceBandForCurrency: (band) => band,
    nativeCurrencyForPlatform: () => "USD",
    targetMatchesText: () => true,
    isSpecializedMercariProduct: () => false,
    detectModel: () => {
      throw new Error("generic targets should not detect models");
    },
    scoreGenericListing: ({ price, maxBuy }) => ({
      go: true,
      grade: "A",
      score: 95,
      reasons: [`price ${price} under ${maxBuy}`],
    }),
    scoreElectronicsListing: () => {
      throw new Error("generic targets should not use electronics scoring");
    },
    resolveTargetReferencePrice: () => 100,
    genericListingLabel: (target) => target.label || target.query,
    summarizeTarget: () => null,
    appendFound: (record) => records.push(record),
    notify: async () => {},
    formatUsd: (value) => `$${value}`,
    chalk: {
      red: (value) => value,
      gray: (value) => value,
      green: (value) => value,
      yellow: (value) => value,
    },
    console: { log() {} },
    process: { stdout: { write() {} } },
    seenIds: new Set(),
    backoffSec: 0,
    LOWBALL_MAX_RATIO: 1.8,
    MercariBlockedError: class MercariBlockedError extends Error {},
  });

  const money = {
    displayCurrency: "USD",
    toDisplay: (value) => value,
    fromDisplay: (value) => value,
    format: (value) => `$${value}`,
  };

  await runTargetQuery({
    label: "Vintage Levi Jacket",
    query: "vintage levis jacket",
    product: "clothing",
    platforms: ["mercari"],
    maxPrice: 100,
  }, {
    search: async () => [{
      id: "jacket-1",
      status: "on_sale",
      price: 45,
      title: "Vintage Levi Jacket",
      condition: "Good",
      category: "Clothing",
      url: "https://www.mercari.com/us/item/jacket-1/",
      photoUrls: [],
    }],
  }, money);

  assert.equal(records.length, 1);
  assert.equal(records[0].product, "clothing");
  assert.equal(records[0].model, "Vintage Levi Jacket");
  assert.equal(records[0].max_buy, 100);
});
