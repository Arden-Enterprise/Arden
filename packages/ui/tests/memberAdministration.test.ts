import { describe, expect, it } from "vitest";
import { filterOrganizationMembers, membersInDepartment } from "../src/organization/memberAdministration";
import type { OrganizationAdministration } from "../src/shared/api-client";

type Member = OrganizationAdministration["members"][number];

const admin: Member = {
  id: "admin", email: "admin@example.test", name: "Org Admin", status: "ACTIVE",
  departmentId: "engineering", departmentIds: ["engineering"], roleIds: ["org-admin"], roleNames: ["Organization Admin"],
};
const member: Member = {
  id: "member", email: "member@example.test", name: "Member", status: "ACTIVE",
  departmentId: "engineering", departmentIds: ["engineering"], roleIds: [], roleNames: ["Member"],
};
const roles: OrganizationAdministration["roles"] = [
  { id: "org-admin", name: "Organization Admin", code: "ORG_ADMIN", isDefault: false },
];

describe("organization member administration", () => {
  it("keeps organization administrators available in the member manager", () => {
    expect(filterOrganizationMembers([admin, member], roles, { query: "", status: "ALL", department: "ALL" }))
      .toEqual([admin, member]);
  });

  it("includes organization administrators whose department membership is affected by deletion", () => {
    expect(membersInDepartment([admin, member], "engineering")).toEqual([admin, member]);
  });

  it("does not classify an unassigned organization administrator as waiting for assignment", () => {
    const unassignedAdmin = { ...admin, departmentId: null, departmentIds: [] };
    expect(filterOrganizationMembers([unassignedAdmin], roles, { query: "", status: "INVITED", department: "ALL" }))
      .toEqual([]);
  });

  it("shows active unassigned members only in the awaiting-assignment filter", () => {
    const unassignedMember = { ...member, departmentId: null, departmentIds: [] };
    expect(filterOrganizationMembers([unassignedMember], roles, { query: "", status: "INVITED", department: "ALL" }))
      .toEqual([unassignedMember]);
    expect(filterOrganizationMembers([unassignedMember], roles, { query: "", status: "ACTIVE", department: "ALL" }))
      .toEqual([]);
  });
});
