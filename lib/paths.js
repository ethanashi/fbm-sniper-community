import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");
// When packaged via Electron, FBM_DATA_DIR is set to app.getPath('userData')
// so writes go to a user-writable location instead of inside the read-only app bundle.
export const DATA_DIR = process.env.FBM_DATA_DIR || path.join(ROOT_DIR, "data");
export const UI_DIR = path.join(ROOT_DIR, "ui");

export const CAR_CONFIG_FILE = path.join(DATA_DIR, "config.json");
export const CAR_WATCHLIST_FILE = path.join(DATA_DIR, "watchlist.json");
export const CAR_FOUND_DEALS_FILE = path.join(DATA_DIR, "found_listings.ndjson");
export const CAR_REJECTED_LOG_FILE = path.join(DATA_DIR, "rejected_listings.csv");
export const CAR_SEEN_IDS_FILE = path.join(DATA_DIR, "seen_ids.json");

export const FACEBOOK_DATA_DIR = path.join(DATA_DIR, "facebook");
export const FACEBOOK_FOUND_FILE = path.join(FACEBOOK_DATA_DIR, "found.ndjson");
export const FACEBOOK_SEEN_FILE = path.join(FACEBOOK_DATA_DIR, "seen_ids.json");

export const WALLAPOP_DATA_DIR = path.join(DATA_DIR, "wallapop");
export const WALLAPOP_FOUND_FILE = path.join(WALLAPOP_DATA_DIR, "found.ndjson");
export const WALLAPOP_SEEN_FILE = path.join(WALLAPOP_DATA_DIR, "seen_ids.json");

export const VINTED_DATA_DIR = path.join(DATA_DIR, "vinted");
export const VINTED_FOUND_FILE = path.join(VINTED_DATA_DIR, "found.ndjson");
export const VINTED_SEEN_FILE = path.join(VINTED_DATA_DIR, "seen_ids.json");
