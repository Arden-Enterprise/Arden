import { describe, expect, it } from "vitest";
import { configurablePermissions, createSampleRoleConfigurations, toggleRoleMember, toggleRolePermission, validateRoleConfigurations } from "../src/organization/roleConfigurationModel";

describe("custom-role configuration preview", () => {
  it("offers only the three V1 content capabilities, not private/admin/review permissions", () => {
    expect(configurablePermissions.map((permission) => permission.code)).toEqual([
      "PUBLISHED_CONTENT_VIEW", "SHARED_DRAFT_WRITE", "SHARED_DRAFT_SUBMIT",
    ]);
  });
  it("toggles permission settings without mutating the previous draft", () => {
    const role = createSampleRoleConfigurations()[1];
    const next = toggleRolePermission(role, "SHARED_DRAFT_SUBMIT");
    expect(next.permissions).toContain("SHARED_DRAFT_SUBMIT");
    expect(role.permissions).toEqual(["PUBLISHED_CONTENT_VIEW"]);
    expect(toggleRolePermission(next, "SHARED_DRAFT_SUBMIT")).toEqual(role);
  });
  it("supports additive member previews and removing an inactive member", () => {
    const role = createSampleRoleConfigurations()[0];
    const member = { id: "member-1", name: "Sample", email: "sample@example.test", active: true };
    const next = toggleRoleMember(role, member);
    expect(next.memberIds).toEqual([member.id]);
    expect(role.memberIds).toEqual([]);
    expect(toggleRoleMember(next, { ...member, active: false }).memberIds).toEqual([]);
    expect(toggleRoleMember(role, { ...member, active: false })).toBe(role);
  });
  it("rejects blank, duplicate, oversized and protected role names", () => {
    const roles = createSampleRoleConfigurations();
    expect(validateRoleConfigurations(roles)).toBeNull();
    expect(validateRoleConfigurations([{ ...roles[0], name: " " }])).not.toBeNull();
    expect(validateRoleConfigurations([roles[0], { ...roles[1], name: " contributor " }])).not.toBeNull();
    expect(validateRoleConfigurations([{ ...roles[0], name: "a".repeat(81) }])).not.toBeNull();
    expect(validateRoleConfigurations([{ ...roles[0], name: "Organization Admin" }])).not.toBeNull();
  });
  it("starts each sample session with fresh role objects", () => {
    const first = createSampleRoleConfigurations();
    first[0].permissions.length = 0;
    expect(createSampleRoleConfigurations()[0].permissions).toHaveLength(3);
  });
});
