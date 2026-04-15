/**
 * Facebook Marketplace Scraper — Configuration
 */

export default {
  // Search defaults
  search: {
    defaultRadiusKM: 65,
    defaultSort: 'CREATION_TIME_DESCEND',
    resultsPerPage: 24,
    maxPages: 5,
  },

  // Default location — Madrid city centre
  location: {
    latitude: 40.4032,
    longitude: -3.7037,
  },

  // Rate limiting / stealth
  timing: {
    minDelayBetweenRequests: 1200,
    maxDelayBetweenRequests: 2800,
    sessionRefreshInterval: 30 * 60 * 1000, // 30 min
    retryDelay: 9000,
    maxRetries: 3,
  },

  // Proxy (optional — fill in or use env vars)
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true' || false,
    host: process.env.PROXY_HOST || '',
    port: process.env.PROXY_PORT || '',
    username: process.env.PROXY_USER || '',
    password: process.env.PROXY_PASS || '',
  },

  // Phone-specific search presets
  phoneSearch: {
    queries: ['iphone', 'samsung galaxy', 'pixel'],
    maxPrice: 80000, // cents ($800)
    minPrice: 5000,  // cents ($50)
    categories: [],
  },
};
