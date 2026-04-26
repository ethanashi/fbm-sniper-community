import { BinanceSpotAdapter } from './spot_adapters/binance.js';
import { BybitPublicAdapter } from './spot_adapters/bybit.js';

/**
 * Agnostic Crypto Spot Engine (Phase 11).
 * Optimized for real-time radar data and charting.
 */
export class CryptoSpotEngine {
  constructor() {
    this.adapters = {
      binance: new BinanceSpotAdapter(),
      bybit: new BybitPublicAdapter()
    };
  }

  /**
   * Fetch latest prices and calculate spreads for a given symbol.
   */
  async getRadarData(symbol) {
    try {
      const bookA = await this.adapters.binance.getOrderBook(symbol);
      const bookB = await this.adapters.bybit.getOrderBook(symbol);

      const timestamp = Date.now();

      // Calculation: (Best Bid B - Best Ask A) vs (Best Bid A - Best Ask B)
      const exchA = { name: 'Binance', ask: bookA.ask, bid: bookA.bid, fee: this.adapters.binance.getTakerFee(), url: this.adapters.binance.getTradeUrl(symbol) };
      const exchB = { name: 'Bybit', ask: bookB.ask, bid: bookB.bid, fee: this.adapters.bybit.getTakerFee(), url: this.adapters.bybit.getTradeUrl(symbol) };

      const opportunities = [];

      // Route 1: Buy on A, Sell on B
      const res1 = this.calculateSpread(exchA.ask, exchB.bid, exchA.fee, exchB.fee);
      if (res1.netSpread > 0.001) {
        opportunities.push({
          symbol,
          buyExchange: exchA.name,
          sellExchange: exchB.name,
          buyPrice: exchA.ask,
          sellPrice: exchB.bid,
          volume: Math.min(bookA.volume, bookB.volume),
          netSpread: res1.netSpread * 100,
          buyUrl: exchA.url,
          sellUrl: exchB.url
        });
      }

      // Route 2: Buy on B, Sell on A
      const res2 = this.calculateSpread(exchB.ask, exchA.bid, exchB.fee, exchA.fee);
      if (res2.netSpread > 0.001) {
        opportunities.push({
          symbol,
          buyExchange: exchB.name,
          sellExchange: exchA.name,
          buyPrice: exchB.ask,
          sellPrice: exchA.bid,
          volume: Math.min(bookA.volume, bookB.volume),
          netSpread: res2.netSpread * 100,
          buyUrl: exchB.url,
          sellUrl: exchA.url
        });
      }

      return {
        timestamp,
        symbol,
        prices: {
          binance: { bid: bookA.bid, ask: bookA.ask },
          bybit: { bid: bookB.bid, ask: bookB.ask }
        },
        opportunities
      };
    } catch (err) {
      // console.error(`[spot_engine] Radar error for ${symbol}:`, err.message);
      return null;
    }
  }

  calculateSpread(buyPrice, sellPrice, feeA, feeB) {
    const grossSpread = (sellPrice - buyPrice) / buyPrice;
    const netSpread = grossSpread - (feeA + feeB);
    return { netSpread };
  }
}
