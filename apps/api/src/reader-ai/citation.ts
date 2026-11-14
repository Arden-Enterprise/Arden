import type { PublishedKnowledge } from "../db/repository.js";
import type { PublicCitation } from "../answers/governed-contracts.js";
import { citationPage } from "../answers/citation-page.js";

/** Both reader operations navigate the original immutable source, never model metadata. */
export function readerCitation(metadata: PublishedKnowledge, publication: string,
  chunk: { content: string; startOffset: number; sourceBlockIds: string[]; parentSectionBlockId: string | null }, quote: string): PublicCitation {
  const startOffset = chunk.startOffset + Array.from(chunk.content.slice(0, chunk.content.indexOf(quote))).length;
  const pages = new Set([...chunk.sourceBlockIds, ...(chunk.parentSectionBlockId ? [chunk.parentSectionBlockId] : [])]
    .map(block => citationPage([block])).filter(page => page !== undefined));
  return { documentId: metadata.draftId, versionId: publication,
    blockId: chunk.sourceBlockIds.length === 1 ? chunk.sourceBlockIds[0] : chunk.parentSectionBlockId ?? undefined,
    page: pages.size === 1 ? [...pages][0] : undefined, excerpt: quote,
    title: metadata.title, version: metadata.management?.version ?? "Version unavailable",
    scope: metadata.targetReaders?.mode === "SELECTED_MEMBERS" ? "Selected readers"
      : metadata.targetReaders?.mode === "DEPARTMENT" ? "Department" : "Organization",
    classification: metadata.classification, documentCode: metadata.documentCode ?? null,
    startOffset, endOffset: startOffset + Array.from(quote).length };
}
