import fetch from 'node-fetch';
import { ExchangeAdapterBase } from './adapter_base.js';

/**
 * Adapter for Binance P2P using internal BAPI.
 */
export class BinanceBapiAdapter extends ExchangeAdapterBase {
  constructor() {
    super();
    this.endpoint = 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  /**
   * Internal method to query Binance P2P.
   */
  async _queryP2P(fiat, asset, side) {
    const payload = {
      fiat: fiat,
      page: 1,
      rows: 10,
      tradeType: side, // 'BUY' or 'SELL'
      asset: asset,
      countries: [],
      proMerchantAds: false,
      shieldMerchantAds: false,
      publisherType: null,
      payTypes: []
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': this.userAgent
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Binance BAPI error: HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(`Binance BAPI success=false: ${JSON.stringify(data.message)}`);
    }

    // Find the best price from an "Advertiser"
    const ads = data.data || [];
    if (ads.length === 0) {
      throw new Error(`No Binance P2P ads found for ${fiat}/${asset} ${side}`);
    }

    // Best price is the first one in the sorted list
    return parseFloat(ads[0].adv.price);
  }

  async getBuyPrice(fiat, asset) {
    return await this._queryP2P(fiat, asset, 'BUY');
  }

  async getSellPrice(fiat, asset) {
    return await this._queryP2P(fiat, asset, 'SELL');
  }
}
