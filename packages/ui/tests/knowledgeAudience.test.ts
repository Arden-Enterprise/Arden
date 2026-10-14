import { describe, expect, it } from "vitest";
import { availableAudienceOptions, normalizeAudienceSelection, validAudienceSelection } from "../src/knowledge/audience-options";

const roles = [
  { id: "everyone", name: "Everyone in organization", departmentId: null, kind: "ALL_MEMBERS" as const },
  { id: "engineering", name: "Engineering Member", departmentId: "dept-engineering", kind: "ROLE" as const },
  { id: "project", name: "Project Reader", departmentId: null, kind: "ROLE" as const },
];

describe("knowledge audience options", () => {
  it("offers ALL_MEMBERS only for Organization scope", () => {
    expect(availableAudienceOptions(roles, "ORGANIZATION").map((role) => role.id)).toEqual(["everyone", "engineering", "project"]);
    expect(availableAudienceOptions(roles, "DEPARTMENT").map((role) => role.id)).toEqual(["engineering", "project"]);
    expect(availableAudienceOptions(roles, null).map((role) => role.id)).toEqual(["engineering", "project"]);
  });

  it("removes ALL_MEMBERS when switching from Organization to Department", () => {
    expect(normalizeAudienceSelection(["everyone", "engineering"], roles, "DEPARTMENT")).toEqual(["engineering"]);
  });

  it("rejects empty, duplicate, unknown and out-of-scope selections", () => {
    expect(validAudienceSelection(["everyone"], roles, "ORGANIZATION")).toBe(true);
    expect(validAudienceSelection(["everyone"], roles, "DEPARTMENT")).toBe(false);
    expect(validAudienceSelection([], roles, "ORGANIZATION")).toBe(false);
    expect(validAudienceSelection(["project", "project"], roles, "ORGANIZATION")).toBe(false);
    expect(validAudienceSelection(["unknown"], roles, "ORGANIZATION")).toBe(false);
  });
});
