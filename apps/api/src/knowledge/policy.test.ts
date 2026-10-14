import { describe, expect, it } from "vitest";
import { canCreateSharedDraft, canReadPublication, canRespondToSubmission, canReviewSnapshot, canSubmitSnapshot, type MembershipActor } from "./policy.js";

const actor: MembershipActor = { membershipId: "author", organizationId: "org", status: "ACTIVE" };
const audienceRole = { roleId: "editor", organizationId: "org", status: "ACTIVE" as const, isSystem: false, kind: "ROLE" as const };
const now = new Date("2026-10-09T00:00:00Z");
const assignment = { membershipId: "author", organizationId: "org", roleId: "editor", status: "ACTIVE" as const,
  validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null, scopeActive: true, memberInScope: true,
  scope: { type: "ORGANIZATION" as const, departmentId: null }, permissions: ["PUBLISHED_CONTENT_VIEW"] };
const audience = { audienceRoles: [audienceRole], assignments: [assignment] };
const publication = { organizationId: "org", status: "CURRENT" as const, audienceRoleIds: ["editor"],
  validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null,
  scope: { type: "ORGANIZATION" as const, departmentId: null } };

describe("Mainflow 2 policy foundations", () => {
  it("unions valid grants without letting an inactive audience role grant access", () => {
    const inactiveRole = { ...audienceRole, roleId: "retired", status: "INACTIVE" as const };
    const unionPublication = { ...publication, audienceRoleIds: ["editor", "retired"] };
    const unionAudience = { ...audience, audienceRoles: [audienceRole, inactiveRole] };
    expect(canReadPublication({ actor, publication: unionPublication, audience: unionAudience, now })).toBe(true);
    expect(canReadPublication({ actor, publication: unionPublication, audience: {
      ...unionAudience, assignments: [{ ...assignment, roleId: "retired" }],
    }, now })).toBe(false);
    expect(canReadPublication({ actor, publication: unionPublication, audience: {
      ...unionAudience, assignments: [{ ...assignment, permissions: [] }],
    }, now })).toBe(false);
  });
  it("requires VIEW on the matching audience grant and the same scope", () => {
    expect(canReadPublication({ actor, publication, audience: { ...audience, assignments: [{ ...assignment, permissions: [] }] }, now })).toBe(false);
    const department = { type: "DEPARTMENT" as const, departmentId: "engineering" };
    expect(canReadPublication({ actor, publication: { ...publication, scope: department }, audience, now })).toBe(false);
    const scopedAudience = { ...audience, assignments: [{ ...assignment, scope: department }] };
    expect(canReadPublication({ actor, publication: { ...publication, scope: department }, audience: scopedAudience, now })).toBe(true);
    expect(canReadPublication({ actor, publication, audience: scopedAudience, now })).toBe(false);
  });
  it("grants every active organization member through ALL_MEMBERS only at Organization scope", () => {
    const allMembers = { ...audienceRole, roleId: "all-members", kind: "ALL_MEMBERS" as const };
    const organizationPublication = { ...publication, audienceRoleIds: [allMembers.roleId] };
    expect(canReadPublication({ actor, publication: organizationPublication,
      audience: { audienceRoles: [allMembers], assignments: [] }, now })).toBe(true);
    expect(canReadPublication({ actor: { ...actor, status: "SUSPENDED" }, publication: organizationPublication,
      audience: { audienceRoles: [allMembers], assignments: [] }, now })).toBe(false);
    const departmentPublication = { ...organizationPublication,
      scope: { type: "DEPARTMENT" as const, departmentId: "engineering" } };
    expect(canReadPublication({ actor, publication: departmentPublication,
      audience: { audienceRoles: [allMembers], assignments: [] }, now })).toBe(false);
  });
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
    expect(canReadPublication({ actor, publication: { ...publication, validFrom: new Date("2026-10-10T00:00:00Z") }, audience, now })).toBe(false);
    expect(canReadPublication({ actor, publication: { ...publication, validUntil: now }, audience, now })).toBe(false);
    expect(canReadPublication({ actor, publication: { ...publication, validUntil: new Date(Number.NaN) }, audience, now })).toBe(false);
  });

  it("creates a shared copy only from the actor's private version or an authorized publication", () => {
    expect(canCreateSharedDraft({ actor, source: { kind: "private", organizationId: "org", ownerMembershipId: "author" }, now })).toBe(true);
    expect(canCreateSharedDraft({ actor, source: { kind: "private", organizationId: "org", ownerMembershipId: "someone-else" }, now })).toBe(false);
    expect(canCreateSharedDraft({ actor, source: { kind: "published", publication, audience }, now })).toBe(true);
    expect(canCreateSharedDraft({ actor, source: { kind: "published", publication, audience: { ...audience, assignments: [] } }, now })).toBe(false);
  });

  it("submits only the current immutable version with valid audience and classification", () => {
    const draft = { organizationId: "org", authorMembershipId: "author", status: "ACTIVE" as const, currentVersionId: "v2" };
    const snapshot = { versionId: "v2", contentHash: "a".repeat(64), classification: "CONFIDENTIAL" as const,
      audienceRoleIds: ["editor"], scope: { type: "ORGANIZATION" as const, departmentId: null } };
    const input = { actor, draft, snapshot, audienceRoles: [audienceRole], audienceEnforceable: true };
    expect(canSubmitSnapshot(input)).toBe(true);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, versionId: "v1" } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, snapshot: { ...snapshot, audienceRoleIds: [] } })).toBe(false);
    expect(canSubmitSnapshot({ ...input, audienceEnforceable: false })).toBe(false);
    expect(canSubmitSnapshot({ ...input, actor: { ...actor, status: "LEFT" } })).toBe(false);
  });
  it("accepts ALL_MEMBERS for an Organization submission but not a Department submission", () => {
    const draft = { organizationId: "org", authorMembershipId: "author", status: "ACTIVE" as const, currentVersionId: "v2" };
    const allMembers = { ...audienceRole, roleId: "all-members", kind: "ALL_MEMBERS" as const };
    const snapshot = { versionId: "v2", contentHash: "a".repeat(64), classification: "INTERNAL" as const,
      audienceRoleIds: [allMembers.roleId], scope: { type: "ORGANIZATION" as const, departmentId: null } };
    expect(canSubmitSnapshot({ actor, draft, snapshot, audienceRoles: [allMembers], audienceEnforceable: true })).toBe(true);
    expect(canSubmitSnapshot({ actor, draft, snapshot: { ...snapshot,
      scope: { type: "DEPARTMENT", departmentId: "engineering" } }, audienceRoles: [allMembers], audienceEnforceable: true })).toBe(false);
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
    expect(canRespondToSubmission(input)).toBe(true);
    expect(canRespondToSubmission({ ...input, grant: { ...grant, status: "INACTIVE" } })).toBe(false);
  });
});
