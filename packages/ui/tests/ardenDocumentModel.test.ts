import { describe, expect, it } from "vitest";
import {
  ARDEN_DOCUMENT_PREFIX,
  parseArdenDocument,
  serializeArdenDocument,
} from "../src/knowledge/ardenDocumentModel";
import type { ArdenDocumentBlock } from "../src/knowledge/ardenDocumentSchema";

describe("Arden document model", () => {
  it("opens existing plain text as editable paragraphs", () => {
    const parsed = parseArdenDocument("First line\r\n\r\nThird line");

    expect(parsed.status).toBe("ok");
    expect(parsed.blocks).toHaveLength(3);
    expect(parsed.blocks[0]?.content).toEqual([{ type: "text", text: "First line", styles: {} }]);
    expect(parsed.blocks[1]?.content).toEqual([]);
    expect(parsed.blocks[2]?.content).toEqual([{ type: "text", text: "Third line", styles: {} }]);
  });

  it("round-trips supported blocks, stable ids, and inline formatting", () => {
    const blocks: ArdenDocumentBlock[] = [{
      id: "heading-1",
      type: "heading",
      props: { level: 2, backgroundColor: "default", textColor: "default", textAlignment: "left" },
      content: [{ type: "text", text: "Recovery guide", styles: { bold: true } }],
      children: [],
    }];

    const stored = serializeArdenDocument(blocks);
    const parsed = parseArdenDocument(stored);

    expect(stored.startsWith(ARDEN_DOCUMENT_PREFIX)).toBe(true);
    expect(parsed).toMatchObject({
      status: "ok",
      format: "arden-blocks-v1",
      blocks: [{ id: "heading-1", type: "heading", props: { level: 2 },
        content: [{ type: "text", text: "Recovery guide", styles: { bold: true } }] }],
    });
  });

  it("drops color and layout properties that are outside the fixed Arden format", () => {
    const stored = `${ARDEN_DOCUMENT_PREFIX}${JSON.stringify({
      version: 1,
      blocks: [{
        id: "paragraph-1",
        type: "paragraph",
        props: { textColor: "red", backgroundColor: "yellow", textAlignment: "center" },
        content: [
          { type: "text", text: "Fixed typography", styles: { bold: true, textColor: "red" } },
          { type: "link", href: "https://example.test/tracker", content: [
            { type: "text", text: " stays local", styles: {} },
          ] },
        ],
        children: [],
      }],
    })}`;

    const parsed = parseArdenDocument(stored);

    expect(parsed.blocks[0]).toMatchObject({
      type: "paragraph",
      props: {},
      content: [
        { type: "text", text: "Fixed typography", styles: { bold: true } },
        { type: "text", text: " stays local", styles: {} },
      ],
    });
  });

  it("rejects malformed or unsupported versioned content", () => {
    const unsupported = `${ARDEN_DOCUMENT_PREFIX}${JSON.stringify({
      version: 1,
      blocks: [{ type: "image", props: { url: "https://example.test/tracker.png" }, content: [], children: [] }],
    })}`;

    expect(parseArdenDocument(unsupported)).toMatchObject({ status: "invalid" });
    expect(parseArdenDocument(`${ARDEN_DOCUMENT_PREFIX}{not-json`)).toMatchObject({ status: "invalid" });
  });
});
