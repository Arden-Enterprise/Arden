import { describe, expect, it } from "vitest";
import { createPreviewOrganization, validateOrganization } from "../src/organization/previewModel";

describe("organization preview configuration", () => {
  it("starts with a valid synthetic two-department demonstration", () => {
    const organization = createPreviewOrganization();
    expect(organization.departments).toHaveLength(2);
    expect(validateOrganization(organization)).toEqual([]);
  });

  it("rejects duplicate departments and members without a department", () => {
    const organization = createPreviewOrganization();
    organization.departments[1].name = organization.departments[0].name.toUpperCase();
    organization.members[1].departmentId = "missing-department";

    expect(validateOrganization(organization)).toEqual(expect.arrayContaining([
      "Department names must be unique.",
      "Assign every member to an existing department.",
    ]));
  });

  it("requires a reviewer and an employee in each department for the demo", () => {
    const organization = createPreviewOrganization();
    organization.members = organization.members.filter((member) => member.role !== "Manager / Knowledge Reviewer" && member.id !== "sample-operations-employee");

    expect(validateOrganization(organization)).toEqual(expect.arrayContaining([
      "Add a Manager / Knowledge Reviewer to the demo configuration.",
      "Add an Employee to each department for the permission-boundary demo.",
    ]));
  });

  it("rejects a duplicate member email regardless of case", () => {
    const organization = createPreviewOrganization();
    organization.members[1].email = organization.members[0].email.toUpperCase();

    expect(validateOrganization(organization)).toContain("Member email addresses must be unique.");
  });

  it("requires the demo's second department and at least one admin", () => {
    const organization = createPreviewOrganization();
    organization.departments = organization.departments.slice(0, 1);
    organization.members = organization.members
      .filter((member) => member.departmentId === organization.departments[0].id)
      .map((member) => ({ ...member, role: "Employee" as const }));

    expect(validateOrganization(organization)).toEqual(expect.arrayContaining([
      "The demo configuration needs at least two departments.",
      "Keep at least one System Admin in the demo configuration.",
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
