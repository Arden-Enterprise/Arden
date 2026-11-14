import { parseAiAnswerResponse, type AiAnswerRequest, type AiAnswerResponse } from "./contracts.js";
import type { ReaderSourceRequest, ReaderSourceResponse } from "../reader-ai/contracts.js";
import { parseGenerationResponse, parseRetrievalResponse, type GenerationRequest, type GenerationResponse,
  type RetrievalRequest, type RetrievalResponse } from "./governed-contracts.js";

const maxResponseBytes = 2 * 1024 * 1024;

export interface AskArdenClient {
  answer(request: AiAnswerRequest): Promise<AiAnswerResponse>;
  retrieve(request: RetrievalRequest): Promise<RetrievalResponse>;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}

export class ArdenAiAnswerError extends Error {
  constructor(readonly code: string) { super(code); }
}

export class HttpAskArdenClient implements AskArdenClient {
  private readonly endpoint: URL;

  constructor(baseUrl: string, private readonly serviceToken: string, private readonly timeoutMs = 90_000) {
    const parsed = new URL(baseUrl);
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:") || parsed.username || parsed.password
      || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
      throw new Error("ARDEN_AI_URL must be an HTTP(S) origin without credentials or a path");
    }
    if (!serviceToken) throw new Error("ARDEN_AI_SERVICE_TOKEN is required");
    this.endpoint = new URL("/v1/answers", parsed);
  }

  async answer(request: AiAnswerRequest): Promise<AiAnswerResponse> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.serviceToken}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ArdenAiAnswerError("AI_SERVICE_UNAVAILABLE");
    }
    if (!response.ok) throw new ArdenAiAnswerError(`AI_SERVICE_HTTP_${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > maxResponseBytes) throw new ArdenAiAnswerError("AI_ANSWER_TOO_LARGE");
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxResponseBytes) throw new ArdenAiAnswerError("AI_ANSWER_TOO_LARGE");
    let parsed: unknown;
    try { parsed = JSON.parse(body); }
    catch { throw new ArdenAiAnswerError("AI_ANSWER_INVALID_JSON"); }
    return parseAiAnswerResponse(parsed, request);
  }

  async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    return parseRetrievalResponse(await this.post("/v2/retrievals", request, maxResponseBytes,
      request.purpose === "READER_QUESTION" ? 75_000 : this.timeoutMs), request.requestId);
  }

  async prepareReaderSource(request: ReaderSourceRequest): Promise<unknown> {
    return this.post("/v1/reader-sources", request, 8 * 1024 * 1024);
  }

  async summarizeReaderSource(source: ReaderSourceResponse): Promise<unknown> {
    return this.post("/v1/reader-summaries", source, maxResponseBytes, 200_000);
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    return parseGenerationResponse(await this.post("/v2/generations", request, maxResponseBytes,
      request.purpose === "READER_QUESTION" ? 125_000 : this.timeoutMs), request);
  }

  private async post(path: string, payload: unknown, responseLimit = maxResponseBytes, timeoutMs = this.timeoutMs): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.endpoint), { method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.serviceToken}` },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new ArdenAiAnswerError(path === "/v1/reader-summaries" && error instanceof Error && error.name === "TimeoutError"
        ? "AI_SUMMARY_TIMEOUT" : "AI_SERVICE_UNAVAILABLE");
    }
    if (!response.ok) {
      if (path === "/v1/reader-summaries" && response.status === 502) {
        const code = await summaryFailureCode(response);
        if (code) throw new ArdenAiAnswerError(`AI_SUMMARY_${code}`);
      }
      await response.body?.cancel().catch(() => undefined);
      throw new ArdenAiAnswerError(`AI_SERVICE_HTTP_${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ArdenAiAnswerError("AI_ANSWER_EMPTY");
    let bytes = 0;
    const parts: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > responseLimit) throw new ArdenAiAnswerError("AI_ANSWER_TOO_LARGE");
        parts.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown; }
    catch { throw new ArdenAiAnswerError("AI_ANSWER_INVALID_JSON"); }
  }
}

/** Read only a tiny, closed error-code envelope. Never surface provider messages. */
async function summaryFailureCode(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 4_096) return null;
      parts.push(part.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (typeof value !== "object" || value === null || !("detail" in value)
      || typeof value.detail !== "object" || value.detail === null || !("code" in value.detail)) return null;
    const code = value.detail.code;
    return typeof code === "string" && ["TIMEOUT", "PROVIDER_BUSY", "PROVIDER_AUTH", "INVALID_OUTPUT", "UNAVAILABLE"].includes(code) ? code : null;
  } catch { return null; }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
