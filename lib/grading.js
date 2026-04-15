export const GRADING_NOTE = "Rules-only grading — photos flagged for manual review";

export function gradeListingPhotos(_listing) {
  return {
    grade: "ungraded",
    confidence: 0,
    notes: GRADING_NOTE,
    needsManualReview: true,
  };
}
