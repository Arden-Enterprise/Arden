import { describe, expect, it } from "vitest";
import { canRead, validateSelection, type ReaderActor, type SelectionFacts } from "./policy.js";

const members = Array.from({ length: 101 }, (_, index) => `member-${index + 1}`);
const facts: SelectionFacts = {
  organizationId: "org",
  departments: [
    { departmentId: "engineering", organizationId: "org", status: "ACTIVE" },
    { departmentId: "archived", organizationId: "org", status: "ARCHIVED" },
    { departmentId: "inactive", organizationId: "org", status: "INACTIVE" },
  ],
  members: [
    ...members.map(membershipId => ({ membershipId, organizationId: "org", status: "ACTIVE" as const, accountActive: true })),
    { membershipId: "suspended", organizationId: "org", status: "SUSPENDED", accountActive: true },
    { membershipId: "invited", organizationId: "org", status: "INVITED", accountActive: true },
    { membershipId: "disabled-account", organizationId: "org", status: "ACTIVE", accountActive: false },
    { membershipId: "foreign", organizationId: "other-org", status: "ACTIVE", accountActive: true },
  ],
};

describe("TargetReaderPolicy.validateSelection", () => {
  it("accepts each mode and keeps the selected member order", () => {
    expect(validateSelection({ mode: "ORGANIZATION" }, facts)).toEqual({ ok: true,
      selection: { mode: "ORGANIZATION", departmentId: null, memberIds: [] } });
    expect(validateSelection({ mode: "DEPARTMENT", departmentId: "engineering" }, facts)).toEqual({ ok: true,
      selection: { mode: "DEPARTMENT", departmentId: "engineering", memberIds: [] } });
    expect(validateSelection({ mode: "SELECTED_MEMBERS", memberIds: ["member-2", "member-1"] }, facts)).toEqual({ ok: true,
      selection: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["member-2", "member-1"] } });
    expect(validateSelection({ mode: "SELECTED_MEMBERS", memberIds: members.slice(0, 100) }, facts).ok).toBe(true);
  });

  it.each([
    ["1 member", ["member-1"]],
    ["101 members", members],
    ["no members", []],
    ["a repeated member", ["member-1", "member-1"]],
    ["a suspended member", ["member-1", "suspended"]],
    ["an invited member", ["member-1", "invited"]],
    ["a disabled account", ["member-1", "disabled-account"]],
    ["another organization's member", ["member-1", "foreign"]],
    ["an unknown member", ["member-1", "unknown"]],
  ])("rejects Selected Members with %s on memberIds", (_name, memberIds) => {
    expect(validateSelection({ mode: "SELECTED_MEMBERS", memberIds }, facts))
      .toMatchObject({ ok: false, field: "targetReaders.memberIds" });
  });

  it.each([
    ["no department", undefined],
    ["an archived department", "archived"],
    ["an inactive department", "inactive"],
    ["an unknown or foreign department", "elsewhere"],
  ])("rejects Department with %s on departmentId", (_name, departmentId) => {
    expect(validateSelection({ mode: "DEPARTMENT", departmentId }, facts))
      .toMatchObject({ ok: false, field: "targetReaders.departmentId" });
  });

  it("rejects fields that do not belong to the chosen mode", () => {
    expect(validateSelection({ mode: "ORGANIZATION", departmentId: "engineering" }, facts))
      .toMatchObject({ ok: false, field: "targetReaders.departmentId" });
    expect(validateSelection({ mode: "ORGANIZATION", memberIds: ["member-1", "member-2"] }, facts))
      .toMatchObject({ ok: false, field: "targetReaders.memberIds" });
    expect(validateSelection({ mode: "DEPARTMENT", departmentId: "engineering", memberIds: ["member-1"] }, facts))
      .toMatchObject({ ok: false, field: "targetReaders.memberIds" });
    expect(validateSelection({ mode: "SELECTED_MEMBERS", departmentId: "engineering",
      memberIds: ["member-1", "member-2"] }, facts)).toMatchObject({ ok: false, field: "targetReaders.departmentId" });
    expect(validateSelection({ mode: "EVERYONE" as never }, facts)).toMatchObject({ ok: false, field: "targetReaders.mode" });
  });
});

describe("TargetReaderPolicy.canRead", () => {
  const actor: ReaderActor = { membershipId: "member-1", organizationId: "org", status: "ACTIVE", departmentIds: ["sales"] };
  const organization = { organizationId: "org", readers: { mode: "ORGANIZATION" as const, departmentId: null, memberIds: [] } };
  const department = { organizationId: "org", readers: { mode: "DEPARTMENT" as const, departmentId: "engineering", memberIds: [] } };
  const selected = { organizationId: "org", readers: { mode: "SELECTED_MEMBERS" as const, departmentId: null,
    memberIds: ["member-2", "member-3"] } };

  it("lets any active member read an Organization publication", () => {
    expect(canRead(actor, organization)).toBe(true);
  });

  it("requires the actor's current department for a Department publication", () => {
    expect(canRead(actor, department)).toBe(false);
    expect(canRead({ ...actor, departmentIds: ["engineering"] }, department)).toBe(true);
  });

  it("requires the actor to be a selected reader for Selected Members", () => {
    expect(canRead(actor, selected)).toBe(false);
    expect(canRead({ ...actor, membershipId: "member-3" }, selected)).toBe(true);
    expect(canRead(actor, { ...selected, readers: { ...selected.readers, memberIds: [] } })).toBe(false);
  });

  it("keeps a publication without readers on the legacy audience path", () => {
    expect(canRead(actor, { organizationId: "org", readers: null })).toBe(true);
  });

  it("denies inactive actors, missing actors and other organizations in every mode", () => {
    for (const publication of [organization, department, selected, { organizationId: "org", readers: null }]) {
      expect(canRead(null, publication)).toBe(false);
      expect(canRead({ ...actor, status: "SUSPENDED", departmentIds: ["engineering"], membershipId: "member-2" }, publication)).toBe(false);
      expect(canRead({ ...actor, organizationId: "other-org", departmentIds: ["engineering"], membershipId: "member-2" }, publication)).toBe(false);
    }
  });
});
