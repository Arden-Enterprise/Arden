import { describe, expect, it } from "vitest";
import { canCreateSharedDraft, canReadPublication, canReviewSnapshot, canSubmitSnapshot, type MembershipActor } from "./policy.js";

const actor: MembershipActor = { membershipId: "author", organizationId: "org", status: "ACTIVE" };
const audienceRole = { roleId: "editor", organizationId: "org", status: "ACTIVE" as const, isSystem: false };
const now = new Date("2026-10-09T00:00:00Z");
const assignment = { membershipId: "author", organizationId: "org", roleId: "editor", status: "ACTIVE" as const,
  validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null, scopeActive: true, memberInScope: true };
const audience = { audienceRoles: [audienceRole], assignments: [assignment] };
const publication = { organizationId: "org", status: "CURRENT" as const, audienceRoleIds: ["editor"] };

describe("Mainflow 2 policy foundations", () => {
  it("reads only current publications with a matching active custom role", () => {
    expect(canReadPublication({ actor, publication, audience, now })).toBe(true);
    expect(canReadPublication({ actor, publication, audience: { ...audience, assignments: [] }, now })).toBe(false);
    expect(canReadPublication({ actor, publication, audience: { ...audience, assignments: [{ ...assignment, status: "REVOKED" }] }, now })).toBe(false);
    expect(canReadPublication({ actor, publication, audience: { ...audience, assignments: [{ ...assignment, validUntil: now }] }, now })).toBe(false);
    expect(canReadPublication({ actor, publication, audience: { ...audience, assignments: [{ ...assignment, memberInScope: false }] }, now })).toBe(false);
    expect(canReadPublication({ actor, publication: { ...publication, audienceRoleIds: [] }, audience, now })).toBe(false);
    expect(canReadPublication({ actor, publication: { ...publication, audienceRoleIds: ["unknown"] }, audience, now })).toBe(false);
    expect(canReadPublication({ actor, publication: { ...publication, audienceRoleIds: ["editor", "unknown"] }, audience, now })).toBe(false);
    expect(canReadPublication({ actor, publication, audience: { ...audience, audienceRoles: [{ ...audienceRole, isSystem: true }] }, now })).toBe(false);
    expect(canReadPublication({ actor: { ...actor, status: "SUSPENDED" }, publication, audience, now })).toBe(false);
    expect(canReadPublication({ actor: { ...actor, organizationId: "other" }, publication, audience, now })).toBe(false);
    expect(canReadPublication({ actor, publication: { ...publication, status: "REVOKED" }, audience, now })).toBe(false);
  });

  it("creates a shared copy only from the actor's private version or an authorized publication", () => {
    expect(canCreateSharedDraft({ actor, source: { kind: "private", organizationId: "org", ownerMembershipId: "author" }, now })).toBe(true);
    expect(canCreateSharedDraft({ actor, source: { kind: "private", organizationId: "org", ownerMembershipId: "someone-else" }, now })).toBe(false);
    expect(canCreateSharedDraft({ actor, source: { kind: "published", publication, audience }, now })).toBe(true);
    expect(canCreateSharedDraft({ actor, source: { kind: "published", publication, audience: { ...audience, assignments: [] } }, now })).toBe(false);
  });

  it("submits only the current immutable version with valid audience and classification", () => {
    const draft = { organizationId: "org", authorMembershipId: "author", status: "ACTIVE" as const, currentVersionId: "v2" };
    const snapshot = { versionId: "v2", contentHash: "a".repeat(64), classification: "CONFIDENTIAL" as const, audienceRoleIds: ["editor"] };
    const input = { actor, draft, snapshot, audienceRoles: [audienceRole], audienceEnforceable: true };
    expect(canSubmitSnapshot(input)).toBe(true);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, versionId: "v1" } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, audienceRoleIds: [] } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, audienceEnforceable: false })).toBe(false);
    expect(canSubmitSnapshot({ ...input, actor: { ...actor, status: "LEFT" } })).toBe(false);
  });

  it("denies self-approval, wrong scope, stale policy, and non-specialist restricted review", () => {
    const submission = { organizationId: "org", submittedByMembershipId: "author", departmentId: "dept", status: "PENDING_REVIEW" as const,
      classification: "RESTRICTED" as const, policyVersion: 2, teamTag: "alpha", projectTag: null };
    const grant = { membershipId: "reviewer", organizationId: "org", departmentId: "dept", status: "ACTIVE" as const,
      classifications: ["RESTRICTED" as const], level: "SPECIALIST" as const, teamTag: "alpha", projectTag: null,
      validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null };
    const input = { actor: { ...actor, membershipId: "reviewer" }, submission, grant, effectivePolicyVersion: 2, audienceEnforceable: true, now };
    expect(canReviewSnapshot(input)).toBe(true);
    expect(canReviewSnapshot({ ...input, actor })).toBe(false);
    expect(canReviewSnapshot({ ...input, grant: { ...grant, membershipId: "other" } })).toBe(false);
    expect(canReviewSnapshot({ ...input, grant: { ...grant, departmentId: "other" } })).toBe(false);
    expect(canReviewSnapshot({ ...input, grant: { ...grant, level: "STANDARD" } })).toBe(false);
    expect(canReviewSnapshot({ ...input, grant: { ...grant, validUntil: now } })).toBe(false);
    expect(canReviewSnapshot({ ...input, effectivePolicyVersion: 3 })).toBe(false);
    expect(canReviewSnapshot({ ...input, audienceEnforceable: false })).toBe(false);
  });
});
