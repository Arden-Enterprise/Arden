export const submissionCheckCategories = [
  "CLARITY", "CONSISTENCY", "MISSING_CONTEXT", "SENSITIVE_CONTENT",
] as const;

export type SubmissionReviewCitation = { excerpt: string; page: number | null };

export type SubmissionReviewPoint = {
  text: string;
  citation: SubmissionReviewCitation;
  additionalCitations?: SubmissionReviewCitation[];
};

export type SubmissionReviewResult = {
  contractVersion: 1 | 2;
  requestId: string;
  snapshotVersionId: string;
  snapshotContentHash: string;
  summary: SubmissionReviewPoint[];
  checks: Array<SubmissionReviewPoint & { category: typeof submissionCheckCategories[number] }>;
};
