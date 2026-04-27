import test from 'node:test';
import assert from 'node:assert/strict';
import { isListingSeen, markListingSeen, recordPrice, getPriceStats, getDb } from '../lib/database.js';
import fs from 'fs';
import path from 'path';

test('Database operations', async (t) => {
  const dbFile = path.join(process.env.FBM_DATA_DIR || './data', 'sniper.sqlite');
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

  await t.test('markListingSeen and isListingSeen', async () => {
    const id = 'test-id-' + Date.now();
    assert.strictEqual(await isListingSeen(id), false);
    await markListingSeen(id, 'facebook');
    assert.strictEqual(await isListingSeen(id), true);
  });

  await t.test('recordPrice and getPriceStats', async () => {
    const platform = 'test-platform';
    const query = 'test-query';

    // Record some prices: 100, 110, 90, 105, 95 (Mean: 100)
    await recordPrice(platform, query, 100);
    await recordPrice(platform, query, 110);
    await recordPrice(platform, query, 90);
    await recordPrice(platform, query, 105);
    await recordPrice(platform, query, 95);

    const stats = await getPriceStats(platform, query);
    assert.ok(stats);
    assert.strictEqual(stats.mean, 100);
    assert.strictEqual(stats.count, 5);
    assert.ok(stats.stdDev > 0);
  });
});
