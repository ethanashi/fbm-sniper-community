import { CryptoSpotEngine } from '../crypto_arbitrage/spot_engine.js';
import { TriangularStrategy } from '../crypto_arbitrage/strategies/triangular.js';
import assert from 'assert';
import test from 'node:test';

test('Triangular Strategy Math', async (t) => {
  const strategy = new TriangularStrategy({ getTakerFee: () => 0.001 });

  await t.test('calculateROI identifies profitable cycle', () => {
    // USDT -> BTC -> ETH -> USDT
    // rates: 1/BTCUSDT, 1/ETHBTC, ETHUSDT
    const rates = [1/40000, 1/0.05, 2100];
    // net = (1/40000) * (1/0.05) * 2100 = 1.05 (5% profit)
    // netROI = (0.05) - (0.001 * 3) = 0.047 (4.7%)
    const roi = strategy.calculateROI(rates, 0.001);
    assert.ok(Math.abs(roi - 4.7) < 0.0001);
  });
});

test('CryptoSpotEngine Mode Routing', async (t) => {
  const engine = new CryptoSpotEngine();

  await t.test('calculateSpread utility exists and is correct', () => {
     const res = engine.calculateSpread(100, 105, 0.001, 0.001);
     assert.strictEqual(res.netSpread, 0.048);
  });
});
