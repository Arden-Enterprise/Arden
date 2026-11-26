import { describe, expect, it } from "vitest";
import {
  ARDEN_DOCUMENT_PREFIX,
  markdownToSemanticDocument,
  parseSemanticDocument,
  semanticBodyText,
  plainTextToSemanticDocument,
  serializeSemanticDocument,
  validateSemanticDocument,
} from "./semantic-document.js";

describe("Semantic Document v1", () => {
  it("round-trips stable ids, formatting, and link semantics", () => {
    const document = {
      schemaVersion: 1,
      blocks: [{ id: "intro", type: "paragraph", props: {}, children: [], content: [
        { type: "text", text: "See ", styles: { bold: true } },
        { type: "link", href: "https://example.test/runbook", content: [
          { type: "text", text: "runbook", styles: {} },
        ] },
      ] }],
    };
    const encoded = serializeSemanticDocument(document);
    expect(parseSemanticDocument(encoded)).toEqual({ ok: true, document });
  });

  it("rejects missing and duplicate stable ids", () => {
    expect(validateSemanticDocument({ schemaVersion: 1, blocks: [
      { type: "paragraph", props: {}, content: [], children: [] },
    ] })).toBeNull();
    expect(validateSemanticDocument({ schemaVersion: 1, blocks: [
      { id: "same", type: "paragraph", props: {}, content: [], children: [] },
      { id: "same", type: "paragraph", props: {}, content: [], children: [] },
    ] })).toBeNull();
  });

  it("normalizes new plain-text input without accepting it as stored canonical content", () => {
    const document = plainTextToSemanticDocument("one\r\n\r\nthree", (index) => `line-${index}`);
    expect(document.blocks.map((block) => block.id)).toEqual(["line-0", "line-1", "line-2"]);
    expect(parseSemanticDocument("one\nthree")).toMatchObject({ ok: false, code: "INVALID_PREFIX" });
  });

  it("rejects unsafe links", () => {
    expect(validateSemanticDocument({ schemaVersion: 1, blocks: [{
      id: "unsafe", type: "paragraph", props: {}, children: [], content: [{
        type: "link", href: "javascript:alert(1)", content: [{ type: "text", text: "bad", styles: {} }],
      }],
    }] })).toBeNull();
  });

  it("rejects unknown canonical fields instead of silently changing meaning", () => {
    const withLayoutProperty = { schemaVersion: 1, blocks: [{
      id: "p-1", type: "paragraph", props: { textAlignment: "center" },
      content: [{ type: "text", text: "Body", styles: {} }], children: [],
    }] };
    expect(validateSemanticDocument(withLayoutProperty)).toBeNull();
  });
});

describe("legacy Markdown notes", () => {
  const convert = (markdown: string) => markdownToSemanticDocument(markdown, (index) => `line-${index}`).blocks;
  const inline = (markdown: string) => {
    const [block] = convert(markdown);
    return block && "content" in block ? block.content : [];
  };

  it("turns emphasis markers into styles", () => {
    expect(inline("**Contribution 26/11**")).toEqual([{ type: "text", text: "Contribution 26/11", styles: { bold: true } }]);
    expect(inline("a _b_ *c* ~~d~~ `e **f**`")).toEqual([
      { type: "text", text: "a ", styles: {} }, { type: "text", text: "b", styles: { italic: true } },
      { type: "text", text: " ", styles: {} }, { type: "text", text: "c", styles: { italic: true } },
      { type: "text", text: " ", styles: {} }, { type: "text", text: "d", styles: { strike: true } },
      { type: "text", text: " ", styles: {} }, { type: "text", text: "e **f**", styles: { code: true } },
    ]);
    expect(inline("**_both_**")).toEqual([{ type: "text", text: "both", styles: { bold: true, italic: true } }]);
  });

  it("leaves unmatched markers and words with underscores as written", () => {
    expect(inline("snake_case_name and 2 * 3 and **open")).toEqual([
      { type: "text", text: "snake_case_name and 2 * 3 and **open", styles: {} }]);
  });

  it("keeps one block per line with headings, lists and quotes", () => {
    expect(convert("# Title\n### Small\n- item\n2. step\n> quoted\n\nplain").map(block =>
      block.type === "heading" ? `heading-${block.props.level}` : block.type)).toEqual([
      "heading-2", "heading-3", "bulletListItem", "numberedListItem", "quote", "paragraph", "paragraph"]);
    expect(validateSemanticDocument(markdownToSemanticDocument("- [x] done\n", (index) => `todo-${index}`))).not.toBeNull();
  });

  it("reads text from rich bodies and returns legacy bodies as written", () => {
    const body = serializeSemanticDocument(markdownToSemanticDocument("# Title\n**Bold** text", (index) => `l${index}`));
    expect(semanticBodyText(body)).toBe("Title\nBold text");
    expect(semanticBodyText("**kept**")).toBe("**kept**");
    expect(semanticBodyText(`${ARDEN_DOCUMENT_PREFIX}{bad`)).toBeNull();
  });
});
