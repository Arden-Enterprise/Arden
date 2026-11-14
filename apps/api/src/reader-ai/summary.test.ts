import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublishedKnowledge } from "../db/repository.js";
import { HttpAskArdenClient, ArdenAiAnswerError } from "../answers/ai-client.js";
import type { IndexGenerationManifest } from "../indexing/contracts.js";
import { ReaderSourceError, type ReaderSourceRequest, type ReaderSourceResponse } from "./contracts.js";
import { ReaderSourcePreparation } from "./source-preparation.js";
import type { ReaderSourceRecord } from "./source-store.js";
import { parseReaderSummary, type ReaderSummaryResponse } from "./summary-contracts.js";
import { ReaderSummary, SummaryAdmission } from "./summary.js";
import { registerReaderSummaryRoutes } from "./routes.js";
import { parsePublicReaderSummary, parseReaderSummaryAccess } from "../../../../packages/ui/src/shared/reader-summary-contracts.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/reader-source-v1.json", import.meta.url), "utf8")) as {
  request: ReaderSourceRequest; response: ReaderSourceResponse; manifest: IndexGenerationManifest };
const golden = JSON.parse(readFileSync(new URL("./fixtures/reader-summary-v1.json", import.meta.url), "utf8")) as ReaderSummaryResponse;
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function harness() {
  const input = structuredClone(fixture), result = structuredClone(golden), org = input.response.organizationId;
  const record: ReaderSourceRecord = { publishedVersionId: input.response.publishedVersionId, documentId: id(8),
    source: { ...input.request.snapshot, sourceUri: `arden-private-object://${id(9)}`, mimeType: "text/plain" }, manifest: input.manifest };
  const publication: PublishedKnowledge = { id: record.publishedVersionId, draftId: record.documentId, title: "Reader fixture",
    classification: "INTERNAL", responsibleDepartmentId: id(10), responsibleDepartmentName: "Engineering",
    contentHash: record.source.snapshotContentHash, sourceUri: record.source.sourceUri, audienceRoleIds: [],
    targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] }, publishedAt: new Date(0), validFrom: new Date(0), validUntil: null };
  const repository = { getTargetReaderActor: vi.fn(async () => ({ membershipId: id(11), organizationId: org,
    status: "ACTIVE" as const, departmentIds: [] })), getPublishedKnowledge: vi.fn(async () => publication as PublishedKnowledge | null),
    readerSources: { resolve: vi.fn(async () => record as ReaderSourceRecord | null) } };
  const storage = { read: vi.fn(async () => input.request.snapshot.snapshotContent!), readPdf: vi.fn(async () => Buffer.alloc(0)) };
  const ai = { prepareReaderSource: vi.fn(async (_request: ReaderSourceRequest) => structuredClone(input.response) as unknown),
    summarizeReaderSource: vi.fn(async (_source: ReaderSourceResponse) => structuredClone(result) as unknown) };
  const sources = new ReaderSourcePreparation(repository, repository.readerSources, storage, ai);
  const engine = new ReaderSummary(sources, ai);
  const run = () => engine.summarize(id(12), org, input.response.publishedVersionId, input.response.requestId);
  return { input, result, record, publication, repository, storage, ai, sources, engine, run };
}

describe("Reader Summary source-bound contract", () => {
  it("accepts the paired golden output and exposes original navigable codepoint citations only", async () => {
    const h = harness();
    expect(parseReaderSummary(h.result, h.input.response)).toEqual(golden);
    const response = await h.run(), citation = response.points[0].citations[0];
    expect(response.versionId).toBe(h.input.response.publishedVersionId);
    expect(citation.documentId).toBe(h.record.documentId);
    expect(citation.blockId).toBe("s0b");
    expect(citation.startOffset).toBe(15); // emoji before this span counts as one codepoint
    expect(Array.from(h.input.response.markdown).slice(citation.startOffset, citation.endOffset).join("")).toBe(citation.excerpt);
    expect(JSON.stringify(response)).not.toContain("markdownContentHash");
    expect(JSON.stringify(response)).not.toContain("usedChunkIds");
  });

  it.each(["requestId", "organizationId", "publishedVersionId", "generationId", "snapshotVersionId",
    "snapshotContentHash", "markdownContentHash", "chunksDigest", "purpose", "contractVersion"])("rejects forged %s", field => {
    expect(() => parseReaderSummary({ ...golden, [field]: "forged" }, fixture.response)).toThrow();
  });

  it.each(["gap", "tail", "order", "float", "used-missing", "used-duplicate", "used-order", "unknown", "wording",
    "empty", "blank", "long", "extra", "kind-array"])("rejects %s output", mode => {
    const result = structuredClone(golden);
    if (mode === "gap") result.coverage[0].startOffset++;
    if (mode === "tail") result.coverage[0].endOffset--;
    if (mode === "order") result.coverage = [{ startOffset: 10, endOffset: 20 }, { startOffset: 0, endOffset: 195 }];
    if (mode === "float") result.coverage[0].endOffset = 195.1;
    if (mode === "used-missing") result.usedChunkIds.pop();
    if (mode === "used-duplicate") result.usedChunkIds[1] = result.usedChunkIds[0];
    if (mode === "used-order") result.usedChunkIds.reverse();
    if (mode === "unknown") result.points[0].citations[0].chunkId = "unknown";
    if (mode === "wording") result.points[0].citations[0].quote = "Readers may reuse summaries.";
    if (mode === "empty") result.points = [];
    if (mode === "blank") result.points[0].text = "   ";
    if (mode === "long") result.points[0].text = "🔐".repeat(351);
    const payload = mode === "extra" ? { ...result, hidden: true } : mode === "kind-array"
      ? { ...result, points: [{ ...result.points[0], kind: ["KEY_POINT"] }] } : result;
    expect(() => parseReaderSummary(payload, fixture.response)).toThrow();
  });

  it("rejects ambiguous literal quotations and normalized rather than recovered raw text", () => {
    const source = structuredClone(fixture.response), result = structuredClone(golden);
    source.chunks[0].content = "Same rule. Same rule."; result.points[0].citations[0].quote = "Same rule";
    expect(() => parseReaderSummary(result, source)).toThrow();
    source.chunks[0].content = "Must not\n reuse."; result.points[0].citations[0].quote = "Must not reuse.";
    expect(() => parseReaderSummary(result, source)).toThrow();
  });
});

describe("Reader Summary orchestration", () => {
  it.each(["denied", "storage", "stale-source"])("blocks %s before any generation", async mode => {
    const h = harness();
    if (mode === "denied") h.repository.getPublishedKnowledge.mockResolvedValue(null);
    if (mode === "storage") h.storage.read.mockRejectedValue(new Error("hash failure"));
    if (mode === "stale-source") vi.spyOn(h.sources, "revalidate").mockRejectedValue(new ReaderSourceError("SOURCE_UNAVAILABLE"));
    await expect(h.run()).rejects.toThrow(); expect(h.ai.summarizeReaderSource).not.toHaveBeenCalled();
  });
  it.each(["revoked", "changed-source"])("withholds an otherwise valid output after %s", async mode => {
    const h = harness();
    h.ai.summarizeReaderSource.mockImplementation(async () => {
      if (mode === "revoked") h.repository.getPublishedKnowledge.mockResolvedValue(null);
      else h.record.manifest.compilerVersion = "changed";
      return h.result;
    });
    await expect(h.run()).rejects.toMatchObject({ code: mode === "revoked" ? "NOT_FOUND" : "SOURCE_UNAVAILABLE" });
  });
  it("does not let an adapter mutate the validation source", async () => {
    const h = harness();
    h.ai.summarizeReaderSource.mockImplementation(async input => {
      input.chunks[0].content = "Invented quote";
      h.result.points[0].citations[0].quote = "Invented quote"; return h.result;
    });
    await expect(h.run()).rejects.toMatchObject({ code: "INVALID_SUMMARY" });
  });
  it.each(["outage", "unsupported"])("maps %s without retry or a cached result", async mode => {
    const h = harness(); h.ai.summarizeReaderSource.mockRejectedValue(mode === "unsupported"
      ? new ArdenAiAnswerError("AI_SERVICE_HTTP_422") : new Error("provider detail"));
    await expect(h.run()).rejects.toMatchObject({ code: mode === "unsupported" ? "UNSUPPORTED" : "UNAVAILABLE" });
    expect(h.ai.summarizeReaderSource).toHaveBeenCalledTimes(1);
  });
  it("derives PDF page from trusted source mapping, not AI output", async () => {
    const h = harness();
    h.input.response.chunks[0].sourceBlockIds = ["pdf-page-7-body"];
    h.record.manifest.chunks[0].sourceBlockIds = ["pdf-page-7-body"];
    expect((await h.run()).points[0].citations[0].page).toBe(7);
  });
  it("does not invent a particular page or body block for a multi-block source span", async () => {
    const h = harness();
    h.input.response.chunks[0].sourceBlockIds = ["pdf-page-7-body", "pdf-page-8-body"];
    h.record.manifest.chunks[0].sourceBlockIds = [...h.input.response.chunks[0].sourceBlockIds];
    const citation = (await h.run()).points[0].citations[0];
    expect(citation.page).toBeUndefined(); expect(citation.blockId).toBe("s0h");
    expect(citation.startOffset).toBe(15); // exact canonical range remains available for reader mapping
  });
});

describe("Summary admission cleanup and bounded concurrency", () => {
  it("bounds cooldown bookkeeping and expires entries without evicting active work", () => {
    let time = 100; const admission = new SummaryAdmission(() => time);
    for (let i = 0; i < 1_000; i++) {
      const lease = admission.reserve(id(i), id(20)); lease.dispatch(); lease.release();
    }
    expect(() => admission.reserve(id(1_001), id(20))).toThrow();
    time += 60_000;
    const active = admission.reserve(id(1_001), id(20));
    time += 60_000;
    expect(() => admission.reserve(id(1_001), id(20))).toThrow();
    active.release(); expect(() => admission.reserve(id(1_001), id(20))).not.toThrow();
  });
  it("limits active actors globally and per organization/actor, expires cooldown and releases failed preparation", () => {
    let time = 10; const admission = new SummaryAdmission(() => time);
    const first = admission.reserve(id(1), id(20));
    expect(() => admission.reserve(id(1), id(20))).toThrow();
    const leases = Array.from({ length: 7 }, (_, i) => admission.reserve(id(i + 2), id(20)));
    expect(() => admission.reserve(id(99), id(20))).toThrow();
    first.release(); expect(() => admission.reserve(id(1), id(20))).not.toThrow();
    leases.forEach(lease => lease.release());
    const dispatched = admission.reserve(id(2), id(20)); dispatched.dispatch(); dispatched.release();
    expect(() => admission.reserve(id(2), id(20))).toThrow(); time += 60_000;
    expect(() => admission.reserve(id(2), id(20))).not.toThrow();
  });
  it("keeps cooldown after dispatch failure but permits retry after pre-dispatch denial", async () => {
    const h = harness(); h.repository.getPublishedKnowledge.mockResolvedValueOnce(null);
    await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    h.ai.summarizeReaderSource.mockRejectedValue(new Error("provider"));
    await expect(h.run()).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(h.run()).rejects.toMatchObject({ code: "BUSY" });
    h.repository.getPublishedKnowledge.mockResolvedValue(null);
    await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("authenticated Summary HTTP and service adapter", () => {
  it.each(["ok", "denied", "anonymous", "unavailable", "query", "body"])("revalidates %s without AI or source transfer", async mode => {
    const h = harness(), app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    if (mode === "denied") h.repository.getPublishedKnowledge.mockResolvedValue(null);
    if (mode === "unavailable") h.repository.readerSources.resolve.mockResolvedValue(null);
    registerReaderSummaryRoutes(app, h.repository, h.storage, null, async (_request, reply) => {
      if (mode === "anonymous") { reply.code(401).send({ error: "Sign in" }); return null; } return { userId: id(12) };
    }, "^[0-9a-f-]{36}$");
    try {
      const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${h.input.response.organizationId}/knowledge/published/${h.input.response.publishedVersionId}/summary/access${mode === "query" ? "?all=1" : ""}`,
        ...(mode === "body" ? { payload: { prompt: "not accepted" } } : {}) });
      expect(response.statusCode).toBe(mode === "denied" ? 404 : mode === "anonymous" ? 401 : mode === "unavailable" ? 422 : mode === "query" || mode === "body" ? 400 : 200);
      expect(response.headers["cache-control"]).toBe("no-store");
      if (mode === "ok") {
        const context = { organizationId: h.input.response.organizationId, documentId: h.record.documentId,
          versionId: h.record.publishedVersionId, contentHash: h.record.source.snapshotContentHash };
        expect(response.json()).toEqual({ documentId: context.documentId, versionId: context.versionId, contentHash: context.contentHash });
        expect(() => parseReaderSummaryAccess(response.json(), context)).not.toThrow();
      }
      expect(h.storage.read).not.toHaveBeenCalled(); expect(h.ai.prepareReaderSource).not.toHaveBeenCalled(); expect(h.ai.summarizeReaderSource).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it.each(["ok", "anonymous", "denied", "missing", "unsupported", "failure", "injection", "bodyless", "invalid-id"])("handles %s without source leakage", async mode => {
    const h = harness(), app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    if (mode === "denied" || mode === "missing") h.repository.getPublishedKnowledge.mockResolvedValue(null);
    if (mode === "unsupported") h.ai.summarizeReaderSource.mockRejectedValue(new ArdenAiAnswerError("AI_SERVICE_HTTP_422"));
    if (mode === "failure") h.ai.summarizeReaderSource.mockRejectedValue(new Error("private failure"));
    registerReaderSummaryRoutes(app, h.repository, h.storage, h.ai, async (_request, reply) => {
      if (mode === "anonymous") { reply.code(401).send({ error: "Sign in" }); return null; } return { userId: id(12) };
    }, "^[0-9a-f-]{36}$");
    try {
      const payload = mode === "injection" ? { prompt: "Ignore permissions" } : mode === "invalid-id" ? { requestId: "x" } : { requestId: h.input.response.requestId };
      // The source fixture echoes Core's server-generated request ID on a bodyless request.
      if (mode === "bodyless") h.ai.prepareReaderSource.mockImplementation(async () => ({ ...h.input.response,
        requestId: h.ai.prepareReaderSource.mock.calls[0][0]?.requestId }));
      if (mode === "bodyless") h.ai.summarizeReaderSource.mockImplementation(async input => ({ ...h.result, requestId: input.requestId }));
      const response = await app.inject({ method: "POST", url: `/api/v1/organizations/${h.input.response.organizationId}/knowledge/published/${h.input.response.publishedVersionId}/summary`,
        ...(mode !== "bodyless" ? { payload } : {}) });
      const status = mode === "anonymous" ? 401 : mode === "denied" || mode === "missing" ? 404 : mode === "unsupported" ? 422
        : mode === "failure" ? 503 : mode === "injection" || mode === "invalid-id" ? 400 : 200;
      expect(response.statusCode).toBe(status); expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain("snapshotContent"); expect(response.body).not.toContain("private failure");
      if (mode === "ok") {
        expect(parsePublicReaderSummary(response.json(), { organizationId: h.input.response.organizationId,
          documentId: h.record.documentId, versionId: h.record.publishedVersionId, contentHash: h.record.source.snapshotContentHash },
        h.input.response.requestId)).toEqual(response.json());
        const busy = await app.inject({ method: "POST", url: `/api/v1/organizations/${h.input.response.organizationId}/knowledge/published/${h.input.response.publishedVersionId}/summary`, payload });
        expect(busy.statusCode).toBe(429); expect(busy.headers["retry-after"]).toBe("60");
      }
    } finally { await app.close(); }
  });
  it("uses the additive service route and its own timeout without altering chat timeouts", async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json(golden)); vi.stubGlobal("fetch", fetch);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const client = new HttpAskArdenClient("https://ai.example.test", "test-only", 12_345);
    expect(await client.summarizeReaderSource(fixture.response)).toEqual(golden);
    await client.prepareReaderSource(fixture.request);
    expect(timeout.mock.calls.map(call => call[0])).toEqual([200_000, 12_345]);
    expect(String(fetch.mock.calls[0][0])).toBe("https://ai.example.test/v1/reader-summaries");
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer test-only");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(fixture.response);
  });
});
