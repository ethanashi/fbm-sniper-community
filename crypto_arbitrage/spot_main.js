import { CryptoSpotEngine } from './spot_engine.js';
import chalk from 'chalk';

/**
 * Main loop for Global Spot Radar (Phase 11).
 * Streams real-time price gaps and opportunities.
 */
async function main() {
  console.log(chalk.bold.magenta('\n📡 Initializing Global Spot Radar Feed...\n'));

  const engine = new CryptoSpotEngine();
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

  let isHalted = false;

  process.on('message', (msg) => {
    if (msg === 'HALT') {
      isHalted = true;
      console.log(chalk.red('[radar] Halt signal received.'));
    }
  });

  while (!isHalted) {
    for (const symbol of symbols) {
      if (isHalted) break;

      const radarData = await engine.getRadarData(symbol);

      if (radarData && process.send) {
        process.send({
          type: 'SPOT_RADAR_UPDATE',
          data: radarData
        });
      }

      // High frequency updates: 500ms between symbols
      await new Promise(r => setTimeout(r, 500));
    }

    // Refresh cycle every 1.5 seconds
    await new Promise(r => setTimeout(r, 1000));
  }

  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`[radar] Fatal Error: ${err.message}`));
  process.exit(1);
});
