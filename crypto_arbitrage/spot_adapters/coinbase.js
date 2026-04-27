import { BaseCryptoAdapter } from './base.js';
import fetch from 'node-fetch';

/**
 * Coinbase Spot Adapter using public REST API (Phase 11).
 */
export class CoinbaseSpotAdapter extends BaseCryptoAdapter {
  constructor() {
    super('Coinbase');
  }

  async getOrderBook(symbol) {
    // Coinbase symbol format: BTC-USDT
    const cbSymbol = symbol.replace('USDT', '-USDT').replace('BTC', 'BTC');
    const url = `https://api.exchange.coinbase.com/products/${cbSymbol}/book?level=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FBM-Sniper-Bot/1.0' }
    });
    const data = await res.json();

    if (!data.bids || !data.asks) throw new Error('Invalid Coinbase response');

    return {
      bid: parseFloat(data.bids[0][0]),
      ask: parseFloat(data.asks[0][0]),
      volume: Math.min(parseFloat(data.bids[0][1]), parseFloat(data.asks[0][1]))
    };
  }

  getTakerFee() {
    return 0.006; // Coinbase standard taker fee is approx 0.6%
  }

  getTradeUrl(symbol) {
    const cbSymbol = symbol.replace('USDT', '-USDT');
    return `https://www.coinbase.com/advanced-trade/spot/${cbSymbol}`;
  }
}
