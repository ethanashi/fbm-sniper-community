import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.FBM_DATA_DIR || path.join(__dirname, '..', 'data');

let db = null;

export async function getDb() {
  if (db) return db;

  db = await open({
    filename: path.join(DATA_DIR, 'sniper.sqlite'),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS seen_listings (
      id TEXT PRIMARY KEY,
      platform TEXT,
      timestamp INTEGER
    );

    CREATE TABLE IF NOT EXISTS price_history (
      platform TEXT,
      query TEXT,
      price REAL,
      timestamp INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_price_history_query ON price_history (platform, query);
  `);

  return db;
}

export async function isListingSeen(id) {
  const db = await getDb();
  const row = await db.get('SELECT id FROM seen_listings WHERE id = ?', [id]);
  return !!row;
}

export async function markListingSeen(id, platform) {
  const db = await getDb();
  await db.run(
    'INSERT OR IGNORE INTO seen_listings (id, platform, timestamp) VALUES (?, ?, ?)',
    [id, platform, Date.now()]
  );
}

export async function recordPrice(platform, query, price) {
  const db = await getDb();
  await db.run(
    'INSERT INTO price_history (platform, query, price, timestamp) VALUES (?, ?, ?, ?)',
    [platform, query, price, Date.now()]
  );
}

export async function getPriceStats(platform, query) {
  const db = await getDb();
  // Get prices from the last 7 days
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = await db.all(
    'SELECT price FROM price_history WHERE platform = ? AND query = ? AND timestamp > ?',
    [platform, query, oneWeekAgo]
  );

  if (rows.length < 5) return null; // Need a minimum sample size

  const prices = rows.map(r => r.price);
  const n = prices.length;
  const mean = prices.reduce((a, b) => a + b, 0) / n;
  const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  return { mean, stdDev, count: n };
}
