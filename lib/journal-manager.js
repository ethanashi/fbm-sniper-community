import { getDb } from './database.js';

/**
 * JournalManager - Manages the PnL (Profit and Loss) Trade Journal (Phase 9).
 * Isolated from the main ArbitrageEngine.
 */
export class JournalManager {
  constructor() {
    this.db = null;
  }

  async init() {
    this.db = await getDb();
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS trade_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT,
        source_exchange TEXT,
        destination_exchange TEXT,
        fiat_origin TEXT,
        fiat_destination TEXT,
        buy_price_usd REAL,
        sell_price_usd REAL,
        net_profit REAL,
        roi REAL,
        volume REAL,
        timestamp TEXT,
        status TEXT DEFAULT 'COMPLETED'
      );
    `);
    console.log('[journal] SQLite Journal Table initialized.');
  }

  /**
   * Record a trade in the journal.
   */
  async recordTrade(tradeData) {
    if (!this.db) await this.init();

    const {
      profile_id, source_exchange, destination_exchange,
      fiat_origin, fiat_destination, buyPriceUSD, sellPriceUSD,
      netProfit, roi, volume, timestamp
    } = tradeData;

    try {
      await this.db.run(`
        INSERT INTO trade_journal (
          profile_id, source_exchange, destination_exchange,
          fiat_origin, fiat_destination, buy_price_usd, sell_price_usd,
          net_profit, roi, volume, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        profile_id, source_exchange, destination_exchange,
        fiat_origin, fiat_destination, buyPriceUSD, sellPriceUSD,
        netProfit, roi, volume, timestamp || new Date().toISOString()
      ]);
      return { ok: true };
    } catch (err) {
      console.error(`[journal] Error recording trade: ${err.message}`);
      return { error: err.message };
    }
  }

  /**
   * Get all journal entries.
   */
  async getJournal() {
    if (!this.db) await this.init();
    return await this.db.all('SELECT * FROM trade_journal ORDER BY id DESC');
  }
}

export const journalManager = new JournalManager();
