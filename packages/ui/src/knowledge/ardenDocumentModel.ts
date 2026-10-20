import type { ArdenDocumentBlock, ArdenPartialDocumentBlock } from "./ardenDocumentSchema";

export const ARDEN_DOCUMENT_PREFIX = "arden-document:application/vnd.arden.blocks+json;version=1\n";

type AllowedBlockType = "paragraph" | "heading" | "bulletListItem" | "numberedListItem" | "quote";
type AllowedStyle = "bold" | "italic" | "underline" | "strike" | "code";

type StoredText = {
  type: "text";
  text: string;
  styles: Partial<Record<AllowedStyle, true>>;
};

export type StoredArdenBlock = {
  id?: string;
  type: AllowedBlockType;
  props: { level?: 2 | 3 };
  content: StoredText[];
  children: StoredArdenBlock[];
};

type ArdenDocumentEnvelope = {
  version: 1;
  blocks: StoredArdenBlock[];
};

export type ParsedArdenDocument =
  | { status: "ok"; format: "legacy-text" | "arden-blocks-v1"; blocks: ArdenPartialDocumentBlock[] }
  | { status: "invalid"; message: string; blocks: ArdenPartialDocumentBlock[] };

const allowedBlockTypes = new Set<AllowedBlockType>([
  "paragraph", "heading", "bulletListItem", "numberedListItem", "quote",
]);
const allowedStyles = new Set<AllowedStyle>(["bold", "italic", "underline", "strike", "code"]);
const maximumBlockDepth = 8;
const maximumBlockCount = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacyTextToBlocks(body: string): ArdenPartialDocumentBlock[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line) => ({
    type: "paragraph",
    props: {},
    content: line ? [{ type: "text", text: line, styles: {} }] : [],
    children: [],
  }));
}

function parseText(value: unknown): StoredText | null {
  if (!isRecord(value) || value.type !== "text" || typeof value.text !== "string" || !isRecord(value.styles)) {
    return null;
  }

  const styles: StoredText["styles"] = {};
  for (const [name, enabled] of Object.entries(value.styles)) {
    if (allowedStyles.has(name as AllowedStyle) && enabled === true) styles[name as AllowedStyle] = true;
  }
  return { type: "text", text: value.text, styles };
}

function parseInlineContent(value: unknown): StoredText[] | null {
  const text = parseText(value);
  if (text) return [text];
  if (!isRecord(value) || value.type !== "link" || !Array.isArray(value.content)) return null;

  const flattened: StoredText[] = [];
  for (const item of value.content) {
    const linkedText = parseText(item);
    if (!linkedText) return null;
    flattened.push(linkedText);
  }
  return flattened;
}

function parseBlock(value: unknown, depth: number, counter: { value: number }): StoredArdenBlock | null {
  if (!isRecord(value) || depth > maximumBlockDepth || counter.value >= maximumBlockCount) return null;
  if (typeof value.type !== "string" || !allowedBlockTypes.has(value.type as AllowedBlockType)) return null;
  if (!Array.isArray(value.content) || !Array.isArray(value.children)) return null;

  counter.value += 1;
  const content: StoredText[] = [];
  for (const item of value.content) {
    const parsed = parseInlineContent(item);
    if (!parsed) return null;
    content.push(...parsed);
  }

  const children: StoredArdenBlock[] = [];
  for (const child of value.children) {
    const parsed = parseBlock(child, depth + 1, counter);
    if (!parsed) return null;
    children.push(parsed);
  }

  const type = value.type as AllowedBlockType;
  const block: StoredArdenBlock = { type, props: {}, content, children };
  if (typeof value.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value.id)) block.id = value.id;
  if (type === "heading") {
    const level = isRecord(value.props) && value.props.level === 2 ? 2 : 3;
    block.props = { level };
  }
  return block;
}

function parseEnvelope(value: unknown): ArdenDocumentEnvelope | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length === 0) return null;
  const counter = { value: 0 };
  const blocks: StoredArdenBlock[] = [];
  for (const block of value.blocks) {
    const parsed = parseBlock(block, 0, counter);
    if (!parsed) return null;
    blocks.push(parsed);
  }
  return { version: 1, blocks };
}

function toPartialBlock(block: StoredArdenBlock): ArdenPartialDocumentBlock {
  const common = {
    id: block.id,
    content: block.content,
    children: block.children.map(toPartialBlock),
  };
  switch (block.type) {
    case "heading": return { ...common, type: "heading", props: { level: block.props.level ?? 3 } };
    case "bulletListItem": return { ...common, type: "bulletListItem", props: {} };
    case "numberedListItem": return { ...common, type: "numberedListItem", props: {} };
    case "quote": return { ...common, type: "quote", props: {} };
    default: return { ...common, type: "paragraph", props: {} };
  }
}

export function parseArdenDocument(body: string): ParsedArdenDocument {
  if (!body.startsWith(ARDEN_DOCUMENT_PREFIX)) {
    return { status: "ok", format: "legacy-text", blocks: legacyTextToBlocks(body) };
  }

  try {
    const envelope = parseEnvelope(JSON.parse(body.slice(ARDEN_DOCUMENT_PREFIX.length)));
    if (envelope) return { status: "ok", format: "arden-blocks-v1", blocks: envelope.blocks.map(toPartialBlock) };
  } catch {
    // The invalid result below prevents malformed stored content from being overwritten silently.
  }

  return {
    status: "invalid",
    message: "This document uses an invalid or unsupported Arden document format.",
    blocks: legacyTextToBlocks("Document content could not be loaded."),
  };
}

export function serializeArdenDocument(blocks: ArdenDocumentBlock[]): string {
  const envelope = parseEnvelope({ version: 1, blocks });
  if (!envelope) throw new Error("BlockNote produced an unsupported Arden document shape.");
  return `${ARDEN_DOCUMENT_PREFIX}${JSON.stringify(envelope)}`;
}
