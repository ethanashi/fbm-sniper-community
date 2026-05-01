import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.FBM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fbm-generic-targets-"));

const workspace = await import("../../lib/shared-marketplace/workspace.js");
const priceBand = await import("../../lib/shared-marketplace/price-band.js");
const scorer = await import("../../lib/shared-marketplace/programmatic-scorer.js");

test("shared watchlist preserves arbitrary products for generic sniping", () => {
  const target = workspace.normalizeWatchlistEntry({
    label: "Vintage Levi Jacket",
    query: "vintage levis jacket",
    group: "Clothing",
    product: "clothing",
    targetType: "apparel",
    platforms: ["mercari"],
    minPrice: null,
    maxPrice: 80,
  });

  assert.equal(target.product, "clothing");
  assert.equal(target.targetType, "apparel");
  assert.deepEqual(target.platforms, ["mercari"]);
});

test("generic scorer does not reject non-electronics keywords like case", () => {
  const verdict = scorer.scoreGenericListing({
    title: "vintage leather carrying case",
    description: "good condition",
    price: 25,
    maxBuy: 60,
  });

  assert.equal(verdict.go, true);
  assert.equal(verdict.grade, "A");
});

test("target reference price only uses an explicitly configured max price", () => {
  assert.equal(priceBand.resolveTargetReferencePrice({ maxPrice: 125 }), 125);
  assert.equal(priceBand.resolveTargetReferencePrice({ maxPrice: null }), null);
});
