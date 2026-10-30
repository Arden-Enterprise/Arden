import { describe, expect, it } from "vitest";
import { departmentDeletionSummary, filterOrganizationMembers, membersInDepartment } from "../src/organization/memberAdministration";
import type { OrganizationAdministration } from "../src/shared/api-client";

type Member = OrganizationAdministration["members"][number];

const admin: Member = {
  id: "admin", email: "admin@example.test", name: "Org Admin", status: "ACTIVE",
  departmentId: "engineering", departmentIds: ["engineering"], isOrganizationAdmin: true,
  roleIds: ["org-admin"], roleNames: ["Organization Admin"],
};
const member: Member = {
  id: "member", email: "member@example.test", name: "Member", status: "ACTIVE",
  departmentId: "engineering", departmentIds: ["engineering"], isOrganizationAdmin: false,
  roleIds: [], roleNames: ["Member"],
};

describe("organization member administration", () => {
  it("keeps organization administrators available in the member manager", () => {
    expect(filterOrganizationMembers([admin, member], { query: "", status: "ALL", department: "ALL" }))
      .toEqual([admin, member]);
  });

  it("includes organization administrators whose department membership is affected by deletion", () => {
    expect(membersInDepartment([admin, member], "engineering")).toEqual([admin, member]);
  });

  it("does not classify an unassigned organization administrator as waiting for assignment", () => {
    const unassignedAdmin = { ...admin, departmentId: null, departmentIds: [] };
    expect(filterOrganizationMembers([unassignedAdmin], { query: "", status: "INVITED", department: "ALL" }))
      .toEqual([]);
  });

  it("shows active unassigned members only in the awaiting-assignment filter", () => {
    const unassignedMember = { ...member, departmentId: null, departmentIds: [] };
    expect(filterOrganizationMembers([unassignedMember], { query: "", status: "INVITED", department: "ALL" }))
      .toEqual([unassignedMember]);
    expect(filterOrganizationMembers([unassignedMember], { query: "", status: "ACTIVE", department: "ALL" }))
      .toEqual([]);
  });

  it("does not treat a custom role named Department Administrator as an organization admin", () => {
    const departmentAdministrator = {
      ...member,
      departmentId: null,
      departmentIds: [],
      roleIds: ["custom-dept-admin"],
      roleNames: ["Department Administrator"],
    };
    expect(filterOrganizationMembers([departmentAdministrator], { query: "", status: "INVITED", department: "ALL" }))
      .toEqual([departmentAdministrator]);
  });

  it("explains that only members who still need a department will wait after deletion", () => {
    expect(departmentDeletionSummary(2)).toBe(
      "Deleting this department will unassign 2 members. Members who still need a department will enter the waiting room; organization administrators remain active.",
    );
  });
});
