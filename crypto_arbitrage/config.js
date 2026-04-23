/**
 * Configuration for the Crypto Arbitrage subsystem.
 */
export const ARBITRAGE_CONFIG = {
  FIAT_ORIGIN: process.env.FIAT_ORIGIN || 'COP',
  FIAT_DESTINO: process.env.FIAT_DESTINO || 'ARS',
  CRYPTO_ASSET: 'USDT',

  // Trigger condition: Net ROI threshold in percentage
  MIN_ROI_PCT: 2.0,

  // P2P Commissions (e.g., 0.1% = 0.001)
  COMMISSION_FEE: 0.001,

  // Reference exchange rate to USD for cross-currency calculations
  // In a production system, these should be fetched via API.
  REFERENCE_RATES: {
    'COP': 3900,
    'ARS': 850,
    'USD': 1
  },

  POLL_INTERVAL_MS: 60 * 1000,
};
