import fs from "fs";
import path from "path";
import {
  DATA_DIR,
  CAR_CONFIG_FILE,
  CAR_FOUND_DEALS_FILE,
  CAR_REJECTED_LOG_FILE,
  CAR_SEEN_IDS_FILE,
  CAR_WATCHLIST_FILE,
} from "./paths.js";
import { DEFAULT_WATCHLIST, ensureWatchlistFile } from "./watchlist.js";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sampleFound = [
  {
    timestamp: new Date().toISOString(),
    query: "Honda Civic",
    target: {
      id: "honda-civic-2016-2021",
      label: "Honda Civic 2016-2021",
      group: "Reliable Sedans",
      customPrompt: "Prefer clean-title commuter trims with strong retail demand and straightforward resale.",
      notes: "",
    },
    listing: {
      id: "sample-civic-1",
      title: "2018 Honda Civic Sport Clean Title 92k miles",
      price: 8900,
      currency: "USD",
      description: "Clean title, 92k miles, recent brakes and tires, one owner.",
      photos: [
        "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?auto=format&fit=crop&w=1200&q=80",
      ],
      seller: { name: "Private Seller", location: "Phoenix, AZ" },
      postedAt: new Date().toISOString(),
      condition: "used_good",
      url: "https://www.facebook.com/marketplace/item/100000000000001/",
      location: "Phoenix, AZ",
    },
    vehicle: {
      year: 2018,
      make: "Honda",
      model: "Civic",
      trim: "Sport",
      mileageMiles: 92000,
      vin: null,
      titleStatus: "clean",
      bodyStyle: "Sedan",
      transmission: "Automatic",
      drivetrain: "FWD",
      fuelType: "Gas",
      issues: [],
    },
    market: {
      estRetail: 13850,
      maxBuy: 10200,
      estimatedMargin: 3550,
      feesReserve: 650,
      reconReserve: 900,
      recallCount: 0,
    },
    underwriting: {
      verdict: "buy_now",
      confidence: "high",
      riskScore: 26,
      reasons: ["Strong spread against starter watchlist target retail"],
      summary: "2018 Honda Civic · Est. retail $13,850 · Max buy $10,200 · Margin $3,550",
    },
    ai_analysis: {
      grade: "ungraded",
      confidence: 0,
      notes: "Rules-only grading — photos flagged for manual review",
      needsManualReview: true,
    },
    sources: {
      nhtsaVinDecoded: false,
      nhtsaVinUrl: "",
      listingUrl: "https://www.facebook.com/marketplace/item/100000000000001/",
    },
  },
  {
    timestamp: new Date().toISOString(),
    query: "Toyota Camry",
    target: {
      id: "toyota-camry-2015-2021",
      label: "Toyota Camry 2015-2021",
      group: "Reliable Sedans",
      customPrompt: "Target reliable trims with clean title and solid service history.",
      notes: "",
    },
    listing: {
      id: "sample-camry-1",
      title: "2019 Toyota Camry SE rebuilt title 88k",
      price: 11900,
      currency: "USD",
      description: "Rebuilt title from minor rear-end. Drives perfect.",
      photos: [
        "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=80",
      ],
      seller: { name: "Private Seller", location: "Dallas, TX" },
      postedAt: new Date().toISOString(),
      condition: "used_good",
      url: "https://www.facebook.com/marketplace/item/100000000000002/",
      location: "Dallas, TX",
    },
    vehicle: {
      year: 2019,
      make: "Toyota",
      model: "Camry",
      trim: "SE",
      mileageMiles: 88000,
      vin: null,
      titleStatus: "rebuilt",
      bodyStyle: "Sedan",
      transmission: "Automatic",
      drivetrain: "FWD",
      fuelType: "Gas",
      issues: ["rebuilt"],
    },
    market: {
      estRetail: 16100,
      maxBuy: 12400,
      estimatedMargin: 1800,
      feesReserve: 700,
      reconReserve: 1200,
      recallCount: 0,
    },
    underwriting: {
      verdict: "maybe",
      confidence: "medium",
      riskScore: 55,
      reasons: ["Rebuilt title risk", "Margin tight but acceptable if inspection passes"],
      summary: "2019 Toyota Camry · Est. retail $16,100 · Max buy $12,400 · Margin $1,800",
    },
    ai_analysis: {
      grade: "ungraded",
      confidence: 0,
      notes: "Rules-only grading — photos flagged for manual review",
      needsManualReview: true,
    },
    sources: {
      nhtsaVinDecoded: false,
      nhtsaVinUrl: "",
      listingUrl: "https://www.facebook.com/marketplace/item/100000000000002/",
    },
  },
];

const sampleRejected = [
  ["timestamp", "title", "query", "target_id", "target_label", "target_group", "listing_price", "reason", "url", "make", "model", "year", "title_status"],
  [
    new Date().toISOString(),
    "2017 Ford F-150 flood truck 168k",
    "Ford F-150",
    "ford-f150-2015-2020",
    "Ford F-150 2015-2020",
    "Trucks",
    "12800",
    "Flagged keyword: flood; Mileage is above watchlist cap (180,000 mi)",
    "https://www.facebook.com/marketplace/item/100000000000003/",
    "Ford",
    "F-150",
    "2017",
    "unknown",
  ],
].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));

const defaultConfig = {
  appName: "FBM Sniper Community Edition",
  source: "facebook_marketplace",
  analysisMode: "rules_with_optional_nhtsa",
  aiProvider: "none",
  analysisPrompt: "Focus on clean-title, easy-turn flips with simple recon and enough spread after fees.",
  radiusKM: 120,
  minPrice: 2500,
  maxPrice: 45000,
  allowShipping: true,
  proxyPool: [],
  searchConcurrency: 2,
  detailConcurrency: 3,
  intervalSeconds: 180,
  maxPages: 2,
  maxListingsPerQuery: 10,
  maxAgeHours: 48,
  location: {
    label: "Phoenix, AZ",
    latitude: 33.4484,
    longitude: -112.074,
  },
};

ensureWatchlistFile();
fs.writeFileSync(CAR_WATCHLIST_FILE, JSON.stringify(DEFAULT_WATCHLIST, null, 2), "utf8");
fs.writeFileSync(CAR_CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), "utf8");
fs.writeFileSync(CAR_SEEN_IDS_FILE, JSON.stringify([], null, 2), "utf8");
fs.writeFileSync(CAR_FOUND_DEALS_FILE, sampleFound.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
fs.writeFileSync(CAR_REJECTED_LOG_FILE, sampleRejected.join("\n") + "\n", "utf8");

console.log(`Seeded FBM Sniper Community Edition with starter watchlist and sample data at ${path.relative(process.cwd(), DATA_DIR)}/`);
