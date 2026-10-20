import { describe, expect, it } from "vitest";
import { filterWorkQueue, sampleWorkQueue } from "../src/my-work/workQueueModel";

describe("My Work sample queue", () => {
  it("keeps urgency order and includes the review item in the queue", () => {
    expect(filterWorkQueue(sampleWorkQueue, { query: "", type: "all", status: "all" }).map(item => item.id)).toEqual(sampleWorkQueue.map(item => item.id));
  });
  it("matches trimmed case-insensitive metadata", () => {
    expect(filterWorkQueue(sampleWorkQueue, { query: "  JIRA ard-482 ", type: "all", status: "all" }).map(item => item.id)).toEqual(["sample-timeout"]);
  });
  it("combines search, type and status without mutating the fixture", () => {
    expect(filterWorkQueue(sampleWorkQueue, { query: "owner", type: "handover", status: "at-risk" }).map(item => item.id)).toEqual(["sample-handover"]);
    expect(filterWorkQueue(sampleWorkQueue, { query: "", type: "review", status: "at-risk" })).toEqual([]);
    expect(sampleWorkQueue).toHaveLength(4);
  });
  it("supports no-match and empty inputs", () => {
    expect(filterWorkQueue(sampleWorkQueue, { query: "missing-query", type: "all", status: "all" })).toEqual([]);
    expect(filterWorkQueue([], { query: "", type: "all", status: "all" })).toEqual([]);
  });
});
