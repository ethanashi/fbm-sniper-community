import { inferTargetType } from "./target-utils.js";

function roundToStep(value, step) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value / step) * step;
}

function summarizeSignals(signals) {
  return (signals || []).map((signal) => signal.keyword);
}

function normalizeGradePenalty(grade) {
  const value = String(grade || "").toUpperCase();
  if (value === "F") return 700;
  if (value === "D") return 450;
  if (value === "C") return 200;
  return 0;
}

function extractBatteryPercent(value) {
  const match = String(value || "").match(/(\d{2,3})/);
  return match ? Number(match[1]) : null;
}

function getYearRangeReason(profileYear, watch) {
  const year = Number(profileYear);
  const minYearRaw = Number(watch?.yearStart);
  const maxYearRaw = Number(watch?.yearEnd);
  const minYear = Number.isFinite(minYearRaw) && minYearRaw >= 1990 ? minYearRaw : null;
  const maxYear = Number.isFinite(maxYearRaw) && maxYearRaw >= 1990 ? maxYearRaw : null;

  if (!Number.isFinite(year)) return "";
  if (minYear !== null && year < minYear) {
    return `Year ${year} is older than the target range (${minYear}${maxYear !== null ? `-${maxYear}` : ""})`;
  }
  if (maxYear !== null && year > maxYear) {
    return `Year ${year} is newer than the target range (${minYear !== null ? `${minYear}-` : ""}${maxYear})`;
  }
  return "";
}

function shouldHardReject({ targetType, aiAnalysis, profile }) {
  const reasons = [];

  if (profile?.matchesCurrentTarget === false) {
    reasons.push("Listing text does not clearly match the active target");
  }
  if (aiAnalysis?.visual_match === false) {
    reasons.push("Photos do not appear to show the requested target");
  }
  if (aiAnalysis?.stock_photos_only) {
    reasons.push("Listing uses stock photos only");
  }
  if (targetType === "vehicle" && aiAnalysis?.possible_total_loss) {
    reasons.push("Photos suggest major collision or total-loss damage");
  }

  for (const reason of aiAnalysis?.kill_reasons || []) {
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  }

  return reasons;
}

function buildNotes({ aiAnalysis, summary, fallback }) {
  if (aiAnalysis?.notes) return aiAnalysis.notes;
  if (summary) return summary;
  return fallback;
}

function underwriteVehicleTarget({ listing, profile, watch, vinData, recalls, aiAnalysis }) {
  const listingPrice = Number(listing.price || 0);
  const year = profile.year || vinData?.year || watch.baselineYear;
  const mileage = profile.mileage?.miles ?? watch.baselineMiles;
  const yearDelta = year - watch.baselineYear;
  let estRetail = watch.retailBase + yearDelta * watch.yearlyAdjustment;

  const mileageDelta = mileage - watch.baselineMiles;
  if (mileageDelta > 0) {
    estRetail -= Math.ceil(mileageDelta / 10000) * watch.mileagePenaltyPer10k;
  } else if (mileageDelta < 0) {
    estRetail += Math.ceil(Math.abs(mileageDelta) / 10000) * watch.mileageBonusPer10k;
  }

  const trimText = `${profile.trim || ""} ${listing.title || ""}`.toLowerCase();
  if ((watch.trimBoostKeywords || []).some((keyword) => trimText.includes(String(keyword).toLowerCase()))) {
    estRetail += 600;
  }

  let titleAdjustment = 0;
  const reasons = [];
  const titleStatus = profile.titleStatus || "unknown";
  if (titleStatus === "salvage") {
    titleAdjustment -= 5000;
    reasons.push("Salvage title risk");
  } else if (titleStatus === "rebuilt") {
    titleAdjustment -= 2800;
    reasons.push("Rebuilt title risk");
  } else if (titleStatus === "missing") {
    titleAdjustment -= 3500;
    reasons.push("Missing title");
  } else if (titleStatus === "unknown") {
    titleAdjustment -= 600;
    reasons.push("Title status not stated");
  }
  estRetail += titleAdjustment;

  const reconFromSignals = (profile.issueSignals || []).reduce((sum, signal) => sum + signal.cost, 0);
  const visualPenalty = normalizeGradePenalty(aiAnalysis?.condition_grade);
  const visibleIssueReserve = (aiAnalysis?.visible_issues || []).length * 150;
  const recallReserve = recalls.length * 150;
  const reconReserve = watch.reconBase + reconFromSignals + recallReserve + visualPenalty + visibleIssueReserve;
  const feesReserve = watch.feesReserve;
  const targetMarginFloor = Number(watch.marginFloor || 0);

  if (mileage > watch.maxMileage) {
    reasons.push(`Mileage is above watchlist cap (${watch.maxMileage.toLocaleString()} mi)`);
  }

  const loweredText = String(profile.sourceText || "").toLowerCase();
  for (const keyword of watch.avoidKeywords || []) {
    if (loweredText.includes(String(keyword).toLowerCase())) {
      reasons.push(`Flagged keyword: ${keyword}`);
    }
  }

  const hardRejectReasons = shouldHardReject({ targetType: "vehicle", aiAnalysis, profile });
  const yearRangeReason = getYearRangeReason(year, watch);
  if (yearRangeReason) hardRejectReasons.push(yearRangeReason);
  reasons.push(...hardRejectReasons);

  const maxBuyRaw = estRetail - reconReserve - feesReserve;
  const maxBuy = roundToStep(maxBuyRaw, 50);
  const estimatedMargin = roundToStep(estRetail - listingPrice - reconReserve - feesReserve, 50);

  let riskScore = 20;
  riskScore += recalls.length * 6;
  riskScore += (profile.issueSignals || []).length * 8;
  if (titleStatus !== "clean") riskScore += 20;
  if (mileage > watch.maxMileage) riskScore += 15;
  if (hardRejectReasons.length) riskScore += 30;
  if (aiAnalysis?.condition_grade === "D") riskScore += 10;
  if (aiAnalysis?.condition_grade === "F") riskScore += 20;
  riskScore = Math.min(100, riskScore);

  let verdict = "pass";
  let confidence = "medium";
  if (!hardRejectReasons.length) {
    if (listingPrice <= maxBuy && riskScore <= 55) {
      verdict = "buy_now";
      confidence = riskScore <= 35 ? "high" : "medium";
    } else if (listingPrice <= maxBuy * 1.08 && riskScore <= 70) {
      verdict = "maybe";
      confidence = "medium";
      reasons.push("Close enough for negotiation if inspection goes well");
    } else {
      confidence = "low";
    }
  } else {
    confidence = "low";
  }

  if (targetMarginFloor > 0 && estimatedMargin < targetMarginFloor) {
    reasons.push(`Below target profit goal ($${targetMarginFloor.toLocaleString()})`);
  }

  const signalList = summarizeSignals(profile.issueSignals);
  const summaryParts = [
    `${year || "Unknown year"} ${watch.make} ${watch.model}`,
    `Est. retail $${estRetail.toLocaleString()}`,
    `Max buy $${maxBuy?.toLocaleString?.() ?? "?"}`,
    `Margin $${estimatedMargin?.toLocaleString?.() ?? "?"}`,
  ];
  if (signalList.length) summaryParts.push(`Issues: ${signalList.join(", ")}`);
  if (aiAnalysis?.visible_issues?.length) summaryParts.push(`Visual: ${aiAnalysis.visible_issues.slice(0, 3).join(", ")}`);
  if (recalls.length) summaryParts.push(`${recalls.length} open recall(s)`);

  const summary = summaryParts.join(" · ");
  return {
    verdict,
    confidence,
    maxBuy,
    estRetail,
    estimatedMargin,
    feesReserve,
    reconReserve,
    riskScore,
    recallCount: recalls.length,
    targetMarginFloor,
    reasons,
    summary,
    notes: buildNotes({
      aiAnalysis,
      summary,
      fallback: `${watch.label} looks ${verdict === "pass" ? "risky" : "promising"} based on the current pricing inputs.`,
    }),
  };
}

function underwriteNonVehicleTarget({ listing, profile, watch, aiAnalysis, targetType }) {
  const listingPrice = Number(listing.price || 0);
  const baselineYearRaw = Number(watch.baselineYear || watch.yearStart);
  const baselineYear = Number.isFinite(baselineYearRaw) && baselineYearRaw >= 1990 ? baselineYearRaw : null;
  const yearRaw = Number(profile.year);
  const year = Number.isFinite(yearRaw) && yearRaw >= 1990 ? yearRaw : baselineYear;
  let estRetail = Number(watch.retailBase || 0);
  if (Number.isFinite(year) && Number.isFinite(baselineYear) && Number.isFinite(Number(watch.yearlyAdjustment || 0))) {
    estRetail += (year - baselineYear) * Number(watch.yearlyAdjustment || 0);
  }

  const text = `${listing.title || ""} ${listing.description || ""}`.toLowerCase();
  if ((watch.trimBoostKeywords || []).some((keyword) => text.includes(String(keyword).toLowerCase()))) {
    estRetail += Math.max(25, Math.round(estRetail * 0.08));
  }

  const reasons = [];
  const hardRejectReasons = shouldHardReject({ targetType, aiAnalysis, profile });
  const yearRangeReason = getYearRangeReason(year, watch);
  if (yearRangeReason) hardRejectReasons.push(yearRangeReason);
  reasons.push(...hardRejectReasons);

  for (const keyword of watch.mustAvoid || watch.avoidKeywords || []) {
    if (text.includes(String(keyword).toLowerCase())) {
      reasons.push(`Flagged keyword: ${keyword}`);
    }
  }

  const batteryPercent = extractBatteryPercent(aiAnalysis?.battery_health_value || profile.batteryHealthValue);
  if (batteryPercent !== null && batteryPercent < 80) {
    reasons.push(`Battery health is low (${batteryPercent}%)`);
  }

  const screenCondition = String(aiAnalysis?.screen_condition || "").toLowerCase();
  if (screenCondition === "cracked") {
    reasons.push("Screen appears cracked");
  }

  const reconFromSignals = (profile.issueSignals || []).reduce((sum, signal) => sum + signal.cost, 0);
  const visualPenalty = normalizeGradePenalty(aiAnalysis?.condition_grade);
  const visibleIssueReserve = (aiAnalysis?.visible_issues || []).length * Math.max(20, Math.round((watch.reconBase || 50) * 0.35));
  const reconReserve = Number(watch.reconBase || 0) + reconFromSignals + visualPenalty + visibleIssueReserve;
  const feesReserve = Number(watch.feesReserve || 0);
  const marginFloor = Number(watch.marginFloor || 0);

  const step = estRetail >= 1000 ? 25 : 10;
  const maxBuyRaw = estRetail - reconReserve - feesReserve;
  const maxBuy = roundToStep(maxBuyRaw, step);
  const estimatedMargin = roundToStep(estRetail - listingPrice - reconReserve - feesReserve, step);

  const unrealisticPriceCeiling = estRetail > 0
    ? Math.round(estRetail * (targetType === "electronics" ? 1.35 : 1.5))
    : null;
  if (Number.isFinite(unrealisticPriceCeiling) && listingPrice > unrealisticPriceCeiling) {
    hardRejectReasons.push(`Listing price is far above the expected resale band for ${watch.label || "this target"}`);
    reasons.push(`Listing price is far above the expected resale band for ${watch.label || "this target"}`);
  }

  let riskScore = 18;
  riskScore += (profile.issueSignals || []).length * 10;
  riskScore += hardRejectReasons.length * 15;
  if (aiAnalysis?.condition_grade === "D") riskScore += 14;
  if (aiAnalysis?.condition_grade === "F") riskScore += 24;
  if (batteryPercent !== null && batteryPercent < 85) riskScore += 8;
  riskScore = Math.min(100, riskScore);

  let verdict = "pass";
  let confidence = "medium";
  if (!hardRejectReasons.length) {
    if (listingPrice <= maxBuy && riskScore <= 50) {
      verdict = "buy_now";
      confidence = riskScore <= 30 ? "high" : "medium";
    } else if (listingPrice <= maxBuy * 1.08 && riskScore <= 68) {
      verdict = "maybe";
      confidence = "medium";
      reasons.push("Close enough for a lowball or manual review");
    } else {
      confidence = "low";
    }
  } else {
    confidence = "low";
  }

  if (marginFloor > 0 && estimatedMargin < marginFloor) {
    reasons.push(`Below target profit goal ($${marginFloor.toLocaleString()})`);
  }

  const summaryParts = [
    watch.label || watch.model || listing.title || "Custom target",
    `Est. retail $${estRetail.toLocaleString()}`,
    `Max buy $${maxBuy?.toLocaleString?.() ?? "?"}`,
    `Margin $${estimatedMargin?.toLocaleString?.() ?? "?"}`,
  ];
  if (profile.storageGb) summaryParts.push(`${profile.storageGb}GB`);
  if (batteryPercent !== null) summaryParts.push(`Battery ${batteryPercent}%`);
  if (aiAnalysis?.visible_issues?.length) summaryParts.push(`Visual: ${aiAnalysis.visible_issues.slice(0, 3).join(", ")}`);

  const summary = summaryParts.join(" · ");
  return {
    verdict,
    confidence,
    maxBuy,
    estRetail,
    estimatedMargin,
    feesReserve,
    reconReserve,
    riskScore,
    recallCount: 0,
    targetMarginFloor: marginFloor,
    reasons,
    summary,
    notes: buildNotes({
      aiAnalysis,
      summary,
      fallback: `${watch.label || "This target"} needs manual review because there is not enough detail yet.`,
    }),
  };
}

export function underwriteVehicle({ listing, profile, watch, vinData, recalls, aiAnalysis }) {
  if (!watch) {
    return {
      verdict: "pass",
      confidence: "low",
      maxBuy: null,
      estRetail: null,
      estimatedMargin: null,
      feesReserve: null,
      reconReserve: null,
      riskScore: 90,
      recallCount: Array.isArray(recalls) ? recalls.length : 0,
      targetMarginFloor: Number(watch?.marginFloor || 0),
      reasons: ["Listing does not match the current target."],
      summary: "Outside the current target definition.",
      notes: aiAnalysis?.notes || "Outside the current target definition.",
    };
  }

  const targetType = inferTargetType(watch);
  if (targetType === "vehicle") {
    return underwriteVehicleTarget({ listing, profile, watch, vinData, recalls: recalls || [], aiAnalysis });
  }

  return underwriteNonVehicleTarget({ listing, profile, watch, aiAnalysis, targetType });
}
