import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAskArdenClient } from "./ai-client.js";
import { parseGenerationV3Response, type GenerationRequest, type GenerationV3Request,
  type RetrievalRequest } from "./governed-contracts.js";
import type { ReaderSourceRequest, ReaderSourceResponse } from "../reader-ai/contracts.js";
import { incompleteUsageMarker } from "./usage-contracts.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/governed-v2.json", import.meta.url), "utf8")) as {
  retrievalRequest: RetrievalRequest; retrievalResponse: unknown; generationRequest: GenerationRequest; generationResponse: unknown };
const goldenV3 = JSON.parse(readFileSync(new URL("./fixtures/governed-v3.json", import.meta.url), "utf8")) as {
  generationV3Request: GenerationV3Request; generationV3Response: unknown };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("paired v2 HTTP adapter", () => {
  it.each(["TIMEOUT", "PROVIDER_BUSY", "PROVIDER_AUTH", "INVALID_OUTPUT"])("accepts only the safe Summary failure %s", async code => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ detail: { code, message: "private provider data" } }, { status: 502 })));
    const source = JSON.parse(readFileSync(new URL("../reader-ai/fixtures/reader-source-v1.json", import.meta.url), "utf8")).response as ReaderSourceResponse;
    await expect(new HttpAskArdenClient("http://ai.example.test", "test").summarizeReaderSource(source))
      .rejects.toMatchObject({ code: `AI_SUMMARY_${code}` });
  });
  it.each(["unknown", "oversize", "old-service"])("bounds and sanitizes %s Summary errors", async mode => {
    const body = mode === "oversize" ? "x".repeat(4_097) : JSON.stringify({ detail: mode === "old-service" ? "private error" : { code: "private token" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 502 })));
    const source = JSON.parse(readFileSync(new URL("../reader-ai/fixtures/reader-source-v1.json", import.meta.url), "utf8")).response as ReaderSourceResponse;
    await expect(new HttpAskArdenClient("http://ai.example.test", "test").summarizeReaderSource(source))
      .rejects.toMatchObject({ code: "AI_SERVICE_HTTP_502" });
  });
  it("applies reader-only deadlines without changing general chat timeouts", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(golden.retrievalResponse)).mockResolvedValueOnce(Response.json(golden.generationResponse))
      .mockResolvedValueOnce(Response.json(golden.retrievalResponse));
    vi.stubGlobal("fetch", fetch); const timeout = vi.spyOn(AbortSignal, "timeout");
    const client = new HttpAskArdenClient("http://ai.example.test", "test-only", 9_999);
    await client.retrieve({ ...golden.retrievalRequest, purpose: "READER_QUESTION", history: [] });
    await client.generate({ ...golden.generationRequest, purpose: "READER_QUESTION", history: [] });
    await client.retrieve(golden.retrievalRequest);
    expect(timeout.mock.calls.map(([value]) => value)).toEqual([75_000, 125_000, 9_999]);
    expect(JSON.parse(fetch.mock.calls[0][1].body).purpose).toBe("READER_QUESTION");
  });
  it("uses the additive provider-free reader route with service authentication", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../reader-ai/fixtures/reader-source-v1.json", import.meta.url), "utf8")) as { request: ReaderSourceRequest; response: unknown };
    const fetch = vi.fn().mockResolvedValue(Response.json(fixture.response));
    vi.stubGlobal("fetch", fetch);
    expect(await new HttpAskArdenClient("http://ai.example.test", "test-only").prepareReaderSource(fixture.request)).toEqual(fixture.response);
    expect(String(fetch.mock.calls[0][0])).toBe("http://ai.example.test/v1/reader-sources");
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer test-only");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(fixture.request);
  });
  it("forwards writing text only to the authenticated internal v1 route with a bounded deadline", async () => {
    const input = { contractVersion: 1, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      action: "IMPROVE", scope: "SELECTION", text: "A sentence." };
    const output = { ...input, status: "CHANGED", text: "A better sentence.", sourceQuote: "" };
    const fetch = vi.fn().mockResolvedValue(Response.json(output));
    vi.stubGlobal("fetch", fetch);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    expect(await new HttpAskArdenClient("http://ai.example.test", "test-only").writing(input)).toEqual(output);
    expect(String(fetch.mock.calls[0][0])).toBe("http://ai.example.test/v1/writing-actions");
    expect(fetch.mock.calls[0][1].headers.authorization).toBe("Bearer test-only");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
    expect(timeout).toHaveBeenCalledWith(65_000);
  });
  it("uses separate authenticated retrieval/generation routes without an old-answer fallback", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(golden.retrievalResponse))
      .mockResolvedValueOnce(Response.json(golden.generationResponse));
    vi.stubGlobal("fetch", fetch);
    const client = new HttpAskArdenClient("http://ai.example.test", "synthetic-test-token");
    await client.retrieve(golden.retrievalRequest); await client.generate(golden.generationRequest);
    expect(fetch.mock.calls.map(call => String(call[0]))).toEqual(["http://ai.example.test/v2/retrievals", "http://ai.example.test/v2/generations"]);
    expect(fetch.mock.calls[0]![1].headers.authorization).toBe("Bearer synthetic-test-token");
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).toEqual(golden.generationRequest);
  });
  it("fails closed on an unavailable v2 service instead of falling back to one-call generation", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("missing", { status: 404 })); vi.stubGlobal("fetch", fetch);
    await expect(new HttpAskArdenClient("http://ai.example.test", "test").retrieve(golden.retrievalRequest))
      .rejects.toMatchObject({ code: "AI_SERVICE_HTTP_404" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds streamed bodies and rejects malformed service data", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array(2 * 1024 * 1024 + 1)))
      .mockResolvedValueOnce(new Response("not json")).mockResolvedValueOnce(Response.json({ contractVersion: 1 }));
    vi.stubGlobal("fetch", fetch);
    const client = new HttpAskArdenClient("http://ai.example.test", "test");
    await expect(client.retrieve(golden.retrievalRequest)).rejects.toMatchObject({ code: "AI_ANSWER_TOO_LARGE" });
    await expect(client.retrieve(golden.retrievalRequest)).rejects.toMatchObject({ code: "AI_ANSWER_INVALID_JSON" });
    await expect(client.retrieve(golden.retrievalRequest)).rejects.toMatchObject({ code: "INVALID_EVIDENCE" });
  });
});

describe("additive v3 HTTP adapter", () => {
  it("posts GenerationV3Request to /v3/generations with 120_000 ms timeout and parses golden response", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(goldenV3.generationV3Response));
    vi.stubGlobal("fetch", fetch);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const client = new HttpAskArdenClient("http://ai.example.test", "synthetic-v3-token", 9_999);

    const result = await client.generateV3(goldenV3.generationV3Request);
    expect(result).toEqual({
      ...(goldenV3.generationV3Response as Record<string, unknown>),
      usageContractVersion: 1,
      usageEvents: [incompleteUsageMarker(goldenV3.generationV3Request.requestId, "CHAT_GENERATION")],
    });
    expect(String(fetch.mock.calls[0]![0])).toBe("http://ai.example.test/v3/generations");
    expect(fetch.mock.calls[0]![1].headers.authorization).toBe("Bearer synthetic-v3-token");
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual(goldenV3.generationV3Request);
    expect(timeout).toHaveBeenCalledWith(120_000);
  });

  it("passes malformed uiSurface through raw when uiSurfaceStatus is GENERATED without throwing INVALID_EVIDENCE", () => {
    const malformed = {
      ...(goldenV3.generationV3Response as Record<string, unknown>),
      uiSurface: { schemaVersion: 99, nodes: "corrupted", unexpected: true },
      uiSurfaceStatus: "GENERATED",
    };
    const parsed = parseGenerationV3Response(malformed, goldenV3.generationV3Request);
    expect(parsed.status).toBe("ANSWERED");
    expect(parsed.uiSurfaceStatus).toBe("GENERATED");
    expect(parsed.uiSurface).toEqual({ schemaVersion: 99, nodes: "corrupted", unexpected: true });
  });

  it.each(["OMITTED_INVALID", "DISABLED"] as const)(
    "normalizes uiSurface to null for non-GENERATED status %s without failing chat delivery",
    (uiSurfaceStatus) => {
      const response = {
        ...(goldenV3.generationV3Response as Record<string, unknown>),
        uiSurface: null,
        uiSurfaceStatus,
      };
      const parsed = parseGenerationV3Response(response, goldenV3.generationV3Request);
      expect(parsed.uiSurfaceStatus).toBe(uiSurfaceStatus);
      expect(parsed.uiSurface).toBeNull();
    },
  );

  it("accepts INSUFFICIENT_EVIDENCE with OMITTED_INSUFFICIENT and null uiSurface", () => {
    const response = {
      contractVersion: 3,
      requestId: goldenV3.generationV3Request.requestId,
      status: "INSUFFICIENT_EVIDENCE",
      answer: "No authorized policy answers that question.",
      citations: [],
      usedEvidence: [goldenV3.generationV3Request.evidence[0]!.chunkId],
      uiSurface: null,
      uiSurfaceStatus: "OMITTED_INSUFFICIENT",
    };
    const parsed = parseGenerationV3Response(response, goldenV3.generationV3Request);
    expect(parsed).toEqual({
      ...response, usageContractVersion: 1,
      usageEvents: [incompleteUsageMarker(response.requestId, "CHAT_GENERATION")],
    });
  });

  it("rejects invalid contractVersion, unknown uiSurfaceStatus, extra keys, forged quotes, or undeclared usedEvidence", () => {
    const base = goldenV3.generationV3Response as Record<string, unknown>;
    const badCases = [
      { ...base, contractVersion: 2 },
      { ...base, uiSurfaceStatus: "BOGUS" },
      { ...base, extra: true },
      { ...base, citations: [{ chunkId: goldenV3.generationV3Request.evidence[0]!.chunkId, quote: "not verbatim" }] },
      { ...base, usedEvidence: [] },
      { ...base, answer: "a".repeat(12_001) },
    ];
    for (const candidate of badCases) {
      expect(() => parseGenerationV3Response(candidate, goldenV3.generationV3Request)).toThrow("INVALID_EVIDENCE");
    }
  });
});
