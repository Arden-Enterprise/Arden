// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findQuoteInSegments } from "../src/knowledge/citationTextMatch";
import { clearMarks, markQuote } from "../src/knowledge/citationHighlight";

describe("cited quote matching", () => {
  it("finds a quote split across PDF text runs regardless of line breaks and spacing", () => {
    const runs = ["3. Offboarding", "All company devices must be returned to IT on or before the", "last working day. Access is revoked."];
    const match = findQuoteInSegments(runs, "All company devices must be returned to IT on or before the last working day.");
    expect(match).toEqual({ start: { segment: 1, offset: 0 }, end: { segment: 2, offset: 17 }, complete: true });
  });

  it("matches ligatures, typographic quotes, dashes and letter case", () => {
    const match = findQuoteInSegments(["The ﬁnal “handover” note — approved."], "the final \"handover\" note - approved");
    expect(match?.complete).toBe(true);
    expect(match?.start).toEqual({ segment: 0, offset: 0 });
  });

  it("falls back to the opening of a quote that continues on another page", () => {
    const page = ["Departing employees prepare a handover note that lists open work and key contacts."];
    const quote = `${page[0]} The manager approves the handover note before the final working day.`;
    expect(findQuoteInSegments(page, quote)).toMatchObject({ start: { segment: 0, offset: 0 }, complete: false });
  });

  it("returns nothing for a quote that is not in the text", () => {
    expect(findQuoteInSegments(["Exceptions require written approval."], "Devices are returned to IT.")).toBeNull();
    expect(findQuoteInSegments(["Anything"], "   ")).toBeNull();
  });
});

describe("text-layer marks", () => {
  it("wraps exactly the cited text and restores the original runs when cleared", () => {
    const layer = document.createElement("div");
    layer.innerHTML = "<span>Managers must request system access at least five working days</span><br><span>before the employee start date. HR confirms the contract.</span>";
    const original = layer.innerHTML;
    const { marks, complete } = markQuote(layer, "system access at least five working days before the employee start date.", "cite");
    expect(complete).toBe(true);
    expect(marks.map((mark) => mark.textContent)).toEqual(["system access at least five working days", "before the employee start date."]);
    expect(layer.textContent).toBe("Managers must request system access at least five working daysbefore the employee start date. HR confirms the contract.");
    clearMarks(layer, "cite");
    expect(layer.innerHTML).toBe(original);
  });
});
