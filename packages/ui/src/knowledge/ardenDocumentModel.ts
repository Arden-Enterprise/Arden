import {
  ARDEN_DOCUMENT_PREFIX,
  parseSemanticDocument,
  serializeSemanticDocument,
  isAllowedSemanticLinkHref,
  type SemanticBlock,
  type SemanticInline,
  type SemanticText,
} from "@arden/domain";
import type { ArdenDocumentBlock, ArdenPartialDocumentBlock } from "./ardenDocumentSchema";

export { ARDEN_DOCUMENT_PREFIX };

export type ParsedArdenDocument =
  | { status: "ok"; format: "arden-semantic-blocks-v1"; blocks: ArdenPartialDocumentBlock[] }
  | { status: "invalid"; message: string; blocks: ArdenPartialDocumentBlock[] };

function errorBlocks(): ArdenPartialDocumentBlock[] {
  return [{ id: "invalid-document", type: "paragraph", props: {},
    content: [{ type: "text", text: "Document content could not be loaded.", styles: {} }], children: [] }];
}

function toEditorInline(content: SemanticInline[]) {
  return content.map((item) => item.type === "text" ? item : ({
    type: "link" as const, href: item.href, content: item.content,
  }));
}

function toEditorBlock(block: SemanticBlock): ArdenPartialDocumentBlock | null {
  if (block.type === "table" || block.type === "code" || block.type === "asset") return null;
  const children: ArdenPartialDocumentBlock[] = [];
  for (const child of block.children) {
    const converted = toEditorBlock(child);
    if (!converted) return null;
    children.push(converted);
  }
  const common = { id: block.id, content: toEditorInline(block.content), children };
  switch (block.type) {
    case "heading":
      if (block.props.level === 1) return null;
      return { ...common, type: "heading", props: { level: block.props.level } };
    case "bulletListItem": return { ...common, type: "bulletListItem", props: {} };
    case "numberedListItem": return { ...common, type: "numberedListItem", props: {} };
    case "quote": return { ...common, type: "quote", props: {} };
    default: return { ...common, type: "paragraph", props: {} };
  }
}

export function parseArdenDocument(body: string): ParsedArdenDocument {
  const parsed = parseSemanticDocument(body);
  if (!parsed.ok) return { status: "invalid", message: parsed.message, blocks: errorBlocks() };
  const blocks: ArdenPartialDocumentBlock[] = [];
  for (const block of parsed.document.blocks) {
    const converted = toEditorBlock(block);
    if (!converted) return { status: "invalid",
      message: "This Semantic Document contains a block that the current editor cannot display.",
      blocks: errorBlocks() };
    blocks.push(converted);
  }
  return { status: "ok", format: "arden-semantic-blocks-v1", blocks };
}

function stylesFromEditor(value: unknown): SemanticText["styles"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const styles: SemanticText["styles"] = {};
  for (const key of ["bold", "italic", "underline", "strike", "code"] as const) {
    if (source[key] === true) styles[key] = true;
  }
  return styles;
}

function inlineFromEditor(value: unknown): SemanticInline[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("BlockNote produced invalid inline content.");
  }
  const item = value as Record<string, unknown>;
  if (item.type === "text" && typeof item.text === "string") {
    return [{ type: "text", text: item.text, styles: stylesFromEditor(item.styles) }];
  }
  if (item.type === "link" && typeof item.href === "string" && Array.isArray(item.content)) {
    const content = item.content.flatMap((child) => inlineFromEditor(child));
    if (content.some((child) => child.type !== "text")) throw new Error("Nested links are not supported.");
    return isAllowedSemanticLinkHref(item.href)
      ? [{ type: "link", href: item.href, content: content as SemanticText[] }] : content;
  }
  throw new Error("BlockNote produced unsupported inline content.");
}

function blockFromEditor(block: ArdenDocumentBlock): SemanticBlock {
  if (!block.id) throw new Error("Every Semantic Document block requires a stable id.");
  const content = block.content.flatMap((item) => inlineFromEditor(item));
  const children = block.children.map(blockFromEditor);
  switch (block.type) {
    case "heading": return { id: block.id, type: "heading", props: { level: block.props.level as 2 | 3 }, content, children };
    case "bulletListItem": return { id: block.id, type: "bulletListItem", props: {}, content, children };
    case "numberedListItem": return { id: block.id, type: "numberedListItem", props: {}, content, children };
    case "quote": return { id: block.id, type: "quote", props: {}, content, children };
    default: return { id: block.id, type: "paragraph", props: {}, content, children };
  }
}

export function serializeArdenDocument(blocks: ArdenDocumentBlock[]): string {
  return serializeSemanticDocument({ schemaVersion: 1, blocks: blocks.map(blockFromEditor) });
}
