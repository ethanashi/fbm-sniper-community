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
   * Calculate Net Spread and ROI.
   */
  calculateSpread(buyPriceFiat, sellPriceFiat) {
    const buyPriceUSD = this._convertToUSD(buyPriceFiat, this.config.FIAT_ORIGIN);
    const sellPriceUSD = this._convertToUSD(sellPriceFiat, this.config.FIAT_DESTINO);

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
      console.log(chalk.blue(`[arbitrage] Checking ${this.config.FIAT_ORIGIN} -> ${this.config.FIAT_DESTINO}...`));

      const buyPrice = await this.adapter.getBuyPrice(this.config.FIAT_ORIGIN, this.config.CRYPTO_ASSET);
      const sellPrice = await this.adapter.getSellPrice(this.config.FIAT_DESTINO, this.config.CRYPTO_ASSET);

      const { buyPriceUSD, sellPriceUSD, netProfit, roi } = this.calculateSpread(buyPrice, sellPrice);

      console.log(chalk.gray(`  Buy ${this.config.FIAT_ORIGIN}: ${buyPrice} ($${buyPriceUSD.toFixed(3)})`));
      console.log(chalk.gray(`  Sell ${this.config.FIAT_DESTINO}: ${sellPrice} ($${sellPriceUSD.toFixed(3)})`));
      console.log(chalk.cyan(`  ROI: ${roi.toFixed(2)}% | Profit: $${netProfit.toFixed(3)} per USDT`));

      if (roi >= this.config.MIN_ROI_PCT) {
        const msg = `🚀 P2P ARBITRAGE OPPORTUNITY!\n` +
                    `ROI: ${roi.toFixed(2)}%\n` +
                    `Pair: ${this.config.FIAT_ORIGIN} -> ${this.config.FIAT_DESTINO}\n` +
                    `Spread: $${netProfit.toFixed(3)} / USDT\n` +
                    `Buy ${this.config.FIAT_ORIGIN}: ${buyPrice}\n` +
                    `Sell ${this.config.FIAT_DESTINO}: ${sellPrice}`;

        console.log(chalk.green(msg));

        // Reuse project notification system
        await notify({
          title: "P2P Arbitrage Opportunity",
          platform: "arbitrage",
          grade: "A",
          score: Math.round(roi * 10),
          reasons: [
            `Spread: $${netProfit.toFixed(3)} USD`,
            `ROI: ${roi.toFixed(2)}%`,
            `Path: ${this.config.FIAT_ORIGIN} -> ${this.config.FIAT_DESTINO}`
          ],
          listing_price: buyPrice,
          url: "https://p2p.binance.com/",
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(chalk.red(`[arbitrage] Error: ${err.message}`));
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
