import type { IndexGenerationJob, IndexGenerationManifest, IndexGenerationRequest } from "./contracts.js";
import { parseIndexGenerationManifest } from "./contracts.js";

const maxResponseBytes = 8 * 1024 * 1024;

export interface IndexGenerationClient {
  index(request: IndexGenerationRequest, job: IndexGenerationJob): Promise<IndexGenerationManifest>;
}

export class ArdenAiRequestError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
  }
}

export class HttpArdenAiClient implements IndexGenerationClient {
  private readonly endpoint: URL;

  constructor(baseUrl: string, private readonly serviceToken: string, private readonly timeoutMs = 120_000) {
    const parsed = new URL(baseUrl);
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password
      || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname !== "")) {
      throw new Error("ARDEN_AI_URL must be an HTTP(S) origin without credentials or a path");
    }
    if (!serviceToken) throw new Error("ARDEN_AI_SERVICE_TOKEN is required");
    this.endpoint = new URL("/v1/index-generations", parsed);
  }

  async index(request: IndexGenerationRequest, job: IndexGenerationJob): Promise<IndexGenerationManifest> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.serviceToken}` },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ArdenAiRequestError("AI_SERVICE_UNAVAILABLE", true);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
        || response.status === 401 || response.status === 403;
      throw new ArdenAiRequestError(`AI_SERVICE_HTTP_${response.status}`, retryable);
    }
    const length = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > maxResponseBytes) {
      throw new ArdenAiRequestError("AI_MANIFEST_TOO_LARGE", false);
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > maxResponseBytes) {
      throw new ArdenAiRequestError("AI_MANIFEST_TOO_LARGE", false);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(body); }
    catch { throw new ArdenAiRequestError("AI_MANIFEST_INVALID_JSON", false); }
    return parseIndexGenerationManifest(parsed, job);
  }
}
