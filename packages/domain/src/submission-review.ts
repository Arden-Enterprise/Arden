export const submissionCheckCategories = [
  "CLARITY", "CONSISTENCY", "MISSING_CONTEXT", "SENSITIVE_CONTENT",
] as const;

export type SubmissionReviewPoint = {
  text: string;
  citation: { excerpt: string; page: number | null };
};

export type SubmissionReviewResult = {
  contractVersion: 1;
  requestId: string;
  snapshotVersionId: string;
  snapshotContentHash: string;
  summary: SubmissionReviewPoint[];
  checks: Array<SubmissionReviewPoint & { category: typeof submissionCheckCategories[number] }>;
};
