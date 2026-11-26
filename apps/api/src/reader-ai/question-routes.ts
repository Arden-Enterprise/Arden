import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ArdenDataRepository } from "../db/repository.js";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import { ArdenAiAnswerError, type AskArdenClient } from "../answers/ai-client.js";
import { ReaderSourcePreparation } from "./source-preparation.js";
import { ReaderSourceError } from "./contracts.js";
import { ReaderSummaryError } from "./summary-contracts.js";
import { ReaderQuestion } from "./question.js";

export function registerReaderQuestionRoutes(app: FastifyInstance,
  repository: Pick<ArdenDataRepository, "getTargetReaderActor" | "getPublishedKnowledge" | "readerSources">,
  storage: Pick<PrivateContentStorage, "read" | "readPdf">, ai: AskArdenClient | null,
  actor: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>, uuidPattern: string) {
  const sources = repository.readerSources ? new ReaderSourcePreparation(repository, repository.readerSources, storage, null) : null;
  const engine = ai && sources ? new ReaderQuestion(sources, ai) : null;
  app.post<{ Params: { organizationId: string; publishedVersionId: string }; Body: { requestId: string; query: string } }>(
    "/api/v1/organizations/:organizationId/knowledge/published/:publishedVersionId/questions", {
      onRequest: async (_request, reply) => { reply.header("Cache-Control", "no-store"); },
      schema: {
        params: { type: "object", additionalProperties: false, required: ["organizationId", "publishedVersionId"],
          properties: { organizationId: { type: "string", pattern: uuidPattern }, publishedVersionId: { type: "string", pattern: uuidPattern } } },
        querystring: { type: "object", additionalProperties: false, properties: {} },
        body: { type: "object", additionalProperties: false, required: ["requestId", "query"], properties: {
          requestId: { type: "string", pattern: uuidPattern }, query: { type: "string", minLength: 1, maxLength: 4_000, pattern: "\\S" },
        } },
      },
    }, async (request, reply) => {
      const context = await actor(request, reply);
      if (!context) return;
      try {
        if (!engine) throw new ReaderSummaryError("UNAVAILABLE");
        return await engine.answer(context.userId, request.params.organizationId, request.params.publishedVersionId,
          request.body.requestId, request.body.query);
      } catch (error) {
        const missing = error instanceof ReaderSourceError && error.code === "NOT_FOUND";
        const unsupported = error instanceof ArdenAiAnswerError && error.code === "AI_SERVICE_HTTP_422";
        const busy = error instanceof ReaderSummaryError && error.code === "BUSY";
        const status = missing ? 404 : unsupported ? 422 : busy ? 429 : 503;
        const retryAfterSeconds = busy ? error.retryAfterSeconds ?? 10 : undefined;
        if (retryAfterSeconds) reply.header("Retry-After", String(retryAfterSeconds));
        if (status === 503) request.log.warn({ requestId: request.id,
          errorType: error instanceof Error ? error.name : "Unknown" }, "Document question failed");
        return reply.code(status).send({ error: {
          code: missing ? "RESOURCE_NOT_AVAILABLE" : unsupported ? "DOCUMENT_QUESTION_UNSUPPORTED" : busy ? "DOCUMENT_QUESTION_BUSY" : "DOCUMENT_QUESTION_UNAVAILABLE",
          ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
          message: missing ? "This document is unavailable." : unsupported ? "This question cannot be answered here."
            : busy ? "Please wait before trying again." : "Document Q&A is unavailable.", requestId: request.id,
        } });
      }
    });
}
