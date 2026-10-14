import { describe, expect, it } from "vitest";
import { parseCustomRole, parseCustomRoleList } from "../src/shared/role-contracts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const role = { id, name: "Reader", description: "", version: 1, status: "ACTIVE",
  permissions: ["PUBLISHED_CONTENT_VIEW"], assignments: [{ id, membershipId: id, status: "ACTIVE",
    scope: { type: "ORGANIZATION", departmentId: null }, validFrom: "2026-10-14T00:00:00Z", validUntil: null }] };

describe("server custom-role contract", () => {
  it("parses bounded role lists without inventing fallback data", () => {
    expect(parseCustomRoleList({ items: [role] })).toEqual([role]);
    expect(() => parseCustomRoleList({ error: "unavailable" })).toThrow();
    expect(() => parseCustomRole({ ...role, version: 0 })).toThrow();
    expect(() => parseCustomRole({ ...role, id: "unknown" })).toThrow();
  });
  it("rejects private/default/management capabilities and duplicate permissions", () => {
    for (const permissions of [["PRIVATE_CONTENT_READ"], ["SHARED_DRAFT_SUBMIT"], ["roles.manage"],
      ["PUBLISHED_CONTENT_VIEW", "PUBLISHED_CONTENT_VIEW"]]) {
      expect(() => parseCustomRole({ ...role, permissions })).toThrow();
    }
  });
  it("requires a consistent scope and valid assignment boundary", () => {
    const assignment = role.assignments[0];
    for (const replacement of [
      { ...assignment, scope: { type: "ORGANIZATION", departmentId: id } },
      { ...assignment, scope: { type: "DEPARTMENT", departmentId: null } },
      { ...assignment, status: "UNKNOWN" }, { ...assignment, validFrom: "not-a-date" },
    ]) expect(() => parseCustomRole({ ...role, assignments: [replacement] })).toThrow();
    expect(parseCustomRole({ ...role, assignments: [{ ...assignment, scope: { type: "DEPARTMENT", departmentId: id } }] }).assignments[0].scope.type).toBe("DEPARTMENT");
  });
});
