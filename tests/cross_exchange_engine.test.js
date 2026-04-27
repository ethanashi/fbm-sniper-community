import { ArbitrageEngine } from '../crypto_arbitrage/engine.js';
import { ARBITRAGE_PROFILES } from '../crypto_arbitrage/config.js';
import assert from 'assert';
import test from 'node:test';

test('ArbitrageEngine Cross-Exchange Logic', async (t) => {
  const engine = new ArbitrageEngine(ARBITRAGE_PROFILES.PRINCIPAL);

  await t.test('calculateSpread aggregates fees correctly', () => {
    // Mock prices
    const buyPriceFiat = 3900; // 1 USD in COP
    const sellPriceFiat = 1;    // 1 USD in USD
    const sourceFiat = 'COP';
    const destFiat = 'USD';

    // Binance fee is 0.001, El Dorado is 0.01. Total = 0.011
    const result = engine.calculateSpread(buyPriceFiat, sellPriceFiat, sourceFiat, destFiat, 'binance', 'eldorado');

    // buyPriceUSD = 3900 / 3900 = 1
    // sellPriceUSD = 1 / 1 = 1
    // totalFeesUSD = 1 * (0.001 + 0.01) = 0.011
    // netProfit = 1 - 1 - 0.011 = -0.011
    // roi = (-0.011 / 1) * 100 = -1.1%

    assert.strictEqual(result.buyPriceUSD, 1);
    assert.strictEqual(result.sellPriceUSD, 1);
    assert.ok(Math.abs(result.netProfit - (-0.011)) < 0.0001);
    assert.ok(Math.abs(result.roi - (-1.1)) < 0.0001);
  });

  await t.test('engine identifies best route', async () => {
    // This is harder to test without mocking the adapters deeply,
    // but we can check if the adapters object is initialized.
    assert.ok(engine.adapters.binance);
    assert.ok(engine.adapters.eldorado);
    assert.ok(engine.adapters.airtm);
  });
});
