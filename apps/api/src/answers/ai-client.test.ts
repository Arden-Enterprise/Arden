import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpAskArdenClient } from "./ai-client.js";
import type { GenerationRequest, RetrievalRequest } from "./governed-contracts.js";
import type { ReaderSourceRequest } from "../reader-ai/contracts.js";

const golden = JSON.parse(readFileSync(new URL("./fixtures/governed-v2.json", import.meta.url), "utf8")) as {
  retrievalRequest: RetrievalRequest; retrievalResponse: unknown; generationRequest: GenerationRequest; generationResponse: unknown };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("paired v2 HTTP adapter", () => {
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
