import { describe, expect, it } from "vitest";
import { ARDEN_DOCUMENT_PREFIX } from "@arden/domain";
import { visibleVersionText } from "./version-text.js";

const text = (value: string) => ({ type: "text", text: value, styles: {} });
const body = (blocks: unknown[]) => ARDEN_DOCUMENT_PREFIX + JSON.stringify({ schemaVersion: 1, blocks });

describe("maintenance version text", () => {
  it("keeps link text and table cells so a table-only change is visible", () => {
    const document = (cell: string) => body([
      { id: "p", type: "paragraph", props: {}, content: [text("Call "), { type: "link", href: "https://example.test", content: [text("the desk")] }], children: [] },
      { id: "t", type: "table", props: { columns: 2 }, content: [{ cells: [[text("Bin")], [text(cell)]] }], children: [] },
    ]);
    expect(visibleVersionText(document("A"), "text/plain")).toBe("Call the desk\nBin | A");
    expect(visibleVersionText(document("B"), "text/plain")).not.toBe(visibleVersionText(document("A"), "text/plain"));
  });

  it("returns unavailable for invalid Semantic Documents and PDFs", () => {
    expect(visibleVersionText(`${ARDEN_DOCUMENT_PREFIX}{"schemaVersion":1,"blocks":[{"type":"mystery"}]}`, "text/plain")).toBeNull();
    expect(visibleVersionText("plain", "application/pdf")).toBeNull();
    expect(visibleVersionText("Plain line", "text/plain")).toBe("Plain line");
  });
});
