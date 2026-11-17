import { describe, expect, it } from "vitest";
import { departmentAudienceName } from "./department-audience-name.js";

describe("department audience name", () => {
  it("keeps the member suffix when the generated name fits", () => {
    expect(departmentAudienceName("Operations")).toBe("Operations members");
    expect(departmentAudienceName("A".repeat(72))).toHaveLength(80);
  });

  it("keeps the entire department name at the 80-character boundary", () => {
    const name = "A".repeat(80);
    expect(departmentAudienceName(name)).toBe(name);
  });
});
