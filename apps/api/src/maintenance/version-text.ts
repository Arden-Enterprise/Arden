import { ARDEN_DOCUMENT_PREFIX, parseSemanticDocument, semanticDocumentText } from "@arden/domain";

/** Comparable text for one version. Every Semantic Document block contributes a line; invalid content is unavailable. */
export function visibleVersionText(body: string, mimeType: string): string | null {
  if (mimeType === "application/pdf" || body.length > 200_000) return null;
  if (!body.startsWith(ARDEN_DOCUMENT_PREFIX)) return body;
  const parsed = parseSemanticDocument(body);
  return parsed.ok ? semanticDocumentText(parsed.document) : null;
}
