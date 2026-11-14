import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishedKnowledge } from "../db/repository.js";
import type { IndexGenerationManifest } from "../indexing/contracts.js";
import type { Evidence, GenerationRequest, GenerationResponse, RetrievalResponse } from "../answers/governed-contracts.js";
import type { ReaderSourceRequest } from "./contracts.js";
import { ReaderSourcePreparation } from "./source-preparation.js";
import type { ReaderSourceRecord } from "./source-store.js";
import { ReaderQuestion, insufficientDocumentEvidence } from "./question.js";
import { registerReaderQuestionRoutes } from "./question-routes.js";
import { ArdenAiAnswerError } from "../answers/ai-client.js";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = JSON.parse(readFileSync(new URL("./fixtures/reader-source-v1.json", import.meta.url), "utf8")) as {
  request: ReaderSourceRequest; manifest: IndexGenerationManifest; response: { markdown: string } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function harness() {
  const record: ReaderSourceRecord = { documentId: id(8), publishedVersionId: fixture.request.publishedVersionId,
    source: { ...fixture.request.snapshot, sourceUri: "arden-private-object://question-fixture", mimeType: "text/plain" },
    manifest: structuredClone(fixture.manifest) };
  const metadata: PublishedKnowledge = { id: record.publishedVersionId, draftId: record.documentId, title: "Reader fixture",
    contentHash: record.source.snapshotContentHash, sourceUri: record.source.sourceUri, classification: "INTERNAL",
    responsibleDepartmentId: id(10), responsibleDepartmentName: "Engineering", audienceRoleIds: [], publishedAt: new Date(0), validFrom: new Date(0), validUntil: null,
    targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] } };
  const repo = { getTargetReaderActor: vi.fn(async () => ({ membershipId: id(11), organizationId: record.source.organizationId,
    status: "ACTIVE" as const, departmentIds: [] })), getPublishedKnowledge: vi.fn(async () => metadata as PublishedKnowledge | null),
    readerSources: { resolve: vi.fn(async () => record as ReaderSourceRecord | null) } };
  const storage = { read: vi.fn(), readPdf: vi.fn() };
  const gate = new ReaderSourcePreparation(repo, repo.readerSources, storage, null);
  const chunk = record.manifest.chunks[0];
  const evidence: Evidence = { chunkId: chunk.chunkId, contentHash: chunk.contentHash,
    startOffset: chunk.startOffset, endOffset: chunk.endOffset, sourceBlockIds: chunk.sourceBlockIds,
    parentSectionBlockId: chunk.parentSectionBlockId, generationId: record.source.generationId, snapshotVersionId: record.source.snapshotVersionId,
    snapshotContentHash: record.source.snapshotContentHash,
    content: Array.from(fixture.response.markdown).slice(chunk.startOffset, chunk.endOffset).join(""), label: "untrusted label" };
  const retrieve = vi.fn(async (input: { requestId: string; query: string }): Promise<RetrievalResponse> => ({
    contractVersion: 2, requestId: input.requestId, standaloneQuery: input.query, retrievalMode: "HYBRID", evidence: [structuredClone(evidence)] }));
  const generate = vi.fn(async (input: GenerationRequest): Promise<GenerationResponse> => ({ contractVersion: 2,
    requestId: input.requestId, status: "ANSWERED", answer: "Only approved readers may read this version.",
    usedEvidence: input.evidence.map(e => e.chunkId), citations: [{ chunkId: evidence.chunkId, quote: "Only approved readers may read this version" }] }));
  const ai = { retrieve, generate, answer: vi.fn() };
  const engine = new ReaderQuestion(gate, ai);
  const organization = record.source.organizationId, publication = record.publishedVersionId;
  const run = () => engine.answer(id(12), organization, publication, id(7), "Who can read?");
  return { record, metadata, repo, storage, gate, evidence, ai, engine, run };
}

describe("stateless exact-document questions", () => {
  it("restricts retrieval/generation to the requested immutable source without history/storage writes", async () => {
    const h = harness(), result = await h.run();
    expect(h.ai.retrieve).toHaveBeenCalledWith(expect.objectContaining({ purpose: "READER_QUESTION", history: [],
      allowedGenerationIds: [h.record.source.generationId] }));
    expect(h.ai.generate).toHaveBeenCalledWith(expect.objectContaining({ purpose: "READER_QUESTION", history: [],
      evidence: [expect.objectContaining({ label: h.metadata.title })] }));
    expect(result.citations[0]).toMatchObject({ documentId: h.record.documentId, versionId: h.record.publishedVersionId, blockId: "s0b", startOffset: 15 });
    expect(h.storage.read).not.toHaveBeenCalled(); expect(h.storage.readPdf).not.toHaveBeenCalled();
  });
  it.each(["denied", "foreign-version", "foreign-org", "hash", "generation", "manifest", "revoked-after-retrieve",
    "revoked-after-generate", "changed-query", "foreign-evidence", "bad-quote", "ambiguous-quote", "used-input", "bad-status"])("withholds %s", async mode => {
    const h = harness();
    if (mode === "denied") h.repo.getPublishedKnowledge.mockResolvedValue(null);
    if (mode === "foreign-version") h.record.publishedVersionId = id(99);
    if (mode === "foreign-org") h.record.source.organizationId = id(99);
    if (mode === "hash") h.metadata.contentHash = "f".repeat(64);
    h.ai.retrieve.mockImplementation(async input => {
      if (mode === "revoked-after-retrieve") h.repo.getPublishedKnowledge.mockResolvedValue(null);
      if (mode === "generation") h.record.source.generationId = id(99);
      const chunk = { ...h.evidence, ...(mode === "foreign-evidence" ? { generationId: id(99) } : {}),
        ...(mode === "manifest" ? { sourceBlockIds: ["forged"] } : {}) };
      return { contractVersion: 2, requestId: input.requestId, standaloneQuery: mode === "changed-query" ? "different" : input.query,
        retrievalMode: "HYBRID", evidence: [chunk] };
    });
    const generated = h.ai.generate.getMockImplementation()!;
    h.ai.generate.mockImplementation(async input => {
      if (mode === "revoked-after-generate") h.repo.getPublishedKnowledge.mockResolvedValue(null);
      const output = await generated(input);
      if (mode === "bad-quote") output.citations[0].quote = "Invented rule";
      if (mode === "ambiguous-quote") output.citations[0].quote = "read";
      if (mode === "used-input") output.usedEvidence = [];
      if (mode === "bad-status") output.citations = [];
      return output;
    });
    await expect(h.run()).rejects.toThrow();
    if (["denied", "foreign-version", "foreign-org", "hash"].includes(mode)) expect(h.ai.retrieve).not.toHaveBeenCalled();
    if (["generation", "manifest", "revoked-after-retrieve", "changed-query", "foreign-evidence"].includes(mode)) expect(h.ai.generate).not.toHaveBeenCalled();
  });
  it.each(["empty", "insufficient"])("uses fixed document-specific insufficient copy for %s evidence", async mode => {
    const h = harness();
    if (mode === "empty") h.ai.retrieve.mockImplementation(async input => ({ contractVersion: 2, requestId: input.requestId,
      standaloneQuery: input.query, retrievalMode: "HYBRID", evidence: [] }));
    else h.ai.generate.mockImplementation(async input => ({ contractVersion: 2, requestId: input.requestId,
      status: "INSUFFICIENT_EVIDENCE", answer: "Untrusted unsupported prose", citations: [], usedEvidence: input.evidence.map(e => e.chunkId) }));
    const result = await h.run(); expect(result.answer).toBe(insufficientDocumentEvidence); expect(result.citations).toEqual([]);
    if (mode === "empty") expect(h.ai.generate).not.toHaveBeenCalled();
  });
  it("rechecks empty retrieval and preserves denial during admission cooldown", async () => {
    const h = harness(); await h.run(); h.repo.getPublishedKnowledge.mockResolvedValue(null);
    await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = harness(); other.ai.retrieve.mockImplementation(async input => {
      other.repo.getPublishedKnowledge.mockResolvedValue(null);
      return { contractVersion: 2, requestId: input.requestId, standaloneQuery: input.query, retrievalMode: "HYBRID", evidence: [] };
    });
    await expect(other.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rejects a coerced retrieval mode before any generation", async () => {
    const h = harness();
    const reader = new ReaderQuestion(h.gate, { ...h.ai, retrieve: async input => ({ ...await h.ai.retrieve(input), retrievalMode: ["HYBRID"] }) });
    await expect(reader.answer(id(12), h.record.source.organizationId, h.record.publishedVersionId, id(7), "q")).rejects.toThrow();
    expect(h.ai.generate).not.toHaveBeenCalled();
  });
  it.each(["ok", "anonymous", "denied", "history", "source", "querystring", "blank", "missing-id", "long",
    "unsupported", "failure", "no-ai", "busy"])("enforces HTTP %s", async mode => {
    const h = harness(), app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    if (mode === "denied") h.repo.getPublishedKnowledge.mockResolvedValue(null);
    if (mode === "unsupported") h.ai.generate.mockRejectedValue(new ArdenAiAnswerError("AI_SERVICE_HTTP_422"));
    if (mode === "failure") h.ai.generate.mockRejectedValue(new Error("private diagnostic payload"));
    registerReaderQuestionRoutes(app, h.repo, h.storage, mode === "no-ai" ? null : h.ai, async (_request, reply) => {
      if (mode === "anonymous") { reply.code(401).send({ error: "Sign in" }); return null; } return { userId: id(12) };
    }, "^[0-9a-f-]{36}$");
    try {
      const body = { requestId: id(7), query: mode === "blank" ? " " : mode === "long" ? "x".repeat(4_001) : "Who can read?",
        ...(mode === "history" ? { history: [] } : {}), ...(mode === "source" ? { generationId: id(4) } : {}) };
      const response = await app.inject({ method: "POST", url: `/api/v1/organizations/${h.record.source.organizationId}/knowledge/published/${h.record.publishedVersionId}/questions${mode === "querystring" ? "?all=1" : ""}`,
        payload: mode === "missing-id" ? { query: "q" } : body });
      expect(response.statusCode).toBe(mode === "ok" || mode === "busy" ? 200 : mode === "anonymous" ? 401 : mode === "denied" ? 404
        : mode === "unsupported" ? 422 : mode === "failure" || mode === "no-ai" ? 503 : 400);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain("private diagnostic payload");
      if (!["ok", "busy", "unsupported", "failure"].includes(mode)) expect(h.ai.generate).not.toHaveBeenCalled();
      if (mode === "busy") {
        const retry = await app.inject({ method: "POST", url: `/api/v1/organizations/${h.record.source.organizationId}/knowledge/published/${h.record.publishedVersionId}/questions`, payload: body });
        expect(retry.statusCode).toBe(429); expect(retry.headers["retry-after"]).toBe("10");
        expect(h.ai.generate).toHaveBeenCalledOnce();
      }
    } finally { await app.close(); }
  });
});
