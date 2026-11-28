export type KnowledgeClassification = "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
/**
 * Decision 0013: authors and admins no longer supply a classification. New drafts default to INTERNAL
 * and new grants to every level, so the legacy columns stay valid while review strictness comes from
 * how widely the frozen snapshot is shared.
 */
export const defaultKnowledgeClassification: KnowledgeClassification = "INTERNAL";
export const allKnowledgeClassifications: readonly KnowledgeClassification[] = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
/** How widely a frozen snapshot is shared. ORGANIZATION_WIDE means it is shared with the entire organization. */
export type ReaderBreadth = "ORGANIZATION_WIDE" | "LIMITED";
export type MembershipActor = { membershipId: string; organizationId: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "LEFT"; isOrganizationAdmin?: boolean };

function activeInOrganization(actor: MembershipActor | null, organizationId: string): actor is MembershipActor {
  return actor !== null && actor.status === "ACTIVE" && actor.organizationId === organizationId;
}

export function canContributePrivateDocument(actor: MembershipActor | null, source: {
  organizationId: string;
  ownerMembershipId: string;
}): boolean {
  return activeInOrganization(actor, source.organizationId)
    && actor.membershipId === source.ownerMembershipId;
}

/**
 * Decision 0014: the author owns a shared draft and its responsible department is the author's primary department,
 * derived on the server. A client may omit the department or repeat that value; any other department is rejected,
 * so an author cannot route review to a department they do not belong to.
 */
export function resolveResponsibleDepartment(requested: string | null | undefined, authorPrimaryDepartmentId: string | null):
  { ok: true; departmentId: string | null } | { ok: false } {
  if (requested === undefined || requested === null || requested === authorPrimaryDepartmentId) {
    return { ok: true, departmentId: authorPrimaryDepartmentId };
  }
  return { ok: false };
}

type SubmissionSnapshot = { actor: MembershipActor | null;
  draft: { organizationId: string; authorMembershipId: string; status: "ACTIVE" | "SUBMITTED" | "ARCHIVED"; currentVersionId: string };
  snapshot: { versionId: string; contentHash: string; classification: KnowledgeClassification };
  responsibleDepartmentId: string | null; authorPrimaryDepartmentId: string | null };

export function canSubmitReaderSnapshot(input: SubmissionSnapshot): boolean {
  const { actor, draft, snapshot } = input;
  return activeInOrganization(actor, draft.organizationId) && actor.membershipId === draft.authorMembershipId
    && input.authorPrimaryDepartmentId !== null && input.responsibleDepartmentId === input.authorPrimaryDepartmentId
    && draft.status === "ACTIVE" && Boolean(snapshot.versionId) && draft.currentVersionId === snapshot.versionId
    && /^[0-9a-f]{64}$/.test(snapshot.contentHash)
    && ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(snapshot.classification);
}

export function canReviewSnapshot(input: { actor: MembershipActor | null;
  submission: { organizationId: string; submittedByMembershipId: string; departmentId: string;
    status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";
    classification: KnowledgeClassification; policyVersion: number;
    readerBreadth: ReaderBreadth; reviewRule: "LEGACY" | "GRANT_SCOPE" };
  grant: { membershipId: string; organizationId: string; scope: "DEPARTMENT" | "ORGANIZATION";
    departmentId: string | null; status: "ACTIVE" | "INACTIVE";
    classifications: readonly KnowledgeClassification[]; level: "STANDARD" | "SPECIALIST" | "SENIOR";
    validFrom: Date; validUntil: Date | null } | null;
  now: Date; effectivePolicyVersion: number; readersEnforceable: boolean }): boolean {
  return input.readersEnforceable && canRespondToSubmission(input);
}

function elevatedReviewerLevel(level: "STANDARD" | "SPECIALIST" | "SENIOR"): boolean {
  return level === "SPECIALIST" || level === "SENIOR";
}

function grantMatchesFrozenSubmission(input: Parameters<typeof canRespondToSubmission>[0],
  grant: NonNullable<Parameters<typeof canReviewSnapshot>[0]["grant"]>): boolean {
  const { submission } = input;
  return grant.classifications.includes(submission.classification)
    && (submission.classification !== "RESTRICTED" || elevatedReviewerLevel(grant.level))
    && Number.isFinite(input.now.getTime()) && Number.isFinite(grant.validFrom.getTime())
    && grant.validFrom <= input.now
    && (grant.validUntil === null || (Number.isFinite(grant.validUntil.getTime()) && grant.validUntil > input.now));
}

function grantScopeCoversSubmission(submission: Parameters<typeof canReviewSnapshot>[0]["submission"],
  grant: NonNullable<Parameters<typeof canReviewSnapshot>[0]["grant"]>): boolean {
  if (submission.readerBreadth === "LIMITED") {
    return grant.scope === "DEPARTMENT" && grant.departmentId === submission.departmentId;
  }
  if (grant.scope === "ORGANIZATION") return true;
  return submission.reviewRule === "LEGACY"
    && grant.scope === "DEPARTMENT"
    && grant.departmentId === submission.departmentId
    && elevatedReviewerLevel(grant.level);
}

// Rejection remains possible when the proposed readers need correction.
export function canRespondToSubmission(input: Omit<Parameters<typeof canReviewSnapshot>[0], "readersEnforceable">): boolean {
  const { actor, submission, grant } = input;
  if (!activeInOrganization(actor, submission.organizationId) || submission.status !== "PENDING_REVIEW"
    || !Number.isInteger(submission.policyVersion) || submission.policyVersion <= 0
    || submission.policyVersion !== input.effectivePolicyVersion) return false;
  if (actor.isOrganizationAdmin === true) return true;
  // Decision 0033: a reviewer whose current grant matches may decide their own submission like any other.
  return grant !== null && grant.status === "ACTIVE"
    && grant.membershipId === actor.membershipId && grant.organizationId === submission.organizationId
    && grantMatchesFrozenSubmission(input, grant)
    // Decision 0015: scopes are disjoint for new submissions. Anything other than an explicit LIMITED breadth
    // follows the organization-wide branch, so incomplete authorization facts fail closed.
    && grantScopeCoversSubmission(submission, grant);
}
