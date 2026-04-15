function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(text) {
  return normalizeText(text).replace(/[^a-z0-9]/g, "");
}

function tokenize(text) {
  return normalizeText(text)
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

const ELECTRONICS_STOPWORDS = new Set([
  "apple",
  "samsung",
  "google",
  "phone",
  "smartphone",
  "cell",
  "mobile",
  "gb",
  "tb",
  "the",
  "with",
  "for",
  "and",
]);

function explicitType(target) {
  const type = normalizeText(target?.targetType || target?.category || "");
  if (type === "vehicle" || type === "electronics" || type === "general") return type;
  return "";
}

export function inferTargetType(target) {
  const explicit = explicitType(target);
  if (explicit) return explicit;

  const raw = normalizeText([
    target?.group,
    target?.label,
    target?.query,
    target?.make,
    target?.model,
    ...(target?.aliases || []),
  ].filter(Boolean).join(" "));

  if (/\biphone\b|\bipad\b|\bmacbook\b|\bairpods\b|\bplaystation\b|\bps[45]\b|\bxbox\b|\bnintendo\b|\bswitch\b|\bcamera\b|\blaptop\b|\bphone\b|\btablet\b|\bconsole\b/.test(raw)) {
    return "electronics";
  }

  const baselineMiles = Number(target?.baselineMiles || 0);
  const maxMileage = Number(target?.maxMileage || 0);
  if (
    /\bcar\b|\bcars\b|\bvehicle\b|\bvehicles\b|\bsuv\b|\bsedan\b|\btruck\b|\bcoupe\b|\bhatchback\b|\bvan\b|\bwagon\b|\bpickup\b/.test(raw) ||
    baselineMiles > 0 ||
    maxMileage > 0
  ) {
    return "vehicle";
  }

  return "general";
}

export function isVehicleTarget(target) {
  return inferTargetType(target) === "vehicle";
}

export function isElectronicsTarget(target) {
  return inferTargetType(target) === "electronics";
}

export function buildTargetTerms(target) {
  const terms = new Set();

  const push = (value) => {
    const normalized = normalizeText(value);
    if (normalized && normalized.length >= 3) terms.add(normalized);
  };

  push(target?.query);
  push(target?.label);
  push(target?.model);
  push(`${target?.make || ""} ${target?.model || ""}`.trim());

  for (const alias of target?.aliases || []) push(alias);

  return [...terms].sort((a, b) => b.length - a.length);
}

export function listingMatchesTarget(listing, target) {
  const text = normalizeText(`${listing?.title || ""}\n${listing?.description || ""}`);
  if (!text) return false;
  const compact = compactText(text);

  const terms = buildTargetTerms(target);
  if (!terms.length) return true;

  if (terms.some((term) => text.includes(term) || compact.includes(compactText(term)))) {
    return true;
  }

  const targetType = inferTargetType(target);

  if (targetType === "vehicle") {
    const make = normalizeText(target?.make);
    const model = normalizeText(target?.model);
    if (make && model) {
      return text.includes(make) && (text.includes(model) || compact.includes(compactText(model)));
    }
  }

  if (targetType === "electronics") {
    const tokens = [...new Set([
      ...tokenize(target?.model),
      ...tokenize(target?.query),
      ...tokenize(target?.label),
    ])].filter((token) => {
      if (ELECTRONICS_STOPWORDS.has(token)) return false;
      if (token.length >= 3) return true;
      return /\d/.test(token);
    });

    if (!tokens.length) return false;

    const matched = tokens.filter((token) => text.includes(token) || compact.includes(compactText(token))).length;
    const requiredMatches = tokens.length >= 4 ? 3 : tokens.length;
    return matched >= requiredMatches;
  }

  return false;
}

export function isSearchPlaceholderListing(listing) {
  const id = String(listing?.id || "");
  const title = String(listing?.title || "").trim();
  const price = Number(listing?.price);
  const url = String(listing?.url || "");

  if (!id) return true;
  if (id.includes("IN_MEMORY_MARKETPLACE_FEED_STORY_ENT")) return true;
  if (url.includes("IN_MEMORY_MARKETPLACE_FEED_STORY_ENT")) return true;
  if (!title && !Number.isFinite(price)) return true;
  if (!title && !listing?.description && (!listing?.photos || !listing.photos.length)) return true;

  return false;
}

export function formatTargetLine(target, profile = {}, listing = {}) {
  const parts = [];
  if (profile?.year) parts.push(profile.year);
  if (profile?.make) parts.push(profile.make);
  if (profile?.model) parts.push(profile.model);
  if (profile?.trim) parts.push(profile.trim);
  if (parts.length) return parts.join(" ");
  return target?.label || listing?.title || "Unknown listing";
}

export { normalizeText };
