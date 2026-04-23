/**
 * Base class for all exchange adapters.
 * Implements the Adapter pattern to decouple the arbitrage engine from specific exchange APIs.
 */
export class ExchangeAdapterBase {
  /**
   * Get depth data for BUYING an asset with a specific fiat currency.
   * @param {string} fiat - The fiat currency.
   * @param {string} asset - The crypto asset.
   * @returns {Promise<{price: number, volume: number, minLimit: number, maxLimit: number}>}
   */
  async getBuyDepth(fiat, asset) {
    throw new Error('getBuyDepth() must be implemented by the adapter.');
  }

  /**
   * Get depth data for SELLING an asset for a specific fiat currency.
   * @param {string} fiat - The fiat currency.
   * @param {string} asset - The crypto asset.
   * @returns {Promise<{price: number, volume: number, minLimit: number, maxLimit: number}>}
   */
  async getSellDepth(fiat, asset) {
    throw new Error('getSellDepth() must be implemented by the adapter.');
  }

  /**
   * Get the fee for a specific side (BUY/SELL).
   * @param {string} side - 'BUY' or 'SELL'.
   * @returns {number} - The fee as a decimal (e.g., 0.001 for 0.1%).
   */
  getFee(side) {
    return 0; // Default: no fees
  }
}
