import { describe, expect, it } from "vitest";
import { caseLoadVisible, startCaseLoad } from "../src/maintenance/case-load";

const history = { items: [{ message: "Review started." }], nextCursor: null };

describe("maintenance case loads", () => {
  it("drops an older case when a later load is already current", () => {
    const state = { request: 0 };
    const first = startCaseLoad(state);
    const second = startCaseLoad(state);
    const older = caseLoadVisible(state, first, { kind: "assigned", caseId: "older" }, history);
    const newer = caseLoadVisible(state, second, { kind: "assigned", caseId: "newer" }, history);
    expect(older).toBeNull();
    expect(newer?.item).toMatchObject({ caseId: "newer" });
    expect(newer?.history.items).toHaveLength(1);
  });

  it("clears history when the current read is only the minimal case", () => {
    const state = { request: 0 };
    const request = startCaseLoad(state);
    const visible = caseLoadVisible(state, request, { kind: "minimal", caseId: "lost" }, history);
    expect(visible).toEqual({ item: { kind: "minimal", caseId: "lost" }, history: { items: [], nextCursor: null } });
  });
});
