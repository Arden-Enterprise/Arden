import { describe, expect, it } from "vitest";
import {
  ARDEN_DOCUMENT_PREFIX,
  parseArdenDocument,
  serializeArdenDocument,
} from "../src/knowledge/ardenDocumentModel";
import type { ArdenDocumentBlock } from "../src/knowledge/ardenDocumentSchema";

describe("Arden document model", () => {
  it("rejects unversioned stored text instead of keeping a second canonical format", () => {
    expect(parseArdenDocument("First line\nThird line")).toMatchObject({
      status: "invalid",
      message: "Content is not an Arden Semantic Document.",
    });
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
      format: "arden-semantic-blocks-v1",
      blocks: [{ id: "heading-1", type: "heading", props: { level: 2 },
        content: [{ type: "text", text: "Recovery guide", styles: { bold: true } }] }],
    });
  });

  it("drops color and layout properties that are outside the fixed Arden format", () => {
    const stored = serializeArdenDocument([{
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
      }]);

    const parsed = parseArdenDocument(stored);

    expect(parsed.blocks[0]).toMatchObject({
      type: "paragraph",
      props: {},
      content: [
        { type: "text", text: "Fixed typography", styles: { bold: true } },
        { type: "link", href: "https://example.test/tracker", content: [
          { type: "text", text: " stays local", styles: {} },
        ] },
      ],
    });
  });

  it("preserves styled text when an editor link has an unsupported scheme", () => {
    const stored = serializeArdenDocument([{
      id: "paragraph-1", type: "paragraph", props: {}, children: [],
      content: [{ type: "link", href: "ftp://example.test/file", content: [
        { type: "text", text: "Keep this text", styles: { bold: true } },
      ] }],
    }]);
    expect(parseArdenDocument(stored).blocks[0]).toMatchObject({
      content: [{ type: "text", text: "Keep this text", styles: { bold: true } }],
    });
  });

  it("rejects malformed or unsupported versioned content", () => {
    const unsupported = `${ARDEN_DOCUMENT_PREFIX}${JSON.stringify({
      schemaVersion: 1,
      blocks: [{ type: "image", props: { url: "https://example.test/tracker.png" }, content: [], children: [] }],
    })}`;

    expect(parseArdenDocument(unsupported)).toMatchObject({ status: "invalid" });
    expect(parseArdenDocument(`${ARDEN_DOCUMENT_PREFIX}{not-json`)).toMatchObject({ status: "invalid" });
  });
});
