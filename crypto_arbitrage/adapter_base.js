/**
 * Base class for all exchange adapters.
 * Implements the Adapter pattern to decouple the arbitrage engine from specific exchange APIs.
 */
export class ExchangeAdapterBase {
  /**
   * Get the best price to BUY an asset with a specific fiat currency.
   * @param {string} fiat - The fiat currency (e.g., 'COP', 'USD').
   * @param {string} asset - The crypto asset (e.g., 'USDT').
   * @returns {Promise<number>} - The unit price.
   */
  async getBuyPrice(fiat, asset) {
    throw new Error('getBuyPrice() must be implemented by the adapter.');
  }

  /**
   * Get the best price to SELL an asset for a specific fiat currency.
   * @param {string} fiat - The fiat currency (e.g., 'ARS', 'VES').
   * @param {string} asset - The crypto asset (e.g., 'USDT').
   * @returns {Promise<number>} - The unit price.
   */
  async getSellPrice(fiat, asset) {
    throw new Error('getSellPrice() must be implemented by the adapter.');
  }
}
