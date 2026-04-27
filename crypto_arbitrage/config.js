/**
 * Configuration for the Crypto Arbitrage subsystem.
 * Supports multiple execution profiles (Phase 8).
 */

export const GLOBAL_ARBITRAGE_CONFIG = {
  CRYPTO_ASSET: 'USDT',
  REFERENCE_RATES: {
    'COP': 3900,
    'ARS': 1200,
    'VES': 36.5,
    'MXN': 17.5,
    'BRL': 5.2,
    'USD': 1
  },
  POLL_INTERVAL_MS: 60 * 1000,
  SOURCE_EXCHANGES: ['binance', 'eldorado'],
  DESTINATION_EXCHANGES: ['binance', 'airtm', 'eldorado']
};

export const ARBITRAGE_PROFILES = {
  PRINCIPAL: {
    id: 'PRINCIPAL',
    label: 'Arbitrage (Principal)',
    origins: ['COP'],
    destinations: ['ARS', 'VES', 'MXN', 'BRL'],
    minRoi: 2.0
  },
  ANOMALIA: {
    id: 'ANOMALIA',
    label: 'Radar Inverso',
    origins: ['ARS', 'VES'],
    destinations: ['COP'],
    minRoi: 1.5
  }
};
