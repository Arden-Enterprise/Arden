import { describe, expect, it } from "vitest";
import { grantLevelLabel, grantValidity } from "../src/organization/AdminDetailIslands";

const isoDate = (iso: string) => iso.slice(0, 10);

describe("reviewer grant labels", () => {
  it("shows the end date for a grant that expires", () => {
    expect(grantValidity({ validFrom: "2026-10-01T00:00:00Z", validUntil: "2026-12-31T00:00:00Z" }, isoDate)).toBe("Until 2026-12-31");
  });

  it("shows the start date for an open-ended grant", () => {
    expect(grantValidity({ validFrom: "2026-10-01T00:00:00Z", validUntil: null }, isoDate)).toBe("Since 2026-10-01");
  });

  it("names every reviewer level", () => {
    expect([grantLevelLabel("STANDARD"), grantLevelLabel("SPECIALIST"), grantLevelLabel("SENIOR")]).toEqual(["Standard", "Specialist", "Senior"]);
  });
});

describe("reviewer grant coverage (decision 0013)", () => {
  it("states that only Specialist and Senior grants cover organization-wide readers", async () => {
    const { grantCoverageLabel } = await import("../src/organization/AdminDetailIslands");
    expect(grantCoverageLabel("STANDARD")).toBe("Department and group readers");
    expect(grantCoverageLabel("SPECIALIST")).toBe("Includes organization-wide readers");
    expect(grantCoverageLabel("SENIOR")).toBe("Includes organization-wide readers");
  });
});
