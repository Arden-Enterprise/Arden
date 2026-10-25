import { describe, expect, it } from "vitest";
import { canCreateSharedDraft, canReadPublication, canRespondToSubmission, canReviewSnapshot,
  canSubmitSnapshot, type MembershipActor } from "./policy.js";

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
    const input = { actor, draft, snapshot, audiences: [group], audienceEnforceable: true };
    expect(canSubmitSnapshot(input)).toBe(true);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, versionId: "v1" } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, audienceIds: [] } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, audienceEnforceable: false })).toBe(false);
  });

  it("uses ReviewerGrant, denies self-review, and requires specialist level for Restricted", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "RESTRICTED" as const, policyVersion: 2,
      teamTag: "alpha", projectTag: null, audienceBreadth: "LIMITED" as const };
    const grant = { membershipId: "reviewer", organizationId: "org", departmentId: "dept", status: "ACTIVE" as const,
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
      teamTag: null, projectTag: null, audienceBreadth: "ORGANIZATION_WIDE" as const };
    expect(canRespondToSubmission({ actor: { ...actor, isOrganizationAdmin: true }, submission,
      grant: null, effectivePolicyVersion: 2, now })).toBe(true);
  });

  describe("review level derived from audience breadth (decision 0013)", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "INTERNAL" as const, policyVersion: 1,
      teamTag: null, projectTag: null, audienceBreadth: "LIMITED" as const };
    const grant = { membershipId: "reviewer", organizationId: "org", departmentId: "dept", status: "ACTIVE" as const,
      classifications: ["INTERNAL" as const, "CONFIDENTIAL" as const, "RESTRICTED" as const], level: "STANDARD" as const,
      teamTag: null, projectTag: null, validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null };
    const input = { actor: { ...actor, membershipId: "reviewer" }, submission, grant, effectivePolicyVersion: 1, now };
    const organizationWide = { ...submission, audienceBreadth: "ORGANIZATION_WIDE" as const };

    it("lets a Standard reviewer decide a department or group-limited snapshot", () => {
      expect(canRespondToSubmission(input)).toBe(true);
    });

    it("requires a Specialist or Senior reviewer for an organization-wide snapshot", () => {
      expect(canRespondToSubmission({ ...input, submission: organizationWide })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: organizationWide, grant: { ...grant, level: "SPECIALIST" } })).toBe(true);
      expect(canRespondToSubmission({ ...input, submission: organizationWide, grant: { ...grant, level: "SENIOR" } })).toBe(true);
    });

    it("fails closed when the breadth is not an explicit LIMITED value", () => {
      const unknownBreadth = { ...submission, audienceBreadth: undefined as unknown as "LIMITED" };
      expect(canRespondToSubmission({ ...input, submission: unknownBreadth })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: unknownBreadth, grant: { ...grant, level: "SENIOR" } })).toBe(true);
    });

    it("keeps the legacy Restricted rule for a pending Restricted snapshot even when it is limited", () => {
      const legacyRestricted = { ...submission, classification: "RESTRICTED" as const };
      expect(canRespondToSubmission({ ...input, submission: legacyRestricted })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: legacyRestricted, grant: { ...grant, level: "SPECIALIST" } })).toBe(true);
    });

    it("still requires the grant to cover a legacy classification, matching the database rule", () => {
      const legacyConfidential = { ...submission, classification: "CONFIDENTIAL" as const };
      expect(canRespondToSubmission({ ...input, submission: legacyConfidential,
        grant: { ...grant, classifications: ["INTERNAL" as const] } })).toBe(false);
    });

    it("keeps Organization Admin final authority from decision 0011", () => {
      expect(canRespondToSubmission({ ...input, actor: { ...actor, isOrganizationAdmin: true },
        submission: organizationWide, grant: null })).toBe(true);
    });

    it("never lets an ordinary reviewer decide their own organization-wide snapshot", () => {
      expect(canRespondToSubmission({ ...input, actor: { ...actor, membershipId: "author" },
        submission: organizationWide, grant: { ...grant, membershipId: "author", level: "SENIOR" } })).toBe(false);
    });
  });
});
