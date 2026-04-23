import { BinanceBapiAdapter } from './binance_adapter.js';
import { ElDoradoAdapter } from './eldorado_adapter.js';
import { AirtmAdapter } from './airtm_adapter.js';
import { ARBITRAGE_CONFIG } from './config.js';
import { notify } from '../lib/shared-marketplace/notifier.js';
import chalk from 'chalk';
import fs from 'fs';
import { ARBITRAGE_DATA_DIR, ARBITRAGE_FOUND_FILE } from '../lib/paths.js';

/**
 * Arbitrage Engine - Core math and logic for Cross-Platform P2P Arbitrage.
 */
export class ArbitrageEngine {
  constructor() {
    this.config = ARBITRAGE_CONFIG;
    this.adapters = {
      binance: new BinanceBapiAdapter(),
      eldorado: new ElDoradoAdapter(),
      airtm: new AirtmAdapter()
    };
  }

  /**
   * Convert price to USD based on reference rates.
   */
  _convertToUSD(price, fiat) {
    const rate = this.config.REFERENCE_RATES[fiat] || 1;
    return price / rate;
  }

  /**
   * Calculate Net Spread and ROI for a specific route.
   */
  calculateSpread(buyPriceFiat, sellPriceFiat, destFiat, sourceExchange, destExchange) {
    const buyPriceUSD = this._convertToUSD(buyPriceFiat, this.config.FIAT_ORIGIN);
    const sellPriceUSD = this._convertToUSD(sellPriceFiat, destFiat);

    // Fee Aggregation
    const buyFee = this.adapters[sourceExchange].getFee('BUY');
    const sellFee = this.adapters[destExchange].getFee('SELL');
    const totalFeeRate = buyFee + sellFee;

    // Profit = (Sell Price in USD) - (Buy Price in USD) - Total Fees
    const totalFeesUSD = buyPriceUSD * totalFeeRate;
    const netProfit = sellPriceUSD - buyPriceUSD - totalFeesUSD;
    const roi = (netProfit / buyPriceUSD) * 100;

    return { buyPriceUSD, sellPriceUSD, netProfit, roi };
  }

  /**
   * Run one iteration of the arbitrage check.
   */
  async checkOpportunities() {
    try {
      console.log(chalk.blue(`[arbitrage] Scanning combinations from ${this.config.FIAT_ORIGIN}...`));
      const results = [];

      // Phase 7: Combinatorial Logic
      // All possible Source Exchanges
      for (const sourceExchange of this.config.SOURCE_EXCHANGES) {
        const sourceAdapter = this.adapters[sourceExchange];
        if (!sourceAdapter) continue;

        let buyDepth;
        try {
          buyDepth = await sourceAdapter.getBuyDepth(this.config.FIAT_ORIGIN, this.config.CRYPTO_ASSET);
        } catch (err) {
          console.error(chalk.yellow(`  [arbitrage] Skipping ${sourceExchange} (BUY): ${err.message}`));
          continue;
        }

        // All possible Destination Exchanges
        for (const destExchange of this.config.DESTINATION_EXCHANGES) {
          const destAdapter = this.adapters[destExchange];
          if (!destAdapter) continue;

          // All possible Destination Fiats
          await Promise.all(this.config.FIAT_DESTINOS.map(async (destFiat) => {
            try {
              // Add jitter to avoid rate limits
              await new Promise(r => setTimeout(r, Math.random() * 1500));

              const sellDepth = await destAdapter.getSellDepth(destFiat, this.config.CRYPTO_ASSET);
              const { buyPriceUSD, sellPriceUSD, netProfit, roi } = this.calculateSpread(
                buyDepth.price,
                sellDepth.price,
                destFiat,
                sourceExchange,
                destExchange
              );

              const tradableVolume = Math.min(buyDepth.volume, sellDepth.volume);
              const estimatedMaxProfit = netProfit * tradableVolume;

              results.push({
                fiat: destFiat,
                source_exchange: sourceExchange,
                destination_exchange: destExchange,
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

              console.log(chalk.gray(`  [${sourceExchange} -> ${destExchange}] ${this.config.FIAT_ORIGIN} -> ${destFiat} | ROI: ${roi.toFixed(2)}%`));
            } catch (err) {
              // Silently ignore individual path failures to keep logs clean
            }
          }));
        }
      }

      if (results.length === 0) return;

      // Sort by ROI descending
      results.sort((a, b) => b.roi - a.roi);
      const best = results[0];

      if (best.roi >= this.config.MIN_ROI_PCT) {
        const msg = `🚀 CROSS-PLATFORM OPPORTUNITY!\n` +
                    `Best ROI: ${best.roi.toFixed(2)}% (${best.source_exchange} -> ${best.destination_exchange})\n` +
                    `Path: ${this.config.FIAT_ORIGIN} -> ${best.fiat}\n` +
                    `Spread: $${best.netProfit.toFixed(3)} / USDT\n` +
                    `Tradable Volume: ${best.volume} USDT`;

        console.log(chalk.green(msg));

        const record = {
          title: `Arbitrage: ${best.source_exchange} → ${best.destination_exchange}`,
          platform: "arbitrage",
          grade: "A",
          score: Math.round(best.roi * 10),
          reasons: [
            `Spread: $${best.netProfit.toFixed(3)} USD`,
            `ROI: ${best.roi.toFixed(2)}%`,
            `Path: ${this.config.FIAT_ORIGIN} (${best.source_exchange}) -> ${best.fiat} (${best.destination_exchange})`,
            `Volume: ${best.volume} USDT`
          ],
          listing_price: best.buyPrice,
          volume: best.volume,
          max_profit: best.maxProfit,
          source_exchange: best.source_exchange,
          destination_exchange: best.destination_exchange,
          url: "https://p2p.binance.com/",
          timestamp: best.timestamp,
          all_results: results.slice(0, 20) // Pass top results for UI
        };

        // Persist for UI
        try {
          if (!fs.existsSync(ARBITRAGE_DATA_DIR)) fs.mkdirSync(ARBITRAGE_DATA_DIR, { recursive: true });
          fs.appendFileSync(ARBITRAGE_FOUND_FILE, JSON.stringify(record) + "\n", "utf8");
        } catch (err) {
          console.error(chalk.red(`[arbitrage] Failed to persist: ${err.message}`));
        }

        // Notify best opportunity
        await notify(record);
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
