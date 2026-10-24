import { describe, expect, it } from "vitest";
import {
  parseSemanticDocument,
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
