import { describe, expect, it } from "vitest";
import { validAudienceSelection } from "../src/knowledge/audience-options";
import { addReader, onlyGroupReaders, readerChoices, removeReader, scopeForReaders } from "../src/knowledge/readerSelection";

const audiences = [
  { id: "everyone", name: "Everyone in organization", departmentId: null, kind: "ORGANIZATION_ALL" as const },
  { id: "engineering", name: "Everyone in Engineering", departmentId: "dept-engineering", kind: "DEPARTMENT_ALL" as const },
  { id: "operations", name: "Everyone in Operations", departmentId: "dept-operations", kind: "DEPARTMENT_ALL" as const },
  { id: "incident-leads", name: "Incident leads", departmentId: null, kind: "GROUP" as const },
  { id: "ops-oncall", name: "Ops on-call", departmentId: "dept-operations", kind: "GROUP" as const },
];

describe("reader picker choices", () => {
  it("offers only the responsible department's audience and groups that stay within it", () => {
    const choices = readerChoices(audiences, "dept-engineering");
    expect(choices.organization.map((item) => item.id)).toEqual(["everyone"]);
    expect(choices.departments.map((item) => item.id)).toEqual(["engineering"]);
    expect(choices.groups.map((item) => item.id)).toEqual(["incident-leads"]);
  });

  it("offers no department audience before a responsible department is chosen", () => {
    expect(readerChoices(audiences, null).departments).toEqual([]);
  });
});

describe("adding and removing readers", () => {
  it("replaces the department audience when the organization audience is added, and the reverse", () => {
    expect(addReader(["engineering", "incident-leads"], "everyone", audiences)).toEqual(["incident-leads", "everyone"]);
    expect(addReader(["everyone"], "engineering", audiences)).toEqual(["engineering"]);
  });

  it("does not duplicate a reader and removes one by id", () => {
    expect(addReader(["incident-leads"], "incident-leads", audiences)).toEqual(["incident-leads"]);
    expect(removeReader(["incident-leads", "everyone"], "everyone")).toEqual(["incident-leads"]);
  });
});

describe("derived publication scope", () => {
  it("follows the organization or department audience", () => {
    expect(scopeForReaders(["everyone", "incident-leads"], audiences, "DEPARTMENT")).toBe("ORGANIZATION");
    expect(scopeForReaders(["engineering"], audiences, "ORGANIZATION")).toBe("DEPARTMENT");
  });

  it("keeps the current scope for groups only, defaulting to Organization", () => {
    expect(scopeForReaders(["incident-leads"], audiences, "DEPARTMENT")).toBe("DEPARTMENT");
    expect(scopeForReaders(["incident-leads"], audiences, null)).toBe("ORGANIZATION");
    expect(scopeForReaders([], audiences, "DEPARTMENT")).toBe("DEPARTMENT");
  });

  it("always yields a selection the existing audience rules accept", () => {
    for (const ids of [["everyone", "incident-leads"], ["engineering", "incident-leads"], ["incident-leads"]]) {
      let selection: string[] = [];
      for (const id of ids) selection = addReader(selection, id, audiences);
      expect(validAudienceSelection(selection, audiences, scopeForReaders(selection, audiences, null))).toBe(true);
    }
  });

  it("detects a groups-only selection", () => {
    expect(onlyGroupReaders(["incident-leads"], audiences)).toBe(true);
    expect(onlyGroupReaders(["incident-leads", "everyone"], audiences)).toBe(false);
    expect(onlyGroupReaders([], audiences)).toBe(false);
  });
});
