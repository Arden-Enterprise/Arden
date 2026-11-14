import type { ReaderSourceResponse } from "./contracts.js";

export type SummaryKind = "KEY_POINT" | "STEP" | "CONDITION" | "EXCEPTION";
export type SummaryPoint = { kind: SummaryKind; text: string; citations: Array<{ chunkId: string; quote: string }> };
export type ReaderSummaryResponse = Pick<ReaderSourceResponse, "contractVersion" | "purpose" | "requestId"
  | "organizationId" | "publishedVersionId" | "generationId" | "snapshotVersionId" | "snapshotContentHash"
  | "markdownContentHash" | "chunksDigest"> & { status: "COMPLETED"; points: SummaryPoint[];
    coverage: Array<{ startOffset: number; endOffset: number }>; usedChunkIds: string[] };

export class ReaderSummaryError extends Error {
  constructor(readonly code: "INVALID_SUMMARY" | "UNSUPPORTED" | "BUSY" | "UNAVAILABLE") { super(code); }
}
const invalid = (): never => { throw new ReaderSummaryError("INVALID_SUMMARY"); };
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join() !== [...keys].sort().join()) return invalid();
  return value as Record<string, unknown>;
}
function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > maximum) return invalid();
  return value;
}

/** The AI service can propose text, never new identities, source ranges or read permissions. */
export function parseReaderSummary(value: unknown, source: ReaderSourceResponse): ReaderSummaryResponse {
  const identity = ["contractVersion", "purpose", "requestId", "organizationId", "publishedVersionId", "generationId",
    "snapshotVersionId", "snapshotContentHash", "markdownContentHash", "chunksDigest"] as const;
  const row = record(value, [...identity, "status", "points", "coverage", "usedChunkIds"]);
  if (identity.some(key => row[key] !== source[key]) || row.status !== "COMPLETED") return invalid();
  if (!Array.isArray(row.coverage) || !row.coverage.length || row.coverage.length > 8) return invalid();
  let end = 0;
  const coverage = row.coverage.map(value => {
    const range = record(value, ["startOffset", "endOffset"]);
    if (range.startOffset !== end || !Number.isSafeInteger(range.endOffset)
      || typeof range.endOffset !== "number" || range.endOffset <= end || range.endOffset - end > 6_000) return invalid();
    const startOffset = end; end = range.endOffset;
    return { startOffset, endOffset: end };
  });
  if (end !== Array.from(source.markdown).length || !Array.isArray(row.usedChunkIds)
    || JSON.stringify(row.usedChunkIds) !== JSON.stringify(source.chunks.map(chunk => chunk.chunkId))) return invalid();
  if (!Array.isArray(row.points) || !row.points.length || row.points.length > 24) return invalid();
  const points = row.points.map((value): SummaryPoint => {
    const point = record(value, ["kind", "text", "citations"]);
    const kind = point.kind;
    if ((kind !== "KEY_POINT" && kind !== "STEP" && kind !== "CONDITION" && kind !== "EXCEPTION")
      || !Array.isArray(point.citations) || !point.citations.length || point.citations.length > 2) return invalid();
    const citations = point.citations.map(value => {
      const citation = record(value, ["chunkId", "quote"]);
      const chunk = source.chunks.find(item => item.chunkId === citation.chunkId);
      const quote = boundedText(citation.quote, 1_200);
      if (!chunk) return invalid();
      const start = chunk.content.indexOf(quote);
      if (start < 0 || chunk.content.indexOf(quote, start + 1) >= 0) return invalid();
      return { chunkId: chunk.chunkId, quote };
    });
    return { kind, text: boundedText(point.text, 350), citations };
  });
  return { contractVersion: 1, purpose: "READER_SUMMARY", requestId: source.requestId,
    organizationId: source.organizationId, publishedVersionId: source.publishedVersionId, generationId: source.generationId,
    snapshotVersionId: source.snapshotVersionId, snapshotContentHash: source.snapshotContentHash,
    markdownContentHash: source.markdownContentHash, chunksDigest: source.chunksDigest,
    status: "COMPLETED", points, coverage, usedChunkIds: source.chunks.map(chunk => chunk.chunkId) };
}
