import { describe, expect, it } from "vitest";
import { canCreateSharedDraft, canReadPublication, canRespondToSubmission, canReviewSnapshot,
  canSubmitSnapshot, resolveResponsibleDepartment, type MembershipActor } from "./policy.js";

const actor: MembershipActor = { membershipId: "author", organizationId: "org", status: "ACTIVE" };
const now = new Date("2026-10-09T00:00:00Z");
const group = { audienceId: "engineering-readers", organizationId: "org", status: "ACTIVE" as const,
  kind: "GROUP" as const, departmentId: null };
const groupMembership = { audienceId: group.audienceId, membershipId: actor.membershipId,
  status: "ACTIVE" as const, validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null };
const audience = { audiences: [group], groupMemberships: [groupMembership], memberDepartmentIds: ["engineering"] };
const publication = { organizationId: "org", status: "CURRENT" as const, audienceIds: [group.audienceId],
  validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null,
  scope: { type: "ORGANIZATION" as const, departmentId: null } };

describe("audience and review policy", () => {
  it("reads a group publication only for an active group member", () => {
    expect(canReadPublication({ actor, publication, audience, now })).toBe(true);
    expect(canReadPublication({ actor, publication, audience: { ...audience, groupMemberships: [] }, now })).toBe(false);
    expect(canReadPublication({ actor, publication, audience: { ...audience,
      groupMemberships: [{ ...groupMembership, status: "REVOKED" }] }, now })).toBe(false);
    expect(canReadPublication({ actor: { ...actor, status: "SUSPENDED" }, publication, audience, now })).toBe(false);
  });

  it("uses the active pointer rather than legacy publication dates", () => {
    expect(canReadPublication({ actor, publication: { ...publication,
      validFrom: new Date("2099-01-01T00:00:00Z"), validUntil: new Date("2000-01-01T00:00:00Z") },
    audience, now })).toBe(true);
  });

  it("applies managed organization and department audiences only at their matching scope", () => {
    const allOrganization = { ...group, audienceId: "org-all", kind: "ORGANIZATION_ALL" as const };
    const allEngineering = { ...group, audienceId: "engineering-all", kind: "DEPARTMENT_ALL" as const,
      departmentId: "engineering" };
    expect(canReadPublication({ actor, publication: { ...publication, audienceIds: [allOrganization.audienceId] },
      audience: { audiences: [allOrganization], groupMemberships: [], memberDepartmentIds: [] }, now })).toBe(true);
    const departmentPublication = { ...publication, audienceIds: [allEngineering.audienceId],
      scope: { type: "DEPARTMENT" as const, departmentId: "engineering" } };
    expect(canReadPublication({ actor, publication: departmentPublication,
      audience: { audiences: [allEngineering], groupMemberships: [], memberDepartmentIds: ["engineering"] }, now })).toBe(true);
    expect(canReadPublication({ actor, publication: departmentPublication,
      audience: { audiences: [allEngineering], groupMemberships: [], memberDepartmentIds: ["operations"] }, now })).toBe(false);
    expect(canReadPublication({ actor, publication: { ...departmentPublication,
      scope: { type: "DEPARTMENT", departmentId: "operations" } },
      audience: { audiences: [allEngineering], groupMemberships: [], memberDepartmentIds: ["engineering"] }, now })).toBe(false);
  });

  it("does not turn review or administration into publication readership", () => {
    expect(canReadPublication({ actor, publication, audience: { ...audience, groupMemberships: [] }, now })).toBe(false);
  });

  it("creates a shared copy only from owned private content or readable publication", () => {
    expect(canCreateSharedDraft({ actor, source: { kind: "private", organizationId: "org", ownerMembershipId: "author" }, now })).toBe(true);
    expect(canCreateSharedDraft({ actor, source: { kind: "private", organizationId: "org", ownerMembershipId: "other" }, now })).toBe(false);
    expect(canCreateSharedDraft({ actor, source: { kind: "published", publication, audience }, now })).toBe(true);
  });

  it("submits only an immutable, enforceable audience snapshot", () => {
    const draft = { organizationId: "org", authorMembershipId: "author", status: "ACTIVE" as const, currentVersionId: "v2" };
    const snapshot = { versionId: "v2", contentHash: "a".repeat(64), classification: "CONFIDENTIAL" as const,
      audienceIds: [group.audienceId], scope: publication.scope };
    const input = { actor, draft, snapshot, audiences: [group], audienceEnforceable: true,
      responsibleDepartmentId: "dept", authorPrimaryDepartmentId: "dept" };
    expect(canSubmitSnapshot(input)).toBe(true);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, versionId: "v1" } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, audienceIds: [] } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, audienceEnforceable: false })).toBe(false);
  });

  it("submits only when the responsible department is the author's current primary department (decision 0014)", () => {
    const draft = { organizationId: "org", authorMembershipId: "author", status: "ACTIVE" as const, currentVersionId: "v2" };
    const snapshot = { versionId: "v2", contentHash: "a".repeat(64), classification: "INTERNAL" as const,
      audienceIds: [group.audienceId], scope: publication.scope };
    const input = { actor, draft, snapshot, audiences: [group], audienceEnforceable: true,
      responsibleDepartmentId: "dept", authorPrimaryDepartmentId: "dept" };
    expect(canSubmitSnapshot({ ...input, responsibleDepartmentId: "other-dept" })).toBe(false);
    expect(canSubmitSnapshot({ ...input, authorPrimaryDepartmentId: "moved-dept" })).toBe(false);
    expect(canSubmitSnapshot({ ...input, responsibleDepartmentId: null, authorPrimaryDepartmentId: null })).toBe(false);
  });

  it("derives the responsible department from the author and rejects any other department (decision 0014)", () => {
    expect(resolveResponsibleDepartment(undefined, "dept")).toEqual({ ok: true, departmentId: "dept" });
    expect(resolveResponsibleDepartment(null, "dept")).toEqual({ ok: true, departmentId: "dept" });
    expect(resolveResponsibleDepartment("dept", "dept")).toEqual({ ok: true, departmentId: "dept" });
    expect(resolveResponsibleDepartment("other-dept", "dept")).toEqual({ ok: false });
    expect(resolveResponsibleDepartment(undefined, null)).toEqual({ ok: true, departmentId: null });
    expect(resolveResponsibleDepartment("dept", null)).toEqual({ ok: false });
  });

  it("uses ReviewerGrant, denies self-review, and requires specialist level for Restricted", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "RESTRICTED" as const, policyVersion: 2,
      teamTag: "alpha", projectTag: null, audienceBreadth: "LIMITED" as const, reviewRule: "GRANT_SCOPE" as const };
    const grant = { membershipId: "reviewer", organizationId: "org", scope: "DEPARTMENT" as const,
      departmentId: "dept", status: "ACTIVE" as const,
      classifications: ["RESTRICTED" as const], level: "SPECIALIST" as const, teamTag: "alpha", projectTag: null,
      validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null };
    const input = { actor: { ...actor, membershipId: "reviewer" }, submission, grant,
      effectivePolicyVersion: 2, audienceEnforceable: true, now };
    expect(canReviewSnapshot(input)).toBe(true);
    expect(canReviewSnapshot({ ...input, actor })).toBe(false);
    expect(canReviewSnapshot({ ...input, grant: { ...grant, level: "STANDARD" } })).toBe(false);
    expect(canReviewSnapshot({ ...input, audienceEnforceable: false })).toBe(false);
    expect(canRespondToSubmission(input)).toBe(true);
  });

  it("allows Organization Admin to review and self-approve without a reviewer grant", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "RESTRICTED" as const, policyVersion: 2,
      teamTag: null, projectTag: null, audienceBreadth: "ORGANIZATION_WIDE" as const, reviewRule: "GRANT_SCOPE" as const };
    expect(canRespondToSubmission({ actor: { ...actor, isOrganizationAdmin: true }, submission,
      grant: null, effectivePolicyVersion: 2, now })).toBe(true);
  });

  describe("reviewer grant scope derived from frozen readers (decision 0015)", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "INTERNAL" as const, policyVersion: 1,
      teamTag: null, projectTag: null, audienceBreadth: "LIMITED" as const, reviewRule: "GRANT_SCOPE" as const };
    const grant = { membershipId: "reviewer", organizationId: "org", scope: "DEPARTMENT" as const,
      departmentId: "dept", status: "ACTIVE" as const,
      classifications: ["INTERNAL" as const, "CONFIDENTIAL" as const, "RESTRICTED" as const], level: "STANDARD" as const,
      teamTag: null, projectTag: null, validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null };
    const input = { actor: { ...actor, membershipId: "reviewer" }, submission, grant, effectivePolicyVersion: 1, now };
    const organizationWide = { ...submission, audienceBreadth: "ORGANIZATION_WIDE" as const };

    const organizationGrant = { ...grant, scope: "ORGANIZATION" as const, departmentId: null };

    it("lets a department reviewer decide a department or group-limited snapshot", () => {
      expect(canRespondToSubmission(input)).toBe(true);
    });

    it("uses disjoint scopes for new submissions", () => {
      expect(canRespondToSubmission({ ...input, submission: organizationWide })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: organizationWide, grant: organizationGrant })).toBe(true);
      expect(canRespondToSubmission({ ...input, grant: organizationGrant })).toBe(false);
    });

    it("fails closed when the breadth is not an explicit LIMITED value", () => {
      const unknownBreadth = { ...submission, audienceBreadth: undefined as unknown as "LIMITED" };
      expect(canRespondToSubmission({ ...input, submission: unknownBreadth })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: unknownBreadth, grant: organizationGrant })).toBe(true);
    });

    it("keeps the transition path for legacy organization-wide submissions", () => {
      const legacy = { ...organizationWide, reviewRule: "LEGACY" as const };
      expect(canRespondToSubmission({ ...input, submission: legacy })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: legacy,
        grant: { ...grant, level: "SPECIALIST" } })).toBe(true);
      expect(canRespondToSubmission({ ...input, submission: legacy,
        grant: { ...grant, level: "SENIOR" } })).toBe(true);
      expect(canRespondToSubmission({ ...input, submission: legacy, grant: organizationGrant })).toBe(true);
    });

    it("keeps the legacy Restricted level rule for both scopes", () => {
      const legacyRestricted = { ...organizationWide, reviewRule: "LEGACY" as const,
        classification: "RESTRICTED" as const };
      expect(canRespondToSubmission({ ...input, submission: legacyRestricted,
        grant: { ...organizationGrant, level: "STANDARD" } })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: legacyRestricted,
        grant: { ...grant, level: "SPECIALIST" } })).toBe(true);
    });

    it("rechecks expiry, tags and ordinary self-review for an organization grant", () => {
      expect(canRespondToSubmission({ ...input, submission: organizationWide,
        grant: { ...organizationGrant, validUntil: now } })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: organizationWide,
        grant: { ...organizationGrant, teamTag: "other" } })).toBe(false);
      expect(canRespondToSubmission({ ...input, actor: { ...actor, membershipId: "author" },
        submission: organizationWide, grant: { ...organizationGrant, membershipId: "author" } })).toBe(false);
    });

    it("keeps Organization Admin final authority from decision 0011", () => {
      expect(canRespondToSubmission({ ...input, actor: { ...actor, isOrganizationAdmin: true },
        submission: organizationWide, grant: null })).toBe(true);
    });

  });
});
