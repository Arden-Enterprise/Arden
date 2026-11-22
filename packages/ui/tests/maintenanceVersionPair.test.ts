import { describe, expect, it } from "vitest";
import { describeVersionPair } from "../src/maintenance/version-pair";

const versions = [
  { publishedVersionId: "v2", versionNo: 2, publishedAt: "2026-10-02T09:00:00Z", current: false },
  { publishedVersionId: "v3", versionNo: 3, publishedAt: "2026-11-04T09:00:00Z", current: false },
  { publishedVersionId: "v4", versionNo: 4, publishedAt: "2026-11-18T09:00:00Z", current: true },
];

describe("version pair", () => {
  it("labels the exact pair and tags the reported and current versions", () => {
    expect(describeVersionPair(versions, 0, "v3")).toEqual({
      earlierLabel: "Version 2", laterLabel: "Version 3", reportedLabel: "Version 3", currentLabel: "Version 4",
      canPrevious: false, canNext: true, canCompareCurrent: true,
    });
  });

  it("stops offering the current shortcut once the current pair is shown", () => {
    expect(describeVersionPair(versions, 1, "v3")).toMatchObject({ canPrevious: true, canNext: false, canCompareCurrent: false });
  });

  it("returns nothing for a pair outside the readable versions", () => {
    expect(describeVersionPair(versions, 2, "v3")).toBeNull();
    expect(describeVersionPair(versions, -1, "v3")).toBeNull();
  });

  it("leaves the reported tag empty when that version is not readable", () => {
    expect(describeVersionPair(versions, 0, "hidden")?.reportedLabel).toBeNull();
  });
});
