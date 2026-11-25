import type { Pool, PoolClient, QueryResult } from "pg";
import { metadataSubmissionErrors, validKnowledgeMetadata, type KnowledgeMetadata } from "@arden/domain";
import { PgKnowledgeCatalogStore, type KnowledgeCatalogStore } from "../knowledge/catalog-store.js";
import { PgConversationStore, type AnswerFeedback, type ConversationStore } from "../answers/conversation-store.js";
import { PgReaderSourceStore, type ReaderSourceStore } from "../reader-ai/source-store.js";
import { PgAudienceGroupStore, type AudienceGroupStore } from "../audiences/store.js";
import { departmentAudienceName } from "./department-audience-name.js";
import { PgSystemAdministrationStore, type SystemAdministrationStore } from "../system-administration/store.js";
import { PgNotificationStore, type NotificationStore } from "../notifications/store.js";
import { PgMaintenanceStore } from "../maintenance/case-store.js";
import { PgPrivateOrganizationStore, isActiveCollection, lockTree, type PrivateOrganizationStore,
  type PrivateTrashRetentionStore } from "../private-notes/organization-store.js";
import type { MaintenancePort } from "../maintenance/case-service.js";
import { createHash, randomUUID } from "node:crypto";
import { canCreateSharedDraft, canRespondToSubmission, canSubmitSnapshot, resolveResponsibleDepartment, type KnowledgeClassification } from "../knowledge/policy.js";
import { listAssignedReviews, type AssignedReview } from "../knowledge/review-queue.js";
import { planReviewDecision, type ReviewAction, type ReviewDecisionPlan } from "../knowledge/review-decision.js";
import { maxSelectedReaders, validateSelection, type ReaderActor, type ReaderMode, type ReaderSelection,
  type SelectionFacts, type TargetReadersField, type TargetReadersInput } from "../target-readers/policy.js";
import { sameReaders, type ApprovedReadersField } from "../target-readers/narrowing.js";

export type MembershipStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "LEFT";
export type MembershipSummary = {
  organizationId: string;
  organizationName: string;
  status: MembershipStatus;
  departmentId?: string | null;
  departmentName?: string | null;
  roleCodes: string[];
  canUsePrivateWorkspace: boolean;
};
export type ActiveMembership = { membershipId: string; organizationId: string; userId: string };

export type PrivateDraft = {
  id: string;
  organizationId: string;
  title: string;
  versionId: string;
  sourceUri: string;
  mimeType: string;
  contentHash: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  collectionId: string | null;
  favoritedAt: Date | null;
  /** Owner-chosen order inside the collection or root (spec F03-ARR); null sorts first. */
  position: number | null;
  /** Decision 0034: text extracted from a PDF item, when it has any; always null for text notes. */
  text?: StoredTextFields | null;
};

/** Decision 0029 note summary; trashed, archived and purged notes are never listed. */
export type DraftListItem = {
  id: string;
  organizationId: string;
  title: string;
  currentVersion: { id: string; version: number; mimeType: string; contentHash: string };
  createdAt: Date;
  updatedAt: Date;
  collectionId: string | null;
  favoritedAt: Date | null;
  position: number | null;
  /** Set while archived (spec F03-ARR); only archive responses carry a non-null value. */
  archivedAt: Date | null;
};
export type DraftWrite = { title: string; body: string; collectionId?: string | null };
/**
 * Decision 0031: `replacedSourceUris` are the content objects the save made unreachable (the open version was
 * overwritten and no other version uses it); the caller erases it after commit.
 */
export type DraftUpdateResult = { kind: "not-found" } | { kind: "conflict"; currentVersion: number }
  | { kind: "wrong-kind" }
  | { kind: "updated"; draft: PrivateDraft; replacedSourceUris: string[] };
export type DraftPatch = { title?: string; body?: string };
export type PrivateContributionSource = {
  versionId: string;
  organizationId: string;
  ownerMembershipId: string;
  title: string;
  sourceUri: string;
  mimeType: string;
  contentHash: string;
};
export type SharedKnowledgeDraft = {
  management?: (KnowledgeMetadata & { schemaVersion?: number }) | null;
  hasPublishedVersion?: boolean;
  id: string;
  organizationId: string;
  title: string;
  classification: KnowledgeClassification;
  sourcePrivateVersionId: string | null;
  responsibleDepartmentId: string | null;
  targetScopeType: "ORGANIZATION" | "DEPARTMENT" | null;
  teamTag: string | null;
  projectTag: string | null;
  audienceRoleIds: string[];
  /** Target Readers saved on the draft (T1.4); null until the author chooses them. */
  targetReaders: ReaderSelection | null;
  versionId: string;
  sourceUri: string;
  mimeType: string;
  contentHash: string;
  currentVersion: number;
  hasPendingSubmission: boolean;
  createdAt: Date;
  updatedAt: Date;
};
export type CreateSharedDraftResult =
  | { kind: "created"; draft: SharedKnowledgeDraft }
  | { kind: "replayed"; draft: SharedKnowledgeDraft }
  | { kind: "unavailable" }
  | { kind: "idempotency-conflict" };
export type SharedDraftPatch = {
  management?: KnowledgeMetadata;
  title?: string;
  body?: string;
  classification?: KnowledgeClassification;
  responsibleDepartmentId?: string | null;
  targetScopeType?: "ORGANIZATION" | "DEPARTMENT" | null;
  teamTag?: string | null;
  projectTag?: string | null;
  audienceRoleIds?: string[];
  /** Absent keeps the saved readers; present must pass TargetReaderPolicy.validateSelection. */
  targetReaders?: TargetReadersInput;
};
export type UpdateSharedDraftResult =
  | { kind: "not-found" }
  | { kind: "conflict"; currentVersion: number }
  | { kind: "invalid-metadata" }
  | { kind: "invalid-target-readers"; field: TargetReadersField; reason: string }
  | { kind: "updated"; draft: SharedKnowledgeDraft };
export type SharedKnowledgeSubmission = {
  management?: KnowledgeMetadata | null;
  id: string;
  draftId: string;
  snapshotVersionId: string;
  title: string;
  classification: KnowledgeClassification;
  responsibleDepartmentId: string;
  targetScopeType: "ORGANIZATION" | "DEPARTMENT";
  targetDepartmentId: string | null;
  audienceRoleIds: string[];
  /** The draft's Target Readers frozen at submit (proposed_selection_id). */
  proposedTargetReaders: ReaderSelection | null;
  /** The readers the reviewer approved (approved_selection_id); null until approved, and for legacy submissions. */
  approvedTargetReaders: ReaderSelection | null;
  contentHash: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  publicationState: "NONE" | "PREPARING" | "ACTIVE" | "FAILED" | "SUPERSEDED" | "WITHDRAWN";
  submittedAt: Date;
  publishedVersionId: string | null;
  decisionComment: string | null;
  /** T6.1: CONTENT for a new version; READER_CHANGE or WITHDRAWAL for a request about the current publication. */
  requestType: PublicationRequestType;
  requestReason: string | null;
  /** T6.3 retry: why preparation failed, only while `publicationState` is FAILED. TEMPORARY can be retried. */
  publicationFailure: PublicationFailureKind | null;
  /** New direct withdrawals are Admin-only (0024); historical reviewer provenance remains readable. */
  withdrawal: { by: "REVIEWER" | "ORGANIZATION_ADMIN"; reason: string; at: Date } | null;
  /** RENEWAL only (0032): the requested Valid until (null = no expiry) and whether it was asked on the author's behalf. */
  renewal?: { expirationDate: string | null; onBehalfOfAuthor: boolean } | null;
};
export type PublicationFailureKind = "TEMPORARY" | "CONTENT" | "SYSTEM";
/** Decision 0032: a reviewed RENEWAL changes only the Valid until of the current publication. */
export type PublicationRenewalInput = { expirationDate: string | null; reason: string; idempotencyKey: string };
export type RequestPublicationRenewalResult =
  | { kind: "requested"; submission: SharedKnowledgeSubmission }
  | { kind: "replayed"; submission: SharedKnowledgeSubmission }
  | { kind: "not-found" } | { kind: "not-renewable" } | { kind: "not-yet" } | { kind: "pending" }
  | { kind: "invalid-date" } | { kind: "invalid-reason" };
export type PublicationRenewalState = {
  documentId: string; publishedVersionId: string; title: string; responsibleDepartmentId: string | null;
  /** Effective Valid until (YYYY-MM-DD) or null for no expiry. */
  expirationDate: string | null; renewalPending: boolean; authorActive: boolean; isAuthor: boolean; canRenew: boolean;
  /** The active author's display name (null when inactive); shown to people renewing on their behalf. */
  authorName: string | null;
  /** The renewal waiting for review, if any. `canDecide`: the caller is the author of an on-behalf request (0032). */
  pending: { submissionId: string; snapshotVersionId: string; contentHash: string; onBehalfOfAuthor: boolean;
    requestedByName: string | null; reason: string; expirationDate: string | null; requestedAt: Date;
    authorWindowUntil: Date | null; canDecide: boolean } | null;
};
export type PublicationRequestType = "CONTENT" | "READER_CHANGE" | "WITHDRAWAL" | "RENEWAL";
export type PublicationChangeInput = {
  type: "READER_CHANGE" | "WITHDRAWAL";
  reason: string;
  /** Required for READER_CHANGE, refused for WITHDRAWAL. */
  targetReaders?: TargetReadersInput;
  idempotencyKey: string;
};
export type RequestPublicationChangeResult =
  | { kind: "requested"; submission: SharedKnowledgeSubmission }
  | { kind: "replayed"; submission: SharedKnowledgeSubmission }
  | { kind: "not-found" }
  | { kind: "not-published" }
  | { kind: "conflict" }
  | { kind: "invalid-request"; reason: string }
  | { kind: "invalid-target-readers"; field: TargetReadersField; reason: string };
export type SubmitKnowledgeDraftResult =
  | { kind: "submitted"; submission: SharedKnowledgeSubmission }
  | { kind: "replayed"; submission: SharedKnowledgeSubmission }
  | { kind: "not-found" }
  | { kind: "conflict" }
  | { kind: "not-ready" };
export type GovernanceReaderMode = "ORGANIZATION" | "DEPARTMENT" | "SELECTED_MEMBERS";
/** Decision 0023: the Organization Admin catalog. Metadata only: no reader count, names or content. */
export type GovernancePublication = {
  documentId: string; publishedVersionId: string; title: string; responsibleDepartmentId: string | null;
  readerMode: GovernanceReaderMode; readerDepartmentId: string | null; versionLabel: string | null;
  snapshotVersionNo: number | null; publishedAt: Date; openReports: number;
};
/** A live audited inspection, or the responsible reviewer's view: the current version's content source. */
export type GovernanceDocumentView = {
  documentId: string; publishedVersionId: string; title: string; sourceUri: string; contentHash: string;
  mimeType: string; responsibleDepartmentId: string | null; readerMode: GovernanceReaderMode;
  readerDepartmentId: string | null;
};
export type GovernanceInspectionView = GovernanceDocumentView & { readerNames: string[]; reason: string; expiresAt: Date };
export type PublicationReport = {
  id: string; documentId: string; publishedVersionId: string; title: string; message: string;
  reporterName: string; createdAt: Date; stillCurrent: boolean; canView: boolean;
  resolution?: "DISMISSED" | "WITHDRAWN" | null;
};
export type OpenGovernanceInspectionResult =
  | { kind: "opened"; inspectionId: string } | { kind: "not-found" } | { kind: "not-admin" } | { kind: "invalid-reason" };
export type DirectWithdrawalResult = { kind: "withdrawn" } | { kind: "not-found" } | { kind: "preparing" } | { kind: "invalid-reason" };
export type ReportPublicationResult = { kind: "reported"; reportId: string } | { kind: "not-found" } | { kind: "duplicate" };
export type RetryKnowledgePublicationResult =
  | { kind: "preparing"; submission: SharedKnowledgeSubmission }
  | { kind: "not-found" }
  | { kind: "not-failed" }
  | { kind: "not-retryable" }
  | { kind: "superseded" };
export type WithdrawKnowledgeSubmissionResult =
  | { kind: "withdrawn"; submission: SharedKnowledgeSubmission }
  | { kind: "replayed"; submission: SharedKnowledgeSubmission }
  | { kind: "not-found" }
  | { kind: "conflict" };
export type ReviewerGrantInput = {
  reviewerMembershipId: string;
  scope: "DEPARTMENT" | "ORGANIZATION";
  departmentId: string | null;
  classifications: KnowledgeClassification[];
  level?: "STANDARD" | "SPECIALIST" | "SENIOR";
  teamTag: string | null;
  projectTag: string | null;
  validUntil: Date | null;
};
export type KnowledgeDraftVersion = {
  id: string;
  version: number;
  sourceUri: string;
  mimeType: string;
  contentHash: string;
  createdAt: Date;
};
export type ReviewerGrantRecord = Omit<ReviewerGrantInput, "level"> & {
  level: "STANDARD" | "SPECIALIST" | "SENIOR";
  id: string;
  status: "ACTIVE" | "INACTIVE";
  validFrom: Date;
};
export class ReviewerGrantConflictError extends Error {
  constructor() { super("Reviewer permission already assigned for this scope and tags."); }
}
/** Proposed readers resolved for the reviewer's narrowing UI (T2.1/T2.2). */
export type ProposedReadersDetail = {
  mode: ReaderMode;
  department: { id: string; name: string } | null;
  members: Array<{ membershipId: string; displayName: string | null }>;
};
export type DecidedReview = {
  submissionId: string;
  title: string;
  departmentId: string;
  classification: KnowledgeClassification;
  versionNo: number;
  decision: "APPROVED" | "REJECTED";
  decidedAt: Date;
  submittedAt: Date;
  publicationState: SharedKnowledgeSubmission["publicationState"];
  authorName: string | null;
};
export type ReviewDetail = {
  submission: SharedKnowledgeSubmission;
  sourceUri: string;
  mimeType: string;
  submittedByMembershipId: string;
  teamTag: string | null;
  projectTag: string | null;
  /** null for a legacy audience submission. */
  proposedReaders: ProposedReadersDetail | null;
};
export type DecideReviewResult =
  | { kind: "decided"; submission: SharedKnowledgeSubmission }
  | { kind: "replayed"; submission: SharedKnowledgeSubmission }
  | { kind: "denied"; reason: Extract<ReviewDecisionPlan, { kind: "DENIED" }>["reason"];
      field?: ApprovedReadersField; message?: string }
  | { kind: "not-found" }
  | { kind: "conflict" };
export type PublishedKnowledge = {
  management?: KnowledgeMetadata | null;
  id: string;
  draftId: string;
  title: string;
  classification: KnowledgeClassification;
  responsibleDepartmentId: string;
  responsibleDepartmentName: string | null;
  contentHash: string;
  sourceUri: string;
  audienceRoleIds: string[];
  /** Approved Target Readers; null keeps the legacy audience behaviour. */
  targetReaders: ReaderSelection | null;
  publishedAt: Date;
  validFrom: Date;
  validUntil: Date | null;
  /** Decision 0032: past its effective Valid until (inclusive through that UTC day). Hidden from readers.
   * The database projection always sets it; only hand-built fixtures omit it. */
  expired?: boolean;
  /** Home AUTHOR column: the active author's display name, when listed; never an email or reviewer. */
  authorName?: string | null;
};
export type AuthorizedAiSource = {
  management?: KnowledgeMetadata | null;
  chunks: unknown;
  generationId: string;
  snapshotVersionId: string;
  snapshotContentHash: string;
  publishedVersionId: string;
  draftId: string;
  title: string;
  versionNo: number;
  classification: KnowledgeClassification;
  targetScopeType: "ORGANIZATION" | "DEPARTMENT";
  /** Approved Target Readers; null keeps the legacy audience behaviour. */
  targetReaders: ReaderSelection | null;
};
type ReaderSelectionColumns = {
  readers_selection_id: string | null;
  readers_mode: ReaderMode | null;
  readers_department_id: string | null;
  readers_member_ids: string[] | null;
};
/**
 * Selects one reader selection as readers_* columns. `selectionId` is an SQL expression.
 * The member list keeps the author's order.
 */
function readerSelectionColumns(selectionId: string, prefix = "readers"): string {
  return `${selectionId} AS ${prefix}_selection_id,
         (SELECT rs.reader_mode FROM reader_selection rs WHERE rs.selection_id = ${selectionId}) AS ${prefix}_mode,
         (SELECT rs.department_id FROM reader_selection rs WHERE rs.selection_id = ${selectionId}) AS ${prefix}_department_id,
         ARRAY(SELECT sr.membership_id::text FROM selected_reader sr
                WHERE sr.selection_id = ${selectionId} ORDER BY sr.ordinal) AS ${prefix}_member_ids`;
}
function toReaderSelection(selectionId: string | null, mode: ReaderMode | null, departmentId: string | null,
  memberIds: string[] | null): ReaderSelection | null {
  if (selectionId === null) return null;
  // A referenced selection that cannot be resolved fails closed: nobody is a reader.
  if (mode === null) return { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] };
  return { mode, departmentId, memberIds: memberIds ?? [] };
}
function mapReaderSelection(row: ReaderSelectionColumns): ReaderSelection | null {
  return toReaderSelection(row.readers_selection_id, row.readers_mode, row.readers_department_id, row.readers_member_ids);
}
type ApprovedReaderColumns = {
  approved_selection_id: string | null;
  approved_mode: ReaderMode | null;
  approved_department_id: string | null;
  approved_member_ids: string[] | null;
};
/** Audit summary: mode, department and member count, never member identities. */
function readersAuditSummary(readers: ReaderSelection) {
  return { mode: readers.mode, departmentId: readers.departmentId, memberCount: readers.memberIds.length };
}
type SharedDraftRow = ReaderSelectionColumns & {
  management: KnowledgeMetadata | null;
  has_published_version: boolean;
  shared_draft_id: string;
  title: string;
  classification: KnowledgeClassification;
  source_private_version_id: string | null;
  author_membership_id: string;
  status: "ACTIVE" | "ARCHIVED";
  responsible_department_id: string | null;
  target_scope_type: "ORGANIZATION" | "DEPARTMENT" | null;
  team_tag: string | null;
  project_tag: string | null;
  create_request_hash: string;
  shared_draft_version_id: string;
  content_uri: string;
  mime_type: string;
  content_hash: string;
  current_version_no: number;
  has_pending_submission: boolean;
  created_at: Date;
  updated_at: Date;
  audience_role_ids: string[];
  draft_selection_revision: number | null;
};
const sharedDraftSelect = `
  SELECT d.shared_draft_id, d.title, d.classification, d.source_private_version_id,
         d.management,
         EXISTS (SELECT 1 FROM shared_submission prior WHERE prior.shared_draft_id = d.shared_draft_id
           AND prior.publication_state IN ('ACTIVE', 'SUPERSEDED')) AS has_published_version,
         d.author_membership_id, d.status,
         d.responsible_department_id, d.target_scope_type, d.team_tag, d.project_tag,
         d.create_request_hash, d.current_version_no, d.created_at, d.updated_at,
         EXISTS (SELECT 1 FROM shared_submission pending
                 WHERE pending.shared_draft_id = d.shared_draft_id
                   AND pending.status = 'PENDING_REVIEW') AS has_pending_submission,
         v.shared_draft_version_id, v.content_uri, v.mime_type, v.content_hash,
         ARRAY(SELECT a.role_id::text FROM shared_draft_audience a
               WHERE a.shared_draft_id = d.shared_draft_id ORDER BY a.role_id) AS audience_role_ids,
         (SELECT rs.revision FROM reader_selection rs
           WHERE rs.selection_id = d.draft_selection_id) AS draft_selection_revision,
         ${readerSelectionColumns("d.draft_selection_id")}
    FROM shared_draft d
    JOIN shared_draft_version v ON v.shared_draft_id = d.shared_draft_id
                               AND v.version_no = d.current_version_no`;

function mapSharedDraft(row: SharedDraftRow, organizationId: string): SharedKnowledgeDraft {
  return {
    management: currentManagement(row.management), hasPublishedVersion: row.has_published_version,
    id: row.shared_draft_id,
    organizationId,
    title: row.title,
    classification: row.classification,
    sourcePrivateVersionId: row.source_private_version_id,
    responsibleDepartmentId: row.responsible_department_id,
    targetScopeType: row.target_scope_type,
    teamTag: row.team_tag,
    projectTag: row.project_tag,
    audienceRoleIds: row.audience_role_ids,
    targetReaders: mapReaderSelection(row),
    versionId: row.shared_draft_version_id,
    sourceUri: row.content_uri,
    mimeType: row.mime_type,
    contentHash: row.content_hash,
    currentVersion: row.current_version_no,
    hasPendingSubmission: row.has_pending_submission,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
type SharedSubmissionRow = ReaderSelectionColumns & ApprovedReaderColumns & {
  management: KnowledgeMetadata | null;
  submission_id: string;
  shared_draft_id: string;
  shared_draft_version_id: string;
  snapshot_version_no: number;
  title: string;
  classification: KnowledgeClassification;
  responsible_department_id: string;
  target_scope_type: "ORGANIZATION" | "DEPARTMENT";
  target_department_id: string | null;
  audience_role_ids: string[];
  content_hash: string;
  content_uri: string;
  mime_type: string;
  status: SharedKnowledgeSubmission["status"];
  publication_state: SharedKnowledgeSubmission["publicationState"];
  submitted_at: Date;
  submitted_by_membership_id: string;
  team_tag: string | null;
  project_tag: string | null;
  policy_version: number;
  review_rule: "LEGACY" | "GRANT_SCOPE";
  organization_wide: boolean;
  published_version_id: string | null;
  decision_comment: string | null;
  request_type: PublicationRequestType;
  request_reason: string | null;
  target_published_version_id: string | null;
  publication_failure: PublicationFailureKind | null;
  withdrawn_by: "REVIEWER" | "ORGANIZATION_ADMIN" | null;
  withdrawn_reason: string | null;
  withdrawn_at: Date | null;
  renewal_expiration_date?: string | null;
  on_behalf_of_author?: boolean;
};
// organization_wide: the frozen audience includes the organization audience. That kind is valid only at
// Organization scope (audience_snapshot_enforceable) and audience_member_read shows it to every active member,
// so it is detected even when the reviewer cannot see the snapshot's group or department audiences.
const submissionSelect = `
  SELECT s.submission_id, s.shared_draft_id, s.shared_draft_version_id,
         s.management,
         s.snapshot_version_no,
         s.title, s.classification, s.responsible_department_id, s.target_scope_type,
         s.target_department_id, s.audience_role_ids, s.content_hash, s.content_uri,
         s.mime_type, s.status, s.publication_state, s.submitted_at, s.submitted_by_membership_id,
         s.team_tag, s.project_tag, s.policy_version, s.review_rule,
         ${readerSelectionColumns("s.proposed_selection_id")},
         ${readerSelectionColumns("s.approved_selection_id", "approved")},
         (s.target_scope_type = 'ORGANIZATION' AND EXISTS (
           SELECT 1 FROM audience a WHERE a.organization_id = s.organization_id
              AND a.audience_id = ANY(s.audience_role_ids) AND a.kind = 'ORGANIZATION_ALL')) AS organization_wide,
         cp.published_version_id,
         rd.comment AS decision_comment, s.request_type, s.request_reason, s.target_published_version_id,
         knowledge_publication_failure_kind(s.publication_failure_code) AS publication_failure,
         s.withdrawn_by, s.withdrawn_reason, s.withdrawn_at,
         to_char(s.renewal_expiration_date, 'YYYY-MM-DD') AS renewal_expiration_date, s.on_behalf_of_author
    FROM shared_submission s
    LEFT JOIN published_knowledge_version pv ON pv.submission_id = s.submission_id
    LEFT JOIN knowledge_current_publication cp ON cp.published_version_id = pv.published_version_id
    LEFT JOIN review_decision rd ON rd.submission_id = s.submission_id AND rd.flow2`;
type GovernanceViewRow = {
  document_id: string; published_version_id: string; title: string; content_uri: string; content_hash: string;
  mime_type: string; responsible_department_id: string | null; reader_mode: GovernanceReaderMode;
  reader_department_id: string | null;
};
/** Frozen snapshots retain retired keys for provenance; current API metadata never returns them. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function currentManagement<T extends object>(management: T | null | undefined): T | null {
  if (!management) return null;
  const { topicId: _topicId, topicName: _topicName, effectiveDate: _effectiveDate, ...rest } = management as T & { topicId?: unknown; topicName?: unknown; effectiveDate?: unknown };
  return rest as T;
}
function mapGovernanceView(row: GovernanceViewRow): GovernanceDocumentView {
  return { documentId: row.document_id, publishedVersionId: row.published_version_id, title: row.title,
    sourceUri: row.content_uri, contentHash: row.content_hash, mimeType: row.mime_type,
    responsibleDepartmentId: row.responsible_department_id, readerMode: row.reader_mode,
    readerDepartmentId: row.reader_department_id };
}
function sqlStateOf(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : null;
}
function mapSharedSubmission(row: SharedSubmissionRow): SharedKnowledgeSubmission {
  return {
    management: currentManagement(row.management),
    id: row.submission_id,
    draftId: row.shared_draft_id,
    snapshotVersionId: row.shared_draft_version_id,
    title: row.title,
    classification: row.classification,
    responsibleDepartmentId: row.responsible_department_id,
    targetScopeType: row.target_scope_type,
    targetDepartmentId: row.target_department_id,
    audienceRoleIds: row.audience_role_ids,
    proposedTargetReaders: mapReaderSelection(row),
    approvedTargetReaders: toReaderSelection(row.approved_selection_id, row.approved_mode,
      row.approved_department_id, row.approved_member_ids),
    contentHash: row.content_hash,
    status: row.status,
    publicationState: row.publication_state,
    submittedAt: row.submitted_at,
    publishedVersionId: row.published_version_id,
    decisionComment: row.decision_comment,
    requestType: row.request_type,
    requestReason: row.request_reason,
    publicationFailure: row.publication_state === "FAILED" ? row.publication_failure ?? "SYSTEM" : null,
    withdrawal: row.withdrawn_by && row.withdrawn_reason && row.withdrawn_at
      ? { by: row.withdrawn_by, reason: row.withdrawn_reason, at: row.withdrawn_at } : null,
    renewal: row.request_type === "RENEWAL"
      ? { expirationDate: row.renewal_expiration_date ?? null, onBehalfOfAuthor: row.on_behalf_of_author === true } : null,
  };
}
type ReviewerGrantRow = {
  reviewer_grant_id: string;
  reviewer_membership_id: string;
  scope: "DEPARTMENT" | "ORGANIZATION";
  department_id: string | null;
  classifications: KnowledgeClassification[];
  level: "STANDARD" | "SPECIALIST" | "SENIOR";
  team_tag: string | null;
  project_tag: string | null;
  status: "ACTIVE" | "INACTIVE";
  valid_from: Date;
  valid_until: Date | null;
};
function mapReviewerGrant(row: ReviewerGrantRow): ReviewerGrantRecord {
  return {
    id: row.reviewer_grant_id,
    reviewerMembershipId: row.reviewer_membership_id,
    scope: row.scope,
    departmentId: row.department_id,
    classifications: row.classifications,
    level: row.level,
    teamTag: row.team_tag,
    projectTag: row.project_tag,
    status: row.status,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
  };
}
function reviewAuthorizationFromRow(row: SharedSubmissionRow, organizationId: string) {
  return {
    organizationId,
    submittedByMembershipId: row.submitted_by_membership_id,
    departmentId: row.responsible_department_id,
    status: row.status,
    classification: row.classification,
    policyVersion: row.policy_version,
    reviewRule: row.review_rule,
    teamTag: row.team_tag,
    projectTag: row.project_tag,
    // Anything but an explicit false fails closed to the stricter organization-wide requirement.
    audienceBreadth: row.organization_wide === false ? "LIMITED" as const : "ORGANIZATION_WIDE" as const,
  };
}
type PublishedKnowledgeRow = ReaderSelectionColumns & {
  management: KnowledgeMetadata | null;
  published_version_id: string;
  shared_draft_id: string;
  title: string;
  classification: KnowledgeClassification;
  responsible_department_id: string;
  responsible_department_name: string | null;
  content_hash: string;
  content_uri: string;
  audience_role_ids: string[];
  published_at: Date;
  valid_from: Date;
  valid_until: Date | null;
  expiration_date: string | null;
  expired: boolean;
};
type AuthorizedAiSourceRow = ReaderSelectionColumns & {
  management: KnowledgeMetadata | null;
  chunks: unknown;
  generation_id: string;
  snapshot_version_id: string;
  snapshot_content_hash: string;
  published_version_id: string;
  shared_draft_id: string;
  title: string;
  version_no: number;
  classification: KnowledgeClassification;
  target_scope_type: "ORGANIZATION" | "DEPARTMENT";
};
const publishedKnowledgeSelect = `
  SELECT pv.published_version_id, pv.shared_draft_id, pv.title, pv.classification,
         pv.management,
         pv.responsible_department_id, pv.content_hash, pv.content_uri,
         owner_department.name AS responsible_department_name,
         pv.audience_role_ids, pv.published_at,
         cp.valid_from, cp.valid_until,
         to_char(publication_expiration_date(pv.published_version_id, pv.management), 'YYYY-MM-DD') AS expiration_date,
         COALESCE(publication_expiration_date(pv.published_version_id, pv.management)
           < (now() AT TIME ZONE 'UTC')::date, false) AS expired,
         ${readerSelectionColumns("pv.reader_selection_id")}
    FROM knowledge_current_publication cp
    JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
    LEFT JOIN department owner_department ON owner_department.department_id = pv.responsible_department_id
      AND owner_department.organization_id = cp.organization_id`;
function mapPublishedKnowledge(row: PublishedKnowledgeRow): PublishedKnowledge {
  const management = currentManagement(row.management);
  return {
    // A reviewed renewal (0068) replaces the frozen Valid until; the snapshot itself is never rewritten.
    management: management ? { ...management, expirationDate: row.expiration_date } : null,
    id: row.published_version_id,
    draftId: row.shared_draft_id,
    title: row.title,
    classification: row.classification,
    responsibleDepartmentId: row.responsible_department_id,
    responsibleDepartmentName: row.responsible_department_name,
    contentHash: row.content_hash,
    sourceUri: row.content_uri,
    audienceRoleIds: row.audience_role_ids,
    targetReaders: mapReaderSelection(row),
    publishedAt: row.published_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    expired: row.expired,
  };
}
export type OrganizationSetup = { name: string; departmentName?: string };
export type CreatedOrganization = { organizationId: string; name: string; departmentId: string | null; departmentName: string | null };
export type CreatedInvitation = { invitationId: string; email: string; organizationName: string; expiresAt: Date };
export type OrganizationAdminData = {
  departments: Array<{ id: string; name: string; code?: string; isBase?: boolean; defaultRoleId: string; defaultRoleName: string }>;
  roles: Array<{ id: string; name: string; code: string; isDefault: boolean }>;
  members: Array<{ id: string; email: string; name: string; status: MembershipStatus; departmentId: string | null; departmentIds?: string[]; isOrganizationAdmin: boolean; roleIds: string[]; roleNames: string[] }>;
  invitations: Array<{ id: string; email: string; departmentId: string | null; status: string; expiresAt: Date }>;
};
export type KnowledgeOptions = {
  departments: Array<{ id: string; name: string }>;
  /** The signed-in member's active primary department, which owns and reviews their drafts (decision 0014). */
  primaryDepartmentId: string | null;
  organizationReviewerAvailable: boolean;
  audiences: Array<{ id: string; name: string; departmentId: string | null;
    kind: "ORGANIZATION_ALL" | "DEPARTMENT_ALL" | "GROUP" }>;
};

export type DeleteDepartmentResult =
  | { success: true; unassignedCount?: number; reassignedCount?: number }
  | { success: false; errorReason: "NOT_FOUND" | "BASE_DEPARTMENT" }
  /** Decision 0032 D: the department still owns current publications that need handling first. */
  | { success: false; errorReason: "OWNS_PUBLICATIONS"; publicationCount: number };

export interface ArdenDataRepository {
  readonly notifications?: NotificationStore;
  readonly readerSources?: ReaderSourceStore;
  readonly knowledgeCatalog?: KnowledgeCatalogStore;
  readonly audienceGroups?: AudienceGroupStore;
  readonly systemAdministration?: SystemAdministrationStore;
  ratePrivateAnswer?(userId: string, organizationId: string, voteKey: string, feedback: AnswerFeedback): Promise<boolean>;
  readonly maintenance?: MaintenancePort;
  readonly privateOrganization: PrivateOrganizationStore;
  listMemberships(userId: string): Promise<MembershipSummary[]>;
  requireActiveMembership(userId: string, organizationId: string): Promise<ActiveMembership | null>;
  createOrganization(userId: string, email: string, fullName: string | null, setup: OrganizationSetup, requestId: string): Promise<CreatedOrganization>;
  createInvitation(userId: string, organizationId: string, departmentId: string | null | undefined, email: string, tokenHash: string, expiresAt: Date, requestId: string): Promise<CreatedInvitation | null>;
  rotateInvitation(userId: string, organizationId: string, invitationId: string, tokenHash: string, requestId: string): Promise<CreatedInvitation | null>;
  revokeInvitation(userId: string, organizationId: string, invitationId: string, requestId: string): Promise<boolean>;
  getInvitationByToken(tokenHash: string): Promise<{ invitationId: string; organizationName: string; email: string; expiresAt: Date } | null>;
  acceptInvitation(userId: string, email: string, fullName: string | null, emailVerified: boolean, tokenHash: string, requestId: string): Promise<boolean>;
  getOrganizationAdministration(userId: string, organizationId: string): Promise<OrganizationAdminData | null>;
  getKnowledgeOptions(userId: string, organizationId: string): Promise<KnowledgeOptions | null>;
  createDepartment(userId: string, organizationId: string, name: string, requestId: string): Promise<boolean>;
  deleteDepartment(userId: string, organizationId: string, departmentId: string, requestId: string): Promise<DeleteDepartmentResult>;
  changePrimaryDepartment(userId: string, organizationId: string, membershipId: string, departmentId: string, requestId: string): Promise<boolean>;
  listDrafts(userId: string, organizationId: string, limit: number, cursor: DraftCursor | null): Promise<{ items: DraftListItem[]; nextCursor: DraftCursor | null } | null>;
  getDraft(userId: string, organizationId: string, draftId: string, options?: { forQuestion: boolean }): Promise<PrivateDraft | null>;
  canCreateDraft(userId: string, organizationId: string): Promise<boolean>;
  createDraft(userId: string, organizationId: string, write: DraftWrite, content: StoredContentFields, requestId: string): Promise<PrivateDraft | null>;
  canUpdateDraft(userId: string, organizationId: string, draftId: string): Promise<boolean>;
  updateDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null, requestId: string): Promise<DraftUpdateResult>;
  getPrivateContributionSource(userId: string, organizationId: string, sourceVersionId: string): Promise<PrivateContributionSource | null>;
  createKnowledgeDraft(userId: string, organizationId: string, input: {
    actorMembershipId: string;
    sourceVersionId: string;
    classification: KnowledgeClassification;
    idempotencyKey: string;
    expectedSource: PrivateContributionSource;
    copiedContent: StoredContentFields;
    requestId: string;
  }): Promise<CreateSharedDraftResult>;
  createNewKnowledgeDraft(userId: string, organizationId: string, input: {
    actorMembershipId: string;
    title: string;
    classification: KnowledgeClassification;
    idempotencyKey: string;
    content: StoredContentFields;
    requestId: string;
  }): Promise<CreateSharedDraftResult>;
  listKnowledgeDrafts(userId: string, organizationId: string): Promise<SharedKnowledgeDraft[] | null>;
  getKnowledgeDraft(userId: string, organizationId: string, draftId: string): Promise<SharedKnowledgeDraft | null>;
  listKnowledgeDraftVersions(userId: string, organizationId: string, draftId: string): Promise<KnowledgeDraftVersion[] | null>;
  getKnowledgeDraftVersion(userId: string, organizationId: string, draftId: string, versionId: string): Promise<KnowledgeDraftVersion | null>;
  updateKnowledgeDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number,
    patch: SharedDraftPatch, content: StoredContentFields | null, requestId: string): Promise<UpdateSharedDraftResult>;
  submitKnowledgeDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number,
    idempotencyKey: string, requestId: string): Promise<SubmitKnowledgeDraftResult>;
  listKnowledgeSubmissions(userId: string, organizationId: string): Promise<SharedKnowledgeSubmission[] | null>;
  listOwnedKnowledgeSubmissionIds(userId: string, organizationId: string,
    submissionIds: readonly string[]): Promise<string[] | null>;
  /** Current publication IDs allowed by the caller's active audience and Target Readers policy. */
  listReadableCurrentPublicationIds(userId: string, organizationId: string,
    publishedVersionIds: readonly string[]): Promise<string[] | null>;
  retryKnowledgePublication(userId: string, organizationId: string, submissionId: string):
    Promise<RetryKnowledgePublicationResult>;
  listGovernancePublications(userId: string, organizationId: string): Promise<GovernancePublication[] | null>;
  openGovernanceInspection(userId: string, organizationId: string, documentId: string, reason: string):
    Promise<OpenGovernanceInspectionResult>;
  useGovernanceInspection(userId: string, organizationId: string, inspectionId: string): Promise<GovernanceInspectionView | null>;
  getResponsiblePublicationView(userId: string, organizationId: string, documentId: string): Promise<GovernanceDocumentView | null>;
  withdrawPublicationDirectly(userId: string, organizationId: string, documentId: string, reason: string):
    Promise<DirectWithdrawalResult>;
  reportPublicationProblem(userId: string, organizationId: string, documentId: string, publishedVersionId: string,
    message: string): Promise<ReportPublicationResult>;
  listPublicationReports(userId: string, organizationId: string): Promise<PublicationReport[] | null>;
  listClosedPublicationReports(userId: string, organizationId: string, cursor: string | null): Promise<{
    items: PublicationReport[]; nextCursor: string | null;
  } | null>;
  dismissPublicationReport(userId: string, organizationId: string, reportId: string): Promise<boolean>;
  withdrawKnowledgeSubmission(userId: string, organizationId: string, submissionId: string,
    requestId: string): Promise<WithdrawKnowledgeSubmissionResult>;
  requestPublicationChange(userId: string, organizationId: string, documentId: string,
    input: PublicationChangeInput, requestId: string): Promise<RequestPublicationChangeResult>;
  listReviewerGrants(userId: string, organizationId: string): Promise<ReviewerGrantRecord[] | null>;
  createReviewerGrant(userId: string, organizationId: string, input: ReviewerGrantInput, requestId: string): Promise<ReviewerGrantRecord | null>;
  deactivateReviewerGrant(userId: string, organizationId: string, grantId: string, requestId: string): Promise<boolean>;
  listAssignedReviews(userId: string, organizationId: string): Promise<AssignedReview[] | null>;
  listAssignedReviewsForSubmissions(userId: string, organizationId: string,
    submissionIds: readonly string[]): Promise<AssignedReview[] | null>;
  /** Submissions this reviewer already decided (REV-02 Approved / Rejected groups), newest first. */
  listDecidedReviews(userId: string, organizationId: string): Promise<DecidedReview[] | null>;
  getAssignedReview(userId: string, organizationId: string, submissionId: string): Promise<ReviewDetail | null>;
  decideReview(userId: string, organizationId: string, submissionId: string, action: ReviewAction,
    expectedSnapshotVersionId: string, expectedContentHash: string, comment: string | null,
    idempotencyKey: string, requestId: string, approvedReaders?: TargetReadersInput): Promise<DecideReviewResult>;
  listPublishedKnowledge(userId: string, organizationId: string): Promise<PublishedKnowledge[] | null>;
  listPublicationRenewalState(userId: string, organizationId: string): Promise<PublicationRenewalState[] | null>;
  requestPublicationRenewal(userId: string, organizationId: string, documentId: string,
    input: PublicationRenewalInput, requestId: string): Promise<RequestPublicationRenewalResult>;
  enqueuePublicationExpiryReminders(): Promise<number>;
  getPublishedKnowledge(userId: string, organizationId: string, publishedVersionId: string): Promise<PublishedKnowledge | null>;
  listAuthorizedAiSources(userId: string, organizationId: string, generationIds?: string[], chunkIds?: string[]): Promise<AuthorizedAiSource[] | null>;
  readonly conversations?: ConversationStore;
  /** The caller as a TargetReaderPolicy actor, or null when they are not an active member. */
  getTargetReaderActor(userId: string, organizationId: string): Promise<ReaderActor | null>;
}

function membershipPermissionSql(permissionParameter: "$2" | "$3" | "$4"): string {
  return `
  EXISTS (
    SELECT 1 FROM user_account ua
     WHERE ua.user_id = om.user_id AND ua.status = 'ACTIVE'
  ) AND om.status = 'ACTIVE'
    AND EXISTS (SELECT 1 FROM organization active_org
      WHERE active_org.organization_id = om.organization_id AND active_org.status = 'ACTIVE')
    AND (${permissionParameter} IN ('PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE') OR EXISTS (
    SELECT 1
      FROM role_assignment ra
      JOIN role r ON r.role_id = ra.role_id AND r.status = 'ACTIVE'
      JOIN role_permission rp ON rp.role_id = r.role_id
      JOIN permission p ON p.permission_id = rp.permission_id AND p.status = 'ACTIVE'
      JOIN access_scope s ON s.access_scope_id = ra.access_scope_id
                          AND s.organization_id = om.organization_id
                          AND s.status = 'ACTIVE'
     WHERE ra.membership_id = om.membership_id
       AND ra.status = 'ACTIVE'
       AND ra.valid_from <= now()
       AND (ra.valid_until IS NULL OR ra.valid_until > now())
       AND p.code = ${permissionParameter}
       AND (
         s.scope_type = 'ORGANIZATION'
         OR EXISTS (
           SELECT 1
             FROM department_membership dm
            WHERE dm.membership_id = om.membership_id
              AND dm.department_id = s.department_id
              AND dm.status = 'ACTIVE'
         )
       )
  ))`;
}

export class ArdenRepository implements ArdenDataRepository {
  readonly notifications: NotificationStore;
  readonly readerSources: ReaderSourceStore;
  readonly conversations: ConversationStore;
  readonly knowledgeCatalog: KnowledgeCatalogStore;
  readonly audienceGroups: AudienceGroupStore;
  readonly systemAdministration: SystemAdministrationStore;
  readonly maintenance: MaintenancePort;
  readonly privateOrganization: PgPrivateOrganizationStore;
  /** System-only retention capability for the in-process 30-day purge loop. */
  readonly privateTrashRetention: PrivateTrashRetentionStore;
  constructor(private readonly pool: Pool, content?: { read(sourceUri: string, expectedHash: string): Promise<string> }) {
    this.notifications = new PgNotificationStore((user, org, work) => this.withActorContext(user, org, work));
    this.readerSources = new PgReaderSourceStore((user, org, work) => this.withActorContext(user, org, work));
    this.conversations = new PgConversationStore((user, org, work) => this.withActorContext(user, org, work));
    this.knowledgeCatalog = new PgKnowledgeCatalogStore((user, org, work) => this.withActorContext(user, org, work),
      (user, org, work) => this.withOrganizationAdmin(user, org, work));
    this.audienceGroups = new PgAudienceGroupStore((user, org, work) => this.withOrganizationAdmin(user, org, work));
    this.systemAdministration = new PgSystemAdministrationStore((user, work) => this.withSystemAdmin(user, work));
    this.maintenance = new PgMaintenanceStore((user, org, work) => this.withActorContext(user, org, work), content);
    this.privateOrganization = new PgPrivateOrganizationStore((user, org, work) => this.withActorContext(user, org, work),
      (work) => this.withPrivateTrashRetention(work));
    this.privateTrashRetention = this.privateOrganization;
  }

  async requireActiveMembership(userId: string, organizationId: string): Promise<ActiveMembership | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<{ membership_id: string }>(`
        SELECT om.membership_id
          FROM organization_membership om
          JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
         WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId]);
      const membershipId = result.rows[0]?.membership_id;
      return membershipId ? { membershipId, organizationId, userId } : null;
    });
  }

  async listMemberships(userId: string): Promise<MembershipSummary[]> {
    return this.withActorContext(userId, null, async (client) => {
    const result = await client.query<{
      organization_id: string;
      organization_name: string;
      status: MembershipStatus;
      department_id: string | null;
      department_name: string | null;
      role_codes: string[] | null;
      can_use_private_workspace: boolean;
    }>(`
      SELECT o.organization_id,
             o.name AS organization_name,
             om.status,
             max(dm.department_id::text) FILTER (WHERE dm.is_primary AND dm.status = 'ACTIVE')::uuid AS department_id,
             max(d.name) FILTER (WHERE dm.is_primary AND dm.status = 'ACTIVE') AS department_name,
             COALESCE(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS role_codes,
             (${membershipPermissionSql("$2")}) AS can_use_private_workspace
        FROM organization_membership om
        JOIN organization o ON o.organization_id = om.organization_id
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        LEFT JOIN department_membership dm ON dm.membership_id = om.membership_id AND dm.is_primary AND dm.status = 'ACTIVE'
        LEFT JOIN department d ON d.department_id = dm.department_id AND d.status = 'ACTIVE'
        LEFT JOIN role_assignment ra
          ON ra.membership_id = om.membership_id
         AND ra.status = 'ACTIVE'
         AND ra.valid_from <= now()
         AND (ra.valid_until IS NULL OR ra.valid_until > now())
        LEFT JOIN role r ON r.role_id = ra.role_id AND r.status = 'ACTIVE'
       WHERE om.user_id = $1
       GROUP BY o.organization_id, o.name, om.membership_id, om.status
       ORDER BY o.name, o.organization_id`, [userId, "PRIVATE_WORKSPACE_READ"]);

    return result.rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      status: row.status,
      departmentId: row.department_id,
      departmentName: row.department_name,
      roleCodes: row.role_codes ?? [],
      canUsePrivateWorkspace: row.can_use_private_workspace,
    }));
    });
  }

  async createOrganization(userId: string, email: string, fullName: string | null, setup: OrganizationSetup, requestId: string): Promise<CreatedOrganization> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', '', true)", [userId]);
      const profileName = fullName ?? email.split("@", 1)[0] ?? "Arden member";
      await client.query(`
        INSERT INTO user_account (user_id, email, full_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now()`,
      [userId, email, profileName]);
      const organization = await client.query<{ organization_id: string }>(`
        INSERT INTO organization (name, slug, created_by_user_id)
        VALUES ($1, $2, $3)
        RETURNING organization_id`, [setup.name, organizationSlug(setup.name), userId]);
      const organizationId = organization.rows[0]?.organization_id;
      if (!organizationId) throw new Error("Organization creation returned no id");
      await client.query("SELECT set_config('arden.organization_id', $1, true), set_config('arden.org_admin', 'true', true)", [organizationId]);

      const allMembersRole = await client.query<{ role_id: string }>(`
        INSERT INTO role (organization_id, code, name, description, is_system)
        VALUES ($1, 'ALL_MEMBERS', 'Everyone in organization',
          'Server-managed audience for every active organization member', false)
        RETURNING role_id`, [organizationId]);
      const allMembersRoleId = allMembersRole.rows[0]?.role_id;
      if (!allMembersRoleId) throw new Error("Organization audience creation returned no id");
      await client.query(`INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission
        WHERE code = 'PUBLISHED_CONTENT_VIEW' AND status = 'ACTIVE'`, [allMembersRoleId]);
      await client.query(`INSERT INTO audience (
          audience_id, organization_id, kind, name, description, is_managed, legacy_role_id)
        VALUES ($1, $2, 'ORGANIZATION_ALL', 'Everyone in organization',
          'Every active member of the organization', true, $1)`, [allMembersRoleId, organizationId]);

      const baseDepartmentName = setup.departmentName?.trim();
      let departmentId: string | null = null;
      let departmentRoleId: string | null = null;
      let departmentScopeId: string | null = null;

      if (baseDepartmentName) {
        const suffix = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
        const role = await client.query<{ role_id: string }>(`
          INSERT INTO role (organization_id, code, name, description, is_system)
          VALUES ($1, $2, $3, 'Default role for the base department', false)
          RETURNING role_id`, [organizationId, `DEPT_DEFAULT_${suffix}`, `${baseDepartmentName} Member`]);
        departmentRoleId = role.rows[0]?.role_id ?? null;
        if (!departmentRoleId) throw new Error("Default role creation returned no id");

        const department = await client.query<{ department_id: string }>(`
          INSERT INTO department (organization_id, code, name, default_role_id)
          VALUES ($1, $2, $3, $4)
          RETURNING department_id`, [organizationId, `DEPT_${suffix}`, baseDepartmentName, departmentRoleId]);
        departmentId = department.rows[0]?.department_id ?? null;
        if (!departmentId) throw new Error("Department creation returned no id");

        await client.query(`INSERT INTO audience (
            audience_id, organization_id, kind, department_id, name, description, is_managed, legacy_role_id)
          VALUES ($1, $2, 'DEPARTMENT_ALL', $3, $4,
            'Every active member of the department', true, $1)`,
        [departmentRoleId, organizationId, departmentId, departmentAudienceName(baseDepartmentName)]);

        await client.query(`
          INSERT INTO role_permission (role_id, permission_id)
          SELECT $1, permission_id FROM permission
           WHERE code IN ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE',
                          'PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE')
          ON CONFLICT DO NOTHING`, [departmentRoleId]);

        const departmentScope = await client.query<{ access_scope_id: string }>(`
          INSERT INTO access_scope (organization_id, department_id, scope_type)
          VALUES ($1, $2, 'DEPARTMENT') RETURNING access_scope_id`, [organizationId, departmentId]);
        departmentScopeId = departmentScope.rows[0]?.access_scope_id ?? null;
      }

      const organizationScope = await client.query<{ access_scope_id: string }>(`
        INSERT INTO access_scope (organization_id, scope_type)
        VALUES ($1, 'ORGANIZATION') RETURNING access_scope_id`, [organizationId]);

      const membership = await client.query<{ membership_id: string }>(`
        INSERT INTO organization_membership (organization_id, user_id, status)
        VALUES ($1, $2, 'ACTIVE') RETURNING membership_id`, [organizationId, userId]);
      const membershipId = membership.rows[0]?.membership_id;
      if (!membershipId) throw new Error("Creator membership creation returned no id");

      if (departmentId && departmentRoleId && departmentScopeId) {
        await client.query(`
          INSERT INTO department_membership (membership_id, department_id, is_primary, status)
          VALUES ($1, $2, true, 'ACTIVE')`, [membershipId, departmentId]);
        await client.query(`
          INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
          VALUES ($1, $2, $3), ($1,
            (SELECT role_id FROM role WHERE organization_id IS NULL AND code = 'ORG_ADMIN' AND is_system), $4)`,
        [membershipId, departmentRoleId, departmentScopeId, organizationScope.rows[0]?.access_scope_id]);
      } else {
        await client.query(`
          INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
          VALUES ($1,
            (SELECT role_id FROM role WHERE organization_id IS NULL AND code = 'ORG_ADMIN' AND is_system), $2)`,
        [membershipId, organizationScope.rows[0]?.access_scope_id]);
      }

      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, membershipId, JSON.stringify({ departmentId, requestId })]);

      await client.query("COMMIT");
      return { organizationId, name: setup.name, departmentId, departmentName: baseDepartmentName || null };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvitation(userId: string, organizationId: string, departmentId: string | null | undefined, email: string, tokenHash: string, expiresAt: Date, requestId: string): Promise<CreatedInvitation | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client, inviterMembershipId) => {
      await client.query(`UPDATE organization_invitation SET status = 'EXPIRED'
        WHERE organization_id = $1 AND email = $2 AND status = 'PENDING' AND expires_at <= now()`, [organizationId, email]);
      let organizationName: string | undefined;
      if (departmentId) {
        const target = await client.query<{ organization_name: string }>(`
          SELECT o.name AS organization_name FROM department d
          JOIN organization o ON o.organization_id = d.organization_id
          WHERE d.department_id = $1 AND d.organization_id = $2 AND d.status = 'ACTIVE' AND o.status = 'ACTIVE'`,
        [departmentId, organizationId]);
        organizationName = target.rows[0]?.organization_name;
      } else {
        const target = await client.query<{ organization_name: string }>(`
          SELECT name AS organization_name FROM organization
          WHERE organization_id = $1 AND status = 'ACTIVE'`,
        [organizationId]);
        organizationName = target.rows[0]?.organization_name;
      }
      if (!organizationName) return null;
      const invitation = await client.query<{ invitation_id: string; expires_at: Date }>(`
        INSERT INTO organization_invitation
          (organization_id, invited_by_membership_id, department_id, email, token_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING invitation_id, expires_at`,
      [organizationId, inviterMembershipId, departmentId ?? null, email, tokenHash, expiresAt]);
      const created = invitation.rows[0];
      if (!created) throw new Error("Invitation creation returned no row");
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, inviterMembershipId, JSON.stringify({ invitationId: created.invitation_id, requestId })]);
      return { invitationId: created.invitation_id, email, organizationName, expiresAt: created.expires_at };
    });
  }

  async rotateInvitation(userId: string, organizationId: string, invitationId: string, tokenHash: string, requestId: string): Promise<CreatedInvitation | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client, inviterMembershipId) => {
      const invitation = await client.query<{ email: string; organization_name: string; expires_at: Date }>(`
        UPDATE organization_invitation i SET token_hash = $3
          FROM organization o
         WHERE i.invitation_id = $1 AND i.organization_id = $2 AND i.organization_id = o.organization_id
           AND i.status = 'PENDING' AND i.expires_at > now()
        RETURNING i.email, o.name AS organization_name, i.expires_at`, [invitationId, organizationId, tokenHash]);
      const rotated = invitation.rows[0];
      if (!rotated) return null;
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_RESENT', 'SUCCESS', $3::jsonb)`,
      [organizationId, inviterMembershipId, JSON.stringify({ invitationId, requestId })]);
      return { invitationId, email: rotated.email, organizationName: rotated.organization_name, expiresAt: rotated.expires_at };
    });
  }

  async revokeInvitation(userId: string, organizationId: string, invitationId: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, inviterMembershipId) => {
      const result = await client.query(`UPDATE organization_invitation SET status = 'REVOKED', revoked_at = now()
        WHERE invitation_id = $1 AND organization_id = $2 AND status = 'PENDING'`, [invitationId, organizationId]);
      if (result.rowCount !== 1) return false;
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_REVOKED', 'SUCCESS', $3::jsonb)`,
      [organizationId, inviterMembershipId, JSON.stringify({ invitationId, requestId })]);
      return true;
    })) ?? false;
  }

  async getOrganizationAdministration(userId: string, organizationId: string): Promise<OrganizationAdminData | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client) => {
      const departments = await client.query<{ id: string; name: string; code: string; is_base: boolean; default_role_id: string; default_role_name: string }>(`
        SELECT d.department_id AS id, d.name, d.code, false AS is_base,
               r.role_id AS default_role_id, r.name AS default_role_name
          FROM department d JOIN role r ON r.role_id = d.default_role_id
         WHERE d.organization_id = $1 AND d.status = 'ACTIVE'
         ORDER BY d.name`, [organizationId]);
      const roles = await client.query<{ id: string; name: string; code: string; is_default: boolean }>(`
        SELECT r.role_id AS id, r.name, r.code,
               EXISTS (SELECT 1 FROM department d WHERE d.default_role_id = r.role_id) AS is_default
          FROM role r WHERE r.organization_id = $1 AND r.status = 'ACTIVE' ORDER BY r.name`, [organizationId]);
      const members = await client.query<{
        id: string; email: string; name: string; status: MembershipStatus; department_id: string | null;
        role_ids: string[] | null; role_names: string[] | null; department_ids: string[]; is_organization_admin: boolean;
      }>(`
        SELECT om.membership_id AS id, ua.email, ua.full_name AS name, om.status,
               max(dm.department_id::text) FILTER (WHERE dm.is_primary AND dm.status = 'ACTIVE')::uuid AS department_id,
               ARRAY(SELECT all_dm.department_id::text FROM department_membership all_dm
                 JOIN department all_d USING(department_id)
                 WHERE all_dm.membership_id = om.membership_id AND all_dm.status = 'ACTIVE'
                   AND all_d.status = 'ACTIVE' AND all_d.organization_id = $1) AS department_ids,
               COALESCE(array_agg(DISTINCT r.role_id::text) FILTER (WHERE r.role_id IS NOT NULL), '{}') AS role_ids,
               COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS role_names,
               COALESCE(bool_or(r.organization_id IS NULL AND r.is_system AND r.code = 'ORG_ADMIN'
                 AND role_scope.organization_id = $1 AND role_scope.scope_type = 'ORGANIZATION'), false) AS is_organization_admin
          FROM organization_membership om JOIN user_account ua ON ua.user_id = om.user_id
          LEFT JOIN department_membership dm ON dm.membership_id = om.membership_id AND dm.is_primary AND dm.status = 'ACTIVE'
          LEFT JOIN role_assignment ra ON ra.membership_id = om.membership_id AND ra.status = 'ACTIVE'
            AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
          LEFT JOIN access_scope role_scope ON role_scope.access_scope_id = ra.access_scope_id
          LEFT JOIN role r ON r.role_id = ra.role_id AND r.status = 'ACTIVE'
         WHERE om.organization_id = $1 GROUP BY om.membership_id, ua.email, ua.full_name, om.status
         ORDER BY ua.full_name, ua.email`, [organizationId]);
      const invitations = await client.query<{
        id: string; email: string; department_id: string; status: string; expires_at: Date;
      }>(`SELECT invitation_id AS id, email, department_id,
                  CASE WHEN status = 'PENDING' AND expires_at <= now() THEN 'EXPIRED' ELSE status END AS status,
                  expires_at
            FROM organization_invitation WHERE organization_id = $1
           ORDER BY created_at DESC LIMIT 200`, [organizationId]);
      return {
        departments: departments.rows.map((row) => ({
          id: row.id,
          name: row.name,
          code: row.code,
          isBase: row.is_base,
          defaultRoleId: row.default_role_id,
          defaultRoleName: row.default_role_name,
        })),
        roles: roles.rows.map((row) => ({ id: row.id, name: row.name, code: row.code, isDefault: row.is_default })),
        members: members.rows.map((row) => ({
          id: row.id, email: row.email, name: row.name, status: row.status, departmentId: row.department_id,
          departmentIds: row.department_ids,
          isOrganizationAdmin: row.is_organization_admin,
          roleIds: row.role_ids ?? [], roleNames: row.role_names ?? [],
        })),
        invitations: invitations.rows.map((row) => ({ id: row.id, email: row.email, departmentId: row.department_id, status: row.status, expiresAt: row.expires_at })),
      };
    });
  }

  async getKnowledgeOptions(userId: string, organizationId: string): Promise<KnowledgeOptions | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membershipId = await this.activeActorMembership(client, userId, organizationId);
      if (!membershipId) return null;
      const departments = await client.query<{ id: string; name: string }>(`
        SELECT d.department_id AS id, d.name FROM department d
        WHERE d.organization_id = $1 AND d.status = 'ACTIVE'
          AND (
            current_setting('arden.org_admin', true) = 'true'
            OR EXISTS (
              SELECT 1 FROM department_membership dm
               WHERE dm.department_id = d.department_id
                 AND dm.membership_id = $2
                 AND dm.status = 'ACTIVE'
            )
          )
        ORDER BY d.name`, [organizationId, membershipId]);
      const audiences = await client.query<{ id: string; name: string; department_id: string | null;
        kind: "ORGANIZATION_ALL" | "DEPARTMENT_ALL" | "GROUP" }>(`SELECT audience_id AS id,
        name, department_id, kind FROM audience WHERE organization_id = $1 AND status = 'ACTIVE'
          AND (
            current_setting('arden.org_admin', true) = 'true'
            OR kind = 'ORGANIZATION_ALL'
            OR (
              department_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM department_membership dm
                 WHERE dm.department_id = audience.department_id
                   AND dm.membership_id = $2
                   AND dm.status = 'ACTIVE'
              )
            )
            OR (
              kind = 'GROUP' AND EXISTS (
                SELECT 1 FROM audience_group_membership agm
                 WHERE agm.audience_id = audience.audience_id
                   AND agm.membership_id = $2
                   AND agm.status = 'ACTIVE'
              )
            )
          )
        ORDER BY kind, name, audience_id`, [organizationId, membershipId]);
      const organizationReviewer = await client.query<{ available: boolean }>(`
        SELECT organization_has_active_reviewer_grant($1) AS available`, [organizationId]);
      return {
        departments: departments.rows,
        primaryDepartmentId: await this.actorPrimaryDepartment(client, userId, organizationId),
        organizationReviewerAvailable: organizationReviewer.rows[0]?.available === true,
        audiences: audiences.rows.map(audience => ({
          id: audience.id, name: audience.name, departmentId: audience.department_id,
          kind: audience.kind,
        })),
      };
    });
  }

  async createDepartment(userId: string, organizationId: string, name: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, actorMembershipId) => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
      const role = await client.query<{ role_id: string }>(`
        INSERT INTO role (organization_id, code, name, description, is_system)
        VALUES ($1, $2, $3, $4, false) RETURNING role_id`,
      [organizationId, `DEPT_DEFAULT_${suffix}`, `${name} Member`, `Default role for ${name}`]);
      const roleId = role.rows[0]?.role_id;
      if (!roleId) throw new Error("Department default role creation returned no id");
      const departmentCode = `DEPT_${suffix}`;
      const department = await client.query<{ department_id: string }>(`
        INSERT INTO department (organization_id, code, name, default_role_id)
        VALUES ($1, $2, $3, $4) RETURNING department_id`, [organizationId, departmentCode, name, roleId]);
      const departmentId = department.rows[0]?.department_id;
      if (!departmentId) throw new Error("Department creation returned no id");
      await client.query(`INSERT INTO audience (
          audience_id, organization_id, kind, department_id, name, description, is_managed, legacy_role_id,
          created_by_membership_id)
        VALUES ($1, $2, 'DEPARTMENT_ALL', $3, $4,
          'Every active member of the department', true, $1, $5)`,
      [roleId, organizationId, departmentId, departmentAudienceName(name), actorMembershipId]);
      await client.query(`
        INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission
         WHERE code IN ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE',
                        'PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE') ON CONFLICT DO NOTHING`, [roleId]);
      await client.query(`INSERT INTO access_scope (organization_id, department_id, scope_type) VALUES ($1, $2, 'DEPARTMENT')`, [organizationId, departmentId]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'DEPARTMENT_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, actorMembershipId, JSON.stringify({ departmentId, requestId })]);
      return true;
    })) ?? false;
  }

  async deleteDepartment(userId: string, organizationId: string, departmentId: string, requestId: string): Promise<DeleteDepartmentResult> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, actorMembershipId) => {
      const dept = await client.query<{ department_id: string; default_role_id: string; name: string; code: string }>(`
        SELECT department_id, default_role_id, name, code
          FROM department
         WHERE department_id = $1 AND organization_id = $2 AND status = 'ACTIVE'
         FOR UPDATE`, [departmentId, organizationId]);
      const department = dept.rows[0];
      if (!department) return { success: false, errorReason: "NOT_FOUND" };
      // Decision 0032 D: published documents keep their owner department, so it cannot disappear under them.
      const owned = await client.query<{ count: number }>(`SELECT count(*)::integer AS count
        FROM list_governance_publications() WHERE responsible_department_id = $1`, [departmentId]);
      const publicationCount = owned.rows[0]?.count ?? 0;
      if (publicationCount > 0) return { success: false, errorReason: "OWNS_PUBLICATIONS", publicationCount };

      const primaryMembers = await client.query<{ membership_id: string }>(`
        SELECT membership_id FROM department_membership
         WHERE department_id = $1 AND is_primary = true AND status = 'ACTIVE'`, [departmentId]);

      await client.query(`
        UPDATE department_membership
           SET is_primary = false, status = 'REMOVED', removed_at = now()
         WHERE department_id = $1 AND status = 'ACTIVE'`, [departmentId]);

      await client.query(`
        UPDATE role_assignment
           SET status = 'REVOKED'
         WHERE role_id = $1 AND status = 'ACTIVE'`, [department.default_role_id]);
      await client.query(`
        UPDATE role_assignment
           SET status = 'REVOKED'
         WHERE access_scope_id = (SELECT access_scope_id FROM access_scope WHERE department_id = $1 AND organization_id = $2 AND scope_type = 'DEPARTMENT')
           AND status = 'ACTIVE'`, [departmentId, organizationId]);

      await client.query(`
        UPDATE organization_invitation
           SET department_id = null
         WHERE department_id = $1 AND organization_id = $2 AND status = 'PENDING'`,
        [departmentId, organizationId]);

      await client.query(`UPDATE department SET status = 'ARCHIVED', updated_at = now() WHERE department_id = $1`, [departmentId]);
      await client.query(`UPDATE audience SET status = 'INACTIVE', updated_at = now() WHERE department_id = $1 AND organization_id = $2`, [departmentId, organizationId]);
      await client.query(`UPDATE access_scope SET status = 'INACTIVE' WHERE department_id = $1 AND organization_id = $2`, [departmentId, organizationId]);
      await client.query(`UPDATE reviewer_grant SET status = 'INACTIVE' WHERE department_id = $1 AND organization_id = $2`, [departmentId, organizationId]);
      await client.query(`UPDATE role SET status = 'INACTIVE' WHERE role_id = $1`, [department.default_role_id]);

      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'DEPARTMENT_DELETED', 'SUCCESS', $3::jsonb)`,
        [organizationId, actorMembershipId, JSON.stringify({
          departmentId,
          name: department.name,
          unassignedCount: primaryMembers.rows.length,
          requestId,
        })]);

      return { success: true, unassignedCount: primaryMembers.rows.length, reassignedCount: primaryMembers.rows.length };
    })) ?? { success: false, errorReason: "NOT_FOUND" };
  }

  async changePrimaryDepartment(userId: string, organizationId: string, membershipId: string, departmentId: string, requestId: string): Promise<boolean> {
    return (await this.withOrganizationAdmin(userId, organizationId, async (client, actorMembershipId) => {
      const member = await client.query<{ current_department_id: string | null }>(`
        SELECT max(department_id::text) FILTER (WHERE is_primary AND status = 'ACTIVE')::uuid AS current_department_id
          FROM department_membership WHERE membership_id = $1`, [membershipId]);
      const currentDepartmentId = member.rows[0]?.current_department_id;
      const target = await client.query<{ default_role_id: string; access_scope_id: string }>(`
        SELECT d.default_role_id, s.access_scope_id FROM department d JOIN access_scope s
          ON s.department_id = d.department_id AND s.organization_id = d.organization_id
         AND s.scope_type = 'DEPARTMENT' AND s.status = 'ACTIVE'
         WHERE d.department_id = $1 AND d.organization_id = $2 AND d.status = 'ACTIVE'
           AND EXISTS (SELECT 1 FROM organization_membership om WHERE om.membership_id = $3
                        AND om.organization_id = $2 AND om.status = 'ACTIVE')`, [departmentId, organizationId, membershipId]);
      const assignment = target.rows[0];
      if (!assignment) return false;
      if (currentDepartmentId === departmentId) return true;
      if (currentDepartmentId) {
        await client.query(`UPDATE role_assignment SET status = 'REVOKED'
          WHERE membership_id = $1 AND role_id = (SELECT default_role_id FROM department WHERE department_id = $2)
            AND status = 'ACTIVE'`, [membershipId, currentDepartmentId]);
        await client.query(`UPDATE role_assignment ra SET status = 'REVOKED'
          WHERE ra.membership_id = $1
            AND ra.access_scope_id = (SELECT access_scope_id FROM access_scope
              WHERE organization_id = $3 AND department_id = $2
                AND scope_type = 'DEPARTMENT' AND status = 'ACTIVE')
            AND ra.status = 'ACTIVE'
            AND EXISTS (SELECT 1 FROM audience_group_membership agm
              JOIN audience a ON a.audience_id = agm.audience_id
             WHERE agm.membership_id = $1 AND agm.status = 'ACTIVE'
               AND a.organization_id = $3 AND a.kind = 'GROUP'
               AND a.legacy_role_id = ra.role_id)`, [membershipId, currentDepartmentId, organizationId]);
        await client.query(`UPDATE department_membership SET is_primary = false, status = 'REMOVED', removed_at = now()
          WHERE membership_id = $1 AND department_id = $2 AND is_primary AND status = 'ACTIVE'`, [membershipId, currentDepartmentId]);
      }
      await client.query(`
        INSERT INTO department_membership (membership_id, department_id, is_primary, status, assigned_at, removed_at)
        VALUES ($1, $2, true, 'ACTIVE', now(), null)
        ON CONFLICT (membership_id, department_id)
        DO UPDATE SET is_primary = true, status = 'ACTIVE', assigned_at = now(), removed_at = null`,
        [membershipId, departmentId]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [membershipId, assignment.default_role_id, assignment.access_scope_id]);
      await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        SELECT $1, a.legacy_role_id, $2
          FROM audience_group_membership agm
          JOIN audience a ON a.audience_id = agm.audience_id
         WHERE agm.membership_id = $1 AND agm.status = 'ACTIVE'
           AND agm.valid_from <= now() AND (agm.valid_until IS NULL OR agm.valid_until > now())
           AND a.organization_id = $3 AND a.kind = 'GROUP' AND a.status = 'ACTIVE'
           AND a.legacy_role_id IS NOT NULL
        ON CONFLICT DO NOTHING`, [membershipId, assignment.access_scope_id, organizationId]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'PRIMARY_DEPARTMENT_CHANGED', 'SUCCESS', $3::jsonb)`,
      [organizationId, actorMembershipId, JSON.stringify({ membershipId, departmentId, requestId })]);
      return true;
    })) ?? false;
  }

  async getInvitationByToken(tokenHash: string): Promise<{ invitationId: string; organizationName: string; email: string; expiresAt: Date } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query(`SELECT set_config('arden.actor_id', '', true),
                                 set_config('arden.organization_id', '', true),
                                 set_config('arden.invitation_token_hash', $1, true)`, [tokenHash]);
      const found = await client.query<{ invitation_id: string; organization_id: string; email: string; expires_at: Date }>(`
        SELECT invitation_id, organization_id, email, expires_at
          FROM organization_invitation
         WHERE token_hash = $1 AND status = 'PENDING' AND expires_at > now()`, [tokenHash]);
      const invitation = found.rows[0];
      if (!invitation) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("SELECT set_config('arden.organization_id', $1, true)", [invitation.organization_id]);
      const orgResult = await client.query<{ name: string }>(`
        SELECT name FROM organization WHERE organization_id = $1 AND status = 'ACTIVE'`, [invitation.organization_id]);
      const organizationName = orgResult.rows[0]?.name ?? "Arden Organization";
      await client.query("COMMIT");
      return {
        invitationId: invitation.invitation_id,
        organizationName,
        email: invitation.email,
        expiresAt: invitation.expires_at,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async acceptInvitation(userId: string, email: string, fullName: string | null, emailVerified: boolean, tokenHash: string, requestId: string): Promise<boolean> {
    if (!emailVerified || !email || email !== email.trim().toLowerCase()) return false;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query(`SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', '', true),
                                 set_config('arden.invitation_token_hash', $2, true)`, [userId, tokenHash]);
      const profileName = fullName ?? email.split("@", 1)[0] ?? "Arden member";
      await client.query(`
        INSERT INTO user_account (user_id, email, full_name)
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now()`,
      [userId, email, profileName]);
      const found = await client.query<{ invitation_id: string; organization_id: string; department_id: string | null; invited_email: string }>(`
        SELECT invitation_id, organization_id, department_id, email AS invited_email
          FROM organization_invitation
         WHERE token_hash = $1 AND status = 'PENDING' AND expires_at > now()
         FOR UPDATE`, [tokenHash]);
      const invitation = found.rows[0];
      if (!invitation || invitation.invited_email !== email) {
        await client.query("ROLLBACK");
        return false;
      }
      const { organization_id: organizationId, department_id: departmentId, invitation_id: invitationId } = invitation;
      await client.query("SELECT set_config('arden.organization_id', $1, true)", [organizationId]);
      const membership = await client.query<{ membership_id: string }>(`
        INSERT INTO organization_membership (organization_id, user_id, status)
        VALUES ($1, $2, 'ACTIVE') RETURNING membership_id`, [organizationId, userId]);
      const membershipId = membership.rows[0]?.membership_id;
      if (!membershipId) throw new Error("Invitation membership creation returned no row");
      if (departmentId) {
        await client.query(`
          INSERT INTO department_membership (membership_id, department_id, is_primary, status)
          VALUES ($1, $2, true, 'ACTIVE')`, [membershipId, departmentId]);
        const defaultRole = await client.query<{ role_id: string; access_scope_id: string }>(`
          SELECT d.default_role_id AS role_id, s.access_scope_id
            FROM department d JOIN access_scope s
              ON s.department_id = d.department_id AND s.organization_id = d.organization_id
             AND s.scope_type = 'DEPARTMENT' AND s.status = 'ACTIVE'
           WHERE d.department_id = $1 AND d.organization_id = $2 AND d.status = 'ACTIVE'`, [departmentId, organizationId]);
        const assignment = defaultRole.rows[0];
        if (!assignment) throw new Error("Invitation department default role is unavailable");
        await client.query(`INSERT INTO role_assignment (membership_id, role_id, access_scope_id) VALUES ($1, $2, $3)`,
          [membershipId, assignment.role_id, assignment.access_scope_id]);
      }
      await client.query(`
        UPDATE organization_invitation SET status = 'ACCEPTED', accepted_by_user_id = $2, accepted_at = now()
         WHERE invitation_id = $1`, [invitationId, userId]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_INVITATION_ACCEPTED', 'SUCCESS', $3::jsonb)`,
      [organizationId, membershipId, JSON.stringify({ invitationId, requestId })]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) return false;
      throw error;
    } finally {
      client.release();
    }
  }

  private async withOrganizationAdmin<T>(userId: string, organizationId: string, work: (client: PoolClient, membershipId: string) => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [userId, organizationId]);
      const admin = await client.query<{ membership_id: string }>(`
        SELECT om.membership_id FROM organization_membership om
        JOIN role_assignment ra ON ra.membership_id = om.membership_id AND ra.status = 'ACTIVE'
          AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
        JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
        JOIN access_scope s ON s.access_scope_id = ra.access_scope_id AND s.organization_id = om.organization_id
          AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
        WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId]);
      const membershipId = admin.rows[0]?.membership_id;
      if (!membershipId) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("SELECT set_config('arden.org_admin', 'true', true)");
      const result = await work(client, membershipId);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async withSystemAdmin<T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query(`SELECT set_config('arden.actor_id', $1, true),
        set_config('arden.organization_id', '', true), set_config('arden.org_admin', 'false', true),
        set_config('arden.instance_admin', 'false', true)`, [userId]);
      const administrator = await client.query(`SELECT 1 FROM system_administrator sa JOIN user_account ua USING (user_id)
        WHERE sa.user_id = $1 AND sa.status = 'ACTIVE' AND ua.status = 'ACTIVE'`, [userId]);
      if (!administrator.rowCount) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query("SELECT set_config('arden.instance_admin', 'true', true)");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async ratePrivateAnswer(userId: string, organizationId: string, voteKey: string, feedback: AnswerFeedback): Promise<boolean> {
    return this.withActorContext(userId, organizationId, async client => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return false;
      await client.query("SELECT set_config('arden.private_feedback_key', $1, true)", [voteKey]);
      await client.query(`
        INSERT INTO private_ai_feedback(vote_key, feedback, rated_at)
        VALUES ($1, $2::text, CASE WHEN $2 IS NULL THEN NULL ELSE now() END)
        ON CONFLICT (vote_key) DO UPDATE SET feedback = EXCLUDED.feedback, rated_at = EXCLUDED.rated_at
        WHERE private_ai_feedback.feedback IS DISTINCT FROM EXCLUDED.feedback`, [voteKey, feedback]);
      return true;
    });
  }

  async listDrafts(userId: string, organizationId: string, limit: number, cursor: DraftCursor | null): Promise<{ items: DraftListItem[]; nextCursor: DraftCursor | null } | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
    const membershipId = await this.findMembership(userId, organizationId, "PRIVATE_WORKSPACE_READ", client);
    if (!membershipId) return null;

    const result = await client.query<{
      draft_id: string;
      title: string;
      current_version_no: number;
      draft_version_id: string;
      mime_type: string;
      content_hash: string;
      created_at: Date;
      updated_at: Date;
      collection_id: string | null;
      favorited_at: Date | null;
      sort_position: number | null;
    }>(`
      SELECT d.draft_id, d.title, d.current_version_no, v.draft_version_id, v.mime_type, v.content_hash,
             d.created_at, d.updated_at, d.collection_id, d.favorited_at, d.sort_position
        FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
        JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
       WHERE w.membership_id = $1 AND w.status = 'ACTIVE' AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
         AND d.archived_at IS NULL
         AND ($2::timestamptz IS NULL OR (d.updated_at, d.draft_id) < ($2, $3::uuid))
       ORDER BY d.updated_at DESC, d.draft_id DESC
       LIMIT $4`, [membershipId, cursor?.updatedAt ?? null, cursor?.draftId ?? null, limit + 1]);

    const hasNextPage = result.rows.length > limit;
    const page = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const items: DraftListItem[] = page.map((row) => ({
      id: row.draft_id,
      organizationId,
      title: row.title,
      currentVersion: { id: row.draft_version_id, version: row.current_version_no, mimeType: row.mime_type, contentHash: row.content_hash },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      collectionId: row.collection_id,
      favoritedAt: row.favorited_at,
      position: row.sort_position,
      archivedAt: null,
    }));
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasNextPage && last ? { updatedAt: last.updated_at.toISOString(), draftId: last.draft_id } : null,
    };
    });
  }

  async getDraft(userId: string, organizationId: string, draftId: string, options?: { forQuestion: boolean }): Promise<PrivateDraft | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
    const result = await client.query<{
      draft_id: string;
      draft_version_id: string;
      title: string;
      source_uri: string;
      mime_type: string;
      content_hash: string;
      current_version_no: number;
      created_at: Date;
      updated_at: Date;
      collection_id: string | null;
      favorited_at: Date | null;
      sort_position: number | null;
      text_source_uri: string | null;
      text_content_hash: string | null;
    }>(`
      SELECT d.draft_id, v.draft_version_id, d.title, v.source_uri, v.mime_type, v.content_hash,
             d.current_version_no, d.created_at, d.updated_at, d.collection_id, d.favorited_at, d.sort_position,
             v.text_source_uri, v.text_content_hash
        FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
        JOIN organization_membership om ON om.membership_id = w.membership_id
        JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
       WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
         AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
         AND (NOT $5::boolean OR (d.archived_at IS NULL AND EXISTS (
           SELECT 1 FROM organization o JOIN user_account ua ON ua.user_id = om.user_id
            WHERE o.organization_id = om.organization_id AND o.status = 'ACTIVE' AND ua.status = 'ACTIVE'
         )))
         AND ${membershipPermissionSql("$4")}`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_READ", options?.forQuestion ?? false]);
    const row = result.rows[0];
    return row ? {
      id: row.draft_id,
      organizationId,
      title: row.title,
      versionId: row.draft_version_id,
      sourceUri: row.source_uri,
      mimeType: row.mime_type,
      contentHash: row.content_hash,
      currentVersion: row.current_version_no,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      collectionId: row.collection_id,
      favoritedAt: row.favorited_at,
      position: row.sort_position,
      text: storedText(row.text_source_uri, row.text_content_hash),
    } : null;
    });
  }

  async getPrivateContributionSource(userId: string, organizationId: string, sourceVersionId: string): Promise<PrivateContributionSource | null> {
    return this.withActorContext(userId, organizationId, (client) =>
      this.findPrivateContributionSource(client, userId, organizationId, sourceVersionId));
  }

  async createKnowledgeDraft(userId: string, organizationId: string, input: {
    actorMembershipId: string;
    sourceVersionId: string;
    classification: KnowledgeClassification;
    idempotencyKey: string;
    expectedSource: PrivateContributionSource;
    copiedContent: StoredContentFields;
    requestId: string;
  }): Promise<CreateSharedDraftResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const createRequestHash = createHash("sha256")
        .update(`${input.sourceVersionId}:${input.classification}`)
        .digest("hex");
      // Decision 0031: serialize with saves of the source note, which may overwrite an open version.
      await client.query(`SELECT 1 FROM draft_version v JOIN draft_document d ON d.draft_id = v.draft_id
        WHERE v.draft_version_id = $1 FOR UPDATE OF d, v`, [input.sourceVersionId]);
      const source = await this.findPrivateContributionSource(client, userId, organizationId, input.sourceVersionId);
      if (!source || !canCreateSharedDraft({
        actor: { membershipId: input.actorMembershipId, organizationId, status: "ACTIVE" },
        source: { kind: "private", organizationId: source.organizationId, ownerMembershipId: source.ownerMembershipId },
        now: new Date(),
      })) return { kind: "unavailable" };
      if (source.sourceUri !== input.expectedSource.sourceUri || source.contentHash !== input.expectedSource.contentHash
        || !(source.mimeType === "text/plain" || source.mimeType === "application/pdf")
        || input.copiedContent.mimeType !== source.mimeType
        || input.copiedContent.sourceUri === source.sourceUri) return { kind: "unavailable" };

      const existing = await this.findSharedDraftByCreateRequest(client, source.ownerMembershipId, organizationId, input.idempotencyKey);
      if (existing) return existing.createRequestHash === createRequestHash
        ? { kind: "replayed", draft: existing.draft } : { kind: "idempotency-conflict" };

      const inserted = await client.query<{ shared_draft_id: string }>(`
        INSERT INTO shared_draft (organization_id, author_membership_id, source_private_version_id,
                                  title, classification, create_request_id, create_request_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (author_membership_id, create_request_id) WHERE create_request_id IS NOT NULL DO NOTHING
        RETURNING shared_draft_id`, [organizationId, source.ownerMembershipId, input.sourceVersionId,
        source.title, input.classification, input.idempotencyKey, createRequestHash]);
      const draftId = inserted.rows[0]?.shared_draft_id;
      if (!draftId) {
        const raced = await this.findSharedDraftByCreateRequest(client, source.ownerMembershipId, organizationId, input.idempotencyKey);
        if (!raced) throw new Error("Shared draft idempotency row disappeared");
        return raced.createRequestHash === createRequestHash
          ? { kind: "replayed", draft: raced.draft } : { kind: "idempotency-conflict" };
      }

      await client.query(`
        INSERT INTO shared_draft_version (shared_draft_id, version_no, content_uri, mime_type, content_hash)
        VALUES ($1, 1, $2, $3, $4)`, [draftId, input.copiedContent.sourceUri,
        input.copiedContent.mimeType, input.copiedContent.contentHash]);
      // The contributed wording must stay exactly as reviewed: later saves start a new private version.
      await client.query(`UPDATE draft_version SET sealed_at = now() WHERE draft_version_id = $1 AND sealed_at IS NULL`,
        [input.sourceVersionId]);
      await this.appendAudit(client, organizationId, source.ownerMembershipId,
        "SHARED_DRAFT_CREATED", draftId, 1, input.requestId);
      const created = await this.findSharedDraftByCreateRequest(client, source.ownerMembershipId, organizationId, input.idempotencyKey);
      if (!created) throw new Error("Created shared draft is not readable");
      return { kind: "created", draft: created.draft };
    });
  }

  async createNewKnowledgeDraft(userId: string, organizationId: string, input: {
    actorMembershipId: string;
    title: string;
    classification: KnowledgeClassification;
    idempotencyKey: string;
    content: StoredContentFields;
    requestId: string;
  }): Promise<CreateSharedDraftResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membership = await client.query<{ membership_id: string }>(`
        SELECT om.membership_id FROM organization_membership om
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId]);
      if (membership.rows[0]?.membership_id !== input.actorMembershipId) return { kind: "unavailable" };
      const createRequestHash = createHash("sha256")
        .update(JSON.stringify([input.title, input.classification, input.content.contentHash]))
        .digest("hex");
      const existing = await this.findSharedDraftByCreateRequest(client, input.actorMembershipId, organizationId, input.idempotencyKey);
      if (existing) return existing.createRequestHash === createRequestHash
        ? { kind: "replayed", draft: existing.draft } : { kind: "idempotency-conflict" };
      const inserted = await client.query<{ shared_draft_id: string }>(`
        INSERT INTO shared_draft (organization_id, author_membership_id, title, classification,
                                  create_request_id, create_request_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (author_membership_id, create_request_id) WHERE create_request_id IS NOT NULL DO NOTHING
        RETURNING shared_draft_id`, [organizationId, input.actorMembershipId, input.title, input.classification,
        input.idempotencyKey, createRequestHash]);
      const draftId = inserted.rows[0]?.shared_draft_id;
      if (!draftId) {
        const raced = await this.findSharedDraftByCreateRequest(client, input.actorMembershipId, organizationId, input.idempotencyKey);
        if (!raced) throw new Error("Shared draft idempotency row disappeared");
        return raced.createRequestHash === createRequestHash
          ? { kind: "replayed", draft: raced.draft } : { kind: "idempotency-conflict" };
      }
      await client.query(`
        INSERT INTO shared_draft_version (shared_draft_id, version_no, content_uri, mime_type, content_hash)
        VALUES ($1, 1, $2, $3, $4)`, [draftId, input.content.sourceUri, input.content.mimeType, input.content.contentHash]);
      await this.appendAudit(client, organizationId, input.actorMembershipId,
        "SHARED_DRAFT_CREATED", draftId, 1, input.requestId);
      const created = await this.findSharedDraftByCreateRequest(client, input.actorMembershipId, organizationId, input.idempotencyKey);
      if (!created) throw new Error("Created shared draft is not readable");
      return { kind: "created", draft: created.draft };
    });
  }

  async listKnowledgeDrafts(userId: string, organizationId: string): Promise<SharedKnowledgeDraft[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membership = await client.query(`
        SELECT 1 FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
        WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`, [userId, organizationId]);
      if (membership.rowCount === 0) return null;
      const result = await client.query<SharedDraftRow>(`${sharedDraftSelect}
        WHERE d.organization_id = $1 ORDER BY d.updated_at DESC, d.shared_draft_id DESC LIMIT 100`, [organizationId]);
      return result.rows.map((row) => mapSharedDraft(row, organizationId));
    });
  }

  async getKnowledgeDraft(userId: string, organizationId: string, draftId: string): Promise<SharedKnowledgeDraft | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<SharedDraftRow>(`${sharedDraftSelect}
        WHERE d.organization_id = $1 AND d.shared_draft_id = $2`, [organizationId, draftId]);
      return result.rows[0] ? mapSharedDraft(result.rows[0], organizationId) : null;
    });
  }

  async listKnowledgeDraftVersions(userId: string, organizationId: string, draftId: string): Promise<KnowledgeDraftVersion[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const draft = await client.query(`SELECT 1 FROM shared_draft
        WHERE organization_id = $1 AND shared_draft_id = $2`, [organizationId, draftId]);
      if (draft.rowCount === 0) return null;
      const result = await client.query<{ shared_draft_version_id: string; version_no: number;
        content_uri: string; mime_type: string; content_hash: string; created_at: Date }>(`
        SELECT v.shared_draft_version_id, v.version_no, v.content_uri, v.mime_type,
               v.content_hash, v.created_at
          FROM shared_draft_version v
          JOIN shared_draft d ON d.shared_draft_id = v.shared_draft_id
         WHERE d.organization_id = $1 AND d.shared_draft_id = $2
         ORDER BY v.version_no DESC`, [organizationId, draftId]);
      return result.rows.map((row) => ({ id: row.shared_draft_version_id, version: row.version_no,
        sourceUri: row.content_uri, mimeType: row.mime_type, contentHash: row.content_hash,
        createdAt: row.created_at }));
    });
  }

  async getKnowledgeDraftVersion(userId: string, organizationId: string, draftId: string,
    versionId: string): Promise<KnowledgeDraftVersion | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<{ shared_draft_version_id: string; version_no: number;
        content_uri: string; mime_type: string; content_hash: string; created_at: Date }>(`
        SELECT v.shared_draft_version_id, v.version_no, v.content_uri, v.mime_type,
               v.content_hash, v.created_at
          FROM shared_draft_version v
          JOIN shared_draft d ON d.shared_draft_id = v.shared_draft_id
         WHERE d.organization_id = $1 AND d.shared_draft_id = $2
           AND v.shared_draft_version_id = $3`, [organizationId, draftId, versionId]);
      const row = result.rows[0];
      return row ? { id: row.shared_draft_version_id, version: row.version_no,
        sourceUri: row.content_uri, mimeType: row.mime_type, contentHash: row.content_hash,
        createdAt: row.created_at } : null;
    });
  }

  async updateKnowledgeDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number,
    patch: SharedDraftPatch, content: StoredContentFields | null, requestId: string): Promise<UpdateSharedDraftResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const selected = await client.query<SharedDraftRow>(`${sharedDraftSelect}
        WHERE d.organization_id = $1 AND d.shared_draft_id = $2 AND d.status = 'ACTIVE' FOR UPDATE OF d`,
      [organizationId, draftId]);
      const row = selected.rows[0];
      if (!row) return { kind: "not-found" };
      if (row.current_version_no !== expectedVersion) return { kind: "conflict", currentVersion: row.current_version_no };
      const current = mapSharedDraft(row, organizationId);
      let management: (KnowledgeMetadata & { schemaVersion?: number }) | null = current.management ?? null;
      if (patch.management !== undefined) {
        if (!validKnowledgeMetadata(patch.management)) return { kind: "invalid-metadata" };
        const value = patch.management;
        management = { schemaVersion: 1, type: value.type, version: value.version.trim(), expirationDate: value.expirationDate, changeNote: value.changeNote.trim() };
      }
      // Decision 0014: the responsible department always follows the author's primary department.
      const responsible = resolveResponsibleDepartment(patch.responsibleDepartmentId,
        await this.actorPrimaryDepartment(client, userId, organizationId));
      if (!responsible.ok) return { kind: "invalid-metadata" };
      const next = {
        title: patch.title ?? current.title,
        classification: patch.classification ?? current.classification,
        responsibleDepartmentId: responsible.departmentId,
        targetScopeType: patch.targetScopeType === undefined ? current.targetScopeType : patch.targetScopeType,
        teamTag: patch.teamTag === undefined ? current.teamTag : patch.teamTag,
        projectTag: patch.projectTag === undefined ? current.projectTag : patch.projectTag,
        audienceRoleIds: patch.audienceRoleIds ?? current.audienceRoleIds,
      };
      const effectiveReaders = patch.targetReaders ?? current.targetReaders;
      if (management?.schemaVersion === 1 && effectiveReaders) {
        // Compatibility audience is a database backstop, not the new reader
        // entitlement. Limited proposals keep the author's department reviewer.
        next.targetScopeType = effectiveReaders.mode === "ORGANIZATION" ? "ORGANIZATION" : "DEPARTMENT";
        const audiences = await client.query<{ id: string }>(`SELECT audience_id AS id FROM audience
          WHERE organization_id = $1 AND status = 'ACTIVE' AND
          (($2 = 'ORGANIZATION' AND kind = 'ORGANIZATION_ALL') OR
           ($2 = 'DEPARTMENT' AND kind = 'DEPARTMENT_ALL' AND department_id = $3))`,
        [organizationId, next.targetScopeType, next.responsibleDepartmentId]);
        next.audienceRoleIds = audiences.rows.map(audience => audience.id);
        next.teamTag = null; next.projectTag = null;
      }
      if (next.responsibleDepartmentId) {
        const department = await client.query(`SELECT 1 FROM department WHERE department_id = $1
          AND organization_id = $2 AND status = 'ACTIVE'`, [next.responsibleDepartmentId, organizationId]);
        if (department.rowCount === 0) return { kind: "invalid-metadata" };
      }
      if (next.audienceRoleIds.length > 100 || new Set(next.audienceRoleIds).size !== next.audienceRoleIds.length) {
        return { kind: "invalid-metadata" };
      }
      if (next.audienceRoleIds.length > 0) {
        const audiences = await client.query(`SELECT audience_id FROM audience
          WHERE organization_id = $1 AND audience_id = ANY($2::uuid[]) AND status = 'ACTIVE'
            AND ((kind = 'ORGANIZATION_ALL' AND $3 = 'ORGANIZATION')
              OR (kind = 'DEPARTMENT_ALL' AND $3 = 'DEPARTMENT' AND department_id = $4)
              OR kind = 'GROUP')`,
        [organizationId, next.audienceRoleIds, next.targetScopeType, next.responsibleDepartmentId]);
        if (audiences.rowCount !== next.audienceRoleIds.length) return { kind: "invalid-metadata" };
      }
      let draftSelectionId: string | null = null;
      if (patch.targetReaders !== undefined) {
        const validation = validateSelection(patch.targetReaders,
          await this.loadSelectionFacts(client, organizationId, patch.targetReaders));
        if (!validation.ok) return { kind: "invalid-target-readers", field: validation.field, reason: validation.reason };
        draftSelectionId = await this.insertReaderSelection(client, organizationId, validation.selection,
          (row.draft_selection_revision ?? 0) + 1);
      }
      await client.query(`UPDATE shared_draft SET title = $3, classification = $4,
        responsible_department_id = $5, target_scope_type = $6, team_tag = $7, project_tag = $8,
        draft_selection_id = COALESCE($9::uuid, draft_selection_id)
        , management = $10::jsonb
        WHERE shared_draft_id = $1 AND organization_id = $2`, [draftId, organizationId, next.title,
        next.classification, next.responsibleDepartmentId, next.targetScopeType, next.teamTag, next.projectTag,
        draftSelectionId, management ? JSON.stringify(management) : null]);
      if (patch.audienceRoleIds !== undefined || patch.targetReaders !== undefined || management?.schemaVersion === 1) {
        await client.query(`DELETE FROM shared_draft_audience WHERE shared_draft_id = $1`, [draftId]);
        if (next.audienceRoleIds.length > 0) {
          await client.query(`INSERT INTO shared_draft_audience (shared_draft_id, organization_id, role_id)
            SELECT $1, $2, unnest($3::uuid[])`, [draftId, organizationId, next.audienceRoleIds]);
        }
      }
      const object = content ?? { sourceUri: current.sourceUri, mimeType: current.mimeType, contentHash: current.contentHash };
      await client.query(`INSERT INTO shared_draft_version (shared_draft_id, version_no, content_uri, mime_type, content_hash)
        VALUES ($1, $2, $3, $4, $5)`, [draftId, expectedVersion + 1,
        object.sourceUri, object.mimeType, object.contentHash]);
      const membership = await client.query<{ membership_id: string }>(`
        SELECT membership_id FROM organization_membership WHERE user_id = $1 AND organization_id = $2
          AND status = 'ACTIVE'`, [userId, organizationId]);
      const membershipId = membership.rows[0]?.membership_id;
      if (!membershipId) throw new Error("Shared draft author membership disappeared");
      await this.appendAudit(client, organizationId, membershipId, "SHARED_DRAFT_UPDATED", draftId,
        expectedVersion + 1, requestId);
      const updated = await client.query<SharedDraftRow>(`${sharedDraftSelect}
        WHERE d.organization_id = $1 AND d.shared_draft_id = $2`, [organizationId, draftId]);
      if (!updated.rows[0]) throw new Error("Updated shared draft is not readable");
      return { kind: "updated", draft: mapSharedDraft(updated.rows[0], organizationId) };
    });
  }

  async submitKnowledgeDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number,
    idempotencyKey: string, requestId: string): Promise<SubmitKnowledgeDraftResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const replay = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submit_request_id = $2`, [organizationId, idempotencyKey]);
      if (replay.rows[0]) return replay.rows[0].shared_draft_id === draftId
        && replay.rows[0].snapshot_version_no === expectedVersion
        ? { kind: "replayed", submission: mapSharedSubmission(replay.rows[0]) }
        : { kind: "conflict" };
      const selected = await client.query<SharedDraftRow>(`${sharedDraftSelect}
        WHERE d.organization_id = $1 AND d.shared_draft_id = $2 AND d.status = 'ACTIVE' FOR UPDATE OF d`,
      [organizationId, draftId]);
      const row = selected.rows[0];
      if (!row || !(await this.activeActorMembership(client, userId, organizationId, row.author_membership_id))) {
        return { kind: "not-found" };
      }
      if (row.current_version_no !== expectedVersion) return { kind: "conflict" };
      if (!row.management || metadataSubmissionErrors(row.management, row.has_published_version).length
        || !row.readers_selection_id) return { kind: "not-ready" };
      const reusedVersion = await client.query(`SELECT 1 FROM shared_submission WHERE shared_draft_id = $1
        AND publication_state IN ('ACTIVE', 'SUPERSEDED') AND management->>'version' = $2`, [draftId, row.management.version]);
      if (reusedVersion.rowCount) return { kind: "not-ready" };
      if (!row.responsible_department_id || !row.target_scope_type) return { kind: "not-ready" };
      const audiences = await client.query<{ audience_id: string; organization_id: string;
        status: "ACTIVE" | "INACTIVE"; kind: "ORGANIZATION_ALL" | "DEPARTMENT_ALL" | "GROUP";
        department_id: string | null }>(`SELECT audience_id, organization_id, status, kind, department_id
        FROM audience WHERE organization_id = $1 AND audience_id = ANY($2::uuid[])`,
      [organizationId, row.audience_role_ids]);
      const ready = canSubmitSnapshot({
        responsibleDepartmentId: row.responsible_department_id,
        authorPrimaryDepartmentId: await this.actorPrimaryDepartment(client, userId, organizationId),
        actor: { membershipId: row.author_membership_id, organizationId, status: "ACTIVE" },
        draft: { organizationId, authorMembershipId: row.author_membership_id, status: row.status,
          currentVersionId: row.shared_draft_version_id },
        snapshot: { versionId: row.shared_draft_version_id, contentHash: row.content_hash,
          classification: row.classification, audienceIds: row.audience_role_ids,
          scope: row.target_scope_type === "ORGANIZATION"
            ? { type: "ORGANIZATION", departmentId: null }
            : { type: "DEPARTMENT", departmentId: row.responsible_department_id } },
        audiences: audiences.rows.map(audience => ({ audienceId: audience.audience_id,
          organizationId: audience.organization_id, status: audience.status, kind: audience.kind,
          departmentId: audience.department_id })),
        audienceEnforceable: await this.audienceEnforceable(client, organizationId, row.audience_role_ids,
          row.target_scope_type, row.responsible_department_id),
      });
      const department = await client.query(`SELECT 1 FROM department
        WHERE department_id = $1 AND organization_id = $2 AND status = 'ACTIVE'`, [row.responsible_department_id, organizationId]);
      if (!ready || department.rowCount === 0) return { kind: "not-ready" };
      const pending = await client.query(`SELECT 1 FROM shared_submission
        WHERE shared_draft_id = $1 AND status = 'PENDING_REVIEW'`, [draftId]);
      if (pending.rowCount !== 0) return { kind: "conflict" };
      const alreadySubmitted = await client.query(`SELECT 1 FROM shared_submission
        WHERE shared_draft_version_id = $1`, [row.shared_draft_version_id]);
      if (alreadySubmitted.rowCount !== 0) return { kind: "conflict" };
      const submitted = await client.query<{ submission_id: string }>(`
        INSERT INTO shared_submission (organization_id, shared_draft_id, shared_draft_version_id,
          snapshot_version_no,
          submitted_by_membership_id, target_scope_type, target_department_id,
          responsible_department_id, title, classification, team_tag, project_tag,
          audience_role_ids, policy_version, content_uri, mime_type, content_hash, submit_request_id,
          proposed_selection_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13::uuid[], 1, $14, $15, $16, $17, $18::uuid)
        RETURNING submission_id`, [organizationId, draftId, row.shared_draft_version_id,
        row.current_version_no, row.author_membership_id, row.target_scope_type,
        row.target_scope_type === "DEPARTMENT" ? row.responsible_department_id : null,
        row.responsible_department_id, row.title, row.classification, row.team_tag, row.project_tag,
        row.audience_role_ids, row.content_uri, row.mime_type, row.content_hash, idempotencyKey,
        // T1.4: the draft selection is frozen as the proposed readers; selections are immutable rows.
        row.readers_selection_id]);
      const submissionId = submitted.rows[0]?.submission_id;
      if (!submissionId) throw new Error("Submission insert returned no identifier");
      await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type,
        outcome, details_json) VALUES ($1, $2, 'KNOWLEDGE_SUBMITTED', 'SUCCESS', $3::jsonb)`, [organizationId,
        row.author_membership_id, JSON.stringify({ submissionId, draftId, snapshotVersionId: row.shared_draft_version_id, requestId })]);
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.submission_id = $1`, [submissionId]);
      if (!result.rows[0]) throw new Error("Submitted snapshot is not readable");
      return { kind: "submitted", submission: mapSharedSubmission(result.rows[0]) };
    });
  }

  async listKnowledgeSubmissions(userId: string, organizationId: string): Promise<SharedKnowledgeSubmission[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membership = await this.activeActorMembership(client, userId, organizationId);
      if (!membership) return null;
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submitted_by_membership_id = $2
        ORDER BY s.submitted_at DESC, s.submission_id DESC LIMIT 100`, [organizationId, membership]);
      return result.rows.map(mapSharedSubmission);
    });
  }

  /** Recheck authorship for specific notification resources without consulting the submissions page. */
  async listOwnedKnowledgeSubmissionIds(userId: string, organizationId: string,
    submissionIds: readonly string[]): Promise<string[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membership = await this.activeActorMembership(client, userId, organizationId);
      if (!membership) return null;
      const uniqueSubmissionIds = [...new Set(submissionIds)];
      if (uniqueSubmissionIds.length === 0) return [];
      const result = await client.query<{ submission_id: string }>(`
        SELECT s.submission_id FROM shared_submission s
         WHERE s.organization_id = $1 AND s.submitted_by_membership_id = $2
           AND s.submission_id = ANY($3::uuid[])`, [organizationId, membership, uniqueSubmissionIds]);
      return result.rows.map(row => row.submission_id);
    });
  }

  /** Recheck current publication access for share notifications through the same RLS policies as the library. */
  async listReadableCurrentPublicationIds(userId: string, organizationId: string,
    publishedVersionIds: readonly string[]): Promise<string[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return null;
      const ids = [...new Set(publishedVersionIds)];
      if (ids.length === 0) return [];
      const result = await client.query<{ published_version_id: string }>(`
        SELECT pv.published_version_id
          FROM knowledge_current_publication cp
          JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
         WHERE cp.organization_id = $1 AND pv.published_version_id = ANY($2::uuid[])`,
      [organizationId, ids]);
      return result.rows.map(row => row.published_version_id);
    });
  }

  /** Decision 0023 catalog. Null when the actor is not a current Organization Admin (0037 re-checks it). */
  async listGovernancePublications(userId: string, organizationId: string): Promise<GovernancePublication[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      try {
        await client.query("SAVEPOINT governance_catalog");
        const result = await client.query<{ document_id: string; published_version_id: string; title: string;
          responsible_department_id: string | null; reader_mode: GovernanceReaderMode; reader_department_id: string | null;
          version_label: string | null; snapshot_version_no: number | null; published_at: Date; open_reports: number }>(
          "SELECT * FROM list_governance_publications()");
        return result.rows.map((row) => ({ documentId: row.document_id, publishedVersionId: row.published_version_id,
          title: row.title, responsibleDepartmentId: row.responsible_department_id, readerMode: row.reader_mode,
          readerDepartmentId: row.reader_department_id, versionLabel: row.version_label,
          snapshotVersionNo: row.snapshot_version_no, publishedAt: row.published_at, openReports: row.open_reports }));
      } catch (error) {
        if (sqlStateOf(error) === "42501") { await client.query("ROLLBACK TO SAVEPOINT governance_catalog"); return null; }
        throw error;
      }
    });
  }

  /** Opens one audited inspection (0037 commits the audit event with it). */
  async openGovernanceInspection(userId: string, organizationId: string, documentId: string, reason: string):
    Promise<OpenGovernanceInspectionResult> {
    const trimmed = reason.trim();
    if (!trimmed || [...trimmed].length > 1000) return { kind: "invalid-reason" };
    return this.withActorContext(userId, organizationId, async (client) => {
      try {
        await client.query("SAVEPOINT governance_open");
        const result = await client.query<{ inspection_id: string | null }>(
          "SELECT open_governance_inspection($1, $2) AS inspection_id", [documentId, trimmed]);
        const id = result.rows[0]?.inspection_id;
        return id ? { kind: "opened", inspectionId: id } : { kind: "not-found" };
      } catch (error) {
        const state = sqlStateOf(error);
        if (state === "42501") { await client.query("ROLLBACK TO SAVEPOINT governance_open"); return { kind: "not-admin" }; }
        if (state === "22023") { await client.query("ROLLBACK TO SAVEPOINT governance_open"); return { kind: "invalid-reason" }; }
        throw error;
      }
    });
  }

  async useGovernanceInspection(userId: string, organizationId: string, inspectionId: string):
    Promise<GovernanceInspectionView | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<GovernanceViewRow & { reader_names: string[]; reason: string; expires_at: Date }>(
        "SELECT * FROM use_governance_inspection($1)", [inspectionId]);
      const row = result.rows[0];
      return row ? { ...mapGovernanceView(row), readerNames: row.reader_names, reason: row.reason, expiresAt: row.expires_at } : null;
    });
  }

  async getResponsiblePublicationView(userId: string, organizationId: string, documentId: string):
    Promise<GovernanceDocumentView | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<GovernanceViewRow>("SELECT * FROM responsible_publication_view($1)", [documentId]);
      return result.rows[0] ? mapGovernanceView(result.rows[0]) : null;
    });
  }

  async withdrawPublicationDirectly(userId: string, organizationId: string, documentId: string, reason: string):
    Promise<DirectWithdrawalResult> {
    const trimmed = reason.trim();
    if (!trimmed || [...trimmed].length > 1000) return { kind: "invalid-reason" };
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<{ outcome: string }>(
        "SELECT withdraw_publication_directly($1, $2) AS outcome", [documentId, trimmed]);
      const outcome = result.rows[0]?.outcome;
      if (outcome === "WITHDRAWN") return { kind: "withdrawn" };
      if (outcome === "PREPARING") return { kind: "preparing" };
      if (outcome === "NOT_FOUND") return { kind: "not-found" };
      throw new Error("Direct withdrawal returned no outcome");
    });
  }

  /** The insert policy re-checks that the actor can read the current publication. */
  async reportPublicationProblem(userId: string, organizationId: string, documentId: string, publishedVersionId: string,
    message: string): Promise<ReportPublicationResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membership = await this.activeActorMembership(client, userId, organizationId);
      if (!membership) return { kind: "not-found" };
      const reportId = randomUUID();
      try {
        await client.query("SAVEPOINT publication_report");
        await client.query(`INSERT INTO publication_report (report_id, organization_id, shared_draft_id,
            published_version_id, reporter_membership_id, message) VALUES ($1, $2, $3, $4, $5, $6)`,
        [reportId, organizationId, documentId, publishedVersionId, membership, message.trim()]);
        return { kind: "reported", reportId };
      } catch (error) {
        const state = sqlStateOf(error);
        if (state === "23505") { await client.query("ROLLBACK TO SAVEPOINT publication_report"); return { kind: "duplicate" }; }
        if (state === "42501" || state === "23503") {
          await client.query("ROLLBACK TO SAVEPOINT publication_report"); return { kind: "not-found" };
        }
        throw error;
      }
    });
  }

  async listPublicationReports(userId: string, organizationId: string): Promise<PublicationReport[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return null;
      const result = await client.query<{ report_id: string; document_id: string; published_version_id: string;
        title: string; message: string; reporter_name: string; created_at: Date; still_current: boolean; can_view: boolean }>(
        "SELECT * FROM list_publication_reports()");
      return result.rows.map((row) => ({ id: row.report_id, documentId: row.document_id,
        publishedVersionId: row.published_version_id, title: row.title, message: row.message,
        reporterName: row.reporter_name, createdAt: row.created_at, stillCurrent: row.still_current, canView: row.can_view }));
    });
  }

  async listClosedPublicationReports(userId: string, organizationId: string, cursor: string | null): Promise<{
    items: PublicationReport[]; nextCursor: string | null;
  } | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return null;
      const result = await client.query<{ report_id: string; document_id: string; published_version_id: string;
        title: string; message: string; reporter_name: string; created_at: Date; still_current: boolean;
        can_view: boolean; resolution: "DISMISSED" | "WITHDRAWN" | null }>(
        "SELECT * FROM list_closed_publication_reports($1::uuid)", [cursor]);
      const items = result.rows.slice(0, 200).map((row) => ({ id: row.report_id, documentId: row.document_id,
        publishedVersionId: row.published_version_id, title: row.title, message: row.message,
        reporterName: row.reporter_name, createdAt: row.created_at, stillCurrent: row.still_current,
        canView: false, resolution: row.resolution }));
      return { items, nextCursor: result.rows.length > items.length ? items.at(-1)?.id ?? null : null };
    });
  }

  async dismissPublicationReport(userId: string, organizationId: string, reportId: string): Promise<boolean> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<{ outcome: string }>("SELECT close_publication_report($1) AS outcome", [reportId]);
      return result.rows[0]?.outcome === "CLOSED";
    });
  }

  /**
   * T6.3 retry: the author restarts preparation of their approved snapshot after a TEMPORARY failure.
   * retry_knowledge_publication (0036) decides eligibility and records the audit event; a repeat while the
   * snapshot is preparing again is a no-op. No new review: the snapshot and its approved readers are unchanged.
   */
  async retryKnowledgePublication(userId: string, organizationId: string, submissionId: string):
    Promise<RetryKnowledgePublicationResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const outcome = await client.query<{ outcome: string }>(
        "SELECT retry_knowledge_publication($1) AS outcome", [submissionId]);
      switch (outcome.rows[0]?.outcome) {
        case "PREPARING": break;
        case "NOT_FOUND": return { kind: "not-found" };
        case "NOT_FAILED": return { kind: "not-failed" };
        case "NOT_RETRYABLE": return { kind: "not-retryable" };
        case "SUPERSEDED": return { kind: "superseded" };
        default: throw new Error("Publication retry returned no outcome");
      }
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.submission_id = $1`, [submissionId]);
      if (!result.rows[0]) throw new Error("Retried submission is not readable");
      return { kind: "preparing", submission: mapSharedSubmission(result.rows[0]) };
    });
  }

  /**
   * T5.1 (FR-DOC-06): the author withdraws their own pending submission. Another member's or an unknown
   * submission is not-found; a decided one is a conflict. Repeating a completed withdrawal replays it.
   */
  async withdrawKnowledgeSubmission(userId: string, organizationId: string, submissionId: string,
    requestId: string): Promise<WithdrawKnowledgeSubmissionResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membership = await this.activeActorMembership(client, userId, organizationId);
      if (!membership) return { kind: "not-found" };
      const selected = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submission_id = $2 AND s.submitted_by_membership_id = $3`, [organizationId, submissionId, membership]);
      const row = selected.rows[0];
      if (!row) return { kind: "not-found" };
      if (row.status === "WITHDRAWN") return { kind: "replayed", submission: mapSharedSubmission(row) };
      if (row.status !== "PENDING_REVIEW") return { kind: "conflict" };
      // No FOR UPDATE: RLS would hide a decided row from it. The guarded UPDATE is the atomic step.
      const changed = await client.query(`UPDATE shared_submission SET status = 'WITHDRAWN'
        WHERE submission_id = $1 AND status = 'PENDING_REVIEW'`, [submissionId]);
      if (changed.rowCount !== 1) return { kind: "conflict" };
      await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type,
        outcome, details_json) VALUES ($1, $2, 'KNOWLEDGE_SUBMISSION_WITHDRAWN', 'SUCCESS', $3::jsonb)`,
      [organizationId, membership, JSON.stringify({ submissionId, draftId: row.shared_draft_id,
        snapshotVersionId: row.shared_draft_version_id, requestId })]);
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.submission_id = $1`, [submissionId]);
      if (!result.rows[0]) throw new Error("Withdrawn submission is not readable");
      return { kind: "withdrawn", submission: mapSharedSubmission(result.rows[0]) };
    });
  }

  /**
   * T6.1 (SDD S-16): the author asks to change the readers of their published document or to withdraw it.
   * The request reuses the current publication's frozen snapshot and is reviewed like a submission; until
   * it is approved (T6.2) the current version and readers do not change.
   */
  async requestPublicationChange(userId: string, organizationId: string, documentId: string,
    input: PublicationChangeInput, requestId: string): Promise<RequestPublicationChangeResult> {
    const reason = input.reason.trim();
    if (!reason || [...reason].length > 1000) return { kind: "invalid-request", reason: "Give a reason of 1 to 1000 characters." };
    if (input.type === "WITHDRAWAL" && input.targetReaders !== undefined) {
      return { kind: "invalid-request", reason: "A withdrawal request does not take readers." };
    }
    if (input.type === "READER_CHANGE" && input.targetReaders === undefined) {
      return { kind: "invalid-request", reason: "Choose the new readers." };
    }
    return this.withActorContext(userId, organizationId, async (client) => {
      const membership = await this.activeActorMembership(client, userId, organizationId);
      if (!membership) return { kind: "not-found" };
      const replay = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submitted_by_membership_id = $2 AND s.submit_request_id = $3`,
      [organizationId, membership, input.idempotencyKey]);
      if (replay.rows[0]) {
        return replay.rows[0].shared_draft_id === documentId && replay.rows[0].request_type === input.type
          ? { kind: "replayed", submission: mapSharedSubmission(replay.rows[0]) } : { kind: "conflict" };
      }
      const document = await client.query<{ author_membership_id: string }>(`SELECT author_membership_id FROM shared_draft
        WHERE organization_id = $1 AND shared_draft_id = $2 AND status = 'ACTIVE' FOR UPDATE`, [organizationId, documentId]);
      if (document.rows[0]?.author_membership_id !== membership) return { kind: "not-found" };
      const current = await client.query<{ published_version_id: string; submission_id: string }>(`
        SELECT cp.published_version_id, pv.submission_id FROM knowledge_current_publication cp
          JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
         WHERE cp.organization_id = $1 AND cp.shared_draft_id = $2`, [organizationId, documentId]);
      const publication = current.rows[0];
      if (!publication) return { kind: "not-published" };
      const pending = await client.query(`SELECT 1 FROM shared_submission
        WHERE shared_draft_id = $1 AND status = 'PENDING_REVIEW'`, [documentId]);
      if (pending.rowCount !== 0) return { kind: "conflict" };
      let selectionId: string | null = null;
      if (input.type === "READER_CHANGE") {
        const validation = validateSelection(input.targetReaders!,
          await this.loadSelectionFacts(client, organizationId, input.targetReaders!));
        if (!validation.ok) return { kind: "invalid-target-readers", field: validation.field, reason: validation.reason };
        selectionId = await this.insertReaderSelection(client, organizationId, validation.selection, 1);
      }
      // The request repeats the published submission's frozen snapshot, so it routes to the same reviewers.
      const inserted = await client.query<{ submission_id: string }>(`
        INSERT INTO shared_submission (organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no,
          submitted_by_membership_id, target_scope_type, target_department_id, responsible_department_id, title,
          classification, team_tag, project_tag, audience_role_ids, policy_version, review_rule, content_uri, mime_type,
          content_hash, submit_request_id, proposed_selection_id, request_type, request_reason,
          target_published_version_id)
        SELECT s.organization_id, s.shared_draft_id, s.shared_draft_version_id, s.snapshot_version_no,
               $2, s.target_scope_type, s.target_department_id, s.responsible_department_id, s.title,
               s.classification, s.team_tag, s.project_tag, s.audience_role_ids, s.policy_version, s.review_rule,
               s.content_uri, s.mime_type, s.content_hash, $3, $4::uuid, $5, $6, $7
          FROM shared_submission s WHERE s.submission_id = $1
        RETURNING submission_id`, [publication.submission_id, membership, input.idempotencyKey, selectionId,
        input.type, reason, publication.published_version_id]);
      const submissionId = inserted.rows[0]?.submission_id;
      if (!submissionId) throw new Error("Change request insert returned no identifier");
      await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type,
        outcome, details_json) VALUES ($1, $2, 'KNOWLEDGE_CHANGE_REQUESTED', 'SUCCESS', $3::jsonb)`,
      [organizationId, membership, JSON.stringify({ submissionId, draftId: documentId, requestType: input.type,
        publishedVersionId: publication.published_version_id, requestId })]);
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect} WHERE s.submission_id = $1`, [submissionId]);
      if (!result.rows[0]) throw new Error("Change request is not readable");
      return { kind: "requested", submission: mapSharedSubmission(result.rows[0]) };
    });
  }

  async listReviewerGrants(userId: string, organizationId: string): Promise<ReviewerGrantRecord[] | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client) => {
      const result = await client.query<ReviewerGrantRow>(`SELECT reviewer_grant_id, reviewer_membership_id,
        scope, department_id, classifications, level, team_tag, project_tag, status, valid_from, valid_until
        FROM reviewer_grant WHERE organization_id = $1
        ORDER BY created_at DESC, reviewer_grant_id DESC LIMIT 200`, [organizationId]);
      return result.rows.map(mapReviewerGrant);
    });
  }

  async createReviewerGrant(userId: string, organizationId: string, input: ReviewerGrantInput,
    requestId: string): Promise<ReviewerGrantRecord | null> {
    return this.withOrganizationAdmin(userId, organizationId, async (client, adminMembershipId) => {
      const target = await client.query(`SELECT 1 FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        WHERE om.membership_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'`,
      [input.reviewerMembershipId, organizationId]);
      const department = input.scope === "DEPARTMENT" && input.departmentId !== null
        ? await client.query(`SELECT 1 FROM department WHERE department_id = $1
            AND organization_id = $2 AND status = 'ACTIVE'`, [input.departmentId, organizationId])
        : null;
      if (target.rowCount === 0
        || (input.scope === "DEPARTMENT" && (!department || department.rowCount === 0))
        || (input.scope === "ORGANIZATION" && input.departmentId !== null)) return null;
      // Serialize writes for the same reviewer in this organization so concurrent requests
      // cannot both pass the duplicate check before either inserts a grant.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [organizationId, input.reviewerMembershipId]);
      const level = input.level ?? "STANDARD";
      const duplicate = await client.query(`SELECT 1 FROM reviewer_grant
        WHERE organization_id = $1 AND reviewer_membership_id = $2 AND scope = $3
          AND department_id IS NOT DISTINCT FROM $4::uuid
          AND team_tag IS NOT DISTINCT FROM $5::text
          AND project_tag IS NOT DISTINCT FROM $6::text
          AND level = $7 AND classifications @> $8::text[] AND classifications <@ $8::text[]
          AND status = 'ACTIVE' AND (valid_until IS NULL OR valid_until > now())
        LIMIT 1`, [organizationId, input.reviewerMembershipId, input.scope, input.departmentId,
        input.teamTag, input.projectTag, level, input.classifications]);
      if (duplicate.rowCount) throw new ReviewerGrantConflictError();
      let result: QueryResult<ReviewerGrantRow>;
      try {
        result = await client.query<ReviewerGrantRow>(`
        INSERT INTO reviewer_grant (organization_id, reviewer_membership_id, scope, department_id,
          granted_by_membership_id, classifications, level, team_tag, project_tag, valid_until)
        VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)
        RETURNING reviewer_grant_id, reviewer_membership_id, scope, department_id, classifications,
                  level, team_tag, project_tag, status, valid_from, valid_until`, [organizationId,
        input.reviewerMembershipId, input.scope, input.departmentId, adminMembershipId,
        input.classifications, level, input.teamTag, input.projectTag, input.validUntil]);
      } catch (error) {
        if (isUniqueViolation(error)) throw new ReviewerGrantConflictError();
        throw error;
      }
      const row = result.rows[0];
      if (!row) throw new Error("Reviewer grant insert returned no row");
      await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id,
        event_type, outcome, details_json) VALUES ($1, $2, 'REVIEWER_GRANT_CREATED', 'SUCCESS', $3::jsonb)`, [
        organizationId, adminMembershipId,
        JSON.stringify({ reviewerGrantId: row.reviewer_grant_id, reviewerMembershipId: input.reviewerMembershipId,
          scope: input.scope, departmentId: input.departmentId, requestId }),
      ]);
      return mapReviewerGrant(row);
    });
  }

  async deactivateReviewerGrant(userId: string, organizationId: string, grantId: string,
    requestId: string): Promise<boolean> {
    const result = await this.withOrganizationAdmin(userId, organizationId, async (client, adminMembershipId) => {
      const updated = await client.query<{ reviewer_membership_id: string }>(`UPDATE reviewer_grant SET status = 'INACTIVE'
        WHERE reviewer_grant_id = $1 AND organization_id = $2 AND status = 'ACTIVE'
        RETURNING reviewer_membership_id`, [grantId, organizationId]);
      if (updated.rowCount === 0) return false;
      await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id,
        event_type, outcome, details_json) VALUES ($1, $2, 'REVIEWER_GRANT_DEACTIVATED', 'SUCCESS', $3::jsonb)`, [
        organizationId, adminMembershipId, JSON.stringify({ reviewerGrantId: grantId, requestId }),
      ]);
      return true;
    });
    return result ?? false;
  }

  async listAssignedReviews(userId: string, organizationId: string): Promise<AssignedReview[] | null> {
    return this.listAssignedReviewsForResources(userId, organizationId, null);
  }

  /** Apply the same review policy as the queue, limited to notification resources rather than its first page. */
  async listAssignedReviewsForSubmissions(userId: string, organizationId: string,
    submissionIds: readonly string[]): Promise<AssignedReview[] | null> {
    return this.listAssignedReviewsForResources(userId, organizationId, [...new Set(submissionIds)]);
  }

  private async listAssignedReviewsForResources(userId: string, organizationId: string,
    submissionIds: string[] | null): Promise<AssignedReview[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const actor = await this.activeActorReviewContext(client, userId, organizationId);
      if (!actor) return null;
      const { membershipId } = actor;
      const grants = await this.loadActorReviewerGrants(client, membershipId, organizationId);
      if (!actor.isOrganizationAdmin && grants.length === 0) return [];
      if (submissionIds !== null && submissionIds.length === 0) return [];
      // Decision 0033: a reviewer's own submissions are listed like any other; the policy checks the grant.
      const resourceFilter = submissionIds === null ? "" : "AND s.submission_id = ANY($2::uuid[])";
      const listLimit = submissionIds === null ? "LIMIT 100" : "";
      const values = submissionIds === null ? [organizationId] : [organizationId, submissionIds];
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.status = 'PENDING_REVIEW'
          ${resourceFilter}
        ORDER BY s.submitted_at DESC, s.submission_id DESC ${listLimit}`, values);
      const now = new Date();
      const candidates = await Promise.all(result.rows.map(async (row) => ({
        submissionId: row.submission_id,
        snapshotId: row.shared_draft_version_id,
        title: row.title,
        submittedAt: row.submitted_at,
        versionNo: row.snapshot_version_no,
        submission: reviewAuthorizationFromRow(row, organizationId),
        reviewerGrants: grants,
        effectivePolicyVersion: 1,
        audienceEnforceable: await this.audienceEnforceable(client, organizationId, row.audience_role_ids,
          row.target_scope_type, row.responsible_department_id),
        requestType: row.request_type,
      })));
      const assigned = listAssignedReviews({ actor, now, candidates });
      if (submissionIds !== null) return assigned;
      // Names are resolved only for submissions the policy above already authorized.
      const names = await this.reviewAuthorNames(client, assigned.map((item) => item.submissionId));
      return assigned.map((item) => ({ ...item, authorName: names.get(item.submissionId) ?? null }));
    });
  }

  async listDecidedReviews(userId: string, organizationId: string): Promise<DecidedReview[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const actor = await this.activeActorReviewContext(client, userId, organizationId);
      if (!actor) return null;
      const result = await client.query<{ submission_id: string; title: string; responsible_department_id: string;
        classification: KnowledgeClassification; snapshot_version_no: number; decision: "APPROVED" | "REJECTED";
        decided_at: Date; submitted_at: Date; publication_state: SharedKnowledgeSubmission["publicationState"] }>(`
        SELECT s.submission_id, s.title, s.responsible_department_id, s.classification, s.snapshot_version_no,
               rd.decision, rd.decided_at, s.submitted_at, s.publication_state
          FROM review_decision rd
          JOIN shared_submission s ON s.submission_id = rd.submission_id
         WHERE rd.flow2 AND rd.reviewer_membership_id = $1 AND s.organization_id = $2
           AND s.shared_draft_version_id IS NOT NULL
         ORDER BY rd.decided_at DESC, s.submission_id DESC LIMIT 100`, [actor.membershipId, organizationId]);
      const names = await this.reviewAuthorNames(client, result.rows.map((row) => row.submission_id));
      return result.rows.map((row) => ({
        submissionId: row.submission_id, title: row.title, departmentId: row.responsible_department_id,
        classification: row.classification, versionNo: row.snapshot_version_no, decision: row.decision,
        decidedAt: row.decided_at, submittedAt: row.submitted_at, publicationState: row.publication_state,
        authorName: names.get(row.submission_id) ?? null,
      }));
    });
  }

  private async reviewAuthorNames(client: PoolClient, submissionIds: string[]): Promise<Map<string, string>> {
    if (submissionIds.length === 0) return new Map();
    const result = await client.query<{ submission_id: string; display_name: string }>(`
      SELECT submission_id, display_name FROM review_submission_authors($1::uuid[])`, [submissionIds.slice(0, 200)]);
    return new Map(result.rows.map((row) => [row.submission_id, row.display_name]));
  }

  async getAssignedReview(userId: string, organizationId: string, submissionId: string): Promise<ReviewDetail | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const actor = await this.activeActorReviewContext(client, userId, organizationId);
      if (!actor) return null;
      const { membershipId } = actor;
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submission_id = $2 AND s.status = 'PENDING_REVIEW'`,
      [organizationId, submissionId]);
      const row = result.rows[0];
      if (!row || (!actor.isOrganizationAdmin && row.submitted_by_membership_id === membershipId)) return null;
      const grants = await this.loadActorReviewerGrants(client, membershipId, organizationId);
      const authorize = (grant: (typeof grants)[number] | null) => canRespondToSubmission({
        actor,
        submission: reviewAuthorizationFromRow(row, organizationId),
        grant, now: new Date(), effectivePolicyVersion: 1,
      });
      const authorized = actor.isOrganizationAdmin ? authorize(null) : grants.some(authorize);
      if (!authorized) return null;
      return {
        submission: mapSharedSubmission(row), sourceUri: row.content_uri, mimeType: row.mime_type,
        submittedByMembershipId: row.submitted_by_membership_id,
        teamTag: row.team_tag, projectTag: row.project_tag,
        // Resolved only after the exact review authorization above.
        proposedReaders: await this.proposedReadersDetail(client, submissionId, mapReaderSelection(row)),
      };
    });
  }

  async decideReview(userId: string, organizationId: string, submissionId: string, action: ReviewAction,
    expectedSnapshotVersionId: string, expectedContentHash: string, comment: string | null,
    idempotencyKey: string, requestId: string, approvedReaders?: TargetReadersInput): Promise<DecideReviewResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const actor = await this.activeActorReviewContext(client, userId, organizationId);
      if (!actor) return { kind: "not-found" };
      const { membershipId } = actor;
      const requestedDecision = action === "APPROVE" ? "APPROVED" : "REJECTED";
      // Decision 0032: the active author decides a renewal asked on their behalf without a reviewer grant.
      // The reviewed routine answers NOT_APPLICABLE for everyone else, who continue on the regular path.
      if (approvedReaders === undefined) {
        const authorOutcome = (await client.query<{ outcome: string }>(
          "SELECT decide_on_behalf_renewal($1, $2, $3, $4, $5, $6) AS outcome",
          [submissionId, requestedDecision, expectedSnapshotVersionId, expectedContentHash, comment, idempotencyKey])).rows[0]?.outcome;
        if (authorOutcome === "DECIDED" || authorOutcome === "REPLAYED") {
          const decided = await client.query<SharedSubmissionRow>(`${submissionSelect}
            WHERE s.organization_id = $1 AND s.submission_id = $2`, [organizationId, submissionId]);
          if (!decided.rows[0]) throw new Error("Decided renewal is not readable");
          return { kind: authorOutcome === "DECIDED" ? "decided" : "replayed", submission: mapSharedSubmission(decided.rows[0]) };
        }
        if (authorOutcome === "CONFLICT") return { kind: "conflict" };
        if (authorOutcome === "COMMENT_REQUIRED") return { kind: "denied", reason: "COMMENT_REQUIRED" };
      }
      const replay = await client.query<{ submission_id: string; decision: string; snapshot_version_id: string;
        content_hash: string; comment: string | null } & ApprovedReaderColumns>(`
        SELECT submission_id, decision, snapshot_version_id, content_hash, comment,
               ${readerSelectionColumns("approved_selection_id", "approved")}
          FROM review_decision
         WHERE reviewer_membership_id = $1 AND decision_request_id = $2 AND flow2`, [membershipId, idempotencyKey]);
      if (replay.rows[0]) {
        const previous = replay.rows[0];
        if (previous.submission_id !== submissionId || previous.decision !== requestedDecision
          || previous.snapshot_version_id !== expectedSnapshotVersionId
          || previous.content_hash !== expectedContentHash
          || previous.comment !== (comment?.trim() || null)) return { kind: "conflict" };
        const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
          WHERE s.organization_id = $1 AND s.submission_id = $2`, [organizationId, submissionId]);
        const replayed = result.rows[0];
        if (!replayed) return { kind: "not-found" };
        // Same key, same readers (compared as a set; absent means "as proposed"), or it is a different request.
        const previousApproved = toReaderSelection(previous.approved_selection_id, previous.approved_mode,
          previous.approved_department_id, previous.approved_member_ids);
        const expectedApproved = approvedReaders === undefined ? (previousApproved ? mapReaderSelection(replayed) : null)
          : { mode: approvedReaders.mode, departmentId: approvedReaders.departmentId ?? null,
            memberIds: approvedReaders.memberIds ?? [] };
        if ((previousApproved === null) !== (expectedApproved === null)
          || (previousApproved && expectedApproved && !sameReaders(previousApproved, expectedApproved))) {
          return { kind: "conflict" };
        }
        return { kind: "replayed", submission: mapSharedSubmission(replayed) };
      }
      const selected = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submission_id = $2 FOR UPDATE OF s`, [organizationId, submissionId]);
      const row = selected.rows[0];
      if (!row) return { kind: "not-found" };
      if (row.status !== "PENDING_REVIEW") return { kind: "conflict" };
      const grants = await this.loadActorReviewerGrants(client, membershipId, organizationId);
      const proposedReaders = mapReaderSelection(row);
      // Facts are loaded inside the locked transaction; the plan checks authorization before using them.
      const readerFacts: SelectionFacts = proposedReaders && approvedReaders !== undefined
        ? await this.loadSelectionFacts(client, organizationId, approvedReaders)
        : { organizationId, departments: [], members: [] };
      // T6.2: a change request applies to the publication it names, which must still be current. One trusted
      // check for every request type: a reviewer whose grant covers the request need not be a reader (0010/0023),
      // so this is not read through publication RLS. No row (fail closed) means PUBLICATION_CHANGED.
      const publicationChange = row.request_type === "CONTENT" ? undefined : (await client.query<{
        target_is_current: boolean; newer_version_preparing: boolean }>(
        "SELECT target_is_current, newer_version_preparing FROM publication_change_target_state($1)", [submissionId])).rows
        .map((fact) => ({ targetIsCurrent: fact.target_is_current, newerVersionPreparing: fact.newer_version_preparing }))[0];
      const plan = planReviewDecision({
        actor,
        submission: { ...reviewAuthorizationFromRow(row, organizationId),
          submissionId, snapshotVersionId: row.shared_draft_version_id, contentHash: row.content_hash },
        reviewerGrants: grants,
        effectivePolicyVersion: 1,
        audienceEnforceable: await this.audienceEnforceable(client, organizationId, row.audience_role_ids,
          row.target_scope_type, row.responsible_department_id),
        policy: { kind: "SINGLE_REVIEWER" },
        now: new Date(),
        readers: { proposed: proposedReaders, facts: readerFacts },
        requestType: row.request_type,
        publicationChange,
      }, { action, expectedSnapshotVersionId, expectedContentHash, comment, approvedReaders });
      if (plan.kind === "DENIED") {
        return plan.reason === "INVALID_READERS"
          ? { kind: "denied", reason: plan.reason, field: plan.field, message: plan.message }
          : { kind: "denied", reason: plan.reason };
      }
      const readers = plan.kind === "APPROVE_FOR_PREPARATION" ? plan.readers : null;
      // A is always its own selection row, even when it equals P; P is never modified.
      const approvedSelectionId = readers
        ? await this.insertReaderSelection(client, organizationId, readers.approved, 1) : null;
      const decisionId = randomUUID();
      try {
        await client.query("SAVEPOINT review_decision_insert");
        await client.query(`INSERT INTO review_decision (review_decision_id, submission_id,
          reviewer_membership_id, decision, comment, flow2, decision_request_id,
          snapshot_version_id, content_hash, approved_selection_id)
          VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9)`, [decisionId, submissionId,
          membershipId, plan.decision, plan.comment, idempotencyKey,
          row.shared_draft_version_id, row.content_hash, approvedSelectionId]);
      } catch (error) {
        // Decision 0032: a renewal asked on the author's behalf waits for the author first (0068 validator).
        if (sqlStateOf(error) === "AR032") {
          await client.query("ROLLBACK TO SAVEPOINT review_decision_insert");
          return { kind: "denied", reason: "AUTHOR_DECISION_WINDOW" };
        }
        throw error;
      }
      await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id,
        review_decision_id, event_type, outcome, details_json)
        VALUES ($1, $2, $3, 'KNOWLEDGE_REVIEW_DECIDED', 'SUCCESS', $4::jsonb)`, [organizationId,
        membershipId, decisionId, JSON.stringify({ submissionId, snapshotVersionId: row.shared_draft_version_id,
          decision: plan.decision,
          // Decision 0033: any self-decision (reviewer or Admin) is recorded, never shown in the UI.
          selfApproved: membershipId === row.submitted_by_membership_id,
          ...(row.request_type !== "CONTENT" ? { requestType: row.request_type,
            publishedVersionId: row.target_published_version_id } : {}),
          ...(readers ? { proposedReaders: readersAuditSummary(readers.proposed),
            approvedReaders: readersAuditSummary(readers.approved), narrowed: readers.narrowed } : {}),
          requestId })]);
      const completed = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submission_id = $2`, [organizationId, submissionId]);
      if (!completed.rows[0]) throw new Error("Reviewed submission is not readable");
      return { kind: "decided", submission: mapSharedSubmission(completed.rows[0]) };
    });
  }

  async listPublishedKnowledge(userId: string, organizationId: string): Promise<PublishedKnowledge[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return null;
      // Decision 0032: expired publications stay current but leave every reader listing.
      const result = await client.query<PublishedKnowledgeRow>(`SELECT * FROM (${publishedKnowledgeSelect}
        WHERE cp.organization_id = $1) listed WHERE NOT listed.expired
        ORDER BY listed.published_at DESC, listed.published_version_id DESC`, [organizationId]);
      const items = result.rows.map(mapPublishedKnowledge);
      const names = new Map<string, string>();
      if (items.length) {
        const authors = await client.query<{ published_version_id: string; author_name: string }>(
          "SELECT * FROM list_publication_author_names($1::uuid[])", [items.slice(0, 1000).map((item) => item.id)]);
        for (const row of authors.rows) names.set(row.published_version_id, row.author_name);
      }
      return items.map((item) => ({ ...item, authorName: names.get(item.id) ?? null }));
    });
  }

  /** Decision 0032: renewal state of current publications the caller is responsible for (author, Admin, reviewer). */
  async listPublicationRenewalState(userId: string, organizationId: string): Promise<PublicationRenewalState[] | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return null;
      const result = await client.query<{ document_id: string; published_version_id: string; title: string;
        responsible_department_id: string | null; expiration_date: string | null; renewal_pending: boolean;
        author_active: boolean; is_author: boolean; can_renew: boolean; pending_submission_id: string | null;
        pending_snapshot_version_id: string | null; pending_content_hash: string | null; pending_on_behalf: boolean | null;
        pending_requested_by: string | null; pending_reason: string | null; pending_expiration_date: string | null;
        pending_requested_at: Date | null; author_window_until: Date | null; can_decide: boolean; author_name: string | null }>(
        `SELECT document_id, published_version_id, title, responsible_department_id,
                to_char(expiration_date, 'YYYY-MM-DD') AS expiration_date, renewal_pending, author_active,
                is_author, can_renew, pending_submission_id, pending_snapshot_version_id, pending_content_hash,
                pending_on_behalf, pending_requested_by, pending_reason,
                to_char(pending_expiration_date, 'YYYY-MM-DD') AS pending_expiration_date, pending_requested_at,
                author_window_until, can_decide, author_name FROM list_publication_renewal_state()`);
      return result.rows.map((row) => ({ documentId: row.document_id, publishedVersionId: row.published_version_id,
        title: row.title, responsibleDepartmentId: row.responsible_department_id, expirationDate: row.expiration_date,
        renewalPending: row.renewal_pending, authorActive: row.author_active, isAuthor: row.is_author,
        canRenew: row.can_renew, authorName: row.author_name,
        pending: row.pending_submission_id && row.pending_snapshot_version_id && row.pending_content_hash && row.pending_requested_at
          ? { submissionId: row.pending_submission_id, snapshotVersionId: row.pending_snapshot_version_id,
            contentHash: row.pending_content_hash, onBehalfOfAuthor: row.pending_on_behalf === true,
            requestedByName: row.pending_requested_by, reason: row.pending_reason ?? "",
            expirationDate: row.pending_expiration_date, requestedAt: row.pending_requested_at,
            authorWindowUntil: row.author_window_until, canDecide: row.can_decide }
          : null }));
    });
  }

  /** Decision 0032: asks for a reviewed renewal as the author, or on the author's behalf (0068 re-checks). */
  async requestPublicationRenewal(userId: string, organizationId: string, documentId: string,
    input: PublicationRenewalInput, requestId: string): Promise<RequestPublicationRenewalResult> {
    const reason = input.reason.trim();
    if (!reason || [...reason].length > 1000) return { kind: "invalid-reason" };
    if (input.expirationDate !== null && !isIsoDate(input.expirationDate)) return { kind: "invalid-date" };
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return { kind: "not-found" };
      let row: { outcome: string; submission_id: string | null } | undefined;
      try {
        await client.query("SAVEPOINT publication_renewal");
        row = (await client.query<{ outcome: string; submission_id: string | null }>(
          "SELECT outcome, submission_id FROM request_publication_renewal($1, $2::date, $3, $4)",
          [documentId, input.expirationDate, reason, input.idempotencyKey])).rows[0];
      } catch (error) {
        // A concurrent renewal from someone else wins the unique pending index.
        if (sqlStateOf(error) === "23505") {
          await client.query("ROLLBACK TO SAVEPOINT publication_renewal");
          return { kind: "pending" };
        }
        throw error;
      }
      const outcome = row?.outcome;
      if ((outcome === "REQUESTED" || outcome === "REPLAYED") && row?.submission_id) {
        const result = await client.query<SharedSubmissionRow>(`${submissionSelect} WHERE s.submission_id = $1`,
          [row.submission_id]);
        if (!result.rows[0]) throw new Error("Renewal request is not readable");
        return { kind: outcome === "REQUESTED" ? "requested" : "replayed", submission: mapSharedSubmission(result.rows[0]) };
      }
      if (outcome === "NOT_RENEWABLE") return { kind: "not-renewable" };
      if (outcome === "NOT_YET") return { kind: "not-yet" };
      if (outcome === "PENDING") return { kind: "pending" };
      if (outcome === "INVALID_DATE") return { kind: "invalid-date" };
      if (outcome === "INVALID_REASON") return { kind: "invalid-reason" };
      if (outcome === "NOT_FOUND") return { kind: "not-found" };
      throw new Error(`Renewal request returned an unknown outcome (${requestId})`);
    });
  }

  /** Decision 0032 C: idempotent 30/7-day reminders. Runs without an actor; the routine derives recipients. */
  async enqueuePublicationExpiryReminders(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      const result = await client.query<{ written: number }>("SELECT enqueue_publication_expiry_reminders() AS written");
      await client.query("COMMIT");
      return result.rows[0]?.written ?? 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPublishedKnowledge(userId: string, organizationId: string,
    publishedVersionId: string): Promise<PublishedKnowledge | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<PublishedKnowledgeRow>(`${publishedKnowledgeSelect}
        WHERE cp.organization_id = $1 AND pv.published_version_id = $2`, [organizationId, publishedVersionId]);
      if (result.rows[0]) return mapPublishedKnowledge(result.rows[0]);
      return null;
    });
  }

  async listAuthorizedAiSources(userId: string, organizationId: string, generationIds?: string[], chunkIds?: string[]): Promise<AuthorizedAiSource[] | null> {
    if ((generationIds && generationIds.length > 64) || (chunkIds && chunkIds.length > 64)) throw new Error("Too many evidence locations");
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return null;
      const result = await client.query<AuthorizedAiSourceRow>(`
        SELECT g.generation_id, g.snapshot_version_id, g.snapshot_content_hash,
               pv.published_version_id, pv.shared_draft_id, pv.title, pv.version_no,
               pv.classification, kb.scope_type AS target_scope_type, pv.management,
               ${readerSelectionColumns("pv.reader_selection_id")},
               CASE WHEN $2::uuid[] IS NULL THEN NULL ELSE
                 (SELECT jsonb_agg(chunk) FROM jsonb_array_elements(g.manifest_json->'chunks') chunk
                   WHERE $3::text[] IS NULL OR chunk->>'chunkId' = ANY($3::text[])) END AS chunks
          FROM published_knowledge_version pv
          JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
          JOIN knowledge_index_generation g
            ON g.submission_id = pv.submission_id AND g.status = 'READY'
         WHERE g.organization_id = $1 AND pv.published_version_id IN (SELECT eligible_ai_publications())
           AND ($2::uuid[] IS NULL OR g.generation_id = ANY($2::uuid[]))
         ORDER BY pv.published_at DESC, pv.published_version_id DESC
         LIMIT 501`, [organizationId, generationIds ?? null, chunkIds ?? null]);
      if (result.rows.length > 500) throw new Error("Authorized source count exceeds the request budget");
      return result.rows.map((row) => ({
        management: currentManagement(row.management),
        generationId: row.generation_id,
        chunks: row.chunks,
        snapshotVersionId: row.snapshot_version_id,
        snapshotContentHash: row.snapshot_content_hash,
        publishedVersionId: row.published_version_id,
        draftId: row.shared_draft_id,
        title: row.title,
        versionNo: row.version_no,
        classification: row.classification,
        targetScopeType: row.target_scope_type,
        targetReaders: mapReaderSelection(row),
      }));
    });
  }

  async getTargetReaderActor(userId: string, organizationId: string): Promise<ReaderActor | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<{ membership_id: string; status: ReaderActor["status"]; department_ids: string[] }>(`
        SELECT om.membership_id, om.status,
               ARRAY(SELECT dm.department_id::text FROM department_membership dm
                       JOIN department d ON d.department_id = dm.department_id
                                        AND d.organization_id = om.organization_id AND d.status = 'ACTIVE'
                      WHERE dm.membership_id = om.membership_id AND dm.status = 'ACTIVE'
                      ORDER BY dm.department_id) AS department_ids
          FROM organization_membership om
          JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
         WHERE om.user_id = $1 AND om.organization_id = $2`, [userId, organizationId]);
      const row = result.rows[0];
      return row ? { membershipId: row.membership_id, organizationId, status: row.status,
        departmentIds: row.department_ids } : null;
    });
  }

  private async proposedReadersDetail(client: PoolClient, submissionId: string,
    proposed: ReaderSelection | null): Promise<ProposedReadersDetail | null> {
    if (!proposed) return null;
    const department = proposed.departmentId === null ? null : (await client.query<{ department_id: string; name: string }>(`
      SELECT department_id, name FROM department WHERE department_id = $1`, [proposed.departmentId])).rows[0] ?? null;
    const names = proposed.memberIds.length === 0 ? new Map<string, string>() : new Map((await client.query<{
      membership_id: string; display_name: string }>(`
      SELECT membership_id, display_name FROM submission_proposed_reader_directory($1)`, [submissionId]))
      .rows.map(member => [member.membership_id, member.display_name]));
    return {
      mode: proposed.mode,
      department: department ? { id: department.department_id, name: department.name } : null,
      members: proposed.memberIds.map(membershipId => ({ membershipId, displayName: names.get(membershipId) ?? null })),
    };
  }

  /** Loads only the facts validateSelection needs, inside the caller's transaction and RLS context. */
  private async loadSelectionFacts(client: PoolClient, organizationId: string,
    input: TargetReadersInput): Promise<SelectionFacts> {
    const departmentId = input.departmentId ?? null;
    const memberIds = input.memberIds ?? [];
    const departments = departmentId === null ? [] : (await client.query<{
      department_id: string; organization_id: string; status: "ACTIVE" | "INACTIVE" | "ARCHIVED" }>(`
      SELECT department_id, organization_id, status FROM department
       WHERE department_id = $1 AND organization_id = $2`, [departmentId, organizationId])).rows;
    const members = memberIds.length === 0 || memberIds.length > maxSelectedReaders ? [] : (await client.query<{
      membership_id: string; membership_status: SelectionFacts["members"][number]["status"]; account_active: boolean;
      department_ids: string[] }>(`
      SELECT membership_id, membership_status, account_active, department_ids::text[] AS department_ids
        FROM reader_selection_member_facts($1::uuid[])`, [memberIds])).rows;
    return {
      organizationId,
      departments: departments.map(row => ({ departmentId: row.department_id, organizationId: row.organization_id,
        status: row.status })),
      members: members.map(row => ({ membershipId: row.membership_id, organizationId,
        status: row.membership_status, accountActive: row.account_active, departmentIds: row.department_ids })),
    };
  }

  private async insertReaderSelection(client: PoolClient, organizationId: string, selection: ReaderSelection,
    revision: number): Promise<string> {
    const inserted = await client.query<{ selection_id: string }>(`
      INSERT INTO reader_selection (organization_id, reader_mode, department_id, revision)
      VALUES ($1, $2, $3, $4) RETURNING selection_id`,
    [organizationId, selection.mode, selection.departmentId, revision]);
    const selectionId = inserted.rows[0]?.selection_id;
    if (!selectionId) throw new Error("Reader selection insert returned no identifier");
    if (selection.memberIds.length > 0) {
      await client.query(`
        INSERT INTO selected_reader (selection_id, organization_id, membership_id, ordinal)
        SELECT $1, $2, member.membership_id, member.ordinal
          FROM unnest($3::uuid[]) WITH ORDINALITY AS member(membership_id, ordinal)`,
      [selectionId, organizationId, selection.memberIds]);
    }
    return selectionId;
  }

  async canCreateDraft(userId: string, organizationId: string): Promise<boolean> {
    return this.withActorContext(userId, organizationId, async (client) =>
      Boolean(await this.findMembership(userId, organizationId, "PRIVATE_WORKSPACE_WRITE", client)));
  }

  async createDraft(userId: string, organizationId: string, write: DraftWrite, content: StoredContentFields, requestId: string): Promise<PrivateDraft | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const membershipId = await this.findMembership(userId, organizationId, "PRIVATE_WORKSPACE_WRITE", client);
      if (!membershipId) return null;

      await client.query(`
        INSERT INTO private_workspace (membership_id, name)
        VALUES ($1, 'Private workspace')
        ON CONFLICT (membership_id) DO NOTHING`, [membershipId]);
      const workspace = await client.query<{ workspace_id: string }>(`
        SELECT workspace_id FROM private_workspace
         WHERE membership_id = $1 AND status = 'ACTIVE'`, [membershipId]);
      const workspaceId = workspace.rows[0]?.workspace_id;
      if (!workspaceId) return null;
      const collectionId = write.collectionId ?? null;
      if (collectionId) {
        // Serialize with trash/restore so a note never lands in a collection being trashed.
        await lockTree(client, workspaceId);
        if (!await isActiveCollection(client, workspaceId, collectionId)) return null;
      }

      const draft = await client.query<{ draft_id: string; created_at: Date; updated_at: Date }>(`
        INSERT INTO draft_document (workspace_id, title, current_version_no, collection_id)
        VALUES ($1, $2, 1, $3)
        RETURNING draft_id, created_at, updated_at`, [workspaceId, write.title, collectionId]);
      const created = draft.rows[0];
      if (!created) throw new Error("Draft insert returned no row");
      const versionResult = await client.query<{ draft_version_id: string }>(`
        INSERT INTO draft_version (draft_id, version_no, source_uri, mime_type, content_hash, created_by_membership_id,
                                   text_source_uri, text_content_hash)
        VALUES ($1, 1, $2, $3, $4, $5, $6, $7)
        RETURNING draft_version_id`, [created.draft_id, content.sourceUri, content.mimeType, content.contentHash, membershipId,
        content.text?.sourceUri ?? null, content.text?.contentHash ?? null]);
      const versionId = versionResult.rows[0]?.draft_version_id;
      if (!versionId) throw new Error("Draft version insert returned no row");
      await this.appendAudit(client, organizationId, membershipId, "PRIVATE_DRAFT_CREATED", created.draft_id, 1, requestId);
      return {
        id: created.draft_id,
        organizationId,
        title: write.title,
        versionId,
        sourceUri: content.sourceUri,
        mimeType: content.mimeType,
        contentHash: content.contentHash,
        currentVersion: 1,
        createdAt: created.created_at,
        updatedAt: created.updated_at,
        collectionId,
        favoritedAt: null,
        position: null,
        text: content.text ?? null,
      };
    });
  }

  async canUpdateDraft(userId: string, organizationId: string, draftId: string): Promise<boolean> {
    return this.withActorContext(userId, organizationId, async (client) => {
    const result = await client.query(`
      SELECT 1 FROM draft_document d
      JOIN private_workspace w ON w.workspace_id = d.workspace_id
      JOIN organization_membership om ON om.membership_id = w.membership_id
     WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
       AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
       AND ${membershipPermissionSql("$4")}`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_WRITE"]);
    return result.rowCount === 1;
    });
  }

  async updateDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null, requestId: string): Promise<DraftUpdateResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      // Lock the mutable document before reading its version join. Under READ
      // COMMITTED, a waiter otherwise rechecks the new document against an old
      // joined-version snapshot and can incorrectly report an owned draft missing.
      const locked = await client.query(`SELECT d.draft_id FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
        JOIN organization_membership om ON om.membership_id = w.membership_id
        WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
          AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
          AND ${membershipPermissionSql("$4")}
        FOR UPDATE OF d`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_WRITE"]);
      if (!locked.rowCount) return { kind: "not-found" };
      const currentResult = await client.query<{
        membership_id: string;
        title: string;
        draft_version_id: string;
        source_uri: string;
        mime_type: string;
        content_hash: string;
        current_version_no: number;
        created_at: Date;
        updated_at: Date;
        collection_id: string | null;
        favorited_at: Date | null;
        sort_position: number | null;
        text_source_uri: string | null;
        text_content_hash: string | null;
        sealed: boolean;
      }>(`
        SELECT om.membership_id, d.title, v.draft_version_id, v.source_uri, v.mime_type, v.content_hash,
               d.current_version_no, d.created_at, d.updated_at, d.collection_id, d.favorited_at, d.sort_position,
               v.text_source_uri, v.text_content_hash,
               (v.sealed_at IS NOT NULL
                OR EXISTS (SELECT 1 FROM shared_draft s WHERE s.source_private_version_id = v.draft_version_id)
                OR EXISTS (SELECT 1 FROM shared_submission s WHERE s.draft_version_id = v.draft_version_id)) AS sealed
          FROM draft_document d
          JOIN private_workspace w ON w.workspace_id = d.workspace_id
          JOIN organization_membership om ON om.membership_id = w.membership_id
          JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
         WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
           AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
           AND ${membershipPermissionSql("$4")}`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_WRITE"]);
      const current = currentResult.rows[0];
      if (!current) return { kind: "not-found" };
      if (current.current_version_no !== expectedVersion) return { kind: "conflict", currentVersion: current.current_version_no };
      // Decision 0034: a text note takes text and a PDF item takes a PDF; only the title changes across kinds.
      if (content && content.mimeType !== current.mime_type) return { kind: "wrong-kind" };

      const version = expectedVersion + 1;
      const title = patch.title ?? current.title;
      const source: StoredContentFields = content ? { ...content, text: content.text ?? null } : {
        sourceUri: current.source_uri,
        mimeType: current.mime_type as StoredContentFields["mimeType"],
        contentHash: current.content_hash,
        text: storedText(current.text_source_uri, current.text_content_hash),
      };
      await client.query(`
        UPDATE draft_document
           SET title = $2, current_version_no = $3, updated_at = now()
         WHERE draft_id = $1`, [draftId, title, version]);
      let versionId: string;
      const replacedSourceUris: string[] = [];
      if (!current.sealed) {
        // Decision 0031: the open current version is overwritten instead of adding history.
        await client.query(`
          UPDATE draft_version SET version_no = $2, source_uri = $3, mime_type = $4, content_hash = $5,
                 text_source_uri = $6, text_content_hash = $7
           WHERE draft_version_id = $1`, [current.draft_version_id, version, source.sourceUri, source.mimeType, source.contentHash,
          source.text?.sourceUri ?? null, source.text?.contentHash ?? null]);
        versionId = current.draft_version_id;
        // Objects the overwrite made unreachable are erased by the caller after commit.
        for (const replaced of [current.source_uri, current.text_source_uri]) {
          if (!replaced || replaced === source.sourceUri || replaced === source.text?.sourceUri) continue;
          const shared = await client.query(`SELECT 1 FROM draft_version WHERE source_uri = $1 OR text_source_uri = $1 LIMIT 1`, [replaced]);
          if (!shared.rowCount) replacedSourceUris.push(replaced);
        }
      } else {
        // A contributed (sealed) version stays as it is; the note continues in a new open version.
        const versionResult = await client.query<{ draft_version_id: string }>(`
          INSERT INTO draft_version (draft_id, version_no, source_uri, mime_type, content_hash, created_by_membership_id,
                                     text_source_uri, text_content_hash)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING draft_version_id`, [draftId, version, source.sourceUri, source.mimeType, source.contentHash, current.membership_id,
          source.text?.sourceUri ?? null, source.text?.contentHash ?? null]);
        const inserted = versionResult.rows[0]?.draft_version_id;
        if (!inserted) throw new Error("Draft version insert returned no row");
        versionId = inserted;
      }
      await this.appendAudit(client, organizationId, current.membership_id, "PRIVATE_DRAFT_UPDATED", draftId, version, requestId);
      const updated = await client.query<{ created_at: Date; updated_at: Date }>(`
        SELECT created_at, updated_at FROM draft_document WHERE draft_id = $1`, [draftId]);
      const timestamps = updated.rows[0];
      if (!timestamps) throw new Error("Updated draft disappeared within transaction");
      return {
        kind: "updated",
        draft: {
          id: draftId,
          organizationId,
          title,
          versionId,
          sourceUri: source.sourceUri,
          mimeType: source.mimeType,
          contentHash: source.contentHash,
          currentVersion: version,
          createdAt: timestamps.created_at,
          updatedAt: timestamps.updated_at,
          collectionId: current.collection_id,
          favoritedAt: current.favorited_at,
          position: current.sort_position,
          text: source.text ?? null,
        },
        replacedSourceUris,
      };
    });
  }

  private async findPrivateContributionSource(client: PoolClient, userId: string, organizationId: string, sourceVersionId: string): Promise<PrivateContributionSource | null> {
    const result = await client.query<{
      draft_version_id: string; membership_id: string; title: string;
      source_uri: string; mime_type: string; content_hash: string;
    }>(`
      SELECT v.draft_version_id, om.membership_id, d.title, v.source_uri, v.mime_type, v.content_hash
        FROM draft_version v
        JOIN draft_document d ON d.draft_id = v.draft_id
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
        JOIN organization_membership om ON om.membership_id = w.membership_id
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
       WHERE v.draft_version_id = $1 AND om.user_id = $2 AND om.organization_id = $3
         AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE' AND d.trashed_at IS NULL
         AND ${membershipPermissionSql("$4")}`, [sourceVersionId, userId, organizationId, "PRIVATE_WORKSPACE_READ"]);
    const row = result.rows[0];
    return row ? {
      versionId: row.draft_version_id,
      organizationId,
      ownerMembershipId: row.membership_id,
      title: row.title,
      sourceUri: row.source_uri,
      mimeType: row.mime_type,
      contentHash: row.content_hash,
    } : null;
  }

  private async findSharedDraftByCreateRequest(client: PoolClient, membershipId: string, organizationId: string, requestKey: string): Promise<{ draft: SharedKnowledgeDraft; createRequestHash: string } | null> {
    const result = await client.query<SharedDraftRow>(`${sharedDraftSelect}
       WHERE d.organization_id = $1 AND d.author_membership_id = $2 AND d.create_request_id = $3`,
    [organizationId, membershipId, requestKey]);
    const row = result.rows[0];
    return row ? {
      createRequestHash: row.create_request_hash,
      draft: mapSharedDraft(row, organizationId),
    } : null;
  }

  private async findMembership(userId: string, organizationId: string, permissionCode: string, client: Pool | PoolClient = this.pool): Promise<string | null> {
    const result = await client.query<{ membership_id: string }>(`
      SELECT om.membership_id
        FROM organization_membership om
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
         AND ${membershipPermissionSql("$3")}`, [userId, organizationId, permissionCode]);
    return result.rows[0]?.membership_id ?? null;
  }

  private async activeActorMembership(client: PoolClient, userId: string, organizationId: string,
    expectedMembershipId?: string): Promise<string | null> {
    const result = await client.query<{ membership_id: string }>(`
      SELECT om.membership_id FROM organization_membership om
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
      WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
        AND ($3::uuid IS NULL OR om.membership_id = $3::uuid)`,
    [userId, organizationId, expectedMembershipId ?? null]);
    return result.rows[0]?.membership_id ?? null;
  }

  private async activeActorReviewContext(client: PoolClient, userId: string, organizationId: string) {
    const membershipId = await this.activeActorMembership(client, userId, organizationId);
    if (!membershipId) return null;
    const admin = await client.query(`SELECT 1 FROM role_assignment ra
      JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN'
        AND r.is_system AND r.status = 'ACTIVE'
      JOIN access_scope s ON s.access_scope_id = ra.access_scope_id
        AND s.organization_id = $2 AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
      WHERE ra.membership_id = $1 AND ra.status = 'ACTIVE' AND ra.valid_from <= now()
        AND (ra.valid_until IS NULL OR ra.valid_until > now())`, [membershipId, organizationId]);
    const isOrganizationAdmin = admin.rowCount !== 0;
    await client.query("SELECT set_config('arden.org_admin', $1, true)", [isOrganizationAdmin ? "true" : "false"]);
    return { membershipId, organizationId, status: "ACTIVE" as const, isOrganizationAdmin };
  }

  private async loadActorReviewerGrants(client: PoolClient, membershipId: string, organizationId: string) {
    const result = await client.query<ReviewerGrantRow>(`
      SELECT reviewer_grant_id, reviewer_membership_id, department_id, classifications,
             scope, level, team_tag, project_tag, status, valid_from, valid_until
        FROM reviewer_grant WHERE organization_id = $1 AND reviewer_membership_id = $2`,
    [organizationId, membershipId]);
    return result.rows.map((row) => ({
      membershipId: row.reviewer_membership_id,
      organizationId,
      scope: row.scope,
      departmentId: row.department_id,
      status: row.status,
      classifications: row.classifications,
      level: row.level,
      teamTag: row.team_tag,
      projectTag: row.project_tag,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
    }));
  }

  /** The actor's active primary department in an active department, read under the actor's own RLS context. */
  private async actorPrimaryDepartment(client: PoolClient, userId: string, organizationId: string): Promise<string | null> {
    const result = await client.query<{ department_id: string }>(`
      SELECT dm.department_id FROM department_membership dm
        JOIN organization_membership om ON om.membership_id = dm.membership_id
        JOIN department d ON d.department_id = dm.department_id AND d.organization_id = om.organization_id
       WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
         AND dm.is_primary AND dm.status = 'ACTIVE' AND d.status = 'ACTIVE'
       LIMIT 1`, [userId, organizationId]);
    return result.rows[0]?.department_id ?? null;
  }

  private async audienceEnforceable(client: PoolClient, organizationId: string, audienceIds: string[],
    targetScopeType: "ORGANIZATION" | "DEPARTMENT", departmentId: string | null): Promise<boolean> {
    const result = await client.query<{ enforceable: boolean }>(`SELECT audience_snapshot_enforceable(
      $1, $2::uuid[], $3, $4) AS enforceable`, [organizationId, audienceIds, targetScopeType, departmentId]);
    return result.rows[0]?.enforceable === true;
  }

  private async appendAudit(client: PoolClient, organizationId: string, membershipId: string, eventType: string, draftId: string, version: number, requestId: string) {
    await client.query(`
      INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
      VALUES ($1, $2, $3, 'SUCCESS', $4::jsonb)`, [organizationId, membershipId, eventType, JSON.stringify({ draftId, version, requestId })]);
  }

  /**
   * Decision 0029 retention context: no actor or organization. Migration 0062
   * policies expose only trash older than 30 days and purged notes with
   * pending content erasure, and allow only tombstone updates.
   */
  private async withPrivateTrashRetention<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query(`SELECT set_config('arden.actor_id', '', true), set_config('arden.organization_id', '', true),
        set_config('arden.private_trash_retention', 'true', true)`);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async withActorContext<T>(userId: string, organizationId: string | null, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SET LOCAL search_path TO arden, public");
      await client.query("SELECT set_config('arden.actor_id', $1, true), set_config('arden.organization_id', $2, true)", [userId, organizationId ?? ""]);
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export type DraftCursor = { updatedAt: string; draftId: string };
export type StoredTextFields = { sourceUri: string; contentHash: string };
function storedText(sourceUri: string | null, contentHash: string | null): StoredTextFields | null {
  return sourceUri && contentHash ? { sourceUri, contentHash } : null;
}
/** Decision 0034: `text` is the extracted text of a PDF item (absent or null for text notes and PDFs without text). */
export type StoredContentFields = { sourceUri: string; mimeType: "text/plain" | "application/pdf"; contentHash: string;
  text?: StoredTextFields | null };

function organizationSlug(name: string): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  return `${base || "organization"}-${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
