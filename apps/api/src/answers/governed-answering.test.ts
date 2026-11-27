import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { validateStoredBoundSurface, type HydratedDocumentSummary } from "@arden/domain";
import type { ArdenDataRepository, AuthorizedAiSource } from "../db/repository.js";
import type { AskArdenClient } from "./ai-client.js";
import { MemoryConversationStore } from "./conversation.test-support.js";
import { GovernedAnswering } from "./governed-answering.js";
import { incompleteUsageMarker } from "./usage-contracts.js";
import {
  parseGenerationResponse,
  parsePublicCitations,
  parseRetrievalResponse,
  type Evidence,
  type GenerationRequest,
  type GenerationResponse,
  type GenerationV3Request,
  type GenerationV3Response,
  type RetrievalRequest,
  type RetrievalResponse,
} from "./governed-contracts.js";
import { registerAnswerRoutes } from "./routes.js";
import { hydrateConversationSurfaces, type UiSurfaceHydrator } from "./ui-surface-hydrator.js";

function fixture() {
  const user = randomUUID(), org = randomUUID(), membership = randomUUID();
  const evidence: Evidence = { generationId: randomUUID(), snapshotVersionId: randomUUID(), snapshotContentHash: "a".repeat(64),
    chunkId: "b".repeat(64), content: "🔐 All team members must use MFA.", startOffset: 8,
    endOffset: 8 + Array.from("🔐 All team members must use MFA.").length,
    contentHash: createHash("sha256").update("🔐 All team members must use MFA.").digest("hex"),
    sourceBlockIds: ["pdf-page-2"], parentSectionBlockId: null, label: "Untrusted label" };
  const source: AuthorizedAiSource = { ...evidence, publishedVersionId: randomUUID(), draftId: randomUUID(),
    title: "Access guide", versionNo: 27, classification: "INTERNAL", targetScopeType: "ORGANIZATION",
    targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
    management: { type: "Guide", version: "2.1", expirationDate: null, changeNote: "" },
    chunks: [{ ...evidence }] };
  const store = new MemoryConversationStore();
  let permitted = true;
  const repository: Pick<ArdenDataRepository, "conversations" | "getTargetReaderActor" | "listAuthorizedAiSources" | "recordAiUsageEvents"> = {
    conversations: store,
    getTargetReaderActor: vi.fn<ArdenDataRepository["getTargetReaderActor"]>(async (actor, organization) => actor === user && organization === org
      ? { membershipId: membership, organizationId: org, status: "ACTIVE", departmentIds: [] } : null),
    listAuthorizedAiSources: vi.fn<ArdenDataRepository["listAuthorizedAiSources"]>(async (_actor, _org, generations, _chunks, documentIds) => permitted
      && (!generations || generations.includes(source.generationId))
      && (!documentIds || documentIds.includes(source.draftId)) ? [source] : []),
    recordAiUsageEvents: vi.fn(async () => true),
  };
  const retrieve = vi.fn(async (value: RetrievalRequest): Promise<RetrievalResponse> => ({ contractVersion: 2,
    usageContractVersion: 1, usageEvents: [], requestId: value.requestId, standaloneQuery: value.query,
    retrievalMode: "HYBRID", evidence: [evidence] }));
  const generate = vi.fn(async (value: GenerationRequest): Promise<GenerationResponse> => ({ contractVersion: 2,
    usageContractVersion: 1, usageEvents: [],
    requestId: value.requestId, status: "ANSWERED", answer: "MFA is required.",
    citations: [{ chunkId: evidence.chunkId, quote: "All team members must use MFA." }],
    usedEvidence: value.evidence.map(chunk => chunk.chunkId) }));
  const ai: AskArdenClient = { retrieve, generate };
  const input = { conversationId: randomUUID(), requestId: randomUUID(), expectedRevision: 0, query: "What is required?" };
  return { engine: new GovernedAnswering(repository, ai), repository, store, ai, input, user, org, evidence, source,
    retrieve, generate, revoke: () => { permitted = false; } };
}

describe("governed answering handoffs", () => {
  it("validates the HTTP scope filter and rejects a changed scope on request replay", async () => {
    const f = fixture();
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    registerAnswerRoutes(app, f.repository as ArdenDataRepository, f.ai, async () => ({ userId: f.user }),
      "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    const url = `/api/v1/organizations/${f.org}/ai/answers`;
    const send = (scopeFilter: unknown) => app.inject({ method: "POST", url, payload: { ...f.input, scopeFilter } });
    try {
      for (const scopeFilter of [
        {}, { documentIds: [] }, { documentIds: ["bad-id"] },
        { documentIds: [f.source.draftId, f.source.draftId] },
        { documentIds: Array.from({ length: 51 }, () => randomUUID()) },
        { documentIds: [f.source.draftId], includeAll: true },
      ]) {
        expect((await send(scopeFilter)).statusCode).toBe(400);
      }
      const ok = await send({ documentIds: [f.source.draftId] });
      expect(ok.statusCode).toBe(200);
      const conflict = await send({ documentIds: [randomUUID()] });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({ error: { code: "CONVERSATION_CONFLICT" } });
      expect(f.retrieve).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("uses canonical metadata and exact codepoint/page anchors, then persists before returning", async () => {
    const f = fixture();
    const result = await f.engine.answer(f.user, f.org, f.input);
    expect(result).toMatchObject({ revision: 1, conversationId: f.input.conversationId, citations: [{
      title: "Access guide", version: "2.1", documentCode: null, page: 2, startOffset: 10,
      versionId: f.source.publishedVersionId,
    }] });
    // Decision 0021: sources are named by title, so the model never sees or repeats a Document Code.
    expect(f.generate.mock.calls[0]![0].evidence[0]!.label).toMatch(/^Access guide · Version 2\.1/);
    expect((await f.store.load(f.user, f.org, f.input.conversationId))?.turns).toHaveLength(1);
  });

  it("stops before generation when selected evidence is revoked during retrieval", async () => {
    const f = fixture();
    f.retrieve.mockImplementationOnce(async value => { f.revoke(); return { contractVersion: 2, requestId: value.requestId,
      usageContractVersion: 1, usageEvents: [], standaloneQuery: value.query,
      retrievalMode: "HYBRID", evidence: [f.evidence] }; });
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    expect(f.generate).not.toHaveBeenCalled();
    expect((await f.store.load(f.user, f.org, f.input.conversationId))?.revision).toBe(0);
  });

  it.each(["ANSWERED", "INSUFFICIENT_EVIDENCE"] as const)("withholds %s output if any uncited input loses access", async status => {
    const f = fixture();
    const other: Evidence = { ...f.evidence, chunkId: "c".repeat(64) };
    f.source.chunks = [f.evidence, other];
    f.retrieve.mockImplementationOnce(async value => ({ contractVersion: 2, requestId: value.requestId,
      usageContractVersion: 1, usageEvents: [], standaloneQuery: value.query,
      retrievalMode: "HYBRID", evidence: [f.evidence, other] }));
    f.generate.mockImplementationOnce(async value => {
      // Only the uncited chunk disappears. Cited evidence still exists.
      f.source.chunks = [f.evidence];
      return { contractVersion: 2, requestId: value.requestId, status, answer: "Derived from both inputs.",
        usageContractVersion: 1, usageEvents: [],
        citations: status === "ANSWERED" ? [{ chunkId: f.evidence.chunkId, quote: "All team members must use MFA." }] : [],
        usedEvidence: [f.evidence.chunkId, other.chunkId] };
    });
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    expect((await f.store.load(f.user, f.org, f.input.conversationId))?.turns).toEqual([]);
  });

  it.each(["contentHash", "startOffset", "sourceBlockIds", "parentSectionBlockId"])("rejects a forged manifest %s before generation", async field => {
    const f = fixture();
    const chunks = f.source.chunks as Array<Record<string, unknown>>;
    chunks[0]![field] = field === "sourceBlockIds" ? ["elsewhere"] : field === "startOffset" ? 99 : "forged";
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("does not return an unrecorded answer if atomic persistence fails", async () => {
    const f = fixture(); f.store.failPersistence = true;
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toThrow("persistence");
    expect((await f.store.load(f.user, f.org, f.input.conversationId))?.revision).toBe(0);
  });

  it("replays a completed request without another provider call and rejects changed reuse", async () => {
    const f = fixture();
    const first = await f.engine.answer(f.user, f.org, f.input);
    expect(await f.engine.answer(f.user, f.org, f.input)).toEqual(first);
    expect(f.generate).toHaveBeenCalledTimes(1);
    await expect(f.engine.answer(f.user, f.org, { ...f.input, query: "Different" })).rejects.toMatchObject({ code: "CONFLICT" });
    f.revoke();
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
  });

  it("withholds the whole historical answer and excludes it from later model context", async () => {
    const f = fixture();
    await f.engine.answer(f.user, f.org, f.input);
    const oldGeneration = f.source.generationId;
    // A different publication replaces the old source; old content remains stored but not usable.
    f.source.generationId = f.evidence.generationId = randomUUID();
    f.source.publishedVersionId = randomUUID();
    const view = await f.engine.load(f.user, f.org, f.input.conversationId);
    expect(view?.turns[0]).toMatchObject({ status: "UNAVAILABLE", answer: "This answer is no longer available.", citations: [] });
    expect(view?.turns[0]).not.toHaveProperty("evidence");
    await f.engine.answer(f.user, f.org, { ...f.input, requestId: randomUUID(), expectedRevision: 1, query: "Any exceptions?" });
    expect(f.retrieve.mock.calls[1]![0].history).toEqual([]);
    expect(f.retrieve.mock.calls[1]![0].allowedGenerationIds).not.toContain(oldGeneration);
  });

  it("keeps valid multi-turn context bounded and uses fresh retrieval each turn", async () => {
    const f = fixture();
    for (let i = 0; i < 6; i++) await f.engine.answer(f.user, f.org,
      { ...f.input, expectedRevision: i, requestId: randomUUID(), query: `Question ${i}` });
    expect(f.retrieve).toHaveBeenCalledTimes(6);
    expect(f.retrieve.mock.calls[5]![0].history.map(turn => turn.question)).toEqual(["Question 1", "Question 2", "Question 3", "Question 4"]);
    await expect(f.engine.answer(f.user, f.org, { ...f.input, requestId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps conversations private even for an otherwise active administrator", async () => {
    const f = fixture();
    await f.engine.answer(f.user, f.org, f.input);
    const administrator = randomUUID();
    vi.mocked(f.repository.getTargetReaderActor).mockResolvedValue({ membershipId: randomUUID(), organizationId: f.org,
      status: "ACTIVE", departmentIds: [] });
    expect(await f.engine.load(administrator, f.org, f.input.conversationId)).toBeNull();
    await expect(f.engine.answer(administrator, f.org, { ...f.input, requestId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await f.engine.load(f.user, randomUUID(), f.input.conversationId)).toBeNull();
  });

  it("abstains without generation when there are no eligible sources", async () => {
    const f = fixture(); f.revoke();
    expect(await f.engine.answer(f.user, f.org, f.input)).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", citations: [], revision: 1 });
    expect(f.retrieve).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
  });

  it("validates output even for injected ports, including all-used-input equality", async () => {
    const f = fixture();
    f.generate.mockImplementationOnce(async value => ({ contractVersion: 2, requestId: value.requestId,
      status: "ANSWERED", answer: "forged", usageContractVersion: 1, usageEvents: [],
      citations: [{ chunkId: f.evidence.chunkId, quote: "not a source quote" }], usedEvidence: [] }));
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
  });
});

describe("v2 runtime contracts", () => {
  it("accepts the shared Python/Core golden response contract", () => {
    const golden = JSON.parse(readFileSync(new URL("./fixtures/governed-v2.json", import.meta.url), "utf8")) as {
      retrievalResponse: RetrievalResponse; generationRequest: GenerationRequest; generationResponse: GenerationResponse };
    expect(parseRetrievalResponse(golden.retrievalResponse, golden.generationRequest.requestId)).toEqual(golden.retrievalResponse);
    // Generation always calls a provider: an empty reported list is stored as incomplete usage.
    expect(parseGenerationResponse(golden.generationResponse, golden.generationRequest)).toEqual({ ...golden.generationResponse,
      usageEvents: [incompleteUsageMarker(golden.generationRequest.requestId, "CHAT_GENERATION")] });
  });
  it("accepts responses from an Arden-AI release that predates usage accounting", () => {
    const golden = JSON.parse(readFileSync(new URL("./fixtures/governed-v2.json", import.meta.url), "utf8")) as {
      retrievalResponse: RetrievalResponse; generationRequest: GenerationRequest; generationResponse: GenerationResponse };
    const { usageContractVersion: _r, usageEvents: _re, ...olderRetrieval } = golden.retrievalResponse;
    const { usageContractVersion: _g, usageEvents: _ge, ...olderGeneration } = golden.generationResponse;
    const requestId = golden.generationRequest.requestId;
    expect(parseRetrievalResponse(olderRetrieval, requestId).usageEvents)
      .toEqual([incompleteUsageMarker(requestId, "CHAT_RETRIEVAL")]);
    expect(parseGenerationResponse(olderGeneration, golden.generationRequest).usageEvents)
      .toEqual([incompleteUsageMarker(requestId, "CHAT_GENERATION")]);
    // A malformed envelope is also incomplete usage, never a failed answer.
    expect(parseGenerationResponse({ ...golden.generationResponse, usageContractVersion: 99 }, golden.generationRequest).status)
      .toBe(golden.generationResponse.status);
    // The marker is deterministic, so a retried request cannot add a second incomplete row.
    expect(incompleteUsageMarker(requestId, "CHAT_GENERATION")).toEqual(incompleteUsageMarker(requestId, "CHAT_GENERATION"));
  });
  it("rejects unknown properties, raw text hash/offset mismatches and undeclared evidence", () => {
    const f = fixture();
    const valid = { contractVersion: 2, usageContractVersion: 1 as const, usageEvents: [], requestId: f.input.requestId,
      standaloneQuery: "MFA?", retrievalMode: "HYBRID" as const, evidence: [f.evidence] };
    expect(parseRetrievalResponse(valid, f.input.requestId).evidence).toHaveLength(1);
    for (const value of [{ ...valid, extra: true }, { ...valid, evidence: [{ ...f.evidence, content: "modified" }] },
      { ...valid, evidence: [f.evidence, f.evidence] }, { ...valid, requestId: randomUUID() }]) {
      expect(() => parseRetrievalResponse(value, f.input.requestId)).toThrow("INVALID_EVIDENCE");
    }
    const request: GenerationRequest = { contractVersion: 2, purpose: "PUBLISHED_CHAT", requestId: f.input.requestId,
      organizationId: f.org, query: "MFA?", history: [], evidence: [f.evidence] };
    const response = { contractVersion: 2, usageContractVersion: 1, usageEvents: [], requestId: request.requestId,
      status: "INSUFFICIENT_EVIDENCE", answer: "Insufficient.", citations: [], usedEvidence: [] };
    expect(() => parseGenerationResponse(response, request)).toThrow("INVALID_EVIDENCE");
  });
});

describe("stored answer citations", () => {
  it("drops a Document Code saved before decision 0021 so older chats show titles", () => {
    const excerpt = "All team members must use MFA.";
    const [citation] = parsePublicCitations([{ documentId: randomUUID(), versionId: randomUUID(), excerpt,
      title: "Access guide", version: "2.1", scope: "Company-wide", classification: "INTERNAL",
      documentCode: "ARD-7098B0251CA744F0", startOffset: 0, endOffset: Array.from(excerpt).length }]);
    expect(citation).toMatchObject({ title: "Access guide", documentCode: null });
  });
});

function v3Fixture() {
  const base = fixture();
  const deptId = randomUUID();
  const colId = randomUUID();
  let bindingRevoked = false;
  let validUntil: string | null = "2026-12-31";
  let openCases: number | null = 2;

  const makeSummary = (): HydratedDocumentSummary => ({
    documentId: base.source.draftId,
    publishedVersionId: base.source.publishedVersionId,
    title: base.source.title,
    type: "Guide",
    version: "2.1",
    ownerDepartmentId: deptId,
    ownerDepartmentName: "Security",
    authorDisplayName: "Alice Author",
    publishedAt: "2026-11-20T00:00:00.000Z",
    validUntil,
    validityStatus: "Current",
    daysUntilExpiry: 35,
    readerScope: "ORGANIZATION",
    collectionName: "Handbook",
    openMaintenanceCaseCount: openCases,
    openTarget: "READER",
    canReportIssue: true,
    canOpenMaintenance: openCases !== null,
    canRenew: false,
  });

  const hydrator: UiSurfaceHydrator = {
    loadCatalogMetadata: vi.fn(async () => new Map([
      [base.source.publishedVersionId, {
        ownerDepartmentId: deptId,
        ownerDepartmentName: "Security",
        version: "2.1",
        readerScope: "ORGANIZATION" as const,
        collectionId: colId,
        hasDirectRelationships: true,
      }],
    ])),
    loadDocuments: vi.fn(async (_u, _o, versionIds) => {
      const map = new Map<string, HydratedDocumentSummary>();
      if (versionIds.includes(base.source.publishedVersionId)) {
        map.set(base.source.publishedVersionId, makeSummary());
      }
      return map;
    }),
    loadLineages: vi.fn(async () => new Map()),
    hydrateConversationSurfaces: vi.fn(async (u, o, turns) =>
      hydrateConversationSurfaces(hydrator, u, o, turns)),
  };

  const arePublishedVersionsAvailable = vi.fn(async (_u: string, _o: string, versionIds: readonly string[]) => {
    if (bindingRevoked) return false;
    return versionIds.every((id) => id === base.source.publishedVersionId);
  });

  const repository: Pick<
    ArdenDataRepository,
    "conversations" | "getTargetReaderActor" | "listAuthorizedAiSources" | "arePublishedVersionsAvailable" | "uiSurfaceHydrator" | "recordAiUsageEvents"
  > = {
    ...base.repository,
    arePublishedVersionsAvailable,
    uiSurfaceHydrator: hydrator,
  };

  const generateV3 = vi.fn(async (value: GenerationV3Request): Promise<GenerationV3Response> => ({
    contractVersion: 3,
    requestId: value.requestId,
    status: "ANSWERED",
    answer: "MFA is required [1].",
    citations: [{ chunkId: base.evidence.chunkId, quote: "All team members must use MFA." }],
    usedEvidence: value.evidence.map((chunk) => chunk.chunkId),
    uiSurfaceStatus: "GENERATED",
    uiSurface: {
      schemaVersion: 1,
      rootId: "root",
      nodes: [
        { id: "root", kind: "stack", gap: "md", childIds: ["metrics", "prose_1", "doc_card"] },
        { id: "metrics", kind: "metric_strip", metricKeys: ["MATCHED_DOCS", "OPEN_MAINTENANCE_CASES"] },
        { id: "prose_1", kind: "prose", markdown: "MFA is required [1].", citationIndexes: [1] },
        {
          id: "doc_card",
          kind: "card",
          title: "Access guide",
          bodyIds: ["doc_1"],
          footerIds: ["open_1", "renew_1"],
        },
        { id: "doc_1", kind: "document_item", docRef: "D1", highlightNote: "Primary MFA policy." },
        { id: "open_1", kind: "open_reader", label: "Open guide", docRef: "D1", page: 2 },
        { id: "renew_1", kind: "workflow_handoff", label: "Renew", handoff: "open_renewal", docRef: "D1" },
      ],
    },
  }));

  const ai: AskArdenClient = { retrieve: base.retrieve, generate: base.generate, generateV3 };
  const engine = new GovernedAnswering(repository, ai);

  return {
    ...base,
    engine,
    repository,
    ai,
    hydrator,
    generateV3,
    arePublishedVersionsAvailable,
    revokeBinding: () => { bindingRevoked = true; },
    setLiveHydration: (next: { validUntil?: string | null; openCases?: number | null }) => {
      if ("validUntil" in next) validUntil = next.validUntil ?? null;
      if ("openCases" in next) openCases = next.openCases ?? null;
    },
  };
}

describe("v3 modular UiSurface orchestration, fallback, 4-path revocation & paging", () => {
  it("calls /v3/generations with opaque handles, strips unauthorized workflow_handoff, persists bindings, and returns hydrated surface", async () => {
    const f = v3Fixture();
    const res = await f.engine.answer(f.user, f.org, f.input);

    expect(f.generateV3).toHaveBeenCalledTimes(1);
    expect(f.generate).not.toHaveBeenCalled();
    const sentCatalog = f.generateV3.mock.calls[0]![0].sourceCatalog;
    expect(sentCatalog).toHaveLength(1);
    expect(sentCatalog[0]!.docRef).toBe("D1");
    expect(JSON.stringify(sentCatalog)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    expect(res.uiSurface).not.toBeNull();
    expect(validateStoredBoundSurface(res.uiSurface, { citationCount: 1 }).ok).toBe(true);
    // canRenew is false, so renew_1 workflow_handoff must be stripped from response surface.
    expect(res.uiSurface!.nodes.renew_1).toBeUndefined();
    expect(res.uiSurface!.nodes.doc_card).toMatchObject({ footerIds: ["open_1"] });
    expect(res.hydratedDocuments[f.source.publishedVersionId]?.title).toBe("Access guide");
    expect(res.turnHydration?.metrics.metrics).toEqual([
      { key: "MATCHED_DOCS", label: "Matched documents", value: 1, tone: "neutral" },
      { key: "OPEN_MAINTENANCE_CASES", label: "Open maintenance cases", value: 2, tone: "attention" },
    ]);

    const stored = await f.store.load(f.user, f.org, f.input.conversationId);
    expect(stored?.turns[0]?.surfaceBindings).toEqual([
      { documentId: f.source.draftId, publishedVersionId: f.source.publishedVersionId },
    ]);
  });

  it("falls back cleanly to synthesizeFallbackSurface on malformed v3 uiSurface without failing chat delivery", async () => {
    const f = v3Fixture();
    f.generateV3.mockImplementationOnce(async (value) => ({
      contractVersion: 3,
      requestId: value.requestId,
      status: "ANSWERED",
      answer: "MFA is required [1].",
      citations: [{ chunkId: f.evidence.chunkId, quote: "All team members must use MFA." }],
      usedEvidence: value.evidence.map((chunk) => chunk.chunkId),
      uiSurfaceStatus: "GENERATED",
      uiSurface: {
        schemaVersion: 1,
        rootId: "root",
        nodes: [
          { id: "root", kind: "stack", childIds: ["bad_callout"] },
          // Forbidden LLM callout tone "warning" must be rejected by UiSurfaceValidator -> fallback!
          { id: "bad_callout", kind: "callout", tone: "warning", title: "Spoof", body: "Expired!", citationIndexes: [1] },
        ],
      },
    }));

    const res = await f.engine.answer(f.user, f.org, f.input);
    expect(res.status).toBe("ANSWERED");
    expect(res.answer).toBe("MFA is required [1].");
    expect(res.uiSurface).not.toBeNull();
    expect(validateStoredBoundSurface(res.uiSurface, { citationCount: 1 }).ok).toBe(true);
    expect(Object.values(res.uiSurface!.nodes).some((n) => n.kind === "callout")).toBe(false);
    expect(Object.values(res.uiSurface!.nodes).some((n) => n.kind === "prose")).toBe(true);
  });

  it("falls back to /v2/generations when useUiSurfaceV3 is false and still synthesizes fallback surface", async () => {
    const f = v3Fixture();
    const engine = new GovernedAnswering(f.repository, f.ai, { useUiSurfaceV3: false });
    const res = await engine.answer(f.user, f.org, f.input);
    expect(f.generateV3).not.toHaveBeenCalled();
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(res.uiSurface).not.toBeNull();
    expect(validateStoredBoundSurface(res.uiSurface, { citationCount: 1 }).ok).toBe(true);
  });

  it("enforces 4-path fail-closed revocation on surfaceBindings (load, replay, context, append)", async () => {
    const f = v3Fixture();
    await f.engine.answer(f.user, f.org, f.input);

    // Revoke ONLY via surfaceBindings availability check (even if evidence source mock still lists the chunk!).
    f.revokeBinding();

    // Path 2: load withholds entire turn cleanly.
    const view = await f.engine.load(f.user, f.org, f.input.conversationId);
    expect(view?.turns[0]).toMatchObject({
      status: "UNAVAILABLE",
      answer: "This answer is no longer available.",
      citations: [],
      uiSurface: null,
      turnHydration: null,
    });
    expect(view?.turns[0]).not.toHaveProperty("surfaceBindings");
    expect(view?.turns[0]).not.toHaveProperty("evidence");

    // Path 3: replay rejects with ACCESS_CHANGED.
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "ACCESS_CHANGED" });

    // Path 4: context excludes revoked turn from follow-up history, and Path 1: append rejects revoked surface binding.
    await expect(f.engine.answer(f.user, f.org, {
      ...f.input,
      requestId: randomUUID(),
      expectedRevision: 1,
      query: "Follow-up?",
    })).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    expect(f.retrieve.mock.calls[1]![0].history).toEqual([]);
  });

  it("replays with live hydrated metadata and rejects scopeFilterHash mismatch with CONFLICT", async () => {
    const f = v3Fixture();
    const documentIds = [f.source.draftId, randomUUID()];
    const first = await f.engine.answer(f.user, f.org, { ...f.input, scopeFilter: { documentIds } });
    expect(first.hydratedDocuments[f.source.publishedVersionId]?.validUntil).toBe("2026-12-31");

    // Live renewal updates validUntil and openCases — replay must return LIVE hydrated metadata!
    f.setLiveHydration({ validUntil: "2028-01-15", openCases: 5 });
    const replayed = await f.engine.answer(f.user, f.org, {
      ...f.input, scopeFilter: { documentIds: [...documentIds].reverse() },
    });
    expect(f.generateV3).toHaveBeenCalledTimes(1);
    expect(replayed.hydratedDocuments[f.source.publishedVersionId]?.validUntil).toBe("2028-01-15");
    expect(replayed.turnHydration?.metrics.metrics).toContainEqual({
      key: "OPEN_MAINTENANCE_CASES",
      label: "Open maintenance cases",
      value: 5,
      tone: "attention",
    });

    // Different scopeFilterHash for same requestId -> 409 CONFLICT.
    await expect(f.engine.answer(f.user, f.org, { ...f.input, scopeFilter: { documentIds: [f.source.draftId] } }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each(["load", "replay", "new answer"] as const)("rechecks a turn at delivery after hydration (%s)", async (path) => {
    const f = v3Fixture();
    if (path !== "new answer") await f.engine.answer(f.user, f.org, f.input);
    vi.mocked(f.hydrator.hydrateConversationSurfaces).mockImplementationOnce(async (user, org, turns) => {
      const hydrated = await hydrateConversationSurfaces(f.hydrator, user, org, turns);
      if (path === "replay") f.revoke();
      else f.revokeBinding();
      return hydrated;
    });

    if (path === "load") {
      const view = await f.engine.load(f.user, f.org, f.input.conversationId);
      expect(view?.turns[0]).toMatchObject({
        status: "UNAVAILABLE",
        answer: "This answer is no longer available.",
        citations: [],
        uiSurface: null,
        turnHydration: null,
      });
      expect(view?.hydratedDocuments).toEqual({});
    } else {
      await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    }
    expect(f.generateV3).toHaveBeenCalledTimes(1);
  });

  it("degrades corrupted stored ui_surface gracefully to null without failing conversation load", async () => {
    const f = v3Fixture();
    await f.engine.answer(f.user, f.org, f.input);

    // Corrupt stored uiSurface directly in backing store.
    const record = f.store.records.get(f.input.conversationId)!;
    record.value.turns[0]!.uiSurface = { schemaVersion: 1, rootId: "__proto__", nodes: {}, bindings: {} } as never;

    const view = await f.engine.load(f.user, f.org, f.input.conversationId);
    expect(view).not.toBeNull();
    expect(view?.turns[0]).toMatchObject({
      status: "ANSWERED",
      answer: "MFA is required [1].",
      uiSurface: null,
      turnHydration: null,
    });
  });

  it("supports cursor pagination (?limit=&beforeSequence=) with hasMore and validates query bounds on routes", async () => {
    const f = v3Fixture();
    for (let i = 0; i < 25; i += 1) {
      await f.engine.answer(f.user, f.org, {
        ...f.input,
        requestId: randomUUID(),
        expectedRevision: i,
        query: `Turn ${i + 1}`,
      });
    }

    const defaultPage = await f.engine.load(f.user, f.org, f.input.conversationId);
    expect(defaultPage?.hasMore).toBe(true);
    expect(defaultPage?.turns).toHaveLength(20);
    expect(defaultPage?.turns[0]?.sequence).toBe(6);
    expect(defaultPage?.turns[19]?.sequence).toBe(25);

    const olderPage = await f.engine.load(f.user, f.org, f.input.conversationId, { limit: 10, beforeSequence: 6 });
    expect(olderPage?.hasMore).toBe(false);
    expect(olderPage?.turns).toHaveLength(5);
    expect(olderPage?.turns.map((t) => t.sequence)).toEqual([1, 2, 3, 4, 5]);

    // Verify Fastify route querystring schema and forwarding.
    const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
    const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
    registerAnswerRoutes(
      app,
      f.repository as unknown as ArdenDataRepository,
      f.ai,
      async () => ({ userId: f.user }),
      uuidPattern,
    );
    const base = `/api/v1/organizations/${f.org}/ai/conversations/${f.input.conversationId}`;
    const paged = await app.inject({ method: "GET", url: `${base}?limit=5&beforeSequence=10` });
    expect(paged.statusCode).toBe(200);
    expect(paged.json().turns.map((t: { sequence: number }) => t.sequence)).toEqual([5, 6, 7, 8, 9]);
    expect(paged.json().hasMore).toBe(true);

    expect((await app.inject({ method: "GET", url: `${base}?limit=0` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `${base}?limit=51` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `${base}?beforeSequence=0` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `${base}?extra=1` })).statusCode).toBe(400);
    await app.close();
  });

  it("keeps UTF-8 conversation pages within the Desktop response ceiling and preserves the omitted turns", async () => {
    const f = v3Fixture();
    await f.engine.answer(f.user, f.org, f.input);
    const record = f.store.records.get(f.input.conversationId)!.value;
    const sample = record.turns[0]!;
    const text = "語".repeat(11_000) + " [1].";
    const surface = structuredClone(sample.uiSurface!);
    const prose = surface.nodes.prose_1;
    if (prose?.kind !== "prose") throw new Error("Missing fixture prose");
    prose.markdown = text;
    expect(validateStoredBoundSurface(surface, { citationCount: 1 }).ok).toBe(true);
    record.turns = Array.from({ length: 50 }, (_, index) => ({
      ...sample, id: randomUUID(), requestId: randomUUID(), sequence: index + 1, answer: text, uiSurface: surface,
    }));
    record.revision = 50;

    const latest = (await f.engine.load(f.user, f.org, f.input.conversationId, { limit: 50 }))!;
    expect(latest.hasMore).toBe(true);
    expect(latest.turns).not.toHaveLength(50);
    expect(latest.turns[0]?.uiSurface).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(latest), "utf8")).toBeLessThanOrEqual(2 * 1024 * 1024);

    const earlier = (await f.engine.load(f.user, f.org, f.input.conversationId, {
      limit: 50, beforeSequence: latest.turns[0]!.sequence,
    }))!;
    expect(earlier.hasMore).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(earlier), "utf8")).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect([...earlier.turns, ...latest.turns].map((turn) => turn.sequence)).toEqual(record.turns.map((turn) => turn.sequence));
  });
});
