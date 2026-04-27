import { ArbitrageEngine } from './engine.js';
import { ARBITRAGE_PROFILES } from './config.js';
import chalk from 'chalk';
import EventEmitter from 'events';

/**
 * Multi-Worker Entry Point for Crypto Arbitrage (Phase 8/10).
 * Instantiates independent engines for each configured profile.
 */

async function main() {
  console.log(chalk.bold.cyan('\n🚀 Initializing Multi-Profile Arbitrage System...\n'));

  const engines = [];
  const eventBus = new EventEmitter();

  // Phase 10: Listen for Emergency Stop from parent process
  process.on('message', (msg) => {
    if (msg === 'HALT') {
      console.log(chalk.bgRed.white('\n EMERGENCY HALT RECEIVED \n'));
      eventBus.emit('HALT');
    }
  });

  // Launch a worker for each profile defined in config.js
  for (const [key, profile] of Object.entries(ARBITRAGE_PROFILES)) {
    console.log(chalk.blue(`[system] Launching worker: ${profile.label} (${profile.id})`));

    const engine = new ArbitrageEngine(profile, { eventBus });
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
