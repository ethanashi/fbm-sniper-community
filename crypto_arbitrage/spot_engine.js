import { BinanceSpotAdapter } from './spot_adapters/binance.js';
import { BybitPublicAdapter } from './spot_adapters/bybit.js';
import { KrakenSpotAdapter } from './spot_adapters/kraken.js';
import { CoinbaseSpotAdapter } from './spot_adapters/coinbase.js';
import { TriangularStrategy } from './strategies/triangular.js';
import { SpatialStrategy } from './strategies/spatial.js';
import { analyticsLogger } from '../lib/analytics-logger.js';

/**
 * Agnostic Crypto Spot Engine (Phase 12).
 * Refactored into specialized strategies with math utility restoration.
 * Now supports dynamic feed providers (Phase 15).
 */
export class CryptoSpotEngine {
  constructor() {
    this.adapters = {
      binance: new BinanceSpotAdapter(),
      bybit: new BybitPublicAdapter(),
      kraken: new KrakenSpotAdapter(),
      coinbase: new CoinbaseSpotAdapter()
    };

    // Default providers
    this.providerA = this.adapters.binance;
    this.providerB = this.adapters.bybit;

    this.strategies = {
      triangular: new TriangularStrategy(this.providerA),
      spatial: new SpatialStrategy(this.providerA, this.providerB)
    };
  }

  /**
   * Update the active feed provider.
   */
  setProvider(providerName) {
    if (providerName === 'kraken-coinbase') {
      this.providerA = this.adapters.kraken;
      this.providerB = this.adapters.coinbase;
    } else {
      // Default to binance-bybit
      this.providerA = this.adapters.binance;
      this.providerB = this.adapters.bybit;
    }

    this.strategies.triangular.adapter = this.providerA;
    this.strategies.spatial.adapterA = this.providerA;
    this.strategies.spatial.adapterB = this.providerB;

    console.log(`[radar] Switched to provider: ${providerName}`);
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
      const bookA = await this.providerA.getOrderBook(symbol);
      const bookB = await this.providerB.getOrderBook(symbol);

      const res = this.strategies.spatial.calculateSpread(
        bookA.ask,
        bookB.bid,
        this.providerA.getTakerFee(),
        this.providerB.getTakerFee()
      );

      const opportunities = [];
      // Adjust threshold slightly
      if (res.netSpread > -0.01) {
        const opp = {
          symbol,
          buyExchange: this.providerA.exchangeName,
          sellExchange: this.providerB.exchangeName,
          buyPrice: bookA.ask,
          sellPrice: bookB.bid,
          netSpread: res.netSpread * 100,
          volume: Math.min(bookA.volume, bookB.volume),
          buyUrl: this.providerA.getTradeUrl(symbol),
          sellUrl: this.providerB.getTradeUrl(symbol)
        };
        opportunities.push(opp);

        // Phase 14 Logging (Only if actually profitable)
        if (opp.netSpread > 0) {
          analyticsLogger.logOpportunity({
            mode: 'spatial',
            target_pair: symbol,
            source_exchange: this.providerA.exchangeName,
            destination_exchange: this.providerB.exchangeName,
            spread: opp.netSpread,
            volume: opp.volume
          });
        }
      }

      const prices = {};
      prices[this.providerA.exchangeName.toLowerCase()] = { ask: bookA.ask };
      prices[this.providerB.exchangeName.toLowerCase()] = { bid: bookB.bid };

      return {
        timestamp: Date.now(),
        symbol,
        prices,
        opportunities
      };
    } catch (err) {
      console.error(`[radar] Spatial error for ${symbol}:`, err.message);
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
