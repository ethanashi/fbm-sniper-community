import { SpotArbitrageEngine } from './spot_engine.js';
import chalk from 'chalk';

/**
 * Main loop for Spot Arbitrage (Phase 11).
 * Runs in a separate process.
 */
async function main() {
  console.log(chalk.bold.magenta('\n💹 Initializing Spot Arbitrage Scanner...\n'));

  const engine = new SpotArbitrageEngine();
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];

  let isHalted = false;

  process.on('message', (msg) => {
    if (msg === 'HALT') {
      isHalted = true;
      console.log(chalk.red('[spot] Halt signal received. Stopping...'));
    }
  });

  while (!isHalted) {
    // console.log(chalk.gray(`[spot] Scanning ${symbols.length} symbols...`));
    const allOpportunities = [];

    for (const symbol of symbols) {
      if (isHalted) break;
      const opportunities = await engine.evaluatePair(symbol, 'binance', 'kraken');
      if (opportunities.length > 0) {
        allOpportunities.push(...opportunities);
      }
      // Small jitter between symbols to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    if (allOpportunities.length > 0) {
      // Send to parent process (server.cjs)
      if (process.send) {
        process.send({ type: 'CRYPTO_OPPORTUNITIES', data: allOpportunities });
      }
    }

    // Wait 2 seconds before next scan
    await new Promise(r => setTimeout(r, 2000));
  }

  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`[spot] Fatal Error: ${err.message}`));
  process.exit(1);
});
