import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMercariSearchUrl,
  isMercariSearchApiUrl,
  normalizeMercariItems,
  parseProxyUrl,
} from "../lib/mercari-client.js";

test("buildMercariSearchUrl opens public search sorted by newest", () => {
  const url = buildMercariSearchUrl("iphone 15 pro");

  assert.equal(url, "https://www.mercari.com/search/?keyword=iphone+15+pro&sortBy=2");
});

test("isMercariSearchApiUrl detects the search GraphQL call", () => {
  assert.equal(
    isMercariSearchApiUrl("https://www.mercari.com/v1/api?operationName=searchFacetQuery&variables=%7B%7D"),
    true,
  );
  assert.equal(isMercariSearchApiUrl("https://www.mercari.com/v1/initialize"), false);
});

test("normalizeMercariItems converts search API items into listing records", () => {
  const payload = {
    data: {
      search: {
        itemsList: [
          {
            id: "m21420613821",
            name: "iPhone 15 Plus - 128GB - T-Mobile",
            status: "on_sale",
            price: 27000,
            originalPrice: 32500,
            photos: [
              {
                imageUrl: "https://u-mercari-images.mercdn.net/photos/m21420613821_1.jpg",
                thumbnail: "https://u-mercari-images.mercdn.net/photos/m21420613821_1.jpg?width=200",
              },
            ],
            seller: { sellerId: 126135768 },
            brand: { name: "Apple" },
            itemCondition: { name: "Good" },
            categoryTitle: "Cell Phones & Smartphones",
          },
        ],
      },
    },
  };

  assert.deepEqual(normalizeMercariItems(payload), [
    {
      id: "m21420613821",
      title: "iPhone 15 Plus - 128GB - T-Mobile",
      status: "on_sale",
      price: 270,
      originalPrice: 325,
      url: "https://www.mercari.com/us/item/m21420613821/",
      photoUrl: "https://u-mercari-images.mercdn.net/photos/m21420613821_1.jpg",
      photoUrls: ["https://u-mercari-images.mercdn.net/photos/m21420613821_1.jpg"],
      seller: { id: 126135768 },
      brand: "Apple",
      condition: "Good",
      category: "Cell Phones & Smartphones",
      raw: payload.data.search.itemsList[0],
    },
  ]);
});

test("parseProxyUrl accepts bare shared proxy entries", () => {
  assert.deepEqual(parseProxyUrl("92.113.180.175:48991"), {
    server: "http://92.113.180.175:48991",
    username: "",
    password: "",
  });
});
