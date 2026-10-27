import type { Pool, PoolClient } from "pg";
import { PgAudienceGroupStore, type AudienceGroupStore } from "../audiences/store.js";
import { PgSystemAdministrationStore, type SystemAdministrationStore } from "../system-administration/store.js";
import { createHash, randomUUID } from "node:crypto";
import { canCreateSharedDraft, canRespondToSubmission, canSubmitSnapshot, resolveResponsibleDepartment, type KnowledgeClassification } from "../knowledge/policy.js";
import { listAssignedReviews, type AssignedReview } from "../knowledge/review-queue.js";
import { planReviewDecision, type ReviewAction, type ReviewDecisionPlan } from "../knowledge/review-decision.js";

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
};

export type DraftListItem = Omit<PrivateDraft, "versionId" | "sourceUri" | "mimeType" | "contentHash">;
export type DraftWrite = { title: string; body: string };
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
  title?: string;
  body?: string;
  classification?: KnowledgeClassification;
  responsibleDepartmentId?: string | null;
  targetScopeType?: "ORGANIZATION" | "DEPARTMENT" | null;
  teamTag?: string | null;
  projectTag?: string | null;
  audienceRoleIds?: string[];
};
export type UpdateSharedDraftResult =
  | { kind: "not-found" }
  | { kind: "conflict"; currentVersion: number }
  | { kind: "invalid-metadata" }
  | { kind: "updated"; draft: SharedKnowledgeDraft };
export type SharedKnowledgeSubmission = {
  id: string;
  draftId: string;
  snapshotVersionId: string;
  title: string;
  classification: KnowledgeClassification;
  responsibleDepartmentId: string;
  targetScopeType: "ORGANIZATION" | "DEPARTMENT";
  targetDepartmentId: string | null;
  audienceRoleIds: string[];
  contentHash: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  publicationState: "NONE" | "PREPARING" | "ACTIVE" | "FAILED" | "SUPERSEDED";
  submittedAt: Date;
  publishedVersionId: string | null;
  decisionComment: string | null;
};
export type SubmitKnowledgeDraftResult =
  | { kind: "submitted"; submission: SharedKnowledgeSubmission }
  | { kind: "replayed"; submission: SharedKnowledgeSubmission }
  | { kind: "not-found" }
  | { kind: "conflict" }
  | { kind: "not-ready" };
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
export type ReviewerGrantRecord = Omit<ReviewerGrantInput, "level"> & {
  level: "STANDARD" | "SPECIALIST" | "SENIOR";
  id: string;
  status: "ACTIVE" | "INACTIVE";
  validFrom: Date;
};
export type ReviewDetail = {
  submission: SharedKnowledgeSubmission;
  sourceUri: string;
  mimeType: string;
  submittedByMembershipId: string;
  teamTag: string | null;
  projectTag: string | null;
};
export type DecideReviewResult =
  | { kind: "decided"; submission: SharedKnowledgeSubmission }
  | { kind: "replayed"; submission: SharedKnowledgeSubmission }
  | { kind: "denied"; reason: Extract<ReviewDecisionPlan, { kind: "DENIED" }>["reason"] }
  | { kind: "not-found" }
  | { kind: "conflict" };
export type PublishedKnowledge = {
  id: string;
  draftId: string;
  title: string;
  classification: KnowledgeClassification;
  responsibleDepartmentId: string;
  contentHash: string;
  sourceUri: string;
  audienceRoleIds: string[];
  publishedAt: Date;
  validFrom: Date;
  validUntil: Date | null;
};
export type AuthorizedAiSource = {
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
};
type SharedDraftRow = {
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
};
const sharedDraftSelect = `
  SELECT d.shared_draft_id, d.title, d.classification, d.source_private_version_id,
         d.author_membership_id, d.status,
         d.responsible_department_id, d.target_scope_type, d.team_tag, d.project_tag,
         d.create_request_hash, d.current_version_no, d.created_at, d.updated_at,
         EXISTS (SELECT 1 FROM shared_submission pending
                 WHERE pending.shared_draft_id = d.shared_draft_id
                   AND pending.status = 'PENDING_REVIEW') AS has_pending_submission,
         v.shared_draft_version_id, v.content_uri, v.mime_type, v.content_hash,
         ARRAY(SELECT a.role_id::text FROM shared_draft_audience a
               WHERE a.shared_draft_id = d.shared_draft_id ORDER BY a.role_id) AS audience_role_ids
    FROM shared_draft d
    JOIN shared_draft_version v ON v.shared_draft_id = d.shared_draft_id
                               AND v.version_no = d.current_version_no`;

function mapSharedDraft(row: SharedDraftRow, organizationId: string): SharedKnowledgeDraft {
  return {
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
type SharedSubmissionRow = {
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
};
// organization_wide: the frozen audience includes the organization audience. That kind is valid only at
// Organization scope (audience_snapshot_enforceable) and audience_member_read shows it to every active member,
// so it is detected even when the reviewer cannot see the snapshot's group or department audiences.
const submissionSelect = `
  SELECT s.submission_id, s.shared_draft_id, s.shared_draft_version_id,
         s.snapshot_version_no,
         s.title, s.classification, s.responsible_department_id, s.target_scope_type,
         s.target_department_id, s.audience_role_ids, s.content_hash, s.content_uri,
         s.mime_type, s.status, s.publication_state, s.submitted_at, s.submitted_by_membership_id,
         s.team_tag, s.project_tag, s.policy_version, s.review_rule,
         (s.target_scope_type = 'ORGANIZATION' AND EXISTS (
           SELECT 1 FROM audience a WHERE a.organization_id = s.organization_id
              AND a.audience_id = ANY(s.audience_role_ids) AND a.kind = 'ORGANIZATION_ALL')) AS organization_wide,
         cp.published_version_id,
         rd.comment AS decision_comment
    FROM shared_submission s
    LEFT JOIN published_knowledge_version pv ON pv.submission_id = s.submission_id
    LEFT JOIN knowledge_current_publication cp ON cp.published_version_id = pv.published_version_id
    LEFT JOIN review_decision rd ON rd.submission_id = s.submission_id AND rd.flow2`;
function mapSharedSubmission(row: SharedSubmissionRow): SharedKnowledgeSubmission {
  return {
    id: row.submission_id,
    draftId: row.shared_draft_id,
    snapshotVersionId: row.shared_draft_version_id,
    title: row.title,
    classification: row.classification,
    responsibleDepartmentId: row.responsible_department_id,
    targetScopeType: row.target_scope_type,
    targetDepartmentId: row.target_department_id,
    audienceRoleIds: row.audience_role_ids,
    contentHash: row.content_hash,
    status: row.status,
    publicationState: row.publication_state,
    submittedAt: row.submitted_at,
    publishedVersionId: row.published_version_id,
    decisionComment: row.decision_comment,
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
type PublishedKnowledgeRow = {
  published_version_id: string;
  shared_draft_id: string;
  title: string;
  classification: KnowledgeClassification;
  responsible_department_id: string;
  content_hash: string;
  content_uri: string;
  audience_role_ids: string[];
  published_at: Date;
  valid_from: Date;
  valid_until: Date | null;
};
type AuthorizedAiSourceRow = {
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
         pv.responsible_department_id, pv.content_hash, pv.content_uri,
         pv.audience_role_ids, pv.published_at,
         cp.valid_from, cp.valid_until
    FROM knowledge_current_publication cp
    JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id`;
function mapPublishedKnowledge(row: PublishedKnowledgeRow): PublishedKnowledge {
  return {
    id: row.published_version_id,
    draftId: row.shared_draft_id,
    title: row.title,
    classification: row.classification,
    responsibleDepartmentId: row.responsible_department_id,
    contentHash: row.content_hash,
    sourceUri: row.content_uri,
    audienceRoleIds: row.audience_role_ids,
    publishedAt: row.published_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
  };
}
export type OrganizationSetup = { name: string; departmentName?: string };
export type CreatedOrganization = { organizationId: string; name: string; departmentId: string; departmentName: string };
export type CreatedInvitation = { invitationId: string; email: string; organizationName: string; expiresAt: Date };
export type OrganizationAdminData = {
  departments: Array<{ id: string; name: string; code?: string; isBase?: boolean; defaultRoleId: string; defaultRoleName: string }>;
  roles: Array<{ id: string; name: string; code: string; isDefault: boolean }>;
  members: Array<{ id: string; email: string; name: string; status: MembershipStatus; departmentId: string | null; departmentIds?: string[]; roleIds: string[]; roleNames: string[] }>;
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
  | { success: true; reassignedCount?: number }
  | { success: false; errorReason: "NOT_FOUND" | "BASE_DEPARTMENT" };

export interface ArdenDataRepository {
  readonly audienceGroups?: AudienceGroupStore;
  readonly systemAdministration?: SystemAdministrationStore;
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
  getDraft(userId: string, organizationId: string, draftId: string): Promise<PrivateDraft | null>;
  canCreateDraft(userId: string, organizationId: string): Promise<boolean>;
  createDraft(userId: string, organizationId: string, write: DraftWrite, content: StoredContentFields, requestId: string): Promise<PrivateDraft | null>;
  canUpdateDraft(userId: string, organizationId: string, draftId: string): Promise<boolean>;
  updateDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null, requestId: string): Promise<{ kind: "not-found" } | { kind: "conflict"; currentVersion: number } | { kind: "updated"; draft: PrivateDraft }>;
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
  updateKnowledgeDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number,
    patch: SharedDraftPatch, content: StoredContentFields | null, requestId: string): Promise<UpdateSharedDraftResult>;
  submitKnowledgeDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number,
    idempotencyKey: string, requestId: string): Promise<SubmitKnowledgeDraftResult>;
  listKnowledgeSubmissions(userId: string, organizationId: string): Promise<SharedKnowledgeSubmission[] | null>;
  listReviewerGrants(userId: string, organizationId: string): Promise<ReviewerGrantRecord[] | null>;
  createReviewerGrant(userId: string, organizationId: string, input: ReviewerGrantInput, requestId: string): Promise<ReviewerGrantRecord | null>;
  deactivateReviewerGrant(userId: string, organizationId: string, grantId: string, requestId: string): Promise<boolean>;
  listAssignedReviews(userId: string, organizationId: string): Promise<AssignedReview[] | null>;
  getAssignedReview(userId: string, organizationId: string, submissionId: string): Promise<ReviewDetail | null>;
  decideReview(userId: string, organizationId: string, submissionId: string, action: ReviewAction,
    expectedSnapshotVersionId: string, expectedContentHash: string, comment: string | null,
    idempotencyKey: string, requestId: string): Promise<DecideReviewResult>;
  listPublishedKnowledge(userId: string, organizationId: string): Promise<PublishedKnowledge[] | null>;
  getPublishedKnowledge(userId: string, organizationId: string, publishedVersionId: string): Promise<PublishedKnowledge | null>;
  listAuthorizedAiSources(userId: string, organizationId: string, generationIds?: string[], chunkIds?: string[]): Promise<AuthorizedAiSource[] | null>;
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
  readonly audienceGroups: AudienceGroupStore;
  readonly systemAdministration: SystemAdministrationStore;
  constructor(private readonly pool: Pool) {
    this.audienceGroups = new PgAudienceGroupStore((user, org, work) => this.withOrganizationAdmin(user, org, work));
    this.systemAdministration = new PgSystemAdministrationStore((user, work) => this.withSystemAdmin(user, work));
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

      const baseDepartmentName = setup.departmentName?.trim() || "General";
      const role = await client.query<{ role_id: string }>(`
        INSERT INTO role (organization_id, code, name, description, is_system)
        VALUES ($1, 'DEPT_DEFAULT_BOOTSTRAP', $2, 'Default role for the base department', false)
        RETURNING role_id`, [organizationId, `${baseDepartmentName} Member`]);
      const roleId = role.rows[0]?.role_id;
      if (!roleId) throw new Error("Default role creation returned no id");
      const department = await client.query<{ department_id: string }>(`
        INSERT INTO department (organization_id, code, name, default_role_id)
        VALUES ($1, 'GENERAL', $2, $3)
        RETURNING department_id`, [organizationId, baseDepartmentName, roleId]);
      const departmentId = department.rows[0]?.department_id;
      if (!departmentId) throw new Error("Department creation returned no id");
      await client.query(`INSERT INTO audience (
          audience_id, organization_id, kind, department_id, name, description, is_managed, legacy_role_id)
        VALUES ($1, $2, 'DEPARTMENT_ALL', $3, $4,
          'Every active member of the department', true, $1)`,
      [roleId, organizationId, departmentId, `${baseDepartmentName} members`]);
      await client.query(`
        INSERT INTO role_permission (role_id, permission_id)
        SELECT $1, permission_id FROM permission
         WHERE code IN ('PUBLISHED_CONTENT_VIEW', 'PUBLISHED_CONTENT_SEARCH', 'PUBLISHED_CONTENT_CONTRIBUTE',
                        'PRIVATE_WORKSPACE_READ', 'PRIVATE_WORKSPACE_WRITE')
        ON CONFLICT DO NOTHING`, [roleId]);
      const departmentScope = await client.query<{ access_scope_id: string }>(`
        INSERT INTO access_scope (organization_id, department_id, scope_type)
        VALUES ($1, $2, 'DEPARTMENT') RETURNING access_scope_id`, [organizationId, departmentId]);
      const organizationScope = await client.query<{ access_scope_id: string }>(`
        INSERT INTO access_scope (organization_id, scope_type)
        VALUES ($1, 'ORGANIZATION') RETURNING access_scope_id`, [organizationId]);
      const membership = await client.query<{ membership_id: string }>(`
        INSERT INTO organization_membership (organization_id, user_id, status)
        VALUES ($1, $2, 'ACTIVE') RETURNING membership_id`, [organizationId, userId]);
      const membershipId = membership.rows[0]?.membership_id;
      if (!membershipId) throw new Error("Creator membership creation returned no id");
      await client.query(`
        INSERT INTO department_membership (membership_id, department_id, is_primary, status)
        VALUES ($1, $2, true, 'ACTIVE')`, [membershipId, departmentId]);
      await client.query(`
        INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
        VALUES ($1, $2, $3), ($1,
          (SELECT role_id FROM role WHERE organization_id IS NULL AND code = 'ORG_ADMIN' AND is_system), $4)`,
      [membershipId, roleId, departmentScope.rows[0]?.access_scope_id, organizationScope.rows[0]?.access_scope_id]);
      await client.query(`
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES ($1, $2, 'ORGANIZATION_CREATED', 'SUCCESS', $3::jsonb)`,
      [organizationId, membershipId, JSON.stringify({ departmentId, requestId })]);
      await client.query("COMMIT");
      return { organizationId, name: setup.name, departmentId, departmentName: baseDepartmentName };
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
        SELECT d.department_id AS id, d.name, d.code, (d.code = 'GENERAL') AS is_base,
               r.role_id AS default_role_id, r.name AS default_role_name
          FROM department d JOIN role r ON r.role_id = d.default_role_id
         WHERE d.organization_id = $1 AND d.status = 'ACTIVE'
         ORDER BY (d.code = 'GENERAL') DESC, d.name`, [organizationId]);
      const roles = await client.query<{ id: string; name: string; code: string; is_default: boolean }>(`
        SELECT r.role_id AS id, r.name, r.code,
               EXISTS (SELECT 1 FROM department d WHERE d.default_role_id = r.role_id) AS is_default
          FROM role r WHERE r.organization_id = $1 AND r.status = 'ACTIVE' ORDER BY r.name`, [organizationId]);
      const members = await client.query<{
        id: string; email: string; name: string; status: MembershipStatus; department_id: string | null;
        role_ids: string[] | null; role_names: string[] | null; department_ids: string[];
      }>(`
        SELECT om.membership_id AS id, ua.email, ua.full_name AS name, om.status,
               max(dm.department_id::text) FILTER (WHERE dm.is_primary AND dm.status = 'ACTIVE')::uuid AS department_id,
               ARRAY(SELECT all_dm.department_id::text FROM department_membership all_dm
                 JOIN department all_d USING(department_id)
                 WHERE all_dm.membership_id = om.membership_id AND all_dm.status = 'ACTIVE'
                   AND all_d.status = 'ACTIVE' AND all_d.organization_id = $1) AS department_ids,
               COALESCE(array_agg(DISTINCT r.role_id::text) FILTER (WHERE r.role_id IS NOT NULL), '{}') AS role_ids,
               COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS role_names
          FROM organization_membership om JOIN user_account ua ON ua.user_id = om.user_id
          LEFT JOIN department_membership dm ON dm.membership_id = om.membership_id AND dm.is_primary AND dm.status = 'ACTIVE'
          LEFT JOIN role_assignment ra ON ra.membership_id = om.membership_id AND ra.status = 'ACTIVE'
            AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
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
      [roleId, organizationId, departmentId, `${name} members`, actorMembershipId]);
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

      if (department.code === "GENERAL") {
        return { success: false, errorReason: "BASE_DEPARTMENT" };
      }

      const baseDept = await client.query<{ department_id: string; default_role_id: string; name: string }>(`
        SELECT d.department_id, d.default_role_id, d.name
          FROM department d
         WHERE d.organization_id = $1 AND d.code = 'GENERAL' AND d.status = 'ACTIVE'
         LIMIT 1`, [organizationId]);
      let targetBase = baseDept.rows[0];
      if (!targetBase) {
        const fallback = await client.query<{ department_id: string; default_role_id: string; name: string }>(`
          SELECT d.department_id, d.default_role_id, d.name
            FROM department d
           WHERE d.organization_id = $1 AND d.department_id != $2 AND d.status = 'ACTIVE'
           ORDER BY d.created_at ASC
           LIMIT 1`, [organizationId, departmentId]);
        targetBase = fallback.rows[0];
        if (!targetBase) {
          return { success: false, errorReason: "BASE_DEPARTMENT" };
        }
      }

      const baseScope = await client.query<{ access_scope_id: string }>(`
        SELECT access_scope_id FROM access_scope
         WHERE organization_id = $1 AND department_id = $2 AND scope_type = 'DEPARTMENT' AND status = 'ACTIVE'
         LIMIT 1`, [organizationId, targetBase.department_id]);
      const baseAccessScopeId = baseScope.rows[0]?.access_scope_id;

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

      for (const row of primaryMembers.rows) {
        await client.query(`
          INSERT INTO department_membership (membership_id, department_id, is_primary, status, assigned_at, removed_at)
          VALUES ($1, $2, true, 'ACTIVE', now(), null)
          ON CONFLICT (membership_id, department_id)
          DO UPDATE SET is_primary = true, status = 'ACTIVE', assigned_at = now(), removed_at = null`,
          [row.membership_id, targetBase.department_id]);

        if (baseAccessScopeId) {
          await client.query(`
            INSERT INTO role_assignment (membership_id, role_id, access_scope_id)
            VALUES ($1, $2, $3)
            ON CONFLICT DO NOTHING`,
            [row.membership_id, targetBase.default_role_id, baseAccessScopeId]);
        }
      }

      await client.query(`
        UPDATE organization_invitation
           SET department_id = $1
         WHERE department_id = $2 AND organization_id = $3 AND status = 'PENDING'`,
        [targetBase.department_id, departmentId, organizationId]);

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
          reassignedCount: primaryMembers.rows.length,
          reassignedToDepartmentId: targetBase.department_id,
          requestId,
        })]);

      return { success: true, reassignedCount: primaryMembers.rows.length };
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
      const administrator = await client.query(`SELECT 1 FROM system_administrator
        WHERE user_id = $1 AND status = 'ACTIVE'`, [userId]);
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

  async listDrafts(userId: string, organizationId: string, limit: number, cursor: DraftCursor | null): Promise<{ items: DraftListItem[]; nextCursor: DraftCursor | null } | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
    const membershipId = await this.findMembership(userId, organizationId, "PRIVATE_WORKSPACE_READ", client);
    if (!membershipId) return null;

    const result = await client.query<{
      draft_id: string;
      title: string;
      current_version_no: number;
      created_at: Date;
      updated_at: Date;
    }>(`
      SELECT d.draft_id, d.title, d.current_version_no, d.created_at, d.updated_at
        FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
       WHERE w.membership_id = $1 AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
         AND ($2::timestamptz IS NULL OR (d.updated_at, d.draft_id) < ($2, $3::uuid))
       ORDER BY d.updated_at DESC, d.draft_id DESC
       LIMIT $4`, [membershipId, cursor?.updatedAt ?? null, cursor?.draftId ?? null, limit + 1]);

    const hasNextPage = result.rows.length > limit;
    const page = hasNextPage ? result.rows.slice(0, limit) : result.rows;
    const items = page.map((row) => ({
      id: row.draft_id,
      organizationId,
      title: row.title,
      currentVersion: row.current_version_no,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    const last = page.at(-1);
    return {
      items,
      nextCursor: hasNextPage && last ? { updatedAt: last.updated_at.toISOString(), draftId: last.draft_id } : null,
    };
    });
  }

  async getDraft(userId: string, organizationId: string, draftId: string): Promise<PrivateDraft | null> {
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
    }>(`
      SELECT d.draft_id, v.draft_version_id, d.title, v.source_uri, v.mime_type, v.content_hash,
             d.current_version_no, d.created_at, d.updated_at
        FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
        JOIN organization_membership om ON om.membership_id = w.membership_id
        JOIN draft_version v ON v.draft_id = d.draft_id AND v.version_no = d.current_version_no
       WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
         AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
         AND ${membershipPermissionSql("$4")}`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_READ"]);
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
      const source = await this.findPrivateContributionSource(client, userId, organizationId, input.sourceVersionId);
      if (!source || !canCreateSharedDraft({
        actor: { membershipId: input.actorMembershipId, organizationId, status: "ACTIVE" },
        source: { kind: "private", organizationId: source.organizationId, ownerMembershipId: source.ownerMembershipId },
        now: new Date(),
      })) return { kind: "unavailable" };
      if (source.sourceUri !== input.expectedSource.sourceUri || source.contentHash !== input.expectedSource.contentHash
        || source.mimeType !== "text/plain" || input.copiedContent.mimeType !== source.mimeType
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
      await client.query(`UPDATE shared_draft SET title = $3, classification = $4,
        responsible_department_id = $5, target_scope_type = $6, team_tag = $7, project_tag = $8
        WHERE shared_draft_id = $1 AND organization_id = $2`, [draftId, organizationId, next.title,
        next.classification, next.responsibleDepartmentId, next.targetScopeType, next.teamTag, next.projectTag]);
      if (patch.audienceRoleIds !== undefined) {
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
          audience_role_ids, policy_version, content_uri, mime_type, content_hash, submit_request_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          $13::uuid[], 1, $14, $15, $16, $17)
        RETURNING submission_id`, [organizationId, draftId, row.shared_draft_version_id,
        row.current_version_no, row.author_membership_id, row.target_scope_type,
        row.target_scope_type === "DEPARTMENT" ? row.responsible_department_id : null,
        row.responsible_department_id, row.title, row.classification, row.team_tag, row.project_tag,
        row.audience_role_ids, row.content_uri, row.mime_type, row.content_hash, idempotencyKey]);
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
      const level = input.level ?? "STANDARD";
      const result = await client.query<ReviewerGrantRow>(`
        INSERT INTO reviewer_grant (organization_id, reviewer_membership_id, scope, department_id,
          granted_by_membership_id, classifications, level, team_tag, project_tag, valid_until)
        VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)
        RETURNING reviewer_grant_id, reviewer_membership_id, scope, department_id, classifications,
                  level, team_tag, project_tag, status, valid_from, valid_until`, [organizationId,
        input.reviewerMembershipId, input.scope, input.departmentId, adminMembershipId,
        input.classifications, level, input.teamTag, input.projectTag, input.validUntil]);
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
      const updated = await client.query(`UPDATE reviewer_grant SET status = 'INACTIVE'
        WHERE reviewer_grant_id = $1 AND organization_id = $2 AND status = 'ACTIVE'`, [grantId, organizationId]);
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
    return this.withActorContext(userId, organizationId, async (client) => {
      const actor = await this.activeActorReviewContext(client, userId, organizationId);
      if (!actor) return null;
      const { membershipId } = actor;
      const grants = await this.loadActorReviewerGrants(client, membershipId, organizationId);
      if (!actor.isOrganizationAdmin && grants.length === 0) return [];
      const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.status = 'PENDING_REVIEW'
          AND ($3::boolean OR s.submitted_by_membership_id <> $2)
        ORDER BY s.submitted_at DESC, s.submission_id DESC LIMIT 100`, [organizationId, membershipId, actor.isOrganizationAdmin]);
      const now = new Date();
      const candidates = await Promise.all(result.rows.map(async (row) => ({
        submissionId: row.submission_id,
        snapshotId: row.shared_draft_version_id,
        title: row.title,
        submittedAt: row.submitted_at,
        submission: reviewAuthorizationFromRow(row, organizationId),
        reviewerGrants: grants,
        effectivePolicyVersion: 1,
        audienceEnforceable: await this.audienceEnforceable(client, organizationId, row.audience_role_ids,
          row.target_scope_type, row.responsible_department_id),
      })));
      return listAssignedReviews({ actor, now, candidates });
    });
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
      };
    });
  }

  async decideReview(userId: string, organizationId: string, submissionId: string, action: ReviewAction,
    expectedSnapshotVersionId: string, expectedContentHash: string, comment: string | null,
    idempotencyKey: string, requestId: string): Promise<DecideReviewResult> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const actor = await this.activeActorReviewContext(client, userId, organizationId);
      if (!actor) return { kind: "not-found" };
      const { membershipId } = actor;
      const requestedDecision = action === "APPROVE" ? "APPROVED" : "REJECTED";
      const replay = await client.query<{ submission_id: string; decision: string; snapshot_version_id: string; content_hash: string; comment: string | null }>(`
        SELECT submission_id, decision, snapshot_version_id, content_hash, comment FROM review_decision
         WHERE reviewer_membership_id = $1 AND decision_request_id = $2 AND flow2`, [membershipId, idempotencyKey]);
      if (replay.rows[0]) {
        const previous = replay.rows[0];
        if (previous.submission_id !== submissionId || previous.decision !== requestedDecision
          || previous.snapshot_version_id !== expectedSnapshotVersionId
          || previous.content_hash !== expectedContentHash
          || previous.comment !== (comment?.trim() || null)) return { kind: "conflict" };
        const result = await client.query<SharedSubmissionRow>(`${submissionSelect}
          WHERE s.organization_id = $1 AND s.submission_id = $2`, [organizationId, submissionId]);
        return result.rows[0] ? { kind: "replayed", submission: mapSharedSubmission(result.rows[0]) }
          : { kind: "not-found" };
      }
      const selected = await client.query<SharedSubmissionRow>(`${submissionSelect}
        WHERE s.organization_id = $1 AND s.submission_id = $2 FOR UPDATE OF s`, [organizationId, submissionId]);
      const row = selected.rows[0];
      if (!row) return { kind: "not-found" };
      if (row.status !== "PENDING_REVIEW") return { kind: "conflict" };
      const grants = await this.loadActorReviewerGrants(client, membershipId, organizationId);
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
      }, { action, expectedSnapshotVersionId, expectedContentHash, comment });
      if (plan.kind === "DENIED") return { kind: "denied", reason: plan.reason };
      const decisionId = randomUUID();
      await client.query(`INSERT INTO review_decision (review_decision_id, submission_id,
        reviewer_membership_id, decision, comment, flow2, decision_request_id,
        snapshot_version_id, content_hash)
        VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8)`, [decisionId, submissionId,
        membershipId, plan.decision, plan.comment, idempotencyKey,
        row.shared_draft_version_id, row.content_hash]);
      await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id,
        review_decision_id, event_type, outcome, details_json)
        VALUES ($1, $2, $3, 'KNOWLEDGE_REVIEW_DECIDED', 'SUCCESS', $4::jsonb)`, [organizationId,
        membershipId, decisionId, JSON.stringify({ submissionId, snapshotVersionId: row.shared_draft_version_id,
          decision: plan.decision,
          selfApproved: actor.isOrganizationAdmin === true && membershipId === row.submitted_by_membership_id,
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
      const result = await client.query<PublishedKnowledgeRow>(`${publishedKnowledgeSelect}
        WHERE cp.organization_id = $1 ORDER BY pv.published_at DESC, pv.published_version_id DESC LIMIT 100`, [organizationId]);
      return result.rows.map(mapPublishedKnowledge);
    });
  }

  async getPublishedKnowledge(userId: string, organizationId: string,
    publishedVersionId: string): Promise<PublishedKnowledge | null> {
    return this.withActorContext(userId, organizationId, async (client) => {
      const result = await client.query<PublishedKnowledgeRow>(`${publishedKnowledgeSelect}
        WHERE cp.organization_id = $1 AND pv.published_version_id = $2`, [organizationId, publishedVersionId]);
      return result.rows[0] ? mapPublishedKnowledge(result.rows[0]) : null;
    });
  }

  async listAuthorizedAiSources(userId: string, organizationId: string, generationIds?: string[], chunkIds?: string[]): Promise<AuthorizedAiSource[] | null> {
    if ((generationIds && generationIds.length > 12) || (chunkIds && chunkIds.length > 12)) throw new Error("Too many citation locations");
    return this.withActorContext(userId, organizationId, async (client) => {
      if (!await this.activeActorMembership(client, userId, organizationId)) return null;
      const result = await client.query<AuthorizedAiSourceRow>(`
        SELECT g.generation_id, g.snapshot_version_id, g.snapshot_content_hash,
               pv.published_version_id, pv.shared_draft_id, pv.title, pv.version_no,
               pv.classification, cp.target_scope_type,
               CASE WHEN $2::uuid[] IS NULL THEN NULL ELSE
                 (SELECT jsonb_agg(chunk) FROM jsonb_array_elements(g.manifest_json->'chunks') chunk
                   WHERE $3::text[] IS NULL OR chunk->>'chunkId' = ANY($3::text[])) END AS chunks
          FROM knowledge_current_publication cp
          JOIN published_knowledge_version pv
            ON pv.published_version_id = cp.published_version_id
          JOIN knowledge_index_generation g
            ON g.submission_id = pv.submission_id AND g.status = 'READY'
         WHERE cp.organization_id = $1
           AND ($2::uuid[] IS NULL OR g.generation_id = ANY($2::uuid[]))
         ORDER BY pv.published_at DESC, pv.published_version_id DESC
         LIMIT 500`, [organizationId, generationIds ?? null, chunkIds ?? null]);
      return result.rows.map((row) => ({
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
      }));
    });
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

      const draft = await client.query<{ draft_id: string; created_at: Date; updated_at: Date }>(`
        INSERT INTO draft_document (workspace_id, title, current_version_no)
        VALUES ($1, $2, 1)
        RETURNING draft_id, created_at, updated_at`, [workspaceId, write.title]);
      const created = draft.rows[0];
      if (!created) throw new Error("Draft insert returned no row");
      const versionResult = await client.query<{ draft_version_id: string }>(`
        INSERT INTO draft_version (draft_id, version_no, source_uri, mime_type, content_hash, created_by_membership_id)
        VALUES ($1, 1, $2, $3, $4, $5)
        RETURNING draft_version_id`, [created.draft_id, content.sourceUri, content.mimeType, content.contentHash, membershipId]);
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
       AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
       AND ${membershipPermissionSql("$4")}`, [draftId, organizationId, userId, "PRIVATE_WORKSPACE_WRITE"]);
    return result.rowCount === 1;
    });
  }

  async updateDraft(userId: string, organizationId: string, draftId: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null, requestId: string): Promise<{ kind: "not-found" } | { kind: "conflict"; currentVersion: number } | { kind: "updated"; draft: PrivateDraft }> {
    return this.withActorContext(userId, organizationId, async (client) => {
      // Lock the mutable document before reading its version join. Under READ
      // COMMITTED, a waiter otherwise rechecks the new document against an old
      // joined-version snapshot and can incorrectly report an owned draft missing.
      const locked = await client.query(`SELECT d.draft_id FROM draft_document d
        JOIN private_workspace w ON w.workspace_id = d.workspace_id
        JOIN organization_membership om ON om.membership_id = w.membership_id
        WHERE d.draft_id = $1 AND om.organization_id = $2 AND om.user_id = $3
          AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
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
      }>(`
        SELECT om.membership_id, d.title, v.draft_version_id, v.source_uri, v.mime_type, v.content_hash,
               d.current_version_no, d.created_at, d.updated_at
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

      const version = expectedVersion + 1;
      const title = patch.title ?? current.title;
      const source = content ?? {
        sourceUri: current.source_uri,
        mimeType: current.mime_type,
        contentHash: current.content_hash,
      };
      await client.query(`
        UPDATE draft_document
           SET title = $2, current_version_no = $3, updated_at = now()
         WHERE draft_id = $1`, [draftId, title, version]);
      const versionResult = await client.query<{ draft_version_id: string }>(`
        INSERT INTO draft_version (draft_id, version_no, source_uri, mime_type, content_hash, created_by_membership_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING draft_version_id`, [draftId, version, source.sourceUri, source.mimeType, source.contentHash, current.membership_id]);
      const versionId = versionResult.rows[0]?.draft_version_id;
      if (!versionId) throw new Error("Draft version insert returned no row");
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
        },
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
         AND om.status = 'ACTIVE' AND w.status = 'ACTIVE' AND d.status = 'ACTIVE'
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
export type StoredContentFields = { sourceUri: string; mimeType: "text/plain" | "application/pdf"; contentHash: string };

function organizationSlug(name: string): string {
  const base = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  return `${base || "organization"}-${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
