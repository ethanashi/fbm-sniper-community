import { getDb } from './database.js';

/**
 * AnalyticsLogger - Phase 14
 * Handles non-blocking asynchronous logging of profitable arbitrage opportunities.
 */
class AnalyticsLogger {
  /**
   * Logs a profitable opportunity to the SQLite database.
   * @param {Object} data - Opportunity data
   */
  async logOpportunity(data) {
    // Return early if basic fields are missing
    if (!data.mode || !data.spread) return;

    try {
      const db = await getDb();

      // Execute INSERT asynchronously without awaiting the result in the main loop
      db.run(`
        INSERT INTO arbitrage_logs (
          timestamp, mode, base_pair, target_pair,
          source_exchange, destination_exchange,
          spread, net_profit, volume
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        data.timestamp || Date.now(),
        data.mode,
        data.base_pair || '',
        data.target_pair || '',
        data.source_exchange || '',
        data.destination_exchange || '',
        data.spread,
        data.net_profit || 0,
        data.volume || 0
      ]).catch(err => {
        console.error('[AnalyticsLogger] Error writing to database:', err.message);
      });

    } catch (err) {
      console.error('[AnalyticsLogger] Failed to initialize database for logging:', err.message);
    }
  }

  /**
   * Retrieves aggregated heatmap data.
   * Format: Array of { hour: 0-23, day: 0-6, count: X }
   */
  async getHeatmapData() {
    try {
      const db = await getDb();
      // SQLite strftime('%w', timestamp/1000, 'unixepoch') returns day of week (0=Sunday)
      // strftime('%H', timestamp/1000, 'unixepoch') returns hour (00-23)
      return await db.all(`
        SELECT
          CAST(strftime('%H', timestamp / 1000, 'unixepoch') AS INTEGER) as hour,
          CAST(strftime('%w', timestamp / 1000, 'unixepoch') AS INTEGER) as day,
          COUNT(*) as count
        FROM arbitrage_logs
        GROUP BY hour, day
        ORDER BY day, hour
      `);
    } catch (err) {
      console.error('[AnalyticsLogger] Error fetching heatmap data:', err.message);
      return [];
    }
  }

  /**
   * Retrieves summary statistics for the analytics dashboard.
   */
  async getStats() {
    try {
      const db = await getDb();
      return await db.all(`
        SELECT
          target_pair as pair,
          AVG(spread) as avg_spread,
          COUNT(*) as total_opps,
          (
            SELECT strftime('%H', timestamp / 1000, 'unixepoch')
            FROM arbitrage_logs l2
            WHERE l2.target_pair = l1.target_pair
            GROUP BY strftime('%H', timestamp / 1000, 'unixepoch')
            ORDER BY COUNT(*) DESC
            LIMIT 1
          ) as peak_hour
        FROM arbitrage_logs l1
        GROUP BY target_pair
        ORDER BY total_opps DESC
        LIMIT 10
      `);
    } catch (err) {
      console.error('[AnalyticsLogger] Error fetching stats:', err.message);
      return [];
    }
  }
}

export const analyticsLogger = new AnalyticsLogger();
