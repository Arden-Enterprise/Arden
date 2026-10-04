import { describe, expect, it } from "vitest";
import {
  invitationStatus,
  membershipReadiness,
  transitionOrganization,
  type OrganizationAction,
} from "../src/organization/organizationWorkflow";
import { createPreviewOrganization, type OrganizationPreview } from "../src/organization/previewModel";

const now = Date.UTC(2026, 9, 4, 8);
const sevenDays = 7 * 24 * 60 * 60 * 1000;
const invitationId = "invitation-jules";
const memberId = "member-jules";

function invitedOrganization(): OrganizationPreview {
  const result = transitionOrganization(createPreviewOrganization(), {
    type: "invite", id: invitationId, name: "Jules Park", email: "jules@northstar.example",
  }, now);
  expect(result.error).toBeUndefined();
  return result.organization;
}

function acceptedOrganization(): OrganizationPreview {
  const result = transitionOrganization(invitedOrganization(), {
    type: "accept", invitationId, email: "jules@northstar.example", memberId,
  }, now);
  expect(result.error).toBeUndefined();
  return result.organization;
}

function expectRejected(organization: OrganizationPreview, action: OrganizationAction, at: number = now) {
  const before = structuredClone(organization);
  const result = transitionOrganization(organization, action, at);
  expect(result.error).toBeTruthy();
  expect(result.organization).toBe(organization);
  expect(organization).toEqual(before);
  return result;
}

describe("organization invitation workflow", () => {
  it("creates a normalized seven-day invitation without adding or mutating a member", () => {
    const organization = createPreviewOrganization();
    const before = structuredClone(organization);
    const result = transitionOrganization(organization, {
      type: "invite", id: " invitation-jules ", name: " Jules Park ", email: " JULES@Northstar.example ",
    }, now);

    expect(result.error).toBeUndefined();
    expect(result.organization.invitations).toEqual([{
      id: invitationId,
      name: "Jules Park",
      email: "jules@northstar.example",
      status: "pending",
      createdAt: now,
      expiresAt: now + sevenDays,
      resendCount: 0,
    }]);
    expect(result.organization.members).toBe(organization.members);
    expect(organization).toEqual(before);
  });

  it("accepts the matching account once and waits for department and role assignment", () => {
    const organization = invitedOrganization();
    const result = transitionOrganization(organization, {
      type: "accept", invitationId, email: " JULES@Northstar.example ", memberId,
    }, now);

    expect(result.error).toBeUndefined();
    expect(result.memberId).toBe(memberId);
    expect(result.organization.members).toHaveLength(organization.members.length + 1);
    expect(result.organization.members.find((member) => member.id === memberId)).toEqual({
      id: memberId,
      name: "Jules Park",
      email: "jules@northstar.example",
      departmentId: "",
      role: "",
      status: "pending-assignment",
    });
    expect(result.organization.invitations?.[0]).toMatchObject({ status: "accepted", memberId });
    expect(membershipReadiness(result.organization, memberId).state).toBe("pending");
    expect(organization.invitations?.[0].status).toBe("pending");
  });

  it.each([
    { name: "empty name", id: "new-invitation", memberName: "  ", email: "new@northstar.example" },
    { name: "invalid email", id: "new-invitation", memberName: "New member", email: "invalid" },
    { name: "missing invitation ID", id: "  ", memberName: "New member", email: "new@northstar.example" },
    { name: "duplicate invitation ID", id: invitationId, memberName: "New member", email: "new@northstar.example" },
    { name: "duplicate pending invitation email", id: "new-invitation", memberName: "New member", email: " JULES@Northstar.example " },
  ])("rejects $name without changing the organization", ({ id, memberName, email }) => {
    expectRejected(invitedOrganization(), { type: "invite", id, name: memberName, email });
  });

  it("rejects existing member emails regardless of casing and membership state", () => {
    for (const status of ["active", "pending-assignment", "suspended"] as const) {
      const organization = createPreviewOrganization();
      const member = organization.members.find((item) => item.role === "Employee");
      expect(member).toBeDefined();
      if (!member) throw new Error("The synthetic organization must include an Employee.");
      member.status = status;
      expectRejected(organization, {
        type: "invite", id: "duplicate-member", name: "Duplicate", email: ` ${member.email.toUpperCase()} `,
      });
    }
  });

  it("rejects an expired invitation at the exact expiry boundary", () => {
    const organization = invitedOrganization();
    expect(invitationStatus(organization.invitations![0], now + sevenDays - 1)).toBe("pending");
    expect(invitationStatus(organization.invitations![0], now + sevenDays)).toBe("expired");
    expectRejected(organization, {
      type: "accept", invitationId, email: "jules@northstar.example", memberId,
    }, now + sevenDays);
  });

  it("rejects the wrong account and an unavailable invitation", () => {
    const organization = invitedOrganization();
    expectRejected(organization, { type: "accept", invitationId, email: "other@northstar.example", memberId });
    expectRejected(organization, { type: "accept", invitationId: "missing", email: "jules@northstar.example", memberId });
  });

  it("rejects a missing or existing member identifier when accepting", () => {
    const organization = invitedOrganization();
    for (const id of [" ", organization.members[0].id]) {
      expectRejected(organization, { type: "accept", invitationId, email: "jules@northstar.example", memberId: id });
    }
  });

  it("keeps repeated acceptance idempotent without creating a second membership", () => {
    const organization = acceptedOrganization();
    expectRejected(organization, {
      type: "accept", invitationId, email: "jules@northstar.example", memberId: "another-member",
    });
    expect(organization.members.filter((member) => member.email === "jules@northstar.example")).toHaveLength(1);
    expect(invitationStatus(organization.invitations![0], now + sevenDays)).toBe("accepted");
  });

  it("renews an expired pending invitation for seven days without creating another invitation", () => {
    const organization = invitedOrganization();
    const resendAt = now + sevenDays + 1;
    const result = transitionOrganization(organization, { type: "resend", invitationId }, resendAt);
    expect(result.error).toBeUndefined();
    expect(result.organization.invitations).toHaveLength(1);
    expect(result.organization.invitations?.[0]).toMatchObject({
      id: invitationId, status: "pending", createdAt: now, expiresAt: resendAt + sevenDays, resendCount: 1,
    });
    expect(invitationStatus(result.organization.invitations![0], resendAt)).toBe("pending");
    expect(organization.invitations?.[0].resendCount).toBe(0);
  });

  it("prevents resending an old invitation when a newer invitation is pending", () => {
    const organization = invitedOrganization();
    const expiredAt = now + sevenDays;
    const replacement = transitionOrganization(organization, {
      type: "invite", id: "newer-invitation", name: "Jules Park", email: "jules@northstar.example",
    }, expiredAt);
    expect(replacement.error).toBeUndefined();
    expectRejected(replacement.organization, { type: "resend", invitationId }, expiredAt);
  });

  it("revokes an invitation and prevents acceptance or renewal", () => {
    const organization = invitedOrganization();
    const result = transitionOrganization(organization, { type: "revoke", invitationId }, now);
    expect(result.error).toBeUndefined();
    expect(invitationStatus(result.organization.invitations![0], now + sevenDays)).toBe("revoked");
    expectRejected(result.organization, { type: "accept", invitationId, email: "jules@northstar.example", memberId });
    expectRejected(result.organization, { type: "resend", invitationId });
    expectRejected(result.organization, { type: "revoke", invitationId });
  });

  it("treats accepted invitations as terminal for resend and revoke", () => {
    const organization = acceptedOrganization();
    expectRejected(organization, { type: "resend", invitationId });
    expectRejected(organization, { type: "revoke", invitationId });
  });

  it("rejects a stale invitation if its email has since become a member", () => {
    const organization = invitedOrganization();
    organization.members = [...organization.members, {
      id: "joined-elsewhere", name: "Jules Park", email: "JULES@northstar.example",
      departmentId: organization.departments[0].id, role: "Employee", status: "active",
    }];
    expectRejected(organization, { type: "accept", invitationId, email: "jules@northstar.example", memberId });
    expectRejected(organization, { type: "resend", invitationId });
  });

  it("fails closed when the invitation clock or expiry is invalid", () => {
    const organization = invitedOrganization();
    expectRejected(organization, { type: "resend", invitationId }, Number.NaN);
    organization.invitations![0].expiresAt = Number.NaN;
    expect(invitationStatus(organization.invitations![0], now)).toBe("expired");
    expectRejected(organization, { type: "accept", invitationId, email: "jules@northstar.example", memberId });
  });
});

describe("organization membership assignment and readiness", () => {
  it("activates a pending member only after valid department and scoped role assignment", () => {
    const organization = acceptedOrganization();
    const departmentId = organization.departments[0].id;
    const result = transitionOrganization(organization, {
      type: "assign", memberId, departmentId, role: "Employee", roleScope: "department",
    }, now);
    expect(result.error).toBeUndefined();
    expect(result.organization.members.find((member) => member.id === memberId)).toMatchObject({
      departmentId, role: "Employee", roleScope: "department", status: "active",
    });
    expect(membershipReadiness(result.organization, memberId).state).toBe("ready");
    expect(membershipReadiness(organization, memberId).state).toBe("pending");
  });

  it("rejects assignment to an unknown department or member", () => {
    const organization = acceptedOrganization();
    expectRejected(organization, {
      type: "assign", memberId, departmentId: "another-organization-department", role: "Employee", roleScope: "department",
    });
    expectRejected(organization, {
      type: "assign", memberId: "missing", departmentId: organization.departments[0].id, role: "Employee", roleScope: "organization",
    });
  });

  it("rejects department-scoped System Admin and accepts organization scope", () => {
    const organization = acceptedOrganization();
    const departmentId = organization.departments[0].id;
    expectRejected(organization, {
      type: "assign", memberId, departmentId, role: "System Admin", roleScope: "department",
    });
    const result = transitionOrganization(organization, {
      type: "assign", memberId, departmentId, role: "System Admin", roleScope: "organization",
    }, now);
    expect(result.error).toBeUndefined();
    expect(membershipReadiness(result.organization, memberId).state).toBe("ready");
  });

  it("protects the last active System Admin from demotion and suspension", () => {
    const organization = createPreviewOrganization();
    const admin = organization.members.find((member) => member.role === "System Admin");
    expect(admin).toBeDefined();
    if (!admin) throw new Error("The synthetic organization must include a System Admin.");
    expectRejected(organization, {
      type: "assign", memberId: admin.id, departmentId: admin.departmentId, role: "Employee", roleScope: "organization",
    });
    expectRejected(organization, { type: "status", memberId: admin.id, status: "suspended" });
  });

  it("does not count a suspended admin as a replacement for the last active admin", () => {
    const organization = createPreviewOrganization();
    const admin = organization.members.find((member) => member.role === "System Admin");
    if (!admin) throw new Error("The synthetic organization must include a System Admin.");
    organization.members = [...organization.members, { ...admin, id: "suspended-admin", email: "suspended@northstar.example", status: "suspended" }];
    expectRejected(organization, { type: "status", memberId: admin.id, status: "suspended" });
  });

  it("does not count an invalid department-scoped admin as a replacement", () => {
    const organization = createPreviewOrganization();
    const admin = organization.members.find((member) => member.role === "System Admin");
    if (!admin) throw new Error("The synthetic organization must include a System Admin.");
    organization.members = [...organization.members, {
      ...admin, id: "invalid-admin", email: "invalid-admin@northstar.example", roleScope: "department",
    }];
    expectRejected(organization, {
      type: "assign", memberId: admin.id, departmentId: admin.departmentId, role: "Employee", roleScope: "department",
    });
    expectRejected(organization, { type: "status", memberId: admin.id, status: "suspended" });
  });

  it("does not count an admin without an explicit role scope as a replacement", () => {
    const organization = createPreviewOrganization();
    const admin = organization.members.find((member) => member.role === "System Admin");
    if (!admin) throw new Error("The synthetic organization must include a System Admin.");
    const replacement = { ...admin, id: "unscoped-admin", email: "unscoped-admin@northstar.example" };
    delete replacement.roleScope;
    organization.members = [...organization.members, replacement];
    expectRejected(organization, { type: "status", memberId: admin.id, status: "suspended" });
  });

  it("allows admin demotion and suspension once another active admin exists", () => {
    const organization = createPreviewOrganization();
    const admin = organization.members.find((member) => member.role === "System Admin");
    if (!admin) throw new Error("The synthetic organization must include a System Admin.");
    organization.members = [...organization.members, { ...admin, id: "second-admin", email: "second@northstar.example", status: "active" }];
    const demotion = transitionOrganization(organization, {
      type: "assign", memberId: admin.id, departmentId: admin.departmentId, role: "Employee", roleScope: "department",
    }, now);
    expect(demotion.error).toBeUndefined();
    const suspension = transitionOrganization(organization, { type: "status", memberId: admin.id, status: "suspended" }, now);
    expect(suspension.error).toBeUndefined();
    expect(membershipReadiness(suspension.organization, admin.id).state).toBe("denied");
  });

  it("does not restore a suspended member merely by changing their assignment", () => {
    const organization = createPreviewOrganization();
    const member = organization.members.find((item) => item.role === "Employee");
    if (!member) throw new Error("The synthetic organization must include an Employee.");
    member.status = "suspended";
    const result = transitionOrganization(organization, {
      type: "assign", memberId: member.id, departmentId: organization.departments[1].id,
      role: "Manager / Knowledge Reviewer", roleScope: "department",
    }, now);
    expect(result.error).toBeUndefined();
    expect(membershipReadiness(result.organization, member.id).state).toBe("denied");
    const restore = transitionOrganization(result.organization, { type: "status", memberId: member.id, status: "active" }, now);
    expect(restore.error).toBeUndefined();
    expect(membershipReadiness(restore.organization, member.id).state).toBe("ready");
  });

  it("requires assignment before activating an unassigned member", () => {
    const organization = acceptedOrganization();
    expectRejected(organization, { type: "status", memberId, status: "active" });
    expectRejected(organization, { type: "status", memberId: "missing", status: "active" });
  });

  it("returns pending for missing departments and denied for unknown or suspended memberships", () => {
    const organization = createPreviewOrganization();
    const member = organization.members.find((item) => item.role === "Employee");
    if (!member) throw new Error("The synthetic organization must include an Employee.");
    expect(membershipReadiness(organization, member.id).state).toBe("ready");
    organization.departments = organization.departments.filter((department) => department.id !== member.departmentId);
    expect(membershipReadiness(organization, member.id).state).toBe("pending");
    member.status = "suspended";
    expect(membershipReadiness(organization, member.id).state).toBe("denied");
    expect(membershipReadiness(organization, "another-organization-member").state).toBe("denied");
  });

  it("denies a malformed department-scoped administrator configuration", () => {
    const organization = createPreviewOrganization();
    const admin = organization.members.find((member) => member.role === "System Admin");
    if (!admin) throw new Error("The synthetic organization must include a System Admin.");
    admin.roleScope = "department";
    expect(membershipReadiness(organization, admin.id).state).toBe("denied");
  });

  it.each(["missing", "unknown"])("denies an assigned member with a %s role scope and blocks restoration", (scopeState) => {
    const organization = createPreviewOrganization();
    const member = organization.members.find((item) => item.role === "Employee");
    if (!member) throw new Error("The synthetic organization must include an Employee.");
    if (scopeState === "missing") delete member.roleScope;
    else Object.assign(member, { roleScope: "unknown-runtime-scope" });
    expect(membershipReadiness(organization, member.id).state).toBe("denied");
    member.status = "suspended";
    expectRejected(organization, { type: "status", memberId: member.id, status: "active" });
  });
});
