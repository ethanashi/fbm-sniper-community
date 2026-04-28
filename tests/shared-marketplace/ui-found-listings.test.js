import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const appPath = path.resolve("ui/app.js");
const source = fs.readFileSync(appPath, "utf8");

function extractFunction(name, context = {}) {
  const syncMarker = `function ${name}(`;
  const asyncMarker = `async function ${name}(`;
  const start = source.indexOf(syncMarker) !== -1
    ? source.indexOf(syncMarker)
    : source.indexOf(asyncMarker);

  assert.notEqual(start, -1, `Could not find ${name} in ${appPath}`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      end = index + 1;
      break;
    }
  }

  assert.notEqual(end, -1, `Could not parse ${name} from ${appPath}`);
  const fnSource = source.slice(start, end);
  return vm.runInNewContext(`(${fnSource})`, context);
}

test("collectSharedPhotoUrls extracts Wallapop image URLs from item.images", () => {
  const collectSharedPhotoUrls = extractFunction("collectSharedPhotoUrls");
  const photos = collectSharedPhotoUrls({
    item: {
      images: [
        { urls: { small: "https://cdn.example.com/one-small.jpg", medium: "https://cdn.example.com/one-medium.jpg" } },
        { urls: { big: "https://cdn.example.com/two-big.jpg" } },
        { urls: { original: "https://cdn.example.com/three-original.jpg" } },
      ],
    },
  });

  assert.deepEqual(Array.from(photos), [
    "https://cdn.example.com/one-medium.jpg",
    "https://cdn.example.com/two-big.jpg",
    "https://cdn.example.com/three-original.jpg",
  ]);
});

test("getFoundListingsColumns hides columns that the user disabled", () => {
  const getFoundListingsColumns = extractFunction("getFoundListingsColumns", {
    FOUND_LISTINGS_META: [
      { id: "cars", label: "Cars", process: "car-sniper" },
      { id: "facebook", label: "Facebook", process: "facebook-sniper" },
      { id: "wallapop", label: "Wallapop", process: "wallapop-sniper" },
      { id: "vinted", label: "Vinted", process: "vinted-sniper" },
    ],
    foundListingsColumnVisibility: {
      cars: true,
      facebook: true,
      wallapop: false,
      vinted: true,
    },
    foundDeals: [{ title: "car deal" }],
    sharedFoundDeals: {
      facebook: [{ title: "fb deal" }],
      wallapop: [{ title: "wp deal" }],
      vinted: [{ title: "vinted deal" }],
    },
    processState: {
      "car-sniper": { running: true, stopping: false },
      "facebook-sniper": { running: false, stopping: false },
      "wallapop-sniper": { running: true, stopping: false },
      "vinted-sniper": { running: true, stopping: true },
    },
  });

  const columns = getFoundListingsColumns();

  assert.deepEqual(
    columns.map((column) => column.id),
    ["cars", "facebook", "vinted"],
  );
  assert.equal(columns[0].count, 1);
  assert.equal(columns[1].count, 1);
  assert.equal(columns[2].process.stopping, true);
});

test("classifyDealTier does not color cards from grade alone", () => {
  const classifyDealTier = extractFunction("classifyDealTier");
  const tier = classifyDealTier({ listing_price: 375 }, "A");

  assert.equal(tier.tier, "");
  assert.equal(tier.label, "");
});

test("classifyDealTier uses max_buy when available", () => {
  const classifyDealTier = extractFunction("classifyDealTier");
  const tier = classifyDealTier({ listing_price: 375, max_buy: 500 }, "F");

  assert.equal(tier.tier, "good");
  assert.equal(tier.label, "Great deal");
});

test("buildSharedDealCard labels the source platform on found cards", () => {
  const buildSharedDealCard = extractFunction("buildSharedDealCard", {
    PLATFORM_META: { wallapop: { label: "Wallapop" } },
    normalizeReasonList: () => [],
    collectSharedPhotoUrls: () => [],
    formatFoundPlatformLabel: () => "Wallapop",
    foundPlatformBadgeClass: () => "badge-platform-wallapop",
    classifyDealTier: () => ({ tier: "", label: "" }),
    gradeBadgeClass: () => "badge-running",
    escHtml: (value) => String(value),
    escAttr: (value) => String(value),
    formatEuro: (value) => `€${value}`,
  });

  const html = buildSharedDealCard("wallapop", {
    title: "iPhone 15 Pro",
    listing_price: 500,
    target: { label: "iPhone", group: "Phones" },
  });

  assert.match(html, /badge-platform-wallapop/);
  assert.match(html, /Wallapop/);
  assert.match(html, /Found Listing/);
});

test("sharedConfigNeedsLocationReview keeps banner visible for unconfirmed Dallas starter", () => {
  const sharedConfigNeedsLocationReview = extractFunction("sharedConfigNeedsLocationReview");

  assert.equal(sharedConfigNeedsLocationReview({
    location: {
      label: "Dallas, TX",
      latitude: 32.7767,
      longitude: -96.797,
      confirmed: false,
    },
  }), true);

  assert.equal(sharedConfigNeedsLocationReview({
    location: {
      label: "Austin, TX",
      latitude: 30.2672,
      longitude: -97.7431,
      confirmed: true,
    },
  }), false);
});
