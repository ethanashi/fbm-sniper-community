/**
 * Triangular Strategy logic (Phase 12).
 * Finds spreads within a single exchange using 3-step routing.
 * e.g., USDT -> BTC -> ETH -> USDT
 */
export class TriangularStrategy {
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * Find triangular arbitrage opportunities on a single exchange.
   * Path: Base -> A -> B -> Base
   */
  async findOpportunities(baseAsset, intermediateA, intermediateB) {
    try {
      // Symbols: intermediateA/base, intermediateB/intermediateA, intermediateB/base
      // e.g. BTCUSDT, ETHBTC, ETHUSDT
      const symbol1 = `${intermediateA}${baseAsset}`;
      const symbol2 = `${intermediateB}${intermediateA}`;
      const symbol3 = `${intermediateB}${baseAsset}`;

      const book1 = await this.adapter.getOrderBook(symbol1);
      const book2 = await this.adapter.getOrderBook(symbol2);
      const book3 = await this.adapter.getOrderBook(symbol3);

      const fee = this.adapter.getTakerFee();

      // Calculation: (1 / Ask 1) * (1 / Ask 2) * (Bid 3)
      const rate1 = 1 / book1.ask;
      const rate2 = 1 / book2.ask;
      const rate3 = book3.bid;

      const netROI = this.calculateROI([rate1, rate2, rate3], fee);

      if (netROI > 0.1) {
        return [{
          exchange: this.adapter.exchangeName,
          route: `${baseAsset} → ${intermediateA} → ${intermediateB} → ${baseAsset}`,
          step1: book1.ask,
          step2: book2.ask,
          step3: book3.bid,
          netROI: netROI,
          actions: [
            this.adapter.getTradeUrl(symbol1),
            this.adapter.getTradeUrl(symbol2),
            this.adapter.getTradeUrl(symbol3)
          ]
        }];
      }
      return [];
    } catch (err) {
      return [];
    }
  }

  calculateROI(rates, fee) {
    // Math: Product of rates - (fee applied 3 times)
    let netResult = 1.0;
    for(const r of rates) netResult *= r;
    const netROI = (netResult - 1.0) - (fee * 3);
    return netROI * 100;
  }
}
