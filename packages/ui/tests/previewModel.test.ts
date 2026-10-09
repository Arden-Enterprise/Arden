import { describe, expect, it } from "vitest";
import { createPreviewOrganization, validateOrganization } from "../src/organization/previewModel";

describe("organization preview configuration", () => {
  it("starts with the valid four-department Figma sample", () => {
    const organization = createPreviewOrganization();
    expect(organization.departments).toHaveLength(4);
    expect(validateOrganization(organization)).toEqual([]);
  });

  it("rejects duplicate departments and members without a department", () => {
    const organization = createPreviewOrganization();
    organization.departments[1].name = organization.departments[0].name.toUpperCase();
    organization.members[1].departmentId = "missing-department";

    expect(validateOrganization(organization)).toEqual(expect.arrayContaining([
      "Department names must be unique.",
      "Assign every active member to an existing department.",
    ]));
  });

  it("allows empty departments and pending members without premature assignments", () => {
    const organization = createPreviewOrganization();
    organization.members = organization.members.filter((member) => member.role !== "Manager / Knowledge Reviewer" && member.id !== "sample-operations-employee");
    organization.members.push({id: "pending", name: "An Le", email: "an@company.example", departmentId: "", role: "", status: "pending-assignment"});
    expect(validateOrganization(organization)).toEqual([]);
  });

  it("rejects a duplicate member email regardless of case", () => {
    const organization = createPreviewOrganization();
    organization.members[1].email = organization.members[0].email.toUpperCase();

    expect(validateOrganization(organization)).toContain("Member email addresses must be unique.");
  });

  it("allows one department and requires a valid active admin", () => {
    const organization = createPreviewOrganization();
    organization.departments = organization.departments.slice(0, 1);
    organization.members = organization.members
      .filter((member) => member.departmentId === organization.departments[0].id);
    expect(validateOrganization(organization)).toEqual([]);
    organization.members = organization.members.map((member) => ({ ...member, role: "Employee" as const }));
    expect(validateOrganization(organization)).toContain("Keep at least one active System Admin.");
  });

  it("requires an explicit scope and does not count an unscoped admin", () => {
    const organization = createPreviewOrganization();
    delete organization.members[0].roleScope;
    expect(validateOrganization(organization)).toEqual(expect.arrayContaining([
      "Assign every active member an explicit role scope.",
      "Keep at least one active System Admin.",
    ]));
  });

  it("requires an organization name and valid member email", () => {
    const organization = createPreviewOrganization();
    organization.name = " ";
    organization.members[0].email = "invalid-address";

    expect(validateOrganization(organization)).toEqual(expect.arrayContaining([
      "Enter an organization name.",
      "Give every member a valid email address.",
    ]));
  });
});
