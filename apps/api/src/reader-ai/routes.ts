import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ArdenDataRepository } from "../db/repository.js";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import { ArdenAiAnswerError } from "../answers/ai-client.js";
import { ReaderSourceError } from "./contracts.js";
import { ReaderSourcePreparation } from "./source-preparation.js";
import { ReaderSummary, type ReaderAiClient, type SummaryStage } from "./summary.js";
import { ReaderSummaryError } from "./summary-contracts.js";

type Actor = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;
type Params = { organizationId: string; publishedVersionId: string };
export function registerReaderSummaryRoutes(app: FastifyInstance,
  repository: Pick<ArdenDataRepository, "getTargetReaderActor" | "getPublishedKnowledge" | "readerSources">,
  storage: Pick<PrivateContentStorage, "read" | "readPdf">, ai: ReaderAiClient | null, actor: Actor, uuidPattern: string): void {
  const sources = repository.readerSources ? new ReaderSourcePreparation(repository, repository.readerSources, storage, ai) : null;
  const engine = ai && sources ? new ReaderSummary(sources, ai) : null;
  const path = "/api/v1/organizations/:organizationId/knowledge/published/:publishedVersionId/summary";
  const params = { type: "object", additionalProperties: false, required: ["organizationId", "publishedVersionId"],
    properties: { organizationId: { type: "string", pattern: uuidPattern }, publishedVersionId: { type: "string", pattern: uuidPattern } } };
  const noStore = async (_request: FastifyRequest, reply: FastifyReply) => { reply.header("Cache-Control", "no-store"); };
  app.get<{ Params: Params }>(`${path}/access`, { onRequest: noStore,
    preValidation: async (request, reply) => {
      // Fastify does not parse GET payloads: inspect framing as well as parsed body.
      if (request.body !== undefined || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")
        || request.headers["transfer-encoding"] !== undefined) {
        return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Request body is not supported." } });
      }
    }, schema: { params,
    querystring: { type: "object", additionalProperties: false, properties: {} } } }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    try {
      if (!sources) throw new ReaderSummaryError("UNAVAILABLE");
      return await sources.checkAccess(context.userId, request.params.organizationId, request.params.publishedVersionId);
    } catch (error) { return fail(reply, error, request); }
  });
  app.post<{ Params: Params; Body: { requestId?: string } }>(
    path, {
      onRequest: noStore,
      preValidation: async request => { if (request.body === undefined) request.body = {}; },
      schema: { params, querystring: { type: "object", additionalProperties: false, properties: {} },
      body: { type: "object", additionalProperties: false, properties: { requestId: { type: "string", pattern: uuidPattern } } } },
    }, async (request, reply) => {
      const context = await actor(request, reply);
      if (!context) return;
      const started = performance.now(), operationId = request.body?.requestId ?? randomUUID();
      let stage: SummaryStage = "ACCESS";
      let joinedOperationId: string | undefined;
      try {
        if (!engine) throw new ReaderSummaryError("UNAVAILABLE");
        const result = await engine.summarize(context.userId, request.params.organizationId, request.params.publishedVersionId,
          operationId, (value, joined) => { stage = value; joinedOperationId = joined; });
        request.log.info({ operationId, joinedOperationId, stage, code: "SUMMARY_COMPLETED", durationMs: Math.round(performance.now() - started) }, "Reader Summary operation");
        return result;
      } catch (error) { return fail(reply, error, request, { operationId, joinedOperationId, stage, durationMs: Math.round(performance.now() - started) }); }
    });
}

function fail(reply: FastifyReply, error: unknown, request: FastifyRequest,
  diagnostic?: { operationId: string; joinedOperationId?: string; stage: SummaryStage; durationMs: number }) {
  const code = error instanceof ReaderSourceError || error instanceof ReaderSummaryError ? error.code
    : error instanceof ArdenAiAnswerError && error.code === "AI_SERVICE_HTTP_422" ? "UNSUPPORTED" : "UNAVAILABLE";
  const status = code === "NOT_FOUND" ? 404 : code === "UNSUPPORTED" ? 422 : code === "BUSY" ? 429
    : code === "TIMEOUT" ? 504 : code === "INVALID_SUMMARY" ? 502 : 503;
  const reason = error instanceof ReaderSummaryError ? error.reason : undefined;
  const retryAfterSeconds = (error instanceof ReaderSummaryError ? error.retryAfterSeconds : undefined)
    ?? (code === "SOURCE_UNAVAILABLE" ? 5 : status === 429 ? 60 : undefined);
  const publicCode = code === "NOT_FOUND" ? "RESOURCE_NOT_AVAILABLE" : code === "UNSUPPORTED" ? "SUMMARY_UNSUPPORTED"
    : code === "BUSY" ? `SUMMARY_${reason ?? "BUSY"}` : `SUMMARY_${code}`;
  const retryable = status !== 404 && status !== 422 && code !== "PROVIDER_AUTH" && code !== "INVALID_SOURCE";
  if (retryAfterSeconds) reply.header("Retry-After", String(retryAfterSeconds));
  request.log.warn({ ...diagnostic, requestId: request.id, code: publicCode, status, reason, retryAfterSeconds }, "Reader Summary failed");
  return reply.code(status).send({ error: {
    code: publicCode, retryable, ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    message: status === 404 ? "This document is unavailable." : status === 422 ? "Summary is unavailable for this document."
      : status === 429 ? "Please wait before trying again." : "Summary is temporarily unavailable.", requestId: request.id,
  } });
}
