import { describe, expect, it } from "vitest";
import { canUseOwnerPrivateWorkspace, configurableRolePermissions, isRolePermission, matchingRoleScope, validCustomRoleName } from "./policy.js";

describe("custom role and default owner policy", () => {
  it("exposes only VIEW, never private, contribution, management or reviewer rights", () => {
    expect(configurableRolePermissions).toEqual(["PUBLISHED_CONTENT_VIEW"]);
    for (const code of ["PRIVATE_WORKSPACE_READ", "PRIVATE_WORKSPACE_WRITE", "SHARED_DRAFT_WRITE", "SHARED_DRAFT_SUBMIT", "ORG_MANAGE_ROLES", "PUBLISHED_CONTENT_SEARCH", "APPROVE", null]) {
      expect(isRolePermission(code)).toBe(false);
    }
  });
  it("matches exact scopes, without inheritance in either direction", () => {
    const org = { type: "ORGANIZATION", departmentId: null } as const;
    const engineering = { type: "DEPARTMENT", departmentId: "engineering" } as const;
    expect(matchingRoleScope(org, org)).toBe(true);
    expect(matchingRoleScope(engineering, engineering)).toBe(true);
    expect(matchingRoleScope(org, engineering)).toBe(false);
    expect(matchingRoleScope(engineering, org)).toBe(false);
    expect(matchingRoleScope(engineering, { type: "DEPARTMENT", departmentId: "operations" })).toBe(false);
    expect(matchingRoleScope({ type: "DEPARTMENT", departmentId: "" }, { type: "DEPARTMENT", departmentId: "" })).toBe(false);
  });
  it("reserves protected role names after normalization", () => {
    expect(validCustomRoleName("Project Readers")).toBe(true);
    for (const name of [" ", "a".repeat(81), "Org Admin", "organization-admin", "ORG_ADMIN", "Ｏｒｇ Ａｄｍｉｎ",
      "All Members", "ALL_MEMBERS", "Everyone", "Everyone in the organization"]) {
      expect(validCustomRoleName(name)).toBe(false);
    }
  });
  it("grants private access to an active owner independently of custom roles", () => {
    const owner = { actorMembershipId: "owner", ownerMembershipId: "owner", actorOrganizationId: "org", resourceOrganizationId: "org", accountActive: true, organizationActive: true, membershipActive: true };
    expect(canUseOwnerPrivateWorkspace(owner)).toBe(true);
    expect(canUseOwnerPrivateWorkspace({ ...owner, actorMembershipId: "admin" })).toBe(false);
    expect(canUseOwnerPrivateWorkspace({ ...owner, actorMembershipId: null })).toBe(false);
    expect(canUseOwnerPrivateWorkspace({ ...owner, resourceOrganizationId: "other" })).toBe(false);
    for (const key of ["accountActive", "organizationActive", "membershipActive"] as const) {
      expect(canUseOwnerPrivateWorkspace({ ...owner, [key]: false })).toBe(false);
    }
  });
});
