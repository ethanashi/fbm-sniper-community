import { BaseCryptoAdapter } from './base.js';
import fetch from 'node-fetch';

/**
 * Kraken Spot Adapter using public REST API (Phase 11).
 */
export class KrakenSpotAdapter extends BaseCryptoAdapter {
  constructor() {
    super('Kraken');
  }

  async getOrderBook(symbol) {
    // Kraken symbol format: XBTUSDT
    let krakenSymbol = symbol.replace('BTC', 'XBT');
    const url = `https://api.kraken.com/0/public/Depth?pair=${krakenSymbol}&count=5`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error && data.error.length > 0) throw new Error(data.error[0]);

    const pairKey = Object.keys(data.result)[0];
    const pair = data.result[pairKey];

    return {
      bid: parseFloat(pair.bids[0][0]),
      ask: parseFloat(pair.asks[0][0]),
      volume: Math.min(parseFloat(pair.bids[0][1]), parseFloat(pair.asks[0][1]))
    };
  }

  getTakerFee() {
    return 0.0026; // Kraken standard taker fee is approx 0.26%
  }

  getTradeUrl(symbol) {
    let krakenSymbol = symbol.replace('BTC', 'XBT');
    // Direct URL structure for Kraken spot trade
    return `https://pro.kraken.com/app/trade/${krakenSymbol}`;
  }
}
