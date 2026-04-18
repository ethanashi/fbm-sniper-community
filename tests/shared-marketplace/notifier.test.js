import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveNotificationConfig,
  selectDiscordTargets,
  buildDiscordEmbeds,
} from "../../lib/shared-marketplace/notifier.js";

test("resolveNotificationConfig keeps Discord optional", () => {
  const config = resolveNotificationConfig({
    notifications: {},
  });

  assert.deepEqual(config.discord, {
    allWebhookUrl: "",
    buyNowWebhookUrl: "",
    maybeWebhookUrl: "",
  });
});

test("selectDiscordTargets routes grade B to all and buy-now", () => {
  const config = resolveNotificationConfig({
    notifications: {
      discord: {
        allWebhookUrl: "https://discord.test/all",
        buyNowWebhookUrl: "https://discord.test/buy",
        maybeWebhookUrl: "https://discord.test/maybe",
      },
    },
  });

  const targets = selectDiscordTargets({ grade: "B", url: "https://listing.test/1" }, config);
  assert.deepEqual(
    targets.map((target) => ({ name: target.name, webhookUrl: target.webhookUrl })),
    [
      { name: "All Deals", webhookUrl: "https://discord.test/all" },
      { name: "Buy Now", webhookUrl: "https://discord.test/buy" },
    ],
  );
});

test("buildDiscordEmbeds includes Vinted fee and seller details", () => {
  const embeds = buildDiscordEmbeds({
    platform: "vinted",
    grade: "C",
    title: "iPhone 15 Pro 256GB",
    url: "https://vinted.test/items/1",
    listing_price: 320,
    max_buy_all_in: 382,
    ceiling: 340,
    savings: 20,
    score: 80,
    reasons: ["saves EUR20 vs ceiling"],
    condition: "Very good",
    battery_health: 89,
    photo_count: 2,
    fees: { buyerProtection: 8, shipping: 6, total: 334, totalWithVerif: 336 },
    seller: { name: "maria", rating: 4.9, item_count: 12 },
    item: {
      photos: [{ full_size_url: "https://img.test/1.jpg" }, { full_size_url: "https://img.test/2.jpg" }],
    },
    target: { label: "iPhone 15 Pro", group: "Phones" },
  }, resolveNotificationConfig({
    notifications: {
      includePhotos: true,
      maxPhotos: 2,
      discord: { allWebhookUrl: "https://discord.test/all" },
    },
  }));

  assert.equal(embeds.length, 2);
  assert.equal(embeds[0].color, 0xd4a72c);
  assert.equal(embeds[0].image.url, "https://img.test/1.jpg");
  assert.equal(embeds[1].image.url, "https://img.test/2.jpg");
  assert.deepEqual(
    embeds[0].fields.map((field) => ({ name: field.name, value: field.value })),
    [
      { name: "Platform", value: "vinted" },
      { name: "Grade", value: "C" },
      { name: "Listed", value: "EUR 320" },
      { name: "Score", value: "80" },
      { name: "Target", value: "iPhone 15 Pro" },
      { name: "Group", value: "Phones" },
      { name: "Max All-In", value: "EUR 382" },
      { name: "Ceiling", value: "EUR 340" },
      { name: "Savings", value: "EUR 20" },
      { name: "Condition", value: "Very good" },
      { name: "Battery", value: "89%" },
      { name: "Photos", value: "2" },
      { name: "Seller", value: "maria (4.9)" },
      { name: "Seller Items", value: "12" },
      { name: "Fees", value: "BP EUR 8 | Ship EUR 6 | Total EUR 334" },
    ],
  );
});
