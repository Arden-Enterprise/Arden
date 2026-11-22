import { describe, expect, it } from "vitest";
import { compareLines } from "./diff.js";

const v3 = "Restart the service.\nKeep the old note.\nLeave the rest.";
const v4 = "Restart the service after saving.\nKeep the old note.\nLeave the rest.";
const v5 = "Restart the service.\nKeep the old note.\nLeave the rest.";

describe("version comparison", () => {
  it("labels the v4 correction and the v5 recurrence", () => {
    const correction = compareLines(v3, v4);
    expect(correction).toContainEqual({ kind: "removed", text: "Restart the service." });
    expect(correction).toContainEqual({ kind: "added", text: "Restart the service after saving." });
    const recurrence = compareLines(v4, v5);
    expect(recurrence).toContainEqual({ kind: "removed", text: "Restart the service after saving." });
    expect(recurrence).toContainEqual({ kind: "added", text: "Restart the service." });
  });

  it("keeps an identical pair as context and an empty pair without added or removed lines", () => {
    const same = "Restart the service.\nKeep the old note.\nLeave the rest.";
    const identical = compareLines(same, same.replace(/\n/g, "\r\n"));
    expect(identical.some((row) => row.kind === "added" || row.kind === "removed")).toBe(false);
    expect(identical).toContainEqual({ kind: "collapsed", text: "Unchanged context", hidden: ["Keep the old note."] });
    expect(compareLines("", "")).toEqual([]);
    expect(compareLines("", "A new step.")).toEqual([{ kind: "added", text: "A new step." }]);
  });

  it("collapses a long unchanged stretch and keeps line endings equivalent", () => {
    const before = ["one", "two", "three", "four", "five"].join("\n");
    const after = ["one", "two", "three", "four", "changed"].join("\r\n");
    expect(compareLines(before, after)).toEqual([
      { kind: "context", text: "one" },
      { kind: "collapsed", text: "Unchanged context", hidden: ["two", "three"] },
      { kind: "context", text: "four" },
      { kind: "removed", text: "five" },
      { kind: "added", text: "changed" },
    ]);
  });
});
