import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRegexFilter, calculateProfitability, evaluateTriggers } from '../lib/shared-marketplace/logic.js';

test('Filtering and Profitability Logic', async (t) => {
  await t.test('matchesRegexFilter', () => {
    const globalFilters = {
      globalMustAvoid: ['broken', 'clone'],
      globalPriorityKeywords: ['urgent']
    };
    const target = { mustAvoid: ['replica'], priorityKeywords: ['travel'] };

    // Should reject blacklisted
    assert.strictEqual(matchesRegexFilter('This is a broken phone', 'iPhone', target, globalFilters).rejected, true);
    assert.strictEqual(matchesRegexFilter('Great phone', 'iPhone replica', target, globalFilters).rejected, true);

    // Should flag priority
    assert.strictEqual(matchesRegexFilter('I need to sell for travel', 'iPhone', target, globalFilters).isPriority, true);
    assert.strictEqual(matchesRegexFilter('Very urgent', 'iPhone', target, globalFilters).isPriority, true);

    // Should pass clean
    const clean = matchesRegexFilter('Like new condition', 'iPhone 15', target, globalFilters);
    assert.strictEqual(clean.rejected, false);
    assert.strictEqual(clean.isPriority, false);
  });

  await t.test('calculateProfitability', () => {
    const { netProfit, roi } = calculateProfitability(100, 150, 10);
    assert.strictEqual(netProfit, 40); // 150 - 100 - 10
    assert.strictEqual(roi, 40); // (40 / 100) * 100
  });

  await t.test('evaluateTriggers', () => {
    const filters = { minProfit: 50, minROI: 30, zScoreEnabled: false };

    // Profit trigger
    assert.strictEqual(evaluateTriggers({ netProfit: 60, roi: 10 }, filters).triggered, true);

    // ROI trigger
    assert.strictEqual(evaluateTriggers({ netProfit: 10, roi: 35 }, filters).triggered, true);

    // No trigger
    assert.strictEqual(evaluateTriggers({ netProfit: 10, roi: 10 }, filters).triggered, false);
  });
});
