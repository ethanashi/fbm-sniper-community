/**
 * Configuration for the Crypto Arbitrage subsystem.
 */
export const ARBITRAGE_CONFIG = {
  FIAT_ORIGIN: process.env.FIAT_ORIGIN || 'COP',
  FIAT_DESTINOS: (process.env.FIAT_DESTINOS || 'ARS,VES,MXN,BRL').split(','),
  CRYPTO_ASSET: 'USDT',

  // Trigger condition: Net ROI threshold in percentage
  MIN_ROI_PCT: 2.0,

  // Reference exchange rate to USD for cross-currency calculations
  REFERENCE_RATES: {
    'COP': 3900,
    'ARS': 1200,
    'VES': 36.5,
    'MXN': 17.5,
    'BRL': 5.2,
    'USD': 1
  },

  POLL_INTERVAL_MS: 60 * 1000,

  // Phase 7: Cross-Platform Support
  SOURCE_EXCHANGES: ['binance', 'eldorado'],
  DESTINATION_EXCHANGES: ['binance', 'airtm', 'eldorado']
};
