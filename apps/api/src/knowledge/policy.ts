export type KnowledgeClassification = "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
/**
 * Decision 0013: authors and admins no longer supply a classification. New drafts default to INTERNAL
 * and new grants to every level, so the legacy columns stay valid while review strictness comes from
 * how widely the frozen snapshot is shared.
 */
export const defaultKnowledgeClassification: KnowledgeClassification = "INTERNAL";
export const allKnowledgeClassifications: readonly KnowledgeClassification[] = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"];
/** How widely a frozen snapshot is shared. ORGANIZATION_WIDE means it targets the organization audience. */
export type AudienceBreadth = "ORGANIZATION_WIDE" | "LIMITED";
export type AudienceScope = { type: "ORGANIZATION"; departmentId: null }
  | { type: "DEPARTMENT"; departmentId: string };
export type MembershipActor = { membershipId: string; organizationId: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "LEFT"; isOrganizationAdmin?: boolean };
export type AudienceDefinition = { audienceId: string; organizationId: string; status: "ACTIVE" | "INACTIVE";
  kind: "ORGANIZATION_ALL" | "DEPARTMENT_ALL" | "GROUP"; departmentId: string | null };
export type Publication = { organizationId: string; status: "CURRENT" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
  audienceIds: readonly string[]; validFrom: Date; validUntil: Date | null; scope: AudienceScope };
export type AudienceContext = { audiences: readonly AudienceDefinition[];
  groupMemberships: readonly { audienceId: string; membershipId: string; status: "ACTIVE" | "REVOKED" | "EXPIRED";
    validFrom: Date; validUntil: Date | null }[]; memberDepartmentIds: readonly string[] };

function activeInOrganization(actor: MembershipActor | null, organizationId: string): actor is MembershipActor {
  return actor !== null && actor.status === "ACTIVE" && actor.organizationId === organizationId;
}

function matchesScope(audience: AudienceDefinition, scope: AudienceScope): boolean {
  if (audience.kind === "ORGANIZATION_ALL") return scope.type === "ORGANIZATION";
  if (audience.kind === "DEPARTMENT_ALL") return scope.type === "DEPARTMENT"
    && Boolean(scope.departmentId) && audience.departmentId === scope.departmentId;
  return true;
}

function validAudience(organizationId: string, audienceIds: readonly string[],
  audiences: readonly AudienceDefinition[], scope: AudienceScope, requireActive = true): boolean {
  if (!audienceIds.length || new Set(audienceIds).size !== audienceIds.length) return false;
  const resolved = new Map(audiences.map(audience => [audience.audienceId, audience]));
  return audienceIds.every(id => {
    const audience = resolved.get(id);
    return Boolean(audience && audience.organizationId === organizationId
      && (!requireActive || audience.status === "ACTIVE") && matchesScope(audience, scope));
  });
}

export function canReadPublication({ actor, publication, audience, now }: {
  actor: MembershipActor | null; publication: Publication; audience: AudienceContext; now: Date;
}): boolean {
  if (!activeInOrganization(actor, publication.organizationId) || publication.status !== "CURRENT") return false;
  if (!validAudience(publication.organizationId, publication.audienceIds, audience.audiences, publication.scope, false)) return false;
  // Publication temporal columns are legacy compatibility metadata. Mainflow 3
  // eligibility is the active pointer plus current AccessPolicy/audience state.
  if (!Number.isFinite(now.getTime())) return false;
  const tagged = new Set(publication.audienceIds);
  return audience.audiences.some(definition => {
    if (!tagged.has(definition.audienceId) || definition.status !== "ACTIVE") return false;
    if (definition.kind === "ORGANIZATION_ALL") return true;
    if (definition.kind === "DEPARTMENT_ALL") return definition.departmentId !== null
      && audience.memberDepartmentIds.includes(definition.departmentId);
    return audience.groupMemberships.some(membership => membership.audienceId === definition.audienceId
      && membership.membershipId === actor.membershipId && membership.status === "ACTIVE"
      && Number.isFinite(membership.validFrom.getTime()) && membership.validFrom <= now
      && (membership.validUntil === null || (Number.isFinite(membership.validUntil.getTime())
        && membership.validUntil > now)));
  });
}

export function canCreateSharedDraft(input: { actor: MembershipActor | null;
  source: { kind: "private"; organizationId: string; ownerMembershipId: string }
    | { kind: "published"; publication: Publication; audience: AudienceContext }; now: Date }): boolean {
  if (input.source.kind === "private") return activeInOrganization(input.actor, input.source.organizationId)
    && input.actor.membershipId === input.source.ownerMembershipId;
  return canReadPublication({ actor: input.actor, publication: input.source.publication,
    audience: input.source.audience, now: input.now });
}

export function canSubmitSnapshot(input: { actor: MembershipActor | null;
  draft: { organizationId: string; authorMembershipId: string; status: "ACTIVE" | "SUBMITTED" | "ARCHIVED"; currentVersionId: string };
  snapshot: { versionId: string; contentHash: string; classification: KnowledgeClassification;
    audienceIds: readonly string[]; scope: AudienceScope };
  audiences: readonly AudienceDefinition[]; audienceEnforceable: boolean }): boolean {
  const { actor, draft, snapshot } = input;
  return activeInOrganization(actor, draft.organizationId) && actor.membershipId === draft.authorMembershipId
    && draft.status === "ACTIVE" && Boolean(snapshot.versionId) && draft.currentVersionId === snapshot.versionId
    && /^[0-9a-f]{64}$/.test(snapshot.contentHash)
    && ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(snapshot.classification)
    && input.audienceEnforceable
    && validAudience(draft.organizationId, snapshot.audienceIds, input.audiences, snapshot.scope);
}

export function canReviewSnapshot(input: { actor: MembershipActor | null;
  submission: { organizationId: string; submittedByMembershipId: string; departmentId: string;
    status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "WITHDRAWN";
    classification: KnowledgeClassification; policyVersion: number; teamTag: string | null; projectTag: string | null;
    audienceBreadth: AudienceBreadth };
  grant: { membershipId: string; organizationId: string; departmentId: string; status: "ACTIVE" | "INACTIVE";
    classifications: readonly KnowledgeClassification[]; level: "STANDARD" | "SPECIALIST" | "SENIOR";
    teamTag: string | null; projectTag: string | null; validFrom: Date; validUntil: Date | null } | null;
  now: Date; effectivePolicyVersion: number; audienceEnforceable: boolean }): boolean {
  return input.audienceEnforceable && canRespondToSubmission(input);
}

// Rejection remains possible for an invalid audience; approval does not.
export function canRespondToSubmission(input: Omit<Parameters<typeof canReviewSnapshot>[0], "audienceEnforceable">): boolean {
  const { actor, submission, grant } = input;
  if (!activeInOrganization(actor, submission.organizationId) || submission.status !== "PENDING_REVIEW"
    || !Number.isInteger(submission.policyVersion) || submission.policyVersion <= 0
    || submission.policyVersion !== input.effectivePolicyVersion) return false;
  if (actor.isOrganizationAdmin === true) return true;
  return actor.membershipId !== submission.submittedByMembershipId
    && grant !== null && grant.status === "ACTIVE"
    && grant.membershipId === actor.membershipId && grant.organizationId === submission.organizationId
    && grant.departmentId === submission.departmentId && grant.classifications.includes(submission.classification)
    && (submission.classification !== "RESTRICTED" || grant.level === "SPECIALIST" || grant.level === "SENIOR")
    // Decision 0013: an organization-wide audience needs a Specialist or Senior grant. Anything other than an
    // explicit LIMITED breadth is treated as organization-wide, so missing facts fail closed.
    && (submission.audienceBreadth === "LIMITED" || grant.level === "SPECIALIST" || grant.level === "SENIOR")
    && Number.isFinite(input.now.getTime()) && Number.isFinite(grant.validFrom.getTime())
    && grant.validFrom <= input.now
    && (grant.validUntil === null || (Number.isFinite(grant.validUntil.getTime()) && grant.validUntil > input.now))
    && (grant.teamTag === null || grant.teamTag === submission.teamTag)
    && (grant.projectTag === null || grant.projectTag === submission.projectTag);
}
