import { describe, expect, it } from "vitest";
import { resolveApprovedReaders, sameReaders } from "./narrowing.js";
import type { ReaderSelection, SelectionFacts } from "./policy.js";

const ids = Array.from({ length: 12 }, (_, index) => `member-${index + 1}`);
// member-1..6 are currently in engineering, member-7..12 in sales.
const facts: SelectionFacts = {
  organizationId: "org",
  departments: [
    { departmentId: "engineering", organizationId: "org", status: "ACTIVE" },
    { departmentId: "sales", organizationId: "org", status: "ACTIVE" },
    { departmentId: "archived", organizationId: "org", status: "ARCHIVED" },
  ],
  members: [
    ...ids.map((membershipId, index) => ({ membershipId, organizationId: "org", status: "ACTIVE" as const,
      accountActive: true, departmentIds: [index < 6 ? "engineering" : "sales"] })),
    { membershipId: "suspended", organizationId: "org", status: "SUSPENDED", accountActive: true, departmentIds: ["engineering"] },
    { membershipId: "foreign", organizationId: "other-org", status: "ACTIVE", accountActive: true, departmentIds: ["engineering"] },
  ],
};
const organization: ReaderSelection = { mode: "ORGANIZATION", departmentId: null, memberIds: [] };
const engineering: ReaderSelection = { mode: "DEPARTMENT", departmentId: "engineering", memberIds: [] };
const selected: ReaderSelection = { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ids.slice(0, 10) };

describe("resolveApprovedReaders: allowed narrowing", () => {
  it.each([
    ["ORGANIZATION → ORGANIZATION", organization, { mode: "ORGANIZATION" as const }, false],
    ["ORGANIZATION → DEPARTMENT", organization, { mode: "DEPARTMENT" as const, departmentId: "sales" }, true],
    ["ORGANIZATION → SELECTED_MEMBERS", organization, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1", "member-9"] }, true],
    ["DEPARTMENT d → DEPARTMENT d", engineering, { mode: "DEPARTMENT" as const, departmentId: "engineering" }, false],
    ["DEPARTMENT d → members of d", engineering, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-2", "member-5"] }, true],
    ["SELECTED S → S", selected, { mode: "SELECTED_MEMBERS" as const, memberIds: ids.slice(0, 10) }, false],
    ["SELECTED S → subset of S", selected, { mode: "SELECTED_MEMBERS" as const, memberIds: ids.slice(0, 5) }, true],
    ["SELECTED S → 2 of S", selected, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-3", "member-8"] }, true],
  ])("%s", (_name, proposed, requested, narrowed) => {
    expect(resolveApprovedReaders(proposed, requested, facts)).toMatchObject({ ok: true, narrowed });
  });

  it("approves exactly as proposed when no readers are sent, as a separate copy", () => {
    const result = resolveApprovedReaders(selected, undefined, facts);
    expect(result).toEqual({ ok: true, narrowed: false, selection: selected });
    if (result.ok) expect(result.selection.memberIds).not.toBe(selected.memberIds);
  });

  it("ignores member order", () => {
    const proposed: ReaderSelection = { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["member-1", "member-2"] };
    expect(resolveApprovedReaders(proposed, { mode: "SELECTED_MEMBERS", memberIds: ["member-2", "member-1"] }, facts))
      .toMatchObject({ ok: true, narrowed: false });
    expect(sameReaders(proposed, { ...proposed, memberIds: ["member-2", "member-1"] })).toBe(true);
  });
});

describe("resolveApprovedReaders: refusals", () => {
  it.each([
    ["DEPARTMENT d → ORGANIZATION", engineering, { mode: "ORGANIZATION" as const }],
    ["DEPARTMENT d → DEPARTMENT e", engineering, { mode: "DEPARTMENT" as const, departmentId: "sales" }],
    ["DEPARTMENT d → members including someone outside d", engineering,
      { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1", "member-7"] }],
    ["SELECTED S → set with a non-member of S", selected,
      { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1", "member-11"] }],
    ["SELECTED → DEPARTMENT", selected, { mode: "DEPARTMENT" as const, departmentId: "engineering" }],
    ["SELECTED → ORGANIZATION", selected, { mode: "ORGANIZATION" as const }],
  ])("%s is READERS_WIDENED", (_name, proposed, requested) => {
    expect(resolveApprovedReaders(proposed, requested, facts)).toEqual({ ok: false, reason: "READERS_WIDENED" });
  });

  it.each([
    ["a set of 1 member", selected, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1"] }, "approvedReaders.memberIds"],
    ["duplicates", selected, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1", "member-1"] }, "approvedReaders.memberIds"],
    ["a suspended member", organization, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1", "suspended"] }, "approvedReaders.memberIds"],
    ["another organization's member", organization, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1", "foreign"] }, "approvedReaders.memberIds"],
    ["an unknown member", organization, { mode: "SELECTED_MEMBERS" as const, memberIds: ["member-1", "nobody"] }, "approvedReaders.memberIds"],
    ["an archived department", organization, { mode: "DEPARTMENT" as const, departmentId: "archived" }, "approvedReaders.departmentId"],
    ["a department without an ID", organization, { mode: "DEPARTMENT" as const }, "approvedReaders.departmentId"],
  ])("%s is INVALID_READERS with a field", (_name, proposed, requested, field) => {
    expect(resolveApprovedReaders(proposed, requested, facts)).toMatchObject({ ok: false, reason: "INVALID_READERS", field });
  });
});
