import { describe, expect, it } from "vitest";
import { availableAudienceOptions, normalizeAudienceSelection, validAudienceSelection } from "../src/knowledge/audience-options";

const audiences = [
  { id: "everyone", name: "Everyone in organization", departmentId: null, kind: "ORGANIZATION_ALL" as const },
  { id: "engineering", name: "Engineering members", departmentId: "dept-engineering", kind: "DEPARTMENT_ALL" as const },
  { id: "project", name: "Project readers", departmentId: null, kind: "GROUP" as const },
];

describe("knowledge audience options", () => {
  it("offers managed audiences only at their matching scope and groups at either scope", () => {
    expect(availableAudienceOptions(audiences, "ORGANIZATION").map(item => item.id)).toEqual(["everyone", "project"]);
    expect(availableAudienceOptions(audiences, "DEPARTMENT").map(item => item.id)).toEqual(["engineering", "project"]);
    expect(availableAudienceOptions(audiences, null).map(item => item.id)).toEqual(["project"]);
  });

  it("removes ALL_MEMBERS when switching from Organization to Department", () => {
    expect(normalizeAudienceSelection(["everyone", "engineering"], audiences, "DEPARTMENT")).toEqual(["engineering"]);
  });

  it("rejects empty, duplicate, unknown and out-of-scope selections", () => {
    expect(validAudienceSelection(["everyone"], audiences, "ORGANIZATION")).toBe(true);
    expect(validAudienceSelection(["everyone"], audiences, "DEPARTMENT")).toBe(false);
    expect(validAudienceSelection([], audiences, "ORGANIZATION")).toBe(false);
    expect(validAudienceSelection(["project", "project"], audiences, "ORGANIZATION")).toBe(false);
    expect(validAudienceSelection(["unknown"], audiences, "ORGANIZATION")).toBe(false);
  });
});
