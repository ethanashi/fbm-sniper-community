import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

import {
  buildDocIdFallbackSession,
  buildSearchDocIdCandidates,
  buildSearchVariables,
  describeGraphQLErrors,
  getListingDetail,
  searchMarketplace,
  selectSearchSession,
} from "../lib/fb-scraper.js";

test("buildSearchDocIdCandidates tries marketplace content query before root query", () => {
  const candidates = buildSearchDocIdCandidates({
    searchRoot: "32811453205106563",
    searchContent: "26952533941102089",
    search: "26952533941102089",
  });

  assert.deepEqual(candidates, [
    { id: "26952533941102089", name: "CometMarketplaceSearchContentContainerQuery" },
    { id: "32811453205106563", name: "CometMarketplaceSearchRootQuery" },
  ]);
});

test("buildSearchDocIdCandidates treats generic search id as content query", () => {
  const candidates = buildSearchDocIdCandidates({
    search: "26952533941102089",
  });

  assert.deepEqual(candidates, [
    { id: "26952533941102089", name: "CometMarketplaceSearchContentContainerQuery" },
  ]);
});

test("buildSearchVariables rewrites captured route preloaders for the caller location and query", () => {
  const capturedVars = {
    buyLocation: { latitude: 37.7793, longitude: -122.419 },
    contextual_data: [{ name: "search_query", value: "\"iphone\"" }],
    count: 24,
    cursor: null,
    params: {
      bqf: { callsite: "COMMERCE_MKTPLACE_WWW", query: "iphone" },
      browse_request_params: {
        commerce_search_and_rp_category_id: [],
        filter_location_latitude: 37.7793,
        filter_location_longitude: -122.419,
        filter_price_lower_bound: 0,
        filter_price_upper_bound: 214748364700,
        filter_radius_km: 65,
        commerce_search_sort_by: "CREATION_TIME_DESCEND",
      },
      custom_request_params: {
        search_vertical: "C2C",
        seo_url: null,
        surface: "SEARCH",
      },
    },
    savedSearchQuery: "iphone",
    searchPopularSearchesParams: { location_id: "sanfrancisco", query: "iphone" },
    topicPageParams: { location_id: "sanfrancisco", url: null },
  };

  const variables = buildSearchVariables({
    capturedVars,
    query: "Honda Civic",
    lat: 32.7767,
    lng: -96.797,
    radiusKM: 120,
    minPrice: 250000,
    maxPrice: 4500000,
    sort: "CREATION_TIME_DESCEND",
    conditionEnums: ["USED_GOOD"],
    daysSinceListed: 2,
  });

  assert.equal(variables.buyLocation.latitude, 32.7767);
  assert.equal(variables.buyLocation.longitude, -96.797);
  assert.equal(variables.savedSearchQuery, "Honda Civic");
  assert.equal(variables.contextual_data[0].value, "\"Honda Civic\"");
  assert.equal(variables.params.bqf.query, "Honda Civic");
  assert.equal(variables.params.browse_request_params.filter_location_latitude, 32.7767);
  assert.equal(variables.params.browse_request_params.filter_location_longitude, -96.797);
  assert.equal(variables.params.browse_request_params.filter_radius_km, 120);
  assert.equal(variables.params.browse_request_params.filter_price_lower_bound, 250000);
  assert.equal(variables.params.browse_request_params.filter_price_upper_bound, 4500000);
  assert.equal(variables.params.browse_request_params.commerce_search_and_rp_ctime_days, 2);
  assert.equal(variables.topicPageParams.location_id, undefined);
  assert.equal(variables.searchPopularSearchesParams.location_id, null);
  assert.equal(JSON.stringify(variables).includes("sanfrancisco"), false);
});

test("buildDocIdFallbackSession uses direct Marketplace metadata when a proxy bootstrap has no search doc id", () => {
  const proxySession = {
    tokens: { lsd: "proxy-lsd" },
    cookies: "proxy-cookie=1",
    userAgent: "proxy-ua",
    docIds: { search: null },
    timestamp: 10,
  };
  const directSession = {
    tokens: { lsd: "direct-lsd", __dyn: "direct-dyn" },
    cookies: "direct-cookie=1",
    userAgent: "direct-ua",
    docIds: {
      searchContent: "26952533941102089",
      search: "26952533941102089",
      _capturedVariables: { savedSearchQuery: "iphone" },
    },
    timestamp: 20,
  };

  const session = buildDocIdFallbackSession(proxySession, directSession);

  assert.equal(session.cookies, "direct-cookie=1");
  assert.equal(session.tokens.__dyn, "direct-dyn");
  assert.equal(session.docIds.searchContent, "26952533941102089");
  assert.equal(session._fallbackForProxySession, true);
  assert.equal(session._proxyBootstrapSession, proxySession);
});

test("buildDocIdFallbackSession keeps proxy session when it already has a search doc id", () => {
  const proxySession = {
    docIds: { searchContent: "26952533941102089" },
  };
  const directSession = {
    docIds: { searchContent: "11111111111111111" },
  };

  assert.equal(buildDocIdFallbackSession(proxySession, directSession), proxySession);
});

test("selectSearchSession prefers preloaded direct metadata for proxied searches", () => {
  const proxySession = {
    docIds: { search: null },
  };
  const metadataSession = {
    cookies: "direct-cookie=1",
    docIds: {
      searchContent: "26952533941102089",
      search: "26952533941102089",
    },
  };

  const session = selectSearchSession({
    proxySession,
    metadataSession,
    effectiveProxy: "http://proxy.test:8080",
  });

  assert.equal(session.cookies, "direct-cookie=1");
  assert.equal(session.docIds.searchContent, "26952533941102089");
  assert.equal(session._metadataPreloadedForProxy, true);
  assert.equal(session._proxyBootstrapSession, proxySession);
});

test("describeGraphQLErrors treats Facebook 1675004 as a rate limit", () => {
  const info = describeGraphQLErrors([
    { code: 1675004, message: "Rate limit exceeded" },
  ]);

  assert.equal(info.rateLimited, true);
  assert.equal(info.codes, "1675004");
  assert.match(info.messages, /Rate limit exceeded/);
});

test("searchMarketplace falls back direct when proxied GraphQL returns 1675004", async () => {
  const originalPost = axios.post;
  const calls = [];
  axios.post = async (_url, _body, requestConfig) => {
    calls.push(requestConfig.proxy ? "proxy" : "direct");
    if (requestConfig.proxy) {
      return {
        data: JSON.stringify({
          errors: [{ code: 1675004, message: "Rate limit exceeded" }],
        }),
      };
    }

    return {
      data: JSON.stringify({
        data: {
          marketplace_search: {
            feed_units: {
              edges: [
                {
                  node: {
                    id: "listing-1",
                    marketplace_listing_title: "Honda Civic",
                    listing_price: { amount: "100.00", currency: "USD" },
                  },
                },
              ],
              page_info: { has_next_page: false },
            },
          },
        },
      }),
    };
  };

  try {
    const result = await searchMarketplace({
      query: "Honda Civic",
      lat: 40.4032,
      lng: -3.7037,
      radiusKM: 120,
      minPrice: 0,
      maxPrice: 2000000,
      maxPages: 1,
      proxyUrl: "http://proxy.test:8080",
      fallbackToDirectOnProxyRateLimit: true,
      metadataSession: {
        tokens: {},
        cookies: "direct-cookie=1",
        userAgent: "test-agent",
        docIds: {
          searchContent: "26952533941102089",
          search: "26952533941102089",
        },
      },
    });

    assert.deepEqual(calls, ["proxy", "direct"]);
    assert.equal(result.totalFound, 1);
    assert.equal(result.listings[0].id, "listing-1");
  } finally {
    axios.post = originalPost;
  }
});

test("searchMarketplace falls back to rendered page listings when anon GraphQL returns no-results sentinel", async () => {
  const originalPost = axios.post;
  const originalLog = console.log;
  const originalWarn = console.warn;
  const logs = [];
  const warnings = [];
  axios.post = async (_url, body) => {
    const params = new URLSearchParams(String(body));
    const friendlyName = params.get("fb_api_req_friendly_name") || "";
    if (friendlyName === "CometMarketplaceSearchRootQuery") {
      return {
        data: JSON.stringify({
          data: {
            viewer: {
              marketplace_ranked_categories: { categories_virtual_taxonomy: [] },
            },
            marketplace_seo_page: {},
            marketplace_search_popular_searches: {},
          },
        }),
      };
    }

    return {
      data: JSON.stringify({
        data: {
          marketplace_search: {
            feed_units: {
              edges: [
                {
                  node: {
                    __typename: "MarketplaceSearchFeedNoResults",
                    story_type: "SERP_NO_RESULTS",
                  },
                },
              ],
              page_info: { has_next_page: false },
            },
          },
        },
      }),
    };
  };
  console.log = (...args) => logs.push(args.join(" "));
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    const result = await searchMarketplace({
      query: "Honda Civic",
      lat: 37.7793,
      lng: -122.419,
      radiusKM: 65,
      minPrice: 0,
      maxPrice: 2000000,
      maxPages: 1,
      metadataSession: {
        tokens: {},
        cookies: "",
        userAgent: "test-agent",
        docIds: {
          searchRoot: "32811453205106563",
          searchContent: "26952533941102089",
          search: "26952533941102089",
        },
      },
      pageSearchFetcher: async () => [
        {
          id: "ssr-listing-1",
          marketplace_listing_title: "Honda Civic",
          listing_price: { amount: "1000.00", currency: "USD" },
        },
      ],
    });

    assert.equal(result.totalFound, 1);
    assert.equal(result.listings[0].id, "ssr-listing-1");
    assert.equal(result.listings[0].title, "Honda Civic");
    assert.equal(warnings.some((line) => line.includes("MarketplaceSearchFeedNoResults")), false);
    assert.equal(warnings.some((line) => line.includes("body[0:300]")), false);
    assert.equal(
      logs.some((line) => line.includes("GraphQL search returned no usable listing feed; scraping rendered Marketplace page.")),
      true,
    );
  } finally {
    axios.post = originalPost;
    console.log = originalLog;
    console.warn = originalWarn;
  }
});

test("searchMarketplace uses rendered page fallback when no search doc id is available", async () => {
  const originalLog = console.log;
  const logs = [];
  console.log = (...args) => logs.push(args.join(" "));

  try {
    const result = await searchMarketplace({
      query: "Toyota Camry",
      lat: 32.7767,
      lng: -96.797,
      radiusKM: 120,
      minPrice: 0,
      maxPrice: 3000000,
      maxPages: 1,
      forceDirect: true,
      metadataSession: {
        tokens: {},
        cookies: "",
        userAgent: "test-agent",
        docIds: {},
      },
      pageSearchFetcher: async () => [
        {
          id: "rendered-car-1",
          marketplace_listing_title: "Toyota Camry 2018",
          listing_price: { amount: "12000.00", currency: "USD" },
          listing_photos: [
            { image: { uri: "https://example.test/camry.jpg" } },
          ],
        },
      ],
    });

    assert.equal(result.totalFound, 1);
    assert.equal(result.listings[0].id, "rendered-car-1");
    assert.equal(result.listings[0].photos[0], "https://example.test/camry.jpg");
    assert.equal(
      logs.some((line) => line.includes("No search doc_id available; scraping rendered Marketplace page.")),
      true,
    );
  } finally {
    console.log = originalLog;
  }
});

test("getListingDetail rewrites captured PDP targetId for each listing", async () => {
  const originalPost = axios.post;
  let sentVariables = null;
  axios.post = async (_url, body) => {
    const params = new URLSearchParams(String(body));
    sentVariables = JSON.parse(params.get("variables"));
    return {
      data: JSON.stringify({
        data: {
          node: {
            id: "wanted-listing",
            marketplace_listing_title: "Wanted listing",
            listing_photos: [
              { image: { uri: "https://example.test/wanted.jpg" } },
            ],
          },
        },
      }),
    };
  };

  try {
    const detail = await getListingDetail(
      "wanted-listing",
      "",
      null,
      null,
      {
        tokens: {},
        cookies: "",
        userAgent: "test-agent",
        docIds: {
          detail: "10059604367394414",
          _pdpVariables: {
            products_per_category: 6,
            scale: 2,
            targetId: "bootstrap-listing",
          },
        },
      },
    );

    assert.equal(sentVariables.targetId, "wanted-listing");
    assert.equal(sentVariables.listingID, "wanted-listing");
    assert.equal(detail.id, "wanted-listing");
  } finally {
    axios.post = originalPost;
  }
});
