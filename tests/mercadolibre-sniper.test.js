import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const sniperPath = path.resolve("lib/mercadolibre-sniper.js");
const source = fs.readFileSync(sniperPath, "utf8");

function extractFunction(name, context = {}) {
  const marker = `async function ${name}(`;
  const start = source.indexOf(marker);
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

test("runTargetQuery calls searchListings and processes items", async () => {
  let searchCalled = false;
  const runTargetQuery = extractFunction("runTargetQuery", {
    searchListings: async (siteId, query, accessToken) => {
      searchCalled = true;
      assert.equal(siteId, "MLA");
      assert.equal(query, "iphone 13");
      return [
        {
          id: "MLA123",
          title: "iPhone 13 128GB",
          price: 500,
          currency_id: "ARS",
          permalink: "https://example.com/MLA123",
          seller: { id: 1, nickname: "test-seller" },
          condition: "new"
        }
      ];
    },
    seenIds: new Set(),
    targetMatchesText: () => true,
    scoreElectronicsListing: () => ({ go: true, grade: "A", score: 95, reasons: ["good deal"] }),
    detectModel: () => "iphone 13",
    detectStorageGb: () => 128,
    summarizeTarget: (t) => t,
    appendFound: (record) => {
      assert.equal(record.listing_price, 500);
      assert.equal(record.grade, "A");
    },
    notify: async () => {},
    isListingSeen: async () => false,
    recordPrice: async () => {},
    matchesRegexFilter: () => ({ rejected: false }),
    calculateProfitability: () => ({ netProfit: 100, roi: 20 }),
    calculateZScore: async () => 0,
    evaluateTriggers: () => ({ triggered: true }),
    markListingSeen: async () => {},
    chalk: {
      green: (v) => v,
      yellow: (v) => v,
      gray: (v) => v,
      red: (v) => v,
      blueBright: (v) => v,
    },
    console: { log() {} },
    process: { stdout: { write() {} } },
    Promise,
    Date,
  });

  await runTargetQuery(
    {
      label: "iPhone 13",
      query: "iphone 13",
      maxPrice: 1000,
      product: "iphone"
    },
    "MLA",
    "token",
    { filters: {} }
  );

  assert.ok(searchCalled, "searchListings should have been called");
});
