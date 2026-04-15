import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const UI_DIR = path.join(ROOT_DIR, "ui");

export const CAR_CONFIG_FILE = path.join(DATA_DIR, "config.json");
export const CAR_WATCHLIST_FILE = path.join(DATA_DIR, "watchlist.json");
export const CAR_FOUND_DEALS_FILE = path.join(DATA_DIR, "found_listings.ndjson");
export const CAR_REJECTED_LOG_FILE = path.join(DATA_DIR, "rejected_listings.csv");
export const CAR_SEEN_IDS_FILE = path.join(DATA_DIR, "seen_ids.json");
