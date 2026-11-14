import { createHash } from "node:crypto";
import type { ChunkManifestEntry, IndexGenerationManifest, IndexGenerationRequest } from "../indexing/contracts.js";

export type ReaderSourceRequest = { contractVersion: 1; purpose: "READER_SUMMARY"; requestId: string;
  publishedVersionId: string; snapshot: IndexGenerationRequest };
export type ReaderChunk = ChunkManifestEntry & { content: string };
export type ReaderSourceResponse = { contractVersion: 1; purpose: "READER_SUMMARY"; requestId: string;
  organizationId: string; publishedVersionId: string; generationId: string; snapshotVersionId: string;
  snapshotContentHash: string; compilerVersion: string; chunkingVersion: string; markdownContentHash: string;
  chunksDigest: string; markdown: string; chunks: ReaderChunk[] };

export class ReaderSourceError extends Error {
  constructor(readonly code: "NOT_FOUND" | "SOURCE_UNAVAILABLE" | "INVALID_SOURCE") { super(code); }
}
const invalid = (): never => { throw new ReaderSourceError("INVALID_SOURCE"); };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (Object.keys(value).sort().join() !== [...keys].sort().join()) return invalid();
  return value as Record<string, unknown>;
}

/** Validate against Core's authoritative ready manifest, not a response-owned inventory. */
export function parseReaderSourceResponse(value: unknown, request: ReaderSourceRequest,
  manifest: IndexGenerationManifest): ReaderSourceResponse {
  const row = object(value, ["contractVersion", "purpose", "requestId", "organizationId", "publishedVersionId",
    "generationId", "snapshotVersionId", "snapshotContentHash", "compilerVersion", "chunkingVersion",
    "markdownContentHash", "chunksDigest", "markdown", "chunks"]);
  if (row.contractVersion !== 1 || row.purpose !== "READER_SUMMARY" || row.requestId !== request.requestId
    || row.organizationId !== request.snapshot.organizationId || row.publishedVersionId !== request.publishedVersionId
    || row.generationId !== request.snapshot.generationId || row.snapshotVersionId !== request.snapshot.snapshotVersionId
    || row.snapshotContentHash !== request.snapshot.snapshotContentHash
    || manifest.generationId !== row.generationId || manifest.snapshotVersionId !== row.snapshotVersionId
    || manifest.snapshotContentHash !== row.snapshotContentHash || row.compilerVersion !== manifest.compilerVersion
    || row.chunkingVersion !== manifest.chunkingVersion || row.markdownContentHash !== manifest.markdownContentHash
    || row.chunksDigest !== manifest.chunksDigest) return invalid();
  if (typeof row.markdown !== "string" || !row.markdown.length || digest(row.markdown) !== manifest.markdownContentHash)
    return invalid();
  const markdown = row.markdown, points = Array.from(markdown);
  if (points.length > 200_000 || !Array.isArray(row.chunks) || !row.chunks.length || row.chunks.length > 256
    || row.chunks.length !== manifest.chunks.length) return invalid();
  let characters = 0;
  const chunks = row.chunks.map((entry, ordinal): ReaderChunk => {
    const chunk = object(entry, ["chunkId", "ordinal", "contentHash", "startOffset", "endOffset",
      "sourceBlockIds", "parentSectionBlockId", "content"]);
    const expected = manifest.chunks[ordinal];
    if (chunk.ordinal !== ordinal || expected.ordinal !== ordinal || chunk.chunkId !== expected.chunkId
      || chunk.contentHash !== expected.contentHash || chunk.startOffset !== expected.startOffset
      || chunk.endOffset !== expected.endOffset || chunk.parentSectionBlockId !== expected.parentSectionBlockId
      || !Array.isArray(chunk.sourceBlockIds)
      || chunk.sourceBlockIds.length < 1 || chunk.sourceBlockIds.length > 100
      || chunk.sourceBlockIds.some(id => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
      || (chunk.parentSectionBlockId !== null && (typeof chunk.parentSectionBlockId !== "string"
        || !/^[A-Za-z0-9_-]{1,128}$/.test(chunk.parentSectionBlockId)))
      || JSON.stringify(chunk.sourceBlockIds) !== JSON.stringify(expected.sourceBlockIds)
      || typeof chunk.content !== "string" || !chunk.content.length) return invalid();
    const length = Array.from(chunk.content).length;
    characters += length;
    if (length > 16_000 || length !== expected.endOffset - expected.startOffset
      || points.slice(expected.startOffset, expected.endOffset).join("") !== chunk.content
      || digest(chunk.content) !== expected.contentHash) return invalid();
    return { ...expected, sourceBlockIds: [...expected.sourceBlockIds], content: chunk.content };
  });
  if (characters > 400_000 || new Set(chunks.map(chunk => chunk.chunkId)).size !== chunks.length) return invalid();
  return { contractVersion: 1, purpose: "READER_SUMMARY", requestId: request.requestId,
    organizationId: request.snapshot.organizationId, publishedVersionId: request.publishedVersionId,
    generationId: request.snapshot.generationId, snapshotVersionId: request.snapshot.snapshotVersionId,
    snapshotContentHash: request.snapshot.snapshotContentHash, compilerVersion: manifest.compilerVersion,
    chunkingVersion: manifest.chunkingVersion, markdownContentHash: manifest.markdownContentHash,
    chunksDigest: manifest.chunksDigest, markdown, chunks };
}
