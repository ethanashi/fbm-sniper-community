import { targetAppliesToPlatform } from "./workspace.js";

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
}

export function getActivePlatformTargets(watchlist, platform, {
  product = null,
  includeDisabled = false,
} = {}) {
  const wantedProduct = String(product || "").trim().toLowerCase();
  return (Array.isArray(watchlist) ? watchlist : []).filter((target) => {
    if (!target || typeof target !== "object") return false;
    if (!includeDisabled && target.enabled === false) return false;
    if (!targetAppliesToPlatform(target, platform)) return false;
    if (wantedProduct && String(target.product || "").trim().toLowerCase() !== wantedProduct) return false;
    return true;
  });
}

export function getTargetMatchTerms(target) {
  const rawTerms = uniqueStrings([
    target?.label,
    target?.query,
    ...(Array.isArray(target?.aliases) ? target.aliases : []),
    ...(Array.isArray(target?.mustInclude) ? target.mustInclude : []),
  ]);
  return rawTerms
    .map((term) => normalizeText(term))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

export function targetMatchesText(target, text) {
  const haystack = normalizeText(text);
  if (!haystack) return false;

  const mustAvoid = uniqueStrings(target?.mustAvoid).map((term) => normalizeText(term)).filter(Boolean);
  if (mustAvoid.some((term) => haystack.includes(term))) return false;

  const mustInclude = uniqueStrings(target?.mustInclude).map((term) => normalizeText(term)).filter(Boolean);
  if (mustInclude.length && !mustInclude.every((term) => haystack.includes(term))) return false;

  const terms = getTargetMatchTerms(target);
  return terms.some((term) => haystack.includes(term));
}

export function inferTargetFromText(watchlist, platform, text, {
  includeDisabled = true,
  product = null,
} = {}) {
  const targets = getActivePlatformTargets(watchlist, platform, { product, includeDisabled });
  const haystack = normalizeText(text);
  if (!haystack) return null;

  let best = null;
  let bestScore = -1;

  for (const target of targets) {
    if (!targetMatchesText(target, haystack)) continue;
    const terms = getTargetMatchTerms(target);
    let score = 0;
    for (const term of terms) {
      if (!haystack.includes(term)) continue;
      score += Math.max(term.length, 1);
    }
    if ((target.mustInclude || []).length) score += 10;
    if (score > bestScore) { best = target; bestScore = score; }
  }

  return best;
}

export function summarizeTarget(target) {
  if (!target || typeof target !== "object") return null;
  return {
    id: String(target.id || "").trim(),
    label: String(target.label || target.query || "").trim(),
    group: String(target.group || "General").trim() || "General",
    product: String(target.product || "").trim().toLowerCase(),
    targetType: String(target.targetType || "electronics").trim(),
    platforms: Array.isArray(target.platforms) ? [...target.platforms] : [],
    query: String(target.query || "").trim(),
    aliases: Array.isArray(target.aliases) ? [...target.aliases] : [],
    mustInclude: Array.isArray(target.mustInclude) ? [...target.mustInclude] : [],
    mustAvoid: Array.isArray(target.mustAvoid) ? [...target.mustAvoid] : [],
    radiusKM: normalizeOptionalNumber(target.radiusKM),
    minPrice: normalizeOptionalNumber(target.minPrice),
    maxPrice: normalizeOptionalNumber(target.maxPrice),
    allowShipping: typeof target.allowShipping === "boolean" ? target.allowShipping : true,
    platformOverrides: target.platformOverrides && typeof target.platformOverrides === "object"
      ? { ...target.platformOverrides }
      : {},
  };
}
