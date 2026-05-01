import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_OPEN_MAX_PRICE,
  DEFAULT_OPEN_MIN_PRICE,
  resolveTargetPriceBand,
} from "../../lib/shared-marketplace/price-band.js";

test("resolveTargetPriceBand opens blank target prices wide", () => {
  assert.deepEqual(resolveTargetPriceBand({ minPrice: null, maxPrice: null }), {
    minPrice: DEFAULT_OPEN_MIN_PRICE,
    maxPrice: DEFAULT_OPEN_MAX_PRICE,
  });
});

test("resolveTargetPriceBand preserves configured target prices", () => {
  assert.deepEqual(resolveTargetPriceBand({ minPrice: 120, maxPrice: 900 }), {
    minPrice: 120,
    maxPrice: 900,
  });
});

test("resolveTargetPriceBand fills one-sided ranges with open defaults", () => {
  assert.deepEqual(resolveTargetPriceBand({ minPrice: 100, maxPrice: null }), {
    minPrice: 100,
    maxPrice: DEFAULT_OPEN_MAX_PRICE,
  });
  assert.deepEqual(resolveTargetPriceBand({ minPrice: null, maxPrice: 500 }), {
    minPrice: DEFAULT_OPEN_MIN_PRICE,
    maxPrice: 500,
  });
});
