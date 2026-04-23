import { BinanceBapiAdapter } from './binance_adapter.js';

async function testAdapter() {
  const adapter = new BinanceBapiAdapter();
  try {
    console.log('Fetching prices from Binance P2P...');

    // Test COP Buy
    const buyPrice = await adapter.getBuyPrice('COP', 'USDT');
    console.log(`COP Buy Price: ${buyPrice}`);

    // Test ARS Sell
    const sellPrice = await adapter.getSellPrice('ARS', 'USDT');
    console.log(`ARS Sell Price: ${sellPrice}`);

    console.log('SUCCESS: Prices fetched successfully.');
  } catch (err) {
    console.error('FAILED:', err.message);
  }
}

testAdapter();
