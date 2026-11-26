import { ARDEN_DOCUMENT_PREFIX, SEMANTIC_DOCUMENT_LIMITS, markdownToSemanticDocument, parseSemanticDocument, semanticBodyText, serializeSemanticDocument } from "@arden/domain";

/** Rich Private notes are stored as Arden Semantic Documents, like shared drafts. */
export const isRichNoteBody = (body: string) => body.startsWith(ARDEN_DOCUMENT_PREFIX);

/**
 * The body the rich editor opens. Notes written before the rich editor are Markdown text: their
 * `**bold**`, `_italic_`, lists and headings open formatted. Nothing is saved until the owner edits.
 */
export function noteEditorBody(body: string, maxBytes = Infinity): string | null {
  if (isRichNoteBody(body)) return parseSemanticDocument(body).ok ? body : null;
  const document = markdownToSemanticDocument(body, () => crypto.randomUUID());
  if (document.blocks.length > SEMANTIC_DOCUMENT_LIMITS.maximumBlockCount) return null;
  const encoded = serializeSemanticDocument(document);
  return utf8Bytes(encoded) <= maxBytes ? encoded : null;
}

/** Readable text of a note, for counts, excerpts and AI; an unreadable document has none. */
export const noteText = (body: string) => semanticBodyText(body) ?? "";

export const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
