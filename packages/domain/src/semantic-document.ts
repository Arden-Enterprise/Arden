export const ARDEN_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const ARDEN_DOCUMENT_PREFIX =
  "arden-document:application/vnd.arden.semantic-blocks+json;version=1\n";

export const SEMANTIC_DOCUMENT_LIMITS = {
  maximumBlockCount: 2_000,
  maximumBlockDepth: 8,
  maximumTextCodePoints: 131_072,
  maximumLinkLength: 2_048,
  maximumAssetReferenceLength: 512,
} as const;

export type SemanticTextStyle = "bold" | "italic" | "underline" | "strike" | "code";
export type SemanticText = {
  type: "text";
  text: string;
  styles: Partial<Record<SemanticTextStyle, true>>;
};
export type SemanticLink = {
  type: "link";
  href: string;
  content: SemanticText[];
};
export type SemanticInline = SemanticText | SemanticLink;

type BlockBase<TType extends string, TProps> = {
  id: string;
  type: TType;
  props: TProps;
  children: SemanticBlock[];
};

export type SemanticBlock =
  | (BlockBase<"paragraph", Record<string, never>> & { content: SemanticInline[] })
  | (BlockBase<"heading", { level: 1 | 2 | 3 }> & { content: SemanticInline[] })
  | (BlockBase<"bulletListItem" | "numberedListItem" | "quote", Record<string, never>> & { content: SemanticInline[] })
  | (BlockBase<"code", { language: string | null }> & { content: SemanticText[] })
  | (BlockBase<"table", { columns: number }> & { content: SemanticTableRow[] })
  | (BlockBase<"asset", { assetVersionId: string; label: string | null }> & { content: [] });

export type SemanticTableRow = { cells: SemanticInline[][] };
export type SemanticDocument = {
  schemaVersion: typeof ARDEN_DOCUMENT_SCHEMA_VERSION;
  blocks: SemanticBlock[];
};

export type SemanticDocumentParseResult =
  | { ok: true; document: SemanticDocument }
  | { ok: false; code: "INVALID_PREFIX" | "INVALID_JSON" | "INVALID_DOCUMENT"; message: string };

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const allowedStyles = new Set<SemanticTextStyle>(["bold", "italic", "underline", "strike", "code"]);
const allowedLinkSchemes = new Set(["http:", "https:", "mailto:"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function parseText(value: unknown, counter: { text: number }): SemanticText | null {
  if (!isRecord(value) || value.type !== "text" || typeof value.text !== "string" || !isRecord(value.styles)) {
    return null;
  }
  if (!hasOnlyKeys(value, ["type", "text", "styles"])) return null;
  counter.text += codePointLength(value.text);
  if (counter.text > SEMANTIC_DOCUMENT_LIMITS.maximumTextCodePoints) return null;
  const styles: SemanticText["styles"] = {};
  for (const [style, enabled] of Object.entries(value.styles)) {
    if (!allowedStyles.has(style as SemanticTextStyle) || enabled !== true) return null;
    styles[style as SemanticTextStyle] = true;
  }
  return { type: "text", text: value.text, styles };
}

function parseLink(value: unknown, counter: { text: number }): SemanticLink | null {
  if (!isRecord(value) || value.type !== "link" || typeof value.href !== "string"
    || value.href.length > SEMANTIC_DOCUMENT_LIMITS.maximumLinkLength || !Array.isArray(value.content)) return null;
  if (!hasOnlyKeys(value, ["type", "href", "content"])) return null;
  let url: URL;
  try { url = new URL(value.href); } catch { return null; }
  if (!allowedLinkSchemes.has(url.protocol)) return null;
  const content: SemanticText[] = [];
  for (const item of value.content) {
    const text = parseText(item, counter);
    if (!text) return null;
    content.push(text);
  }
  return { type: "link", href: value.href, content };
}

function parseInline(value: unknown, counter: { text: number }): SemanticInline | null {
  return isRecord(value) && value.type === "link" ? parseLink(value, counter) : parseText(value, counter);
}

function parseInlineArray(value: unknown, counter: { text: number }): SemanticInline[] | null {
  if (!Array.isArray(value)) return null;
  const content: SemanticInline[] = [];
  for (const item of value) {
    const parsed = parseInline(item, counter);
    if (!parsed) return null;
    content.push(parsed);
  }
  return content;
}

function parseBlock(value: unknown, depth: number, state: { blocks: number; text: number; ids: Set<string> }): SemanticBlock | null {
  if (!isRecord(value) || depth > SEMANTIC_DOCUMENT_LIMITS.maximumBlockDepth
    || state.blocks >= SEMANTIC_DOCUMENT_LIMITS.maximumBlockCount
    || typeof value.id !== "string" || !idPattern.test(value.id) || state.ids.has(value.id)
    || typeof value.type !== "string" || !isRecord(value.props) || !Array.isArray(value.children)) return null;
  if (!hasOnlyKeys(value, ["id", "type", "props", "content", "children"])) return null;
  state.blocks += 1;
  state.ids.add(value.id);
  const children: SemanticBlock[] = [];
  for (const child of value.children) {
    const parsed = parseBlock(child, depth + 1, state);
    if (!parsed) return null;
    children.push(parsed);
  }
  if (value.type === "asset") {
    if (!hasOnlyKeys(value.props, ["assetVersionId", "label"])
      || !Array.isArray(value.content) || value.content.length !== 0
      || typeof value.props.assetVersionId !== "string" || !idPattern.test(value.props.assetVersionId)
      || (value.props.label !== null && typeof value.props.label !== "string")
      || (typeof value.props.label === "string" && value.props.label.length > SEMANTIC_DOCUMENT_LIMITS.maximumAssetReferenceLength)) return null;
    return { id: value.id, type: "asset", props: {
      assetVersionId: value.props.assetVersionId, label: value.props.label as string | null,
    }, content: [], children };
  }
  if (value.type === "table") {
    if (!hasOnlyKeys(value.props, ["columns"])
      || !Number.isInteger(value.props.columns) || (value.props.columns as number) < 1
      || (value.props.columns as number) > 32 || !Array.isArray(value.content)) return null;
    const rows: SemanticTableRow[] = [];
    for (const row of value.content) {
      if (!isRecord(row) || !hasOnlyKeys(row, ["cells"])
        || !Array.isArray(row.cells) || row.cells.length !== value.props.columns) return null;
      const cells: SemanticInline[][] = [];
      for (const cell of row.cells) {
        const parsed = parseInlineArray(cell, state);
        if (!parsed) return null;
        cells.push(parsed);
      }
      rows.push({ cells });
    }
    return { id: value.id, type: "table", props: { columns: value.props.columns as number }, content: rows, children };
  }
  const content = parseInlineArray(value.content, state);
  if (!content) return null;
  if (value.type === "heading") {
    if (!hasOnlyKeys(value.props, ["level"]) || ![1, 2, 3].includes(value.props.level as number)) return null;
    return { id: value.id, type: "heading", props: { level: value.props.level as 1 | 2 | 3 }, content, children };
  }
  if (value.type === "code") {
    if (!hasOnlyKeys(value.props, ["language"])
      || (value.props.language !== null && typeof value.props.language !== "string")) return null;
    if (content.some((item) => item.type !== "text")) return null;
    return { id: value.id, type: "code", props: { language: value.props.language as string | null }, content: content as SemanticText[], children };
  }
  if (value.type === "paragraph" || value.type === "bulletListItem"
    || value.type === "numberedListItem" || value.type === "quote") {
    if (!hasOnlyKeys(value.props, [])) return null;
    return { id: value.id, type: value.type, props: {}, content, children };
  }
  return null;
}

export function validateSemanticDocument(value: unknown): SemanticDocument | null {
  if (!isRecord(value) || value.schemaVersion !== ARDEN_DOCUMENT_SCHEMA_VERSION
    || !Array.isArray(value.blocks) || value.blocks.length === 0) return null;
  if (!hasOnlyKeys(value, ["schemaVersion", "blocks"])) return null;
  const state = { blocks: 0, text: 0, ids: new Set<string>() };
  const blocks: SemanticBlock[] = [];
  for (const block of value.blocks) {
    const parsed = parseBlock(block, 0, state);
    if (!parsed) return null;
    blocks.push(parsed);
  }
  return { schemaVersion: ARDEN_DOCUMENT_SCHEMA_VERSION, blocks };
}

export function parseSemanticDocument(body: string): SemanticDocumentParseResult {
  if (!body.startsWith(ARDEN_DOCUMENT_PREFIX)) return {
    ok: false, code: "INVALID_PREFIX", message: "Content is not an Arden Semantic Document.",
  };
  let decoded: unknown;
  try { decoded = JSON.parse(body.slice(ARDEN_DOCUMENT_PREFIX.length)); }
  catch { return { ok: false, code: "INVALID_JSON", message: "Semantic Document JSON is malformed." }; }
  const document = validateSemanticDocument(decoded);
  return document ? { ok: true, document } : {
    ok: false, code: "INVALID_DOCUMENT", message: "Semantic Document violates schema version 1.",
  };
}

export function serializeSemanticDocument(value: unknown): string {
  const document = validateSemanticDocument(value);
  if (!document) throw new Error("Semantic Document violates schema version 1.");
  return `${ARDEN_DOCUMENT_PREFIX}${JSON.stringify(document)}`;
}

export function plainTextToSemanticDocument(body: string, idForLine: (index: number) => string): SemanticDocument {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  return {
    schemaVersion: ARDEN_DOCUMENT_SCHEMA_VERSION,
    blocks: lines.map((line, index) => ({
      id: idForLine(index), type: "paragraph", props: {},
      content: line ? [{ type: "text", text: line, styles: {} }] : [], children: [],
    })),
  };
}
