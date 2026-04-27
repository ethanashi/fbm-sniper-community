import { getPriceStats } from '../database.js';

/**
 * Utility to escape special characters for use in a Regular Expression.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Advanced Regex Filtering (The AI Replacement)
 */
export function matchesRegexFilter(text, title, target, globalFilters) {
  const content = `${title} ${text}`.toLowerCase();

  // Black List (Must Avoid)
  const blacklist = [...(target.mustAvoid || []), ...(globalFilters.globalMustAvoid || [])];
  for (const word of blacklist) {
    const escaped = escapeRegExp(word);
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(content)) {
      return { rejected: true, reason: `Blacklisted word: ${word}` };
    }
  }

  // White List (Priority Keywords) - Just flagging for now, can be used to boost priority
  const whitelist = [...(target.priorityKeywords || []), ...(globalFilters.globalPriorityKeywords || [])];
  let isPriority = false;
  for (const word of whitelist) {
    const escaped = escapeRegExp(word);
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(content)) {
      isPriority = true;
      break;
    }
  }

  return { rejected: false, isPriority };
}

/**
 * ROI and Net Profit Calculations
 */
export function calculateProfitability(purchasePrice, estimatedSellingPrice, shippingCosts = 0) {
  const netProfit = estimatedSellingPrice - purchasePrice - shippingCosts;
  const roi = purchasePrice > 0 ? (netProfit / purchasePrice) * 100 : 0;

  return { netProfit, roi };
}

/**
 * Z-Score Anomaly Detection
 */
export async function calculateZScore(platform, query, currentPrice) {
  const stats = await getPriceStats(platform, query);
  if (!stats) return null;

  const { mean, stdDev } = stats;
  if (stdDev === 0) return 0;

  const zScore = (currentPrice - mean) / stdDev;
  return zScore;
}

/**
 * Trigger Condition
 */
export function evaluateTriggers(profitability, filters, zScore = null) {
  const { netProfit, roi } = profitability;

  // Profit Trigger
  if (netProfit >= filters.minProfit) return { triggered: true, reason: `Profit $${netProfit.toFixed(2)} >= $${filters.minProfit}` };

  // ROI Trigger
  if (roi >= filters.minROI) return { triggered: true, reason: `ROI ${roi.toFixed(1)}% >= ${filters.minROI}%` };

  // Z-Score Trigger
  if (filters.zScoreEnabled && zScore !== null && zScore <= filters.zScoreThreshold) {
    return { triggered: true, reason: `Z-Score ${zScore.toFixed(2)} <= ${filters.zScoreThreshold}` };
  }

  return { triggered: false };
}
