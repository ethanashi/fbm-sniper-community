export const DEFAULT_OPEN_MIN_PRICE = 0;
export const DEFAULT_OPEN_MAX_PRICE = 250000;

function normalizeOptionalPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveTargetReferencePrice(target) {
  return normalizeOptionalPrice(target?.maxPrice);
}

export function resolveTargetPriceBand(target, {
  defaultMin = DEFAULT_OPEN_MIN_PRICE,
  defaultMax = DEFAULT_OPEN_MAX_PRICE,
} = {}) {
  const minPrice = normalizeOptionalPrice(target?.minPrice) ?? defaultMin;
  const rawMaxPrice = normalizeOptionalPrice(target?.maxPrice) ?? defaultMax;
  const maxPrice = rawMaxPrice < minPrice ? minPrice : rawMaxPrice;
  return { minPrice, maxPrice };
}
