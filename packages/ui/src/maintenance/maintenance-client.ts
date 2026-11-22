import { apiRequest } from "../shared/api-client";
import type { Platform } from "../shared/types";

export type ReporterStatus = "Submitted" | "In Progress" | "Resolved";
export type MaintenanceCase = {
  kind: "minimal" | "reporter" | "queue" | "assigned";
  caseId: string;
  reporterStatus: ReporterStatus;
  documentId?: string;
  publishedVersionId?: string;
  title?: string | null;
  description?: string;
  reporterExplanation?: string | null;
  reviewerRationale?: string | null;
  revision?: number;
  assigneeMembershipId?: string | null;
  canDecide?: boolean;
  needsReassignment?: boolean;
  canReassign?: boolean;
  unread?: boolean;
  publicationProof?: { state: "pending" | "applicable" | "rejected" | "upcoming"; outcome: "UPDATED" | "WITHDRAWN" | null; publishedVersionId: string | null };
  publicationLinkVersionId?: string | null;
  publicationLinkSubmissionId?: string | null;
};
export type MaintenanceHistory = {
  items: Array<{ sequence: number; eventType: string; message: string; occurredAt: string }>;
  nextCursor: string | null;
};

const base = (organizationId: string) => `/api/v1/organizations/${organizationId}/knowledge/maintenance`;

export function listMaintenanceCases(platform: Platform, organizationId: string, scope: "mine" | "queue"): Promise<MaintenanceCase[]> {
  return apiRequest(platform, `${base(organizationId)}/cases?scope=${scope}`);
}

export function createMaintenanceCase(platform: Platform, organizationId: string, input: {
  origin?: "READER_REPORT" | "REVIEWER_INTAKE";
  documentId: string; publishedVersionId: string; description: string;
  anchor?: { page?: number; passage?: string };
}, idempotencyKey: string): Promise<MaintenanceCase> {
  const { origin = "READER_REPORT", anchor, ...rest } = input;
  return apiRequest(platform, `${base(organizationId)}/cases`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ origin, ...rest, ...(anchor ? { anchor } : {}) }),
  });
}

export function getMaintenanceCase(platform: Platform, organizationId: string, caseId: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}`);
}

export function claimMaintenanceCase(platform: Platform, organizationId: string, caseId: string,
  expectedRevision: number, idempotencyKey: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/claim`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ expectedRevision }),
  });
}

export type EligibleReviewer = { membershipId: string; displayName: string };

export function listEligibleReviewers(platform: Platform, organizationId: string, caseId: string): Promise<EligibleReviewer[]> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/reviewers`);
}

export function reassignMaintenanceCase(platform: Platform, organizationId: string, caseId: string,
  input: { expectedRevision: number; membershipId: string; reason: string }, idempotencyKey: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/reassign`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}

export function postMaintenanceMessage(platform: Platform, organizationId: string, caseId: string,
  input: { expectedRevision: number; message: string }, idempotencyKey: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/messages`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}

export function linkMaintenancePublication(platform: Platform, organizationId: string, caseId: string,
  input: { expectedRevision: number; reason: string; publishedVersionId?: string; submissionId?: string }, idempotencyKey: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/publication-link`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}

export function confirmMaintenancePublication(platform: Platform, organizationId: string, caseId: string,
  input: { expectedRevision: number; reporterExplanation: string; reviewerRationale: string; evidencePublishedVersionId: string }, idempotencyKey: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/publication-confirmation`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}

export function resolveMaintenanceCase(platform: Platform, organizationId: string, caseId: string,
  input: { expectedRevision: number; reporterExplanation: string; reviewerRationale: string }, idempotencyKey: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/decisions`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(input),
  });
}

export function importOpenMaintenanceReports(platform: Platform, organizationId: string): Promise<{
  imported: Array<{ reportId: string; caseId: string }>; retained: string[]; held: string[];
}> {
  return apiRequest(platform, `${base(organizationId)}/imports`, { method: "POST" });
}

export type RelatedCase = { caseId: string; reporterStatus: ReporterStatus; title: string | null };

export function listMaintenanceLinks(platform: Platform, organizationId: string, caseId: string): Promise<{ items: RelatedCase[] }> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/links`);
}

export function linkMaintenanceCase(platform: Platform, organizationId: string, caseId: string,
  relatedCaseId: string, idempotencyKey: string): Promise<MaintenanceCase> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/links`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ relatedCaseId }),
  });
}

export function listMaintenanceHistory(platform: Platform, organizationId: string, caseId: string, cursor?: string): Promise<MaintenanceHistory> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/history${query}`);
}

export type MaintenanceVersion = { publishedVersionId: string; versionNo: number; publishedAt: string; current: boolean };
export type MaintenanceComparison = { unavailable: true } | {
  unavailable: false; fromVersionId: string; toVersionId: string;
  rows: Array<{ kind: "added" | "removed" | "context" | "collapsed"; text: string }>;
};

export function listMaintenanceVersions(platform: Platform, organizationId: string, caseId: string): Promise<{
  items: MaintenanceVersion[]; currentPublishedVersionId: string | null;
}> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/versions`);
}

export type MaintenanceOriginal = { unavailable: true; publishedVersionId: string } | { unavailable: false; publishedVersionId: string; text: string };

export function readMaintenanceOriginal(platform: Platform, organizationId: string, caseId: string, publishedVersionId: string): Promise<MaintenanceOriginal> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/versions/${publishedVersionId}`);
}

export type AnalysisRun = {
  runId: string;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  findings: Array<{ versionId: string; summary: string }>;
  attempt: number;
};

export function startMaintenanceAnalysis(platform: Platform, organizationId: string, caseId: string,
  versionIds: string[], idempotencyKey: string): Promise<AnalysisRun> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/analysis`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ versionIds }),
  });
}

export function readMaintenanceAnalysis(platform: Platform, organizationId: string, caseId: string): Promise<AnalysisRun> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/analysis`);
}

export function cancelMaintenanceAnalysis(platform: Platform, organizationId: string, caseId: string, idempotencyKey: string): Promise<AnalysisRun> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/analysis-cancellation`, {
    method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify({}),
  });
}

export function compareMaintenanceCase(platform: Platform, organizationId: string, caseId: string,
  fromPublishedVersionId: string, toPublishedVersionId: string): Promise<MaintenanceComparison> {
  return apiRequest(platform, `${base(organizationId)}/cases/${caseId}/compare`, {
    method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ fromPublishedVersionId, toPublishedVersionId }),
  });
}
