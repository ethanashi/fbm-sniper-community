import { BinanceSpotAdapter } from './spot_adapters/binance.js';
import { BybitPublicAdapter } from './spot_adapters/bybit.js';
import { TriangularStrategy } from './strategies/triangular.js';
import { SpatialStrategy } from './strategies/spatial.js';
import { analyticsLogger } from '../lib/analytics-logger.js';

/**
 * Agnostic Crypto Spot Engine (Phase 12).
 * Refactored into specialized strategies with math utility restoration.
 */
export class CryptoSpotEngine {
  constructor() {
    this.adapters = {
      binance: new BinanceSpotAdapter(),
      bybit: new BybitPublicAdapter()
    };

    this.strategies = {
      triangular: new TriangularStrategy(this.adapters.binance),
      spatial: new SpatialStrategy(this.adapters.binance, this.adapters.bybit)
    };
  }

  /**
   * Utility for standalone spread calculations.
   * Restored for existing tests.
   */
  calculateSpread(buyPrice, sellPrice, feeA, feeB) {
    const grossSpread = (sellPrice - buyPrice) / buyPrice;
    const netSpread = grossSpread - (feeA + feeB);
    return { netSpread };
  }

  /**
   * Main entry point for radar data fetching.
   */
  async getModeData(mode, symbol) {
    if (mode === 'spatial') {
      return this.getSpatialData(symbol);
    }
    if (mode === 'triangular') {
      return this.getTriangularData('USDT', 'BTC', 'ETH');
    }
    return null;
  }

  async getSpatialData(symbol) {
    try {
      const bookA = await this.adapters.binance.getOrderBook(symbol);
      const bookB = await this.adapters.bybit.getOrderBook(symbol);

      const res = this.strategies.spatial.calculateSpread(
        bookA.ask,
        bookB.bid,
        this.adapters.binance.getTakerFee(),
        this.adapters.bybit.getTakerFee()
      );

      const opportunities = [];
      if (res.netSpread > 0.001) {
        const opp = {
          symbol,
          buyExchange: 'Binance',
          sellExchange: 'Bybit',
          buyPrice: bookA.ask,
          sellPrice: bookB.bid,
          netSpread: res.netSpread * 100,
          volume: Math.min(bookA.volume, bookB.volume),
          buyUrl: this.adapters.binance.getTradeUrl(symbol),
          sellUrl: this.adapters.bybit.getTradeUrl(symbol)
        };
        opportunities.push(opp);

        // Phase 14 Logging
        analyticsLogger.logOpportunity({
          mode: 'spatial',
          target_pair: symbol,
          source_exchange: 'Binance',
          destination_exchange: 'Bybit',
          spread: opp.netSpread,
          volume: opp.volume
        });
      }

      return {
        timestamp: Date.now(),
        symbol,
        prices: {
          binance: { ask: bookA.ask },
          bybit: { bid: bookB.bid }
        },
        opportunities
      };
    } catch (err) {
      return null;
    }
  }

  async getTriangularData(base, a, b) {
    try {
      const opportunities = await this.strategies.triangular.findOpportunities(base, a, b);

      // Phase 14 Logging
      if (opportunities && opportunities.length > 0) {
        opportunities.forEach(opp => {
          analyticsLogger.logOpportunity({
            mode: 'triangular',
            base_pair: base,
            target_pair: `${a}/${b}`,
            source_exchange: opp.exchange,
            spread: opp.netROI,
            volume: opp.step1 // Use first step as volume proxy
          });
        });
      }

      return {
        timestamp: Date.now(),
        symbol: `${a}/${b}`,
        opportunities
      };
    } catch (err) {
      return null;
    }
  }
}
