/**
 * Base Interface for Crypto Spot Adapters (Phase 11).
 */
export class BaseCryptoAdapter {
  constructor(exchangeName) {
    this.exchangeName = exchangeName;
  }

  /**
   * Fetch current order book for a symbol (e.g., BTCUSDT).
   * @returns {Promise<{bid: number, ask: number, volume: number}>}
   */
  async getOrderBook(symbol) {
    throw new Error('Method not implemented');
  }

  /**
   * Returns the taker fee for this exchange.
   */
  getTakerFee() {
    return 0.001; // Default 0.1%
  }

  /**
   * Construct a direct trade URL for a symbol.
   */
  getTradeUrl(symbol) {
    throw new Error('Method not implemented');
  }
}
