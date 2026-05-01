/**
 * Programmatic scorer — replaces AI verdict with price-band rules.
 *
 * Grade reflects price positioning, not physical condition (no vision available
 * in the community edition).
 *
 *   A  ≤ 80 % of maxBuy — strong deal
 *   B  81–90 %           — good deal
 *   C  91–100 %          — fair deal
 *   D  101–130 %         — lowball target
 *   F  > 130 % or junk   — skip
 */

const JUNK_RE = [
  /\bfunda\b/, /\bcarcasa\b/, /\bcargador\b/, /\bcable\b/,
  /\bprotector\b/, /\bcrystal\b/, /\bscreen[\s-]?guard\b/, /\bcase\b/,
  /\baccessori/, /\bcover\b/, /\bfilm\b/, /\btempered\b/,
  /\bpiezas?\b/, /\breparar\b/, /\baveri/, /\bno\s+funciona\b/, /\bpara\s+piezas\b/,
  /\bicloud[\s-]?lock/i, /\bactivation[\s-]?lock/i, /\brepuestos?\b/, /\bbloqueo\b/,
];

const LOWBALL_MAX_RATIO = 1.8;

/**
 * @param {{ title?: string, description?: string, price: number, maxBuy: number|null, screenJunk?: boolean }} opts
 * @returns {{ go: boolean, grade: string, score: number, reasons: string[] }}
 */
function scoreListing({ title = "", description = "", price, maxBuy, screenJunk = true }) {
  const text = `${title} ${description}`.toLowerCase();
  const reasons = [];

  if (screenJunk) {
    for (const re of JUNK_RE) {
      if (re.test(text)) {
        return { go: false, grade: "F", score: 0, reasons: [`junk: ${re.source}`] };
      }
    }
  }

  if (!price || price <= 0) {
    return { go: false, grade: "F", score: 0, reasons: ["missing price"] };
  }

  if (maxBuy === null || maxBuy === undefined) {
    return { go: true, grade: "?", score: 50, reasons: ["no reference price — review manually"] };
  }

  const ratio = price / maxBuy;

  if (ratio > LOWBALL_MAX_RATIO) {
    return { go: false, grade: "F", score: 0, reasons: [`€${price} > ${LOWBALL_MAX_RATIO}× maxBuy €${maxBuy}`] };
  }

  let grade, score;
  if (ratio <= 0.80)      { grade = "A"; score = 95; }
  else if (ratio <= 0.90) { grade = "B"; score = 80; }
  else if (ratio <= 1.00) { grade = "C"; score = 65; }
  else if (ratio <= 1.30) { grade = "D"; score = 40; }
  else                    { grade = "D"; score = 25; }

  const savings = maxBuy - price;
  if (savings > 0) reasons.push(`saves €${savings} vs max-buy €${maxBuy}`);
  else reasons.push(`lowball: list €${price}, offer €${maxBuy}`);

  return { go: true, grade, score, reasons };
}

export function scoreElectronicsListing(opts) {
  return scoreListing({ ...opts, screenJunk: true });
}

export function scoreGenericListing(opts) {
  return scoreListing({ ...opts, screenJunk: false });
}
