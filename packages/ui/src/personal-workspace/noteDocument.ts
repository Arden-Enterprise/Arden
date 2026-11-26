import { ARDEN_DOCUMENT_PREFIX, markdownToSemanticDocument, semanticBodyText, serializeSemanticDocument } from "@arden/domain";

/** Rich Private notes are stored as Arden Semantic Documents, like shared drafts. */
export const isRichNoteBody = (body: string) => body.startsWith(ARDEN_DOCUMENT_PREFIX);

/**
 * The body the rich editor opens. Notes written before the rich editor are Markdown text: their
 * `**bold**`, `_italic_`, lists and headings open formatted. Nothing is saved until the owner edits.
 */
export function noteEditorBody(body: string): string {
  return isRichNoteBody(body) ? body : serializeSemanticDocument(markdownToSemanticDocument(body, () => crypto.randomUUID()));
}

/** Readable text of a note, for counts, excerpts and AI; an unreadable document has none. */
export const noteText = (body: string) => semanticBodyText(body) ?? "";

export const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;
