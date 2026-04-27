import { CryptoSpotEngine } from './spot_engine.js';
import chalk from 'chalk';

/**
 * Main loop for Global Spot Radar (Phase 12).
 * Streams real-time price gaps and opportunities based on subscribed mode.
 */
async function main() {
  console.log(chalk.bold.magenta('\n📡 Initializing Global Spot Radar Feed...\n'));

  const engine = new CryptoSpotEngine();
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

  let currentMode = null;
  let isHalted = false;

  process.on('message', (msg) => {
    if (msg === 'HALT') {
      isHalted = true;
      console.log(chalk.red('[radar] Halt signal received.'));
    }
    if (msg.command === 'SET_MODE') {
      currentMode = msg.mode;
      if (msg.provider) {
        engine.setProvider(msg.provider);
      }
      console.log(chalk.blue(`[radar] Switched to mode: ${currentMode}`));
    }
  });

  while (!isHalted) {
    if (!currentMode) {
      // Sleep if no mode is selected
      await new Promise(r => setTimeout(r, 1000));
      continue;
    }

    for (const symbol of symbols) {
      if (isHalted) break;

      const radarData = await engine.getModeData(currentMode, symbol);

      if (radarData && process.send) {
        process.send({
          type: 'SPOT_RADAR_UPDATE',
          mode: currentMode,
          data: radarData
        });
      }

      // Dynamic frequency based on mode
      const delay = currentMode === 'triangular' ? 300 : 800;
      await new Promise(r => setTimeout(r, delay));
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  process.exit(0);
}

main().catch(err => {
  console.error(chalk.red(`[radar] Fatal Error: ${err.message}`));
  process.exit(1);
});
