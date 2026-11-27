import { describe, expect, it } from "vitest";
import { uniformSelectionMarks, type SelectionMark } from "../src/knowledge/writingSelectionMarks";

/** Minimal stand-ins for ProseMirror marks and text nodes: jsdom cannot drive the BlockNote editor. */
const mark = (name: string): SelectionMark => ({ type: { name }, eq(other) { return other.type.name === name; } });
const bold = mark("bold");
const italic = mark("italic");
const link = mark("link");
const doc = (...texts: Array<readonly SelectionMark[]>) => ({
  nodesBetween(_from: number, _to: number, visit: (node: { isText: boolean; marks: readonly SelectionMark[] }) => void) {
    visit({ isText: false, marks: [] });
    for (const marks of texts) visit({ isText: true, marks });
  },
});

describe("AI writing on formatted text", () => {
  it("allows plain text and text in one style, keeping that style", () => {
    expect(uniformSelectionMarks(doc([]), 0, 1)).toEqual([]);
    expect(uniformSelectionMarks(doc([bold]), 0, 1)).toEqual([bold]);
    expect(uniformSelectionMarks(doc([bold, italic], [italic, bold]), 0, 1)).toEqual([bold, italic]);
  });

  it("blocks a selection that mixes styles or contains a link", () => {
    expect(uniformSelectionMarks(doc([bold], []), 0, 1)).toBeNull();
    expect(uniformSelectionMarks(doc([bold], [bold, italic]), 0, 1)).toBeNull();
    expect(uniformSelectionMarks(doc([link]), 0, 1)).toBeNull();
  });
});
