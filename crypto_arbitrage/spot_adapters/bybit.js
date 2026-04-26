import { BaseCryptoAdapter } from './base.js';
import fetch from 'node-fetch';

/**
 * Bybit Spot Adapter using public REST API (Phase 11).
 * Uses public endpoints for unauthenticated data access.
 */
export class BybitPublicAdapter extends BaseCryptoAdapter {
  constructor() {
    super('Bybit');
  }

  async getOrderBook(symbol) {
    // Bybit V5 API: /v5/market/orderbook?category=spot&symbol=BTCUSDT
    const url = `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.retCode !== 0 || !data.result) {
      throw new Error(`Bybit API error: ${data.retMsg || 'Unknown error'}`);
    }

    const { b, a } = data.result; // b: bids, a: asks

    return {
      bid: parseFloat(b[0][0]),
      ask: parseFloat(a[0][0]),
      volume: Math.min(parseFloat(b[0][1]), parseFloat(a[0][1]))
    };
  }

  getTakerFee() {
    return 0.001; // Bybit standard spot taker fee is 0.1%
  }

  getTradeUrl(symbol) {
    return `https://www.bybit.com/en/trade/spot/${symbol.replace('USDT', '/USDT')}`;
  }
}
