import { createHash } from "node:crypto";
import type { PublicationProof } from "./publication-proof.js";

export type { PublicationProof };

export type PublicationSubmission = {
  documentId: string;
  requestType: "CONTENT" | "READER_CHANGE" | "WITHDRAWAL" | "RENEWAL";
  status: string;
  producedVersionId: string | null;
  targetPublishedVersionId: string | null;
  withdrawn: boolean;
};

export type MaintenanceOrigin = "READER_REPORT" | "REVIEWER_INTAKE";
export type ReporterStatus = "Submitted" | "In Progress" | "Resolved";
export type CaseAudience = "PUBLIC" | "REVIEWER";
export type CaseEventType = "SUBMITTED" | "CLAIMED" | "REASSIGNED" | "RESOLVED" | "IMPORTED" | "MESSAGE";

export type IntakeInput = {
  origin: MaintenanceOrigin;
  documentId: string;
  publishedVersionId: string;
  description: string;
  anchor?: { page?: number; passage?: string };
};

export type ActorRecord = {
  userId: string;
  organizationId: string;
  membershipId: string;
};

export type AnchorRecord = {
  organizationId: string;
  documentId: string;
  publishedVersionId: string;
  contentHash: string;
  title: string;
  classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  departmentId: string;
  teamTag: string | null;
  projectTag: string | null;
  authorMembershipId: string;
};

export type CaseRecord = {
  caseId: string;
  organizationId: string;
  origin: MaintenanceOrigin;
  reporterMembershipId: string | null;
  documentId: string;
  publishedVersionId: string;
  contentHash: string;
  title: string;
  description: string;
  anchorPage: number | null;
  anchorPassage: string | null;
  routeDepartmentId: string;
  classification: AnchorRecord["classification"];
  teamTag: string | null;
  projectTag: string | null;
  authorMembershipId: string;
  assigneeMembershipId: string | null;
  reporterStatus: ReporterStatus;
  outcome: "NO_CHANGE_NEEDED" | "UPDATED" | "WITHDRAWN" | null;
  reporterExplanation: string | null;
  reviewerRationale: string | null;
  publicationLinkVersionId: string | null;
  publicationLinkSubmissionId: string | null;
  publicationLinkReason: string | null;
  revision: number;
  firstClaimedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type CaseEventRecord = {
  eventId: string;
  organizationId: string;
  caseId: string;
  sequence: number;
  actorMembershipId: string | null;
  eventType: CaseEventType;
  audience: CaseAudience;
  message: string;
  occurredAt: string;
};

export type NotificationRecord = {
  notificationId: string;
  organizationId: string;
  caseId: string;
  recipientMembershipId: string;
  logicalKey: string;
  message: string;
};

export type CaseProjection =
  | { kind: "minimal"; caseId: string; reporterStatus: ReporterStatus; unread: boolean }
  | { kind: "reporter"; caseId: string; documentId: string; publishedVersionId: string; title: string;
      description: string; reporterStatus: ReporterStatus; reporterExplanation: string | null; revision: number; unread: boolean }
  | { kind: "queue"; caseId: string; documentId?: string; reporterStatus: ReporterStatus; title: string | null; revision: number; unread: boolean;
      needsReassignment?: boolean }
  | { kind: "assigned"; caseId: string; documentId: string; publishedVersionId: string; title: string;
      description: string; reporterStatus: ReporterStatus; reporterExplanation: string | null;
      reviewerRationale: string | null; revision: number; assigneeMembershipId: string | null;
      canDecide: boolean; needsReassignment: boolean; canReassign: boolean; unread: boolean;
      publicationLinkVersionId: string | null;
      publicationLinkSubmissionId: string | null;
      publicationProof?: PublicationProof; analysisAvailable?: boolean; publicationReady?: boolean };

export type HistoryPage = {
  items: Array<{ sequence: number; eventType: CaseEventType; message: string; occurredAt: string }>;
  nextCursor: string | null;
};

export class MaintenanceError extends Error {
  constructor(readonly code: "DENIED" | "CONFLICT" | "STALE" | "INVALID" | "UNAVAILABLE") {
    super(code);
  }
}

export function commandHash(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export type LegacyReport = {
  reportId: string;
  documentId: string;
  publishedVersionId: string;
  reporterMembershipId: string;
  message: string;
  createdAt: string;
  status: "OPEN" | "CLOSED";
  verifiable: boolean;
  /** Routing facts of the original pin; it need not still be current. */
  anchor?: AnchorRecord | null;
  /** Full-precision paging position from the database. */
  cursor?: string;
};

export function legacyRequestKey(organizationId: string, membershipId: string, documentId: string,
  publishedVersionId: string, message: string): string {
  const bytes = Buffer.from(createHash("sha256").update([
    organizationId, membershipId, documentId, publishedVersionId, message.trim(),
  ].join("\u001f")).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function intakeHash(input: IntakeInput): string {
  return createHash("sha256").update(JSON.stringify([
    input.origin,
    input.documentId,
    input.publishedVersionId,
    input.description.trim(),
    input.anchor?.page ?? null,
    input.anchor?.passage?.trim() ?? null,
  ])).digest("hex");
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Lowercases UUIDs in identifier fields (keys ending in `Id` or `Ids`) so comparisons and hashes use
 * PostgreSQL's canonical form. Free text such as a description or rationale is kept exactly as typed.
 */
export function canonicalIds<T>(value: T): T {
  const canonical = (item: unknown): unknown => typeof item === "string" && uuidPattern.test(item) ? item.toLowerCase()
    : Array.isArray(item) ? item.map(canonical) : item;
  if (typeof value === "string") return canonical(value) as T;
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /Ids?$/.test(key) ? canonical(item) : item])) as T;
}

export function assertUuid(value: string): void {
  if (!uuidPattern.test(value)) throw new MaintenanceError("INVALID");
}
