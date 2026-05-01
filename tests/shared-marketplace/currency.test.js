import test from "node:test";
import assert from "node:assert/strict";

import {
  convertCurrency,
  convertPriceBandForCurrency,
  createCurrencyConverter,
  currencyForVintedDomain,
  formatCurrency,
  nativeCurrencyForPlatform,
  normalizeCurrencyCode,
} from "../../lib/shared-marketplace/currency.js";

test("normalizes and formats display currencies", () => {
  assert.equal(normalizeCurrencyCode("usd"), "USD");
  assert.equal(normalizeCurrencyCode("eur"), "EUR");
  assert.equal(normalizeCurrencyCode("nope", "GBP"), "GBP");
  assert.equal(formatCurrency(1234.5, "USD"), "$1,234.50");
  assert.equal(formatCurrency(1234.5, "EUR"), "€1,234.50");
});

test("converts using supplied exchange rates", () => {
  assert.equal(convertCurrency(100, "EUR", "USD", { EUR: 1.2 }), 120);
  assert.equal(convertCurrency(120, "EUR", "USD", { EUR: 1.2 }, { direction: "fromDisplay" }), 100);
});

test("resolves native marketplace currencies", () => {
  assert.equal(nativeCurrencyForPlatform("mercari"), "USD");
  assert.equal(nativeCurrencyForPlatform("wallapop"), "EUR");
  assert.equal(currencyForVintedDomain("www.vinted.co.uk"), "GBP");
  assert.equal(currencyForVintedDomain("www.vinted.pl"), "PLN");
  assert.equal(currencyForVintedDomain("www.vinted.es"), "EUR");
});

test("currency converter fetches rates and converts both directions", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({ rates: { USD: 1.25 } }),
    };
  };

  const converter = await createCurrencyConverter({
    displayCurrency: "USD",
    sourceCurrencies: ["EUR"],
    fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(converter.toDisplay(40, "EUR"), 50);
  assert.equal(converter.fromDisplay(50, "EUR"), 40);
  assert.deepEqual(convertPriceBandForCurrency({ minPrice: 25, maxPrice: 50 }, converter, "EUR"), {
    minPrice: 20,
    maxPrice: 40,
  });
});
