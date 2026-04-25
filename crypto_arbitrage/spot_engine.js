import { BinanceSpotAdapter } from './spot_adapters/binance.js';
import { KrakenSpotAdapter } from './spot_adapters/kraken.js';

/**
 * Engine for Spot Arbitrage (Phase 11).
 * Calculates spreads between spot exchanges.
 */
export class SpotArbitrageEngine {
  constructor() {
    this.adapters = {
      binance: new BinanceSpotAdapter(),
      kraken: new KrakenSpotAdapter()
    };
    this.estimated_network_fee_usdt = 1.0; // Placeholder for future withdrawal logic
  }

  /**
   * Evaluate arbitrage opportunity for a specific symbol between two exchanges.
   */
  async evaluatePair(symbol, exchA_id, exchB_id) {
    const adapterA = this.adapters[exchA_id];
    const adapterB = this.adapters[exchB_id];

    try {
      const bookA = await adapterA.getOrderBook(symbol);
      const bookB = await adapterB.getOrderBook(symbol);

      // Scenario 1: Buy on A, Sell on B
      const res1 = this.calculate(bookA.ask, bookB.bid, adapterA.getTakerFee(), adapterB.getTakerFee());

      // Scenario 2: Buy on B, Sell on A
      const res2 = this.calculate(bookB.ask, bookA.bid, adapterB.getTakerFee(), adapterA.getTakerFee());

      const results = [];

      if (res1.netSpread > 0.001) { // Only report if > 0.1%
        results.push({
          symbol,
          buyExchange: adapterA.exchangeName,
          sellExchange: adapterB.exchangeName,
          buyPrice: bookA.ask,
          sellPrice: bookB.bid,
          volume: Math.min(bookA.volume, bookB.volume),
          grossSpread: res1.grossSpread * 100,
          netSpread: res1.netSpread * 100,
          fees: (res1.grossSpread - res1.netSpread) * 100,
          buyUrl: adapterA.getTradeUrl(symbol),
          sellUrl: adapterB.getTradeUrl(symbol)
        });
      }

      if (res2.netSpread > 0.001) {
        results.push({
          symbol,
          buyExchange: adapterB.exchangeName,
          sellExchange: adapterA.exchangeName,
          buyPrice: bookB.ask,
          sellPrice: bookA.bid,
          volume: Math.min(bookB.volume, bookA.volume),
          grossSpread: res2.grossSpread * 100,
          netSpread: res2.netSpread * 100,
          fees: (res2.grossSpread - res2.netSpread) * 100,
          buyUrl: adapterB.getTradeUrl(symbol),
          sellUrl: adapterA.getTradeUrl(symbol)
        });
      }

      return results;
    } catch (err) {
      // console.error(`[spot_engine] Error evaluating ${symbol}:`, err.message);
      return [];
    }
  }

  calculate(buyPrice, sellPrice, feeA, feeB) {
    const grossSpread = (sellPrice - buyPrice) / buyPrice;
    const totalFees = feeA + feeB;
    const netSpread = grossSpread - totalFees;
    return { grossSpread, netSpread };
  }
}
