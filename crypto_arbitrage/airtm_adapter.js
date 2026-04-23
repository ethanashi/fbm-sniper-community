import { ExchangeAdapterBase } from './adapter_base.js';

/**
 * Adapter for Airtm P2P.
 * Ready for endpoint injection.
 */
export class AirtmAdapter extends ExchangeAdapterBase {
  constructor() {
    super();
    this.endpoint = 'https://api.airtm.com/v1/p2p/search'; // Placeholder
  }

  async getBuyDepth(fiat, asset) {
    console.log(`[Airtm] Fetching buy depth for ${fiat}/${asset}...`);
    return {
      price: 1, // Placeholder
      volume: 1000,
      minLimit: 10,
      maxLimit: 10000
    };
  }

  async getSellDepth(fiat, asset) {
    console.log(`[Airtm] Fetching sell depth for ${fiat}/${asset}...`);
    return {
      price: 1, // Placeholder
      volume: 1000,
      minLimit: 10,
      maxLimit: 10000
    };
  }

  getFee(side) {
    // Airtm fee is typically around 1.5%
    return 0.015;
  }
}
