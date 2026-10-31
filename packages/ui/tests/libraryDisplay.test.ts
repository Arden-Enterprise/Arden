import { describe, expect, it } from "vitest";
import { libraryTitleParts } from "../src/knowledge/libraryDisplay";

describe("library title display", () => {
  it("derives the code from a leading title prefix and strips it", () => {
    expect(libraryTitleParts("NSS-STD-067 — Emergency rollback: Serving Runtime", undefined))
      .toEqual({ code: "NSS-STD-067", title: "Emergency rollback: Serving Runtime" });
  });

  it("prefers the stored document code and strips a matching prefix", () => {
    expect(libraryTitleParts("NSS-STD-067 – Emergency rollback", "NSS-STD-067")).toEqual({ code: "NSS-STD-067", title: "Emergency rollback" });
  });

  it("keeps a different prefix in the title when a stored code exists", () => {
    expect(libraryTitleParts("OPS-RB-001 - Paging rotation", "NSS-STD-010")).toEqual({ code: "NSS-STD-010", title: "OPS-RB-001 - Paging rotation" });
  });

  it("renders no code when neither a code nor a prefix exists", () => {
    expect(libraryTitleParts("Onboarding handbook 2026", null)).toEqual({ code: null, title: "Onboarding handbook 2026" });
  });

  it("does not treat an ordinary hyphenated phrase as a code", () => {
    expect(libraryTitleParts("Follow-up checklist - draft", undefined)).toEqual({ code: null, title: "Follow-up checklist - draft" });
  });
});
