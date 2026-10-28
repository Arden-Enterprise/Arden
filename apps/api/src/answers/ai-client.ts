import { parseAiAnswerResponse, type AiAnswerRequest, type AiAnswerResponse } from "./contracts.js";

const maxResponseBytes = 2 * 1024 * 1024;

export interface AskArdenClient {
  answer(request: AiAnswerRequest): Promise<AiAnswerResponse>;
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
}
