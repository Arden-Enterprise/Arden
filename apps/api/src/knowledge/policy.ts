export type KnowledgeClassification = "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";

export type MembershipActor = {
  membershipId: string;
  organizationId: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED" | "LEFT";
};

export type AudienceRole = {
  roleId: string;
  organizationId: string;
  status: "ACTIVE" | "INACTIVE";
  isSystem: boolean;
};

export type Publication = {
  organizationId: string;
  status: "CURRENT" | "SUPERSEDED" | "ARCHIVED" | "REVOKED";
  audienceRoleIds: readonly string[];
};

export type AudienceContext = {
  audienceRoles: readonly AudienceRole[];
  assignments: readonly {
    membershipId: string;
    organizationId: string;
    roleId: string;
    status: "ACTIVE" | "REVOKED" | "EXPIRED";
    validFrom: Date;
    validUntil: Date | null;
    scopeActive: boolean;
    memberInScope: boolean;
  }[];
};

function activeInOrganization(actor: MembershipActor | null, organizationId: string): actor is MembershipActor {
  return actor !== null && actor.status === "ACTIVE" && actor.organizationId === organizationId;
}

function validAudience(organizationId: string, audienceRoleIds: readonly string[], audienceRoles: readonly AudienceRole[]): boolean {
  if (audienceRoleIds.length === 0 || new Set(audienceRoleIds).size !== audienceRoleIds.length) return false;
  const resolved = new Map(audienceRoles.map((role) => [role.roleId, role]));
  return audienceRoleIds.every((roleId) => {
    const role = resolved.get(roleId);
    return Boolean(role && roleId && role.organizationId === organizationId && role.status === "ACTIVE" && !role.isSystem);
  });
}

export function canReadPublication(input: {
  actor: MembershipActor | null;
  publication: Publication;
  audience: AudienceContext;
  now: Date;
}): boolean {
  const { actor, publication, audience, now } = input;
  if (!activeInOrganization(actor, publication.organizationId) || publication.status !== "CURRENT") return false;
  if (!validAudience(publication.organizationId, publication.audienceRoleIds, audience.audienceRoles)) return false;
  if (!Number.isFinite(now.getTime())) return false;
  const taggedRoles = new Set(publication.audienceRoleIds);
  return audience.assignments.some((assignment) =>
    assignment.membershipId === actor.membershipId
    && assignment.organizationId === publication.organizationId
    && assignment.status === "ACTIVE"
    && assignment.scopeActive && assignment.memberInScope
    && Number.isFinite(assignment.validFrom.getTime())
    && assignment.validFrom <= now
    && (assignment.validUntil === null || (Number.isFinite(assignment.validUntil.getTime()) && assignment.validUntil > now))
    && taggedRoles.has(assignment.roleId));
}

export function canCreateSharedDraft(input: {
  actor: MembershipActor | null;
  source:
    | { kind: "private"; organizationId: string; ownerMembershipId: string }
    | { kind: "published"; publication: Publication; audience: AudienceContext };
  now: Date;
}): boolean {
  const { actor, source } = input;
  if (source.kind === "private") {
    return activeInOrganization(actor, source.organizationId) && actor.membershipId === source.ownerMembershipId;
  }
  return canReadPublication({ actor, publication: source.publication, audience: source.audience, now: input.now });
}

export function canSubmitSnapshot(input: {
  actor: MembershipActor | null;
  draft: { organizationId: string; authorMembershipId: string; status: "ACTIVE" | "SUBMITTED" | "ARCHIVED"; currentVersionId: string };
  snapshot: { versionId: string; contentHash: string; classification: KnowledgeClassification; audienceRoleIds: readonly string[] };
  audienceRoles: readonly AudienceRole[];
  audienceEnforceable: boolean;
}): boolean {
  const { actor, draft, snapshot } = input;
  return activeInOrganization(actor, draft.organizationId)
    && actor.membershipId === draft.authorMembershipId
    && draft.status === "ACTIVE"
    && Boolean(snapshot.versionId) && draft.currentVersionId === snapshot.versionId
    && /^[0-9a-f]{64}$/.test(snapshot.contentHash)
    && ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(snapshot.classification)
    && input.audienceEnforceable
    && validAudience(draft.organizationId, snapshot.audienceRoleIds, input.audienceRoles);
}

export function canReviewSnapshot(input: {
  actor: MembershipActor | null;
  submission: {
    organizationId: string;
    submittedByMembershipId: string;
    departmentId: string;
    status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "WITHDRAWN";
    classification: KnowledgeClassification;
    policyVersion: number;
    teamTag: string | null;
    projectTag: string | null;
  };
  grant: {
    membershipId: string;
    organizationId: string;
    departmentId: string;
    status: "ACTIVE" | "INACTIVE";
    classifications: readonly KnowledgeClassification[];
    level: "STANDARD" | "SPECIALIST" | "SENIOR";
    teamTag: string | null;
    projectTag: string | null;
    validFrom: Date;
    validUntil: Date | null;
  } | null;
  now: Date;
  effectivePolicyVersion: number;
  audienceEnforceable: boolean;
}): boolean {
  const { actor, submission, grant } = input;
  return activeInOrganization(actor, submission.organizationId)
    && actor.membershipId !== submission.submittedByMembershipId
    && submission.status === "PENDING_REVIEW"
    && input.audienceEnforceable
    && Number.isInteger(submission.policyVersion) && submission.policyVersion > 0
    && submission.policyVersion === input.effectivePolicyVersion
    && grant !== null && grant.status === "ACTIVE"
    && grant.membershipId === actor.membershipId
    && grant.organizationId === submission.organizationId
    && grant.departmentId === submission.departmentId
    && grant.classifications.includes(submission.classification)
    && (submission.classification !== "RESTRICTED" || grant.level === "SPECIALIST" || grant.level === "SENIOR")
    && Number.isFinite(input.now.getTime()) && Number.isFinite(grant.validFrom.getTime())
    && grant.validFrom <= input.now
    && (grant.validUntil === null || (Number.isFinite(grant.validUntil.getTime()) && grant.validUntil > input.now))
    && (grant.teamTag === null || grant.teamTag === submission.teamTag)
    && (grant.projectTag === null || grant.projectTag === submission.projectTag);
}
