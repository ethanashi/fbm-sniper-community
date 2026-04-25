import { BaseCryptoAdapter } from './base.js';
import fetch from 'node-fetch';

/**
 * Binance Spot Adapter using public REST API (Phase 11).
 */
export class BinanceSpotAdapter extends BaseCryptoAdapter {
  constructor() {
    super('Binance');
  }

  async getOrderBook(symbol) {
    // Binance symbol format: BTCUSDT
    const url = `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=5`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.bids || !data.asks) throw new Error('Invalid Binance response');

    return {
      bid: parseFloat(data.bids[0][0]),
      ask: parseFloat(data.asks[0][0]),
      volume: Math.min(parseFloat(data.bids[0][1]), parseFloat(data.asks[0][1]))
    };
  }

  getTakerFee() {
    return 0.001; // 0.1% standard fee
  }

  getTradeUrl(symbol) {
    // Format: BTC_USDT
    const formatted = symbol.replace('USDT', '_USDT');
    return `https://www.binance.com/en/trade/${formatted}?type=spot`;
  }
}
