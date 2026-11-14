import type { KnowledgeCitationReference } from "../knowledge/knowledgeCitation";
import { isKnowledgeClassification } from "./knowledge-classification";

export type ReaderSummaryContext = { organizationId: string; documentId: string; versionId: string; contentHash: string };
export type ReaderSummaryCitation = KnowledgeCitationReference & { startOffset: number; endOffset: number;
  title: string; version: string; scope: string; classification: string; documentCode: string | null };
export type ReaderSummaryResult = { requestId: string; status: "COMPLETED"; documentId: string; versionId: string;
  points: Array<{ kind: "KEY_POINT" | "STEP" | "CONDITION" | "EXCEPTION"; text: string; citations: ReaderSummaryCitation[] }> };
export function assertReaderSummaryContext(context: ReaderSummaryContext): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (![context.organizationId, context.documentId, context.versionId].every(id => uuid.test(id))
    || !/^[0-9a-f]{64}$/.test(context.contentHash)) throw new Error("Invalid Summary context");
}
const invalid = (): never => { throw new Error("Invalid Summary response"); };
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => ![...required, ...optional].includes(key))) return invalid();
  return row;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > max) return invalid();
  return value;
}
export function parseReaderSummaryAccess(value: unknown, context: ReaderSummaryContext): void {
  const row = object(value, ["documentId", "versionId", "contentHash"]);
  if (row.documentId !== context.documentId || row.versionId !== context.versionId || row.contentHash !== context.contentHash) return invalid();
}
export function parsePublicReaderSummary(value: unknown, context: ReaderSummaryContext, requestId: string): ReaderSummaryResult {
  const row = object(value, ["requestId", "status", "documentId", "versionId", "points"]);
  if (row.requestId !== requestId || row.status !== "COMPLETED" || row.documentId !== context.documentId
    || row.versionId !== context.versionId || !Array.isArray(row.points) || !row.points.length || row.points.length > 24) return invalid();
  const points = row.points.map((value): ReaderSummaryResult["points"][number] => {
    const point = object(value, ["kind", "text", "citations"]), kind = point.kind;
    if ((kind !== "KEY_POINT" && kind !== "STEP" && kind !== "CONDITION" && kind !== "EXCEPTION")
      || !Array.isArray(point.citations) || !point.citations.length || point.citations.length > 2) return invalid();
    const citations = point.citations.map(value => parseReaderCitation(value, context));
    return { kind, text: text(point.text, 350), citations };
  });
  return { requestId, status: "COMPLETED", documentId: context.documentId, versionId: context.versionId, points };
}

export function parseReaderCitation(value: unknown, context: ReaderSummaryContext, maxEndOffset = 200_000): ReaderSummaryCitation {
  const citation = object(value, ["documentId", "versionId", "excerpt", "title", "version", "scope", "classification",
    "documentCode", "startOffset", "endOffset"], ["blockId", "page"]);
  const excerpt = text(citation.excerpt, 1_200), start = citation.startOffset, end = citation.endOffset;
  if (citation.documentId !== context.documentId || citation.versionId !== context.versionId
    || typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || start < 0
    || !Number.isSafeInteger(end) || end > maxEndOffset || end - start !== Array.from(excerpt).length
    || !isKnowledgeClassification(citation.classification)
    || (citation.blockId !== undefined && (typeof citation.blockId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(citation.blockId)))
    || (citation.page !== undefined && (typeof citation.page !== "number" || !Number.isSafeInteger(citation.page) || citation.page < 1))) return invalid();
  return { documentId: context.documentId, versionId: context.versionId,
    ...(citation.blockId === undefined ? {} : { blockId: citation.blockId as string }),
    ...(citation.page === undefined ? {} : { page: citation.page as number }), excerpt,
    title: text(citation.title, 200), version: text(citation.version, 200), scope: text(citation.scope, 100),
    classification: citation.classification, documentCode: citation.documentCode === null ? null : text(citation.documentCode, 200),
    startOffset: start, endOffset: end };
}
