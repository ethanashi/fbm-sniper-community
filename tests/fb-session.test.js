import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMarketplaceListingFromDomRecord,
  buildSessionCacheKey,
  extractMarketplacePreloaderDocIds,
} from "../lib/fb-session.js";

test("extractMarketplacePreloaderDocIds reads search query IDs from route preloaders", () => {
  const source = `
    {
      "preloaders": [
        {
          "actorID": "0",
          "preloaderID": "adp_CometMarketplaceSearchRootQueryRelayPreloader_69f33af5b3f573117252266",
          "queryID": "32811453205106563",
          "variables": {
            "savedSearchQuery": "iphone 12"
          },
          "queryName": "CometMarketplaceSearchRootQuery"
        },
        {
          "actorID": "0",
          "preloaderID": "adp_CometMarketplaceSearchContentContainerQueryRelayPreloader_69f33af5b3fbd7271451464",
          "queryID": "26952533941102089",
          "variables": {
            "count": 24,
            "cursor": null,
            "params": {
              "bqf": {
                "callsite": "COMMERCE_MKTPLACE_WWW",
                "query": "iphone 12"
              }
            },
            "savedSearchQuery": "iphone 12"
          },
          "queryName": "CometMarketplaceSearchContentContainerQuery"
        }
      ]
    }
  `;

  assert.deepEqual(extractMarketplacePreloaderDocIds(source), {
    searchRoot: "32811453205106563",
    searchContent: "26952533941102089",
    search: "26952533941102089",
    _capturedVariables: {
      count: 24,
      cursor: null,
      params: {
        bqf: {
          callsite: "COMMERCE_MKTPLACE_WWW",
          query: "iphone 12",
        },
      },
      savedSearchQuery: "iphone 12",
    },
  });
});

test("extractMarketplacePreloaderDocIds reads expectedPreloaders from live route payloads", () => {
  const source = `
    {
      "expectedPreloaders": [
        {
          "actorID": "0",
          "preloaderID": "adp_CometMarketplaceSearchContentContainerQueryRelayPreloader_69f33d623ec6f9f76095592",
          "queryID": "26952533941102089",
          "variables": {
            "buyLocation": {
              "latitude": 37.7793,
              "longitude": -122.419
            },
            "count": 24,
            "params": {
              "bqf": {
                "callsite": "COMMERCE_MKTPLACE_WWW",
                "query": "iphone"
              },
              "browse_request_params": {
                "filter_radius_km": 65,
                "commerce_search_sort_by": "CREATION_TIME_DESCEND"
              }
            },
            "savedSearchQuery": "iphone"
          },
          "queryName": "CometMarketplaceSearchContentContainerQuery"
        }
      ]
    }
  `;

  assert.deepEqual(extractMarketplacePreloaderDocIds(source), {
    searchContent: "26952533941102089",
    search: "26952533941102089",
    _capturedVariables: {
      buyLocation: {
        latitude: 37.7793,
        longitude: -122.419,
      },
      count: 24,
      params: {
        bqf: {
          callsite: "COMMERCE_MKTPLACE_WWW",
          query: "iphone",
        },
        browse_request_params: {
          filter_radius_km: 65,
          commerce_search_sort_by: "CREATION_TIME_DESCEND",
        },
      },
      savedSearchQuery: "iphone",
    },
  });
});

test("buildSessionCacheKey scopes Facebook sessions by proxy and search location", () => {
  assert.equal(
    buildSessionCacheKey(null, { latitude: 32.7767, longitude: -96.797 }),
    "__direct__::32.777,-96.797",
  );
  assert.equal(
    buildSessionCacheKey("http://proxy.test:8080", { latitude: 40.4168, longitude: -3.7038 }),
    "http://proxy.test:8080::40.417,-3.704",
  );
  assert.equal(
    buildSessionCacheKey("proxy.test:8080", { latitude: 40.4168, longitude: -3.7038 }),
    "http://proxy.test:8080::40.417,-3.704",
  );
  assert.equal(buildSessionCacheKey(null), "__direct__::nocoords");
});

test("buildMarketplaceListingFromDomRecord converts rendered search cards to listing objects", () => {
  const listing = buildMarketplaceListingFromDomRecord({
    href: "https://www.facebook.com/marketplace/item/1234567890/?ref=search",
    text: "$250\nHonda Civic wheels\nSan Francisco, CA",
    image: "https://example.test/photo.jpg",
  });

  assert.equal(listing.id, "1234567890");
  assert.equal(listing.marketplace_listing_title, "Honda Civic wheels");
  assert.equal(listing.listing_price.amount, "250");
  assert.equal(listing.listing_price.currency, "USD");
  assert.equal(listing.primary_listing_photo.image.uri, "https://example.test/photo.jpg");
});

test("buildMarketplaceListingFromDomRecord parses rendered car prices with thousands separators", () => {
  const listing = buildMarketplaceListingFromDomRecord({
    href: "https://www.facebook.com/marketplace/item/1234567890/?ref=search",
    text: "$7,500\n2014 Toyota Camry\nDallas, TX",
    image: "https://example.test/camry.jpg",
  });

  assert.equal(listing.marketplace_listing_title, "2014 Toyota Camry");
  assert.equal(listing.listing_price.amount, "7500");
  assert.equal(listing.listing_price.formatted_amount, "$7,500");
});

test("buildMarketplaceListingFromDomRecord preserves rendered card image candidates", () => {
  const listing = buildMarketplaceListingFromDomRecord({
    href: "https://www.facebook.com/marketplace/item/1234567890/?ref=search",
    text: "$250\nHonda Civic wheels\nSan Francisco, CA",
    images: [
      "",
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
      "https://scontent.xx.fbcdn.net/v/t45.5328-4/first.jpg?stp=dst-jpg_p180x540",
      "https://scontent.xx.fbcdn.net/v/t45.5328-4/first.jpg?stp=dst-jpg_p180x540",
      "https://scontent.xx.fbcdn.net/v/t45.5328-4/second.jpg?stp=dst-jpg_p180x540",
    ],
  });

  assert.equal(
    listing.primary_listing_photo.image.uri,
    "https://scontent.xx.fbcdn.net/v/t45.5328-4/first.jpg?stp=dst-jpg_p180x540",
  );
  assert.deepEqual(
    listing.listing_photos.map((photo) => photo.image.uri),
    [
      "https://scontent.xx.fbcdn.net/v/t45.5328-4/first.jpg?stp=dst-jpg_p180x540",
      "https://scontent.xx.fbcdn.net/v/t45.5328-4/second.jpg?stp=dst-jpg_p180x540",
    ],
  );
});
