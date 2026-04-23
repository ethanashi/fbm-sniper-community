import { ArbitrageEngine } from './engine.js';
import { ARBITRAGE_PROFILES } from './config.js';
import chalk from 'chalk';

/**
 * Multi-Worker Entry Point for Crypto Arbitrage (Phase 8).
 * Instantiates independent engines for each configured profile.
 */

async function main() {
  console.log(chalk.bold.cyan('\n🚀 Initializing Multi-Profile Arbitrage System...\n'));

  const engines = [];

  // Launch a worker for each profile defined in config.js
  for (const [key, profile] of Object.entries(ARBITRAGE_PROFILES)) {
    console.log(chalk.blue(`[system] Launching worker: ${profile.label} (${profile.id})`));

    const engine = new ArbitrageEngine(profile);
    engine.start();
    engines.push(engine);
  }

  console.log(chalk.green(`\n✅ ${engines.length} workers are now running concurrently.\n`));

  // Handle graceful shutdown
  const shutdown = () => {
    console.log(chalk.yellow('\n[system] Shutting down all workers...'));
    engines.forEach(e => e.stop());
    setTimeout(() => process.exit(0), 1000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error(chalk.red(`[system] Fatal Error: ${err.message}`));
  process.exit(1);
});
