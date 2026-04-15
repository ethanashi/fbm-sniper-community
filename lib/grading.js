export const UPGRADE_NOTE = "Upgrade to Pro for AI-powered photo grading";

export function gradeListingPhotos(_listing) {
  return {
    grade: "ungraded",
    confidence: 0,
    notes: UPGRADE_NOTE,
    needsManualReview: true,
  };
}
