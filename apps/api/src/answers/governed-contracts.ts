import { createHash } from "node:crypto";
import type { AuthorizedAiSource } from "../db/repository.js";

export type VersionScope = "CURRENT" | "UPCOMING" | "COMPARE";
export type DialogueTurn = { question: string; answer: string };
export type EvidenceReference = { generationId: string; publishedVersionId: string; snapshotVersionId: string;
  snapshotContentHash: string; chunkId: string };
export type Evidence = Omit<EvidenceReference, "publishedVersionId"> & { content: string; contentHash: string;
  startOffset: number; endOffset: number; sourceBlockIds: string[]; parentSectionBlockId: string | null; label: string };
export type RetrievalRequest = { contractVersion: 2; purpose: "PUBLISHED_CHAT" | "READER_QUESTION"; requestId: string;
  organizationId: string; query: string; allowedGenerationIds: string[]; history: DialogueTurn[];
  sourceHints: Array<{ generationId: string; label: string }> };
export type RetrievalResponse = { contractVersion: 2; requestId: string; standaloneQuery: string;
  retrievalMode: "HYBRID" | "SEMANTIC" | "LEXICAL"; evidence: Evidence[] };
export type GenerationRequest = Omit<RetrievalRequest, "allowedGenerationIds" | "sourceHints"> & { evidence: Evidence[] };
export type GenerationResponse = { contractVersion: 2; requestId: string; status: "ANSWERED" | "INSUFFICIENT_EVIDENCE";
  answer: string; citations: Array<{ chunkId: string; quote: string }>; usedEvidence: string[] };
export type PublicCitation = { documentId: string; versionId: string; blockId?: string; page?: number;
  excerpt: string; title: string; version: string; scope: string; classification: string;
  documentCode: string | null; startOffset: number; endOffset: number };
export type StoredAnswer = { status: "ANSWERED" | "INSUFFICIENT_EVIDENCE"; answer: string; citations: PublicCitation[] };

export class GovernedAnswerError extends Error {
  constructor(readonly code: "INVALID_EVIDENCE" | "ACCESS_CHANGED" | "CONFLICT" | "NOT_FOUND") { super(code); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash = /^[0-9a-f]{64}$/;
const invalid = (): never => { throw new GovernedAnswerError("INVALID_EVIDENCE"); };
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  if (Object.keys(value).sort().join() !== keys.sort().join()) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, pattern?: RegExp): string {
  if (typeof value !== "string" || !value.length || value.length > max || (pattern && !pattern.test(value))) return invalid();
  return value;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}
export function parseRetrievalResponse(value: unknown, requestId: string): RetrievalResponse {
  const row = record(value, ["contractVersion", "requestId", "standaloneQuery", "retrievalMode", "evidence"]);
  if (row.contractVersion !== 2 || row.requestId !== requestId
    || (row.retrievalMode !== "HYBRID" && row.retrievalMode !== "SEMANTIC" && row.retrievalMode !== "LEXICAL")) return invalid();
  const evidence = array(row.evidence, 8).map((value): Evidence => {
    const chunk = record(value, ["generationId", "snapshotVersionId", "snapshotContentHash", "chunkId", "contentHash",
      "content", "startOffset", "endOffset", "sourceBlockIds", "parentSectionBlockId", "label"]);
    const content = text(chunk.content, 16_000);
    const startOffset = integer(chunk.startOffset), endOffset = integer(chunk.endOffset);
    const sourceBlockIds = array(chunk.sourceBlockIds, 100).map((id) => text(id, 200));
    const contentHash = text(chunk.contentHash, 64, hash);
    if (!sourceBlockIds.length || endOffset - startOffset !== Array.from(content).length
      || createHash("sha256").update(content).digest("hex") !== contentHash) return invalid();
    if (typeof chunk.label !== "string" || chunk.label.length > 800) return invalid();
    return { generationId: text(chunk.generationId, 36, uuid), snapshotVersionId: text(chunk.snapshotVersionId, 36, uuid),
      snapshotContentHash: text(chunk.snapshotContentHash, 64, hash), chunkId: text(chunk.chunkId, 64, hash),
      content, contentHash, startOffset, endOffset, sourceBlockIds,
      parentSectionBlockId: chunk.parentSectionBlockId === null ? null : text(chunk.parentSectionBlockId, 200), label: chunk.label };
  });
  if (new Set(evidence.map((chunk) => chunk.chunkId)).size !== evidence.length
    || evidence.reduce((sum, chunk) => sum + chunk.content.length, 0) > 64_000) return invalid();
  return { contractVersion: 2, requestId, standaloneQuery: text(row.standaloneQuery, 4_000),
    retrievalMode: row.retrievalMode as RetrievalResponse["retrievalMode"], evidence };
}
export function parseGenerationResponse(value: unknown, request: GenerationRequest): GenerationResponse {
  const row = record(value, ["contractVersion", "requestId", "status", "answer", "citations", "usedEvidence"]);
  if (row.contractVersion !== 2 || row.requestId !== request.requestId
    || (row.status !== "ANSWERED" && row.status !== "INSUFFICIENT_EVIDENCE")) return invalid();
  const usedEvidence = array(row.usedEvidence, 8).map((id) => text(id, 64, hash));
  if (usedEvidence.length !== request.evidence.length || new Set(usedEvidence).size !== usedEvidence.length
    || request.evidence.some((chunk) => !usedEvidence.includes(chunk.chunkId))) return invalid();
  const citations = array(row.citations, 12).map((value) => {
    const citation = record(value, ["chunkId", "quote"]);
    const chunkId = text(citation.chunkId, 64, hash), quote = text(citation.quote, 1_200);
    if (!request.evidence.find((chunk) => chunk.chunkId === chunkId)?.content.includes(quote)) return invalid();
    return { chunkId, quote };
  });
  if ((row.status === "ANSWERED") !== Boolean(citations.length)) return invalid();
  return { contractVersion: 2, requestId: request.requestId, status: row.status,
    answer: text(row.answer, 12_000), citations, usedEvidence };
}
export function evidenceMatchesManifest(evidence: Evidence, source: Pick<AuthorizedAiSource,
  "generationId" | "snapshotVersionId" | "snapshotContentHash" | "chunks">): boolean {
  if (evidence.generationId !== source.generationId || evidence.snapshotVersionId !== source.snapshotVersionId
    || evidence.snapshotContentHash !== source.snapshotContentHash || !Array.isArray(source.chunks)) return false;
  const entries = source.chunks.filter((entry: unknown) => entry && typeof entry === "object"
    && "chunkId" in entry && entry.chunkId === evidence.chunkId);
  if (entries.length !== 1) return false;
  const chunk = entries[0] as Record<string, unknown>;
  return chunk.contentHash === evidence.contentHash && chunk.startOffset === evidence.startOffset
    && chunk.endOffset === evidence.endOffset && chunk.parentSectionBlockId === evidence.parentSectionBlockId
    && Array.isArray(chunk.sourceBlockIds)
    && JSON.stringify(chunk.sourceBlockIds) === JSON.stringify(evidence.sourceBlockIds);
}
export function sourceLabel(source: AuthorizedAiSource): string {
  const metadata = source.management;
  return [source.documentCode, source.title, metadata?.version ? `Version ${metadata.version}` : null,
    metadata?.type, metadata?.topicName, metadata?.effectiveDate ? `Effective ${metadata.effectiveDate}` : null,
    metadata?.expirationDate ? `Expires ${metadata.expirationDate}` : null].filter(Boolean).join(" · ").slice(0, 800);
}

/** Stored JSON is also a runtime boundary; never trust a TypeScript row annotation. */
export function parsePublicCitations(value: unknown): PublicCitation[] {
  return array(value, 12).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid();
    const row = entry as Record<string, unknown>;
    const keys = ["documentId", "versionId", "blockId", "page", "excerpt", "title", "version", "scope", "classification",
      "documentCode", "startOffset", "endOffset"];
    if (Object.keys(row).some(key => !keys.includes(key))) return invalid();
    const excerpt = text(row.excerpt, 1_200), startOffset = integer(row.startOffset), endOffset = integer(row.endOffset);
    if (endOffset - startOffset !== Array.from(excerpt).length
      || !["INTERNAL", "CONFIDENTIAL", "RESTRICTED"].includes(String(row.classification))) return invalid();
    const page = row.page === undefined ? undefined : integer(row.page);
    if (page !== undefined && (page < 1 || page > 100_000)) return invalid();
    return { documentId: text(row.documentId, 36, uuid), versionId: text(row.versionId, 36, uuid),
      ...(row.blockId === undefined ? {} : { blockId: text(row.blockId, 200) }), ...(page === undefined ? {} : { page }),
      excerpt, title: text(row.title, 1_000), version: text(row.version, 100), scope: text(row.scope, 100),
      classification: String(row.classification), documentCode: row.documentCode === null ? null : text(row.documentCode, 100), startOffset, endOffset };
  });
}
