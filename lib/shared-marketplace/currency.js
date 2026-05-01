export const DEFAULT_DISPLAY_CURRENCY = "USD";

export const DISPLAY_CURRENCIES = [
  { code: "USD", label: "United States Dollar", symbol: "$", locale: "en-US" },
  { code: "EUR", label: "Euro", symbol: "€", locale: "en-US" },
  { code: "GBP", label: "British Pound", symbol: "£", locale: "en-GB" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$", locale: "en-CA" },
  { code: "AUD", label: "Australian Dollar", symbol: "A$", locale: "en-AU" },
  { code: "JPY", label: "Japanese Yen", symbol: "¥", locale: "ja-JP" },
  { code: "PLN", label: "Polish Zloty", symbol: "zł", locale: "pl-PL" },
  { code: "SEK", label: "Swedish Krona", symbol: "kr", locale: "sv-SE" },
  { code: "DKK", label: "Danish Krone", symbol: "kr", locale: "da-DK" },
  { code: "CZK", label: "Czech Koruna", symbol: "Kč", locale: "cs-CZ" },
  { code: "RON", label: "Romanian Leu", symbol: "lei", locale: "ro-RO" },
  { code: "HUF", label: "Hungarian Forint", symbol: "Ft", locale: "hu-HU" },
];

const CURRENCY_META = new Map(DISPLAY_CURRENCIES.map((entry) => [entry.code, entry]));
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";

// Approximate USD values for offline fallback. Live rates are fetched when possible.
const FALLBACK_USD_VALUE = {
  USD: 1,
  EUR: 1.17,
  GBP: 1.35,
  CAD: 0.72,
  AUD: 0.66,
  JPY: 0.0065,
  PLN: 0.27,
  SEK: 0.11,
  DKK: 0.157,
  CZK: 0.048,
  RON: 0.23,
  HUF: 0.003,
};

const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "HUF"]);

export function normalizeCurrencyCode(value, fallback = DEFAULT_DISPLAY_CURRENCY) {
  const code = String(value || "").trim().toUpperCase();
  if (CURRENCY_META.has(code)) return code;
  const safeFallback = String(fallback || DEFAULT_DISPLAY_CURRENCY).trim().toUpperCase();
  return CURRENCY_META.has(safeFallback) ? safeFallback : DEFAULT_DISPLAY_CURRENCY;
}

export function roundCurrency(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const places = ZERO_DECIMAL_CURRENCIES.has(normalizeCurrencyCode(currency)) ? 0 : 2;
  const factor = 10 ** places;
  return Math.round(parsed * factor) / factor;
}

export function formatCurrency(value, currency = DEFAULT_DISPLAY_CURRENCY) {
  const code = normalizeCurrencyCode(currency);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "–";
  const meta = CURRENCY_META.get(code);
  try {
    return new Intl.NumberFormat(meta?.locale || "en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: ZERO_DECIMAL_CURRENCIES.has(code) ? 0 : 2,
    }).format(parsed);
  } catch {
    return `${meta?.symbol || code} ${roundCurrency(parsed, code)?.toLocaleString()}`;
  }
}

export function fallbackRate(fromCurrency, toCurrency) {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  if (from === to) return 1;
  const fromUsd = FALLBACK_USD_VALUE[from] || 1;
  const toUsd = FALLBACK_USD_VALUE[to] || 1;
  return fromUsd / toUsd;
}

export function convertCurrency(amount, fromCurrency, toCurrency, sourceRates = {}, { direction = "toDisplay" } = {}) {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) return null;
  if (from === to) return roundCurrency(parsed, to);

  const rate = Number(sourceRates[from]);
  const effectiveRate = Number.isFinite(rate) && rate > 0 ? rate : fallbackRate(from, to);
  const converted = direction === "fromDisplay" ? parsed / effectiveRate : parsed * effectiveRate;
  return roundCurrency(converted, direction === "fromDisplay" ? from : to);
}

async function fetchRate(fromCurrency, toCurrency, fetchImpl = globalThis.fetch) {
  const from = normalizeCurrencyCode(fromCurrency);
  const to = normalizeCurrencyCode(toCurrency);
  if (from === to) return 1;
  if (typeof fetchImpl !== "function") return fallbackRate(from, to);

  const url = new URL(FRANKFURTER_URL);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);

  try {
    const response = await fetchImpl(url.toString());
    if (!response?.ok) return fallbackRate(from, to);
    const payload = await response.json();
    const rate = Number(payload?.rates?.[to]);
    return Number.isFinite(rate) && rate > 0 ? rate : fallbackRate(from, to);
  } catch {
    return fallbackRate(from, to);
  }
}

export async function createCurrencyConverter({
  displayCurrency = DEFAULT_DISPLAY_CURRENCY,
  sourceCurrencies = [],
  fetchImpl = globalThis.fetch,
} = {}) {
  const display = normalizeCurrencyCode(displayCurrency);
  const sources = [...new Set([display, ...sourceCurrencies].map((code) => normalizeCurrencyCode(code)))];
  const rates = {};

  await Promise.all(sources.map(async (source) => {
    rates[source] = source === display ? 1 : await fetchRate(source, display, fetchImpl);
  }));

  return {
    displayCurrency: display,
    rates,
    toDisplay(amount, sourceCurrency) {
      const source = normalizeCurrencyCode(sourceCurrency, display);
      return convertCurrency(amount, source, display, rates);
    },
    fromDisplay(amount, targetCurrency) {
      const target = normalizeCurrencyCode(targetCurrency, display);
      return convertCurrency(amount, target, display, rates, { direction: "fromDisplay" });
    },
    format(amount, currency = display) {
      return formatCurrency(amount, currency);
    },
  };
}

export function convertPriceBandForCurrency(priceBand, converter, nativeCurrency) {
  const currency = normalizeCurrencyCode(nativeCurrency, converter?.displayCurrency);
  if (!converter || currency === converter.displayCurrency) return { ...priceBand };
  return {
    minPrice: converter.fromDisplay(priceBand?.minPrice, currency),
    maxPrice: converter.fromDisplay(priceBand?.maxPrice, currency),
  };
}

export function currencyForVintedDomain(domain) {
  const value = String(domain || "").trim().toLowerCase();
  if (value.endsWith(".co.uk")) return "GBP";
  if (value.endsWith(".pl")) return "PLN";
  if (value.endsWith(".cz")) return "CZK";
  if (value.endsWith(".se")) return "SEK";
  if (value.endsWith(".dk")) return "DKK";
  if (value.endsWith(".hu")) return "HUF";
  if (value.endsWith(".ro")) return "RON";
  return "EUR";
}

export function nativeCurrencyForPlatform(platform, { facebookCurrency = DEFAULT_DISPLAY_CURRENCY, vintedDomain = "" } = {}) {
  const key = String(platform || "").trim().toLowerCase();
  if (key === "mercari") return "USD";
  if (key === "wallapop") return "EUR";
  if (key === "vinted") return currencyForVintedDomain(vintedDomain);
  if (key === "facebook") return normalizeCurrencyCode(facebookCurrency);
  return DEFAULT_DISPLAY_CURRENCY;
}
