import { describe, expect, it } from "vitest";
import { apiTestFilesRunInParallel } from "../../shared-database-test-scheduling.js";

describe("shared database test scheduling", () => {
  it("keeps ordinary API tests parallel", () => {
    expect(apiTestFilesRunInParallel(undefined)).toBe(true);
    expect(apiTestFilesRunInParallel("")).toBe(true);
  });

  it("runs files one at a time when they share a migrated database", () => {
    expect(apiTestFilesRunInParallel("postgresql://postgres@127.0.0.1:5432/arden_test_ci")).toBe(false);
  });
});
