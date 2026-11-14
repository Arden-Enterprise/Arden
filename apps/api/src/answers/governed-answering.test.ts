import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ArdenDataRepository, AuthorizedAiSource } from "../db/repository.js";
import type { AskArdenClient } from "./ai-client.js";
import { MemoryConversationStore } from "./conversation.test-support.js";
import { GovernedAnswering } from "./governed-answering.js";
import { parseGenerationResponse, parseRetrievalResponse, type Evidence, type GenerationRequest,
  type GenerationResponse, type RetrievalRequest, type RetrievalResponse } from "./governed-contracts.js";

function fixture() {
  const user = randomUUID(), org = randomUUID(), membership = randomUUID();
  const evidence: Evidence = { generationId: randomUUID(), snapshotVersionId: randomUUID(), snapshotContentHash: "a".repeat(64),
    chunkId: "b".repeat(64), content: "🔐 All team members must use MFA.", startOffset: 8,
    endOffset: 8 + Array.from("🔐 All team members must use MFA.").length,
    contentHash: createHash("sha256").update("🔐 All team members must use MFA.").digest("hex"),
    sourceBlockIds: ["pdf-page-2"], parentSectionBlockId: null, label: "Untrusted label" };
  const source: AuthorizedAiSource = { ...evidence, publishedVersionId: randomUUID(), draftId: randomUUID(),
    title: "Access guide", versionNo: 27, classification: "INTERNAL", targetScopeType: "ORGANIZATION",
    targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] }, documentCode: "NS-IT-001",
    management: { type: "Guide", topicId: randomUUID(), version: "2.1", effectiveDate: "2026-01-01", expirationDate: null, changeNote: "" },
    chunks: [{ ...evidence }] };
  const store = new MemoryConversationStore();
  let permitted = true;
  const repository: Pick<ArdenDataRepository, "conversations" | "getTargetReaderActor" | "listAuthorizedAiSources"> = {
    conversations: store,
    getTargetReaderActor: vi.fn<ArdenDataRepository["getTargetReaderActor"]>(async (actor, organization) => actor === user && organization === org
      ? { membershipId: membership, organizationId: org, status: "ACTIVE", departmentIds: [] } : null),
    listAuthorizedAiSources: vi.fn<ArdenDataRepository["listAuthorizedAiSources"]>(async (_actor, _org, generations) => permitted
      && (!generations || generations.includes(source.generationId)) ? [source] : []),
  };
  const retrieve = vi.fn(async (value: RetrievalRequest): Promise<RetrievalResponse> => ({ contractVersion: 2,
    requestId: value.requestId, standaloneQuery: value.query, retrievalMode: "HYBRID", evidence: [evidence] }));
  const generate = vi.fn(async (value: GenerationRequest): Promise<GenerationResponse> => ({ contractVersion: 2,
    requestId: value.requestId, status: "ANSWERED", answer: "MFA is required.",
    citations: [{ chunkId: evidence.chunkId, quote: "All team members must use MFA." }],
    usedEvidence: value.evidence.map(chunk => chunk.chunkId) }));
  const ai: AskArdenClient = { answer: vi.fn(async () => { throw new Error("v1 must not be used"); }), retrieve, generate };
  const input = { conversationId: randomUUID(), requestId: randomUUID(), expectedRevision: 0, query: "What is required?", versionScope: "CURRENT" as const };
  return { engine: new GovernedAnswering(repository, ai), repository, store, ai, input, user, org, evidence, source,
    retrieve, generate, revoke: () => { permitted = false; } };
}

describe("governed answering handoffs", () => {
  it("uses canonical metadata and exact codepoint/page anchors, then persists before returning", async () => {
    const f = fixture();
    const result = await f.engine.answer(f.user, f.org, f.input);
    expect(result).toMatchObject({ revision: 1, conversationId: f.input.conversationId, citations: [{
      title: "Access guide", version: "2.1", documentCode: "NS-IT-001", page: 2, startOffset: 10,
      versionId: f.source.publishedVersionId,
    }] });
    expect(f.generate.mock.calls[0]![0].evidence[0]!.label).toContain("Version 2.1");
    expect(f.ai.answer).not.toHaveBeenCalled();
    expect((await f.store.load(f.user, f.org, f.input.conversationId))?.turns).toHaveLength(1);
  });

  it("stops before generation when selected evidence is revoked during retrieval", async () => {
    const f = fixture();
    f.retrieve.mockImplementationOnce(async value => { f.revoke(); return { contractVersion: 2, requestId: value.requestId,
      standaloneQuery: value.query, retrievalMode: "HYBRID", evidence: [f.evidence] }; });
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "ACCESS_CHANGED" });
    expect(f.generate).not.toHaveBeenCalled();
    expect((await f.store.load(f.user, f.org, f.input.conversationId))?.revision).toBe(0);
  });

  it.each(["ANSWERED", "INSUFFICIENT_EVIDENCE"] as const)("withholds %s output if any uncited input loses access", async status => {
    const f = fixture();
    const other: Evidence = { ...f.evidence, chunkId: "c".repeat(64) };
    f.source.chunks = [f.evidence, other];
    f.retrieve.mockImplementationOnce(async value => ({ contractVersion: 2, requestId: value.requestId,
      standaloneQuery: value.query, retrievalMode: "HYBRID", evidence: [f.evidence, other] }));
    f.generate.mockImplementationOnce(async value => {
      // Only the uncited chunk disappears. Cited evidence still exists.
      f.source.chunks = [f.evidence];
      return { contractVersion: 2, requestId: value.requestId, status, answer: "Derived from both inputs.",
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
      status: "ANSWERED", answer: "forged", citations: [{ chunkId: f.evidence.chunkId, quote: "not a source quote" }], usedEvidence: [] }));
    await expect(f.engine.answer(f.user, f.org, f.input)).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
  });
});

describe("v2 runtime contracts", () => {
  it("accepts the shared Python/Core golden response contract", () => {
    const golden = JSON.parse(readFileSync(new URL("./fixtures/governed-v2.json", import.meta.url), "utf8")) as {
      retrievalResponse: RetrievalResponse; generationRequest: GenerationRequest; generationResponse: GenerationResponse };
    expect(parseRetrievalResponse(golden.retrievalResponse, golden.generationRequest.requestId)).toEqual(golden.retrievalResponse);
    expect(parseGenerationResponse(golden.generationResponse, golden.generationRequest)).toEqual(golden.generationResponse);
  });
  it("rejects unknown properties, raw text hash/offset mismatches and undeclared evidence", () => {
    const f = fixture();
    const valid = { contractVersion: 2, requestId: f.input.requestId, standaloneQuery: "MFA?", retrievalMode: "HYBRID", evidence: [f.evidence] };
    expect(parseRetrievalResponse(valid, f.input.requestId).evidence).toHaveLength(1);
    for (const value of [{ ...valid, extra: true }, { ...valid, evidence: [{ ...f.evidence, content: "modified" }] },
      { ...valid, evidence: [f.evidence, f.evidence] }, { ...valid, requestId: randomUUID() }]) {
      expect(() => parseRetrievalResponse(value, f.input.requestId)).toThrow("INVALID_EVIDENCE");
    }
    const request: GenerationRequest = { contractVersion: 2, purpose: "PUBLISHED_CHAT", requestId: f.input.requestId,
      organizationId: f.org, query: "MFA?", history: [], evidence: [f.evidence] };
    const response = { contractVersion: 2, requestId: request.requestId, status: "INSUFFICIENT_EVIDENCE", answer: "Insufficient.", citations: [], usedEvidence: [] };
    expect(() => parseGenerationResponse(response, request)).toThrow("INVALID_EVIDENCE");
  });
});
