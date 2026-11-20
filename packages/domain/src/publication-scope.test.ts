import { describe, expect, it } from "vitest";
import { matchesPublicationScope, type PublicationScope } from "./publication-scope.js";

describe("publication reading scopes", () => {
  it.each([
    ["ORGANIZATION", true, false],
    ["DEPARTMENT", false, true],
    ["SELECTED_MEMBERS", false, true],
    [null, false, false],
    [undefined, false, false],
    ["PRIVATE", false, false],
    ["organization", false, false],
    ["", false, false],
  ] as const)("classifies %s without inferring or expanding its readers", (mode, common, shared) => {
    expect(matchesPublicationScope(mode, "ORGANIZATION")).toBe(common);
    expect(matchesPublicationScope(mode, "SHARED")).toBe(shared);
    // This view does not authorize anything; its caller preserves the old read check.
    expect(matchesPublicationScope(mode, "ALL_READABLE")).toBe(true);
  });

  it("fails closed on an unknown requested scope", () => {
    expect(matchesPublicationScope("ORGANIZATION", "PRIVATE" as PublicationScope)).toBe(false);
  });
});
