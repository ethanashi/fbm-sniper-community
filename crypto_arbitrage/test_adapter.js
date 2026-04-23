import { BinanceBapiAdapter } from './binance_adapter.js';

async function testAdapter() {
  const adapter = new BinanceBapiAdapter();
  try {
    console.log('Fetching prices from Binance P2P...');

    // Test COP Buy
    const buyDepth = await adapter.getBuyDepth('COP', 'USDT');
    console.log(`COP Buy Price: ${buyDepth.price}`);

    // Test ARS Sell
    const sellDepth = await adapter.getSellDepth('ARS', 'USDT');
    console.log(`ARS Sell Price: ${sellDepth.price}`);

    console.log('SUCCESS: Prices fetched successfully.');
  } catch (err) {
    console.error('FAILED:', err.message);
  }
}

testAdapter();
