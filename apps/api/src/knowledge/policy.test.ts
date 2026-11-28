import { describe, expect, it } from "vitest";
import { canContributePrivateDocument, canRespondToSubmission, canReviewSnapshot,
  canSubmitReaderSnapshot, resolveResponsibleDepartment, type MembershipActor } from "./policy.js";

const actor: MembershipActor = { membershipId: "author", organizationId: "org", status: "ACTIVE" };
const now = new Date("2026-10-09T00:00:00Z");
const draft = { organizationId: "org", authorMembershipId: "author", status: "ACTIVE" as const,
  currentVersionId: "v2" };
const snapshot = { versionId: "v2", contentHash: "a".repeat(64), classification: "INTERNAL" as const };
const submissionInput = { actor, draft, snapshot, responsibleDepartmentId: "dept", authorPrimaryDepartmentId: "dept" };

describe("submission and review policy", () => {
  it("contributes a copy only from the author's private document", () => {
    const source = { organizationId: "org", ownerMembershipId: "author" };
    expect(canContributePrivateDocument(actor, source)).toBe(true);
    expect(canContributePrivateDocument(actor, { ...source, ownerMembershipId: "other" })).toBe(false);
    expect(canContributePrivateDocument({ ...actor, status: "SUSPENDED" }, source)).toBe(false);
  });

  it("submits only the author's current snapshot with a valid content hash", () => {
    expect(canSubmitReaderSnapshot(submissionInput)).toBe(true);
    expect(canSubmitReaderSnapshot({ ...submissionInput, snapshot: { ...snapshot, versionId: "v1" } })).toBe(false);
    expect(canSubmitReaderSnapshot({ ...submissionInput, snapshot: { ...snapshot, contentHash: "invalid" } })).toBe(false);
    expect(canSubmitReaderSnapshot({ ...submissionInput, actor: { ...actor, status: "SUSPENDED" } })).toBe(false);
  });

  it("requires the author's current primary department", () => {
    expect(canSubmitReaderSnapshot({ ...submissionInput, responsibleDepartmentId: "other-dept" })).toBe(false);
    expect(canSubmitReaderSnapshot({ ...submissionInput, authorPrimaryDepartmentId: "moved-dept" })).toBe(false);
    expect(canSubmitReaderSnapshot({ ...submissionInput, responsibleDepartmentId: null, authorPrimaryDepartmentId: null })).toBe(false);
  });

  it("derives the responsible department from the author and rejects any other department (decision 0014)", () => {
    expect(resolveResponsibleDepartment(undefined, "dept")).toEqual({ ok: true, departmentId: "dept" });
    expect(resolveResponsibleDepartment(null, "dept")).toEqual({ ok: true, departmentId: "dept" });
    expect(resolveResponsibleDepartment("dept", "dept")).toEqual({ ok: true, departmentId: "dept" });
    expect(resolveResponsibleDepartment("other-dept", "dept")).toEqual({ ok: false });
    expect(resolveResponsibleDepartment(undefined, null)).toEqual({ ok: true, departmentId: null });
    expect(resolveResponsibleDepartment("dept", null)).toEqual({ ok: false });
  });

  it("requires a matching Reviewer Grant with an elevated level for Restricted", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "RESTRICTED" as const, policyVersion: 2,
      readerBreadth: "LIMITED" as const, reviewRule: "GRANT_SCOPE" as const };
    const grant = { membershipId: "reviewer", organizationId: "org", scope: "DEPARTMENT" as const,
      departmentId: "dept", status: "ACTIVE" as const,
      classifications: ["RESTRICTED" as const], level: "SPECIALIST" as const, teamTag: "alpha", projectTag: null,
      validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null };
    const input = { actor: { ...actor, membershipId: "reviewer" }, submission, grant,
      effectivePolicyVersion: 2, readersEnforceable: true, now };
    expect(canReviewSnapshot(input)).toBe(true);
    expect(canReviewSnapshot({ ...input, actor })).toBe(false);
    expect(canReviewSnapshot({ ...input, grant: { ...grant, level: "STANDARD" } })).toBe(false);
    expect(canReviewSnapshot({ ...input, readersEnforceable: false })).toBe(false);
    expect(canRespondToSubmission(input)).toBe(true);
  });

  it("allows Organization Admin to review and self-approve without a reviewer grant", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "RESTRICTED" as const, policyVersion: 2,
      readerBreadth: "ORGANIZATION_WIDE" as const, reviewRule: "GRANT_SCOPE" as const };
    expect(canRespondToSubmission({ actor: { ...actor, isOrganizationAdmin: true }, submission,
      grant: null, effectivePolicyVersion: 2, now })).toBe(true);
  });

  describe("reviewer grant scope derived from frozen readers (decision 0015)", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept",
      status: "PENDING_REVIEW" as const, classification: "INTERNAL" as const, policyVersion: 1,
      readerBreadth: "LIMITED" as const, reviewRule: "GRANT_SCOPE" as const };
    const grant = { membershipId: "reviewer", organizationId: "org", scope: "DEPARTMENT" as const,
      departmentId: "dept", status: "ACTIVE" as const,
      classifications: ["INTERNAL" as const, "CONFIDENTIAL" as const, "RESTRICTED" as const], level: "STANDARD" as const,
      validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null };
    const input = { actor: { ...actor, membershipId: "reviewer" }, submission, grant, effectivePolicyVersion: 1, now };
    const organizationWide = { ...submission, readerBreadth: "ORGANIZATION_WIDE" as const };

    const organizationGrant = { ...grant, scope: "ORGANIZATION" as const, departmentId: null };

    it("lets a department reviewer decide a Department or Selected Members snapshot", () => {
      expect(canRespondToSubmission(input)).toBe(true);
    });

    it("uses disjoint scopes for new submissions", () => {
      expect(canRespondToSubmission({ ...input, submission: organizationWide })).toBe(false);
      expect(canRespondToSubmission({ ...input, submission: organizationWide, grant: organizationGrant })).toBe(true);
      expect(canRespondToSubmission({ ...input, grant: organizationGrant })).toBe(false);
    });

    it("fails closed when the breadth is not an explicit LIMITED value", () => {
      const unknownBreadth = { ...submission, readerBreadth: undefined as unknown as "LIMITED" };
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

    it("rechecks expiry for an organization grant", () => {
      expect(canRespondToSubmission({ ...input, submission: organizationWide,
        grant: { ...organizationGrant, validUntil: now } })).toBe(false);
    });

    it("lets a reviewer decide their own submission only with a matching current grant (decision 0033)", () => {
      const self = { ...actor, membershipId: "author" };
      expect(canRespondToSubmission({ ...input, actor: self, submission: organizationWide,
        grant: { ...organizationGrant, membershipId: "author" } })).toBe(true);
      expect(canRespondToSubmission({ ...input, actor: self, submission,
        grant: { ...grant, membershipId: "author" } })).toBe(true);
      // The wrong scope is still refused for one's own submission: a Department grant for an organization-wide
      // snapshot, an Organization grant for a department-only one, another department, or an expired grant.
      expect(canRespondToSubmission({ ...input, actor: self, submission: organizationWide,
        grant: { ...grant, membershipId: "author" } })).toBe(false);
      expect(canRespondToSubmission({ ...input, actor: self, submission,
        grant: { ...organizationGrant, membershipId: "author" } })).toBe(false);
      expect(canRespondToSubmission({ ...input, actor: self, submission,
        grant: { ...grant, membershipId: "author", departmentId: "other-dept" } })).toBe(false);
      expect(canRespondToSubmission({ ...input, actor: self, submission,
        grant: { ...grant, membershipId: "author", validUntil: now } })).toBe(false);
    });

    it("keeps Organization Admin final authority from decision 0011", () => {
      expect(canRespondToSubmission({ ...input, actor: { ...actor, isOrganizationAdmin: true },
        submission: organizationWide, grant: null })).toBe(true);
    });

  });
});
