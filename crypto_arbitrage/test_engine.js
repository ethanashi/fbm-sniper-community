import { ArbitrageEngine } from './engine.js';
import assert from 'node:assert/strict';

function testMath() {
  const engine = new ArbitrageEngine();

  // Set fixed rates for testing
  engine.config.REFERENCE_RATES = {
    'COP': 4000,
    'ARS': 1000,
    'USD': 1
  };
  engine.config.FIAT_ORIGIN = 'COP';
  engine.config.FIAT_DESTINO = 'ARS';
  engine.config.COMMISSION_FEE = 0.001;

  console.log('Testing Spread Calculation...');

  // Case 1: Buy at $1 USD, Sell at $1.1 USD (10% gross spread)
  // Buy Price in COP = 4000
  // Sell Price in ARS = 1100
  const result = engine.calculateSpread(4000, 1100);

  console.log(`ROI: ${result.roi.toFixed(2)}%`);
  console.log(`Profit: ${result.netProfit.toFixed(3)}`);

  // Expected:
  // buyPriceUSD = 1
  // sellPriceUSD = 1.1
  // commission = 0.001 * 1 = 0.001
  // netProfit = 1.1 - 1 - 0.001 = 0.099
  // roi = (0.099 / 1) * 100 = 9.9%

  assert.strictEqual(result.buyPriceUSD, 1);
  assert.strictEqual(result.sellPriceUSD, 1.1);
  assert.ok(Math.abs(result.roi - 9.9) < 0.001);
  assert.ok(Math.abs(result.netProfit - 0.099) < 0.001);

  console.log('SUCCESS: Math engine calculations are correct.');
}

testMath();
