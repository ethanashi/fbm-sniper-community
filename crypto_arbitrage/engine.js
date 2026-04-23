import { BinanceBapiAdapter } from './binance_adapter.js';
import { ARBITRAGE_CONFIG } from './config.js';
import { notify } from '../lib/shared-marketplace/notifier.js';
import chalk from 'chalk';

/**
 * Arbitrage Engine - Core math and logic for P2P Arbitrage.
 */
export class ArbitrageEngine {
  constructor() {
    this.adapter = new BinanceBapiAdapter();
    this.config = ARBITRAGE_CONFIG;
  }

  /**
   * Convert price to USD based on reference rates.
   */
  _convertToUSD(price, fiat) {
    const rate = this.config.REFERENCE_RATES[fiat] || 1;
    return price / rate;
  }

  /**
   * Calculate Net Spread and ROI for a specific destination.
   */
  calculateSpread(buyPriceFiat, sellPriceFiat, destFiat) {
    const buyPriceUSD = this._convertToUSD(buyPriceFiat, this.config.FIAT_ORIGIN);
    const sellPriceUSD = this._convertToUSD(sellPriceFiat, destFiat);

    // Profit = (Sell Price in USD) - (Buy Price in USD) - Commissions
    const commission = buyPriceUSD * this.config.COMMISSION_FEE;
    const netProfit = sellPriceUSD - buyPriceUSD - commission;
    const roi = (netProfit / buyPriceUSD) * 100;

    return { buyPriceUSD, sellPriceUSD, netProfit, roi };
  }

  /**
   * Run one iteration of the arbitrage check.
   */
  async checkOpportunities() {
    try {
      console.log(chalk.blue(`[arbitrage] Scanning regions from ${this.config.FIAT_ORIGIN}...`));

      const buyDepth = await this.adapter.getBuyDepth(this.config.FIAT_ORIGIN, this.config.CRYPTO_ASSET);
      const results = [];

      // Concurrently query all destinations
      await Promise.all(this.config.FIAT_DESTINOS.map(async (destFiat) => {
        try {
          // Add jitter to avoid rate limits
          await new Promise(r => setTimeout(r, Math.random() * 2000));

          const sellDepth = await this.adapter.getSellDepth(destFiat, this.config.CRYPTO_ASSET);
          const { buyPriceUSD, sellPriceUSD, netProfit, roi } = this.calculateSpread(buyDepth.price, sellDepth.price, destFiat);

          const tradableVolume = Math.min(buyDepth.volume, sellDepth.volume);
          const estimatedMaxProfit = netProfit * tradableVolume;

          results.push({
            fiat: destFiat,
            buyPrice: buyDepth.price,
            sellPrice: sellDepth.price,
            buyPriceUSD,
            sellPriceUSD,
            netProfit,
            roi,
            volume: tradableVolume,
            maxProfit: estimatedMaxProfit,
            timestamp: new Date().toISOString()
          });

          console.log(chalk.gray(`  ${this.config.FIAT_ORIGIN} -> ${destFiat} | ROI: ${roi.toFixed(2)}% | Vol: ${tradableVolume}`));
        } catch (err) {
          console.error(chalk.red(`  [arbitrage] Error scanning ${destFiat}: ${err.message}`));
        }
      }));

      if (results.length === 0) return;

      // Sort by ROI descending
      results.sort((a, b) => b.roi - a.roi);
      const best = results[0];

      if (best.roi >= this.config.MIN_ROI_PCT) {
        const msg = `🚀 P2P ARBITRAGE OPPORTUNITY!\n` +
                    `Best ROI: ${best.roi.toFixed(2)}% (${best.fiat})\n` +
                    `Pair: ${this.config.FIAT_ORIGIN} -> ${best.fiat}\n` +
                    `Spread: $${best.netProfit.toFixed(3)} / USDT\n` +
                    `Tradable Volume: ${best.volume} USDT`;

        console.log(chalk.green(msg));

        // Notify best opportunity
        await notify({
          title: `P2P Arbitrage: ${best.fiat}`,
          platform: "arbitrage",
          grade: "A",
          score: Math.round(best.roi * 10),
          reasons: [
            `Spread: $${best.netProfit.toFixed(3)} USD`,
            `ROI: ${best.roi.toFixed(2)}%`,
            `Path: ${this.config.FIAT_ORIGIN} -> ${best.fiat}`,
            `Volume: ${best.volume} USDT`
          ],
          listing_price: best.buyPrice,
          volume: best.volume,
          max_profit: best.maxProfit,
          url: "https://p2p.binance.com/",
          timestamp: best.timestamp,
          all_results: results // Pass all results for UI
        });
      }
    } catch (err) {
      console.error(chalk.red(`[arbitrage] Critical Error: ${err.message}`));
    }
  }

  /**
   * Start the polling loop.
   */
  start() {
    console.log(chalk.blueBright('=== Crypto Arbitrage Engine Started ==='));
    this.checkOpportunities();
    this.interval = setInterval(() => this.checkOpportunities(), this.config.POLL_INTERVAL_MS);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    console.log(chalk.yellow('=== Crypto Arbitrage Engine Stopped ==='));
  }
}

// Execution block for running as a standalone process
if (import.meta.url === `file://${process.argv[1]}` || process.argv.includes('--run')) {
  const engine = new ArbitrageEngine();
  engine.start();

  process.on('SIGINT', () => {
    engine.stop();
    process.exit(0);
  });
}
