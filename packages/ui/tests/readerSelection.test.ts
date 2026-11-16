import { describe, expect, it } from "vitest";
import { ownerDepartment } from "../src/knowledge/readerSelection";

describe("draft owner department (decision 0014)", () => {
  it("uses the member primary department when the server reports one, ignoring the stored choice", () => {
    expect(ownerDepartment("dept-engineering", "dept-operations")).toEqual({ derived: true, departmentId: "dept-engineering" });
  });

  it("reports a missing primary department so submission stays blocked", () => {
    expect(ownerDepartment(null, "dept-operations")).toEqual({ derived: true, departmentId: null });
  });

  it("falls back to the stored choice for a server without the rule", () => {
    expect(ownerDepartment(undefined, "dept-operations")).toEqual({ derived: false, departmentId: "dept-operations" });
  });
});
