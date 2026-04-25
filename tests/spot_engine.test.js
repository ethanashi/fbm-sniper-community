import { SpotArbitrageEngine } from '../crypto_arbitrage/spot_engine.js';
import assert from 'assert';
import test from 'node:test';

test('SpotArbitrageEngine Math Logic', async (t) => {
  const engine = new SpotArbitrageEngine();

  await t.test('calculate identifies profitable spread', () => {
    // Buy at 100, Sell at 105. Fees 0.1% each (total 0.2%).
    // Gross spread = (105-100)/100 = 0.05 (5%)
    // Net spread = 0.05 - 0.002 = 0.048 (4.8%)
    const result = engine.calculate(100, 105, 0.001, 0.001);

    assert.strictEqual(result.grossSpread, 0.05);
    assert.strictEqual(result.netSpread, 0.048);
  });

  await t.test('calculate identifies loss/break-even', () => {
    // Buy at 100, Sell at 100.1. Fees total 0.2%.
    // Gross = 0.1%
    // Net = 0.1% - 0.2% = -0.1%
    const result = engine.calculate(100, 100.1, 0.001, 0.001);
    assert.ok(result.netSpread < 0);
  });
});
