import { randomUUID } from "node:crypto";
import { CONTEXT_BASKET_MAX_DOCUMENTS, type AnswerScopeFilter } from "@arden/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ArdenDataRepository } from "../db/repository.js";
import type { AskArdenClient } from "./ai-client.js";
import type { AnswerFeedback } from "./conversation-store.js";
import { GovernedAnswering } from "./governed-answering.js";
import { GovernedAnswerError } from "./governed-contracts.js";

type Actor = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;
type Params = { organizationId: string; conversationId: string };
type ConversationQuery = { limit?: number; beforeSequence?: number };
type Body = { query: string; conversationId?: string; requestId?: string; expectedRevision?: number; scopeFilter?: AnswerScopeFilter };
export function registerAnswerRoutes(app: FastifyInstance, repository: ArdenDataRepository, ai: AskArdenClient | null,
  actor: Actor, uuidPattern: string, options: { useUiSurfaceV3?: boolean } = {}): void {
  const base = "/api/v1/organizations/:organizationId/ai";
  const usageFailure = (operation: string) => (error: unknown) => app.log.warn({ operation,
    errorType: error instanceof Error ? error.name : "Unknown" }, "AI telemetry write failed");
  const engine = new GovernedAnswering(repository, ai, {
    useUiSurfaceV3: options.useUiSurfaceV3,
    onUsageFailure: usageFailure("CHAT_USAGE"),
    onResultFailure: usageFailure("CHAT_RESULT"),
    onSurfaceFallback: (fallbackReason) => app.log.info({ fallbackReason }, "UiSurface degraded to fallback"),
  });
  const params = { type: "object", required: ["organizationId"], additionalProperties: false,
    properties: { organizationId: { type: "string", pattern: uuidPattern } } };
  const fail = (reply: FastifyReply, error: unknown, request: FastifyRequest) => {
    const code = error instanceof GovernedAnswerError ? error.code : "UNAVAILABLE";
    const status = code === "NOT_FOUND" ? 404 : code === "CONFLICT" || code === "ACCESS_CHANGED" ? 409 : 503;
    const message = code === "NOT_FOUND" ? "This conversation is unavailable."
      : code === "CONFLICT" ? "This conversation changed. Reload and try again."
      : code === "ACCESS_CHANGED" ? "Knowledge access changed. Please ask again."
      : "Ask Arden is temporarily unavailable.";
    if (status === 503) request.log.warn({ requestId: request.id, errorType: error instanceof Error ? error.name : "Unknown" }, "Governed answer failed");
    return reply.code(status).send({ error: { code: code === "ACCESS_CHANGED" ? "KNOWLEDGE_ACCESS_CHANGED"
      : code === "CONFLICT" ? "CONVERSATION_CONFLICT" : code === "NOT_FOUND" ? "RESOURCE_NOT_AVAILABLE" : "AI_UNAVAILABLE",
      message, requestId: request.id } });
  };
  app.post<{ Params: Params; Body: Body }>(`${base}/answers`, { schema: { params, body: {
    type: "object", required: ["query"], additionalProperties: false, properties: {
      query: { type: "string", minLength: 1, maxLength: 4_000 },
      conversationId: { type: "string", pattern: uuidPattern }, requestId: { type: "string", pattern: uuidPattern },
      expectedRevision: { type: "integer", minimum: 0, maximum: 1_000_000 },
      scopeFilter: { type: "object", required: ["documentIds"], additionalProperties: false, properties: {
        documentIds: { type: "array", minItems: 1, maxItems: CONTEXT_BASKET_MAX_DOCUMENTS, uniqueItems: true,
          items: { type: "string", pattern: uuidPattern } },
      } },
    } } } }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    reply.header("Cache-Control", "no-store");
    const query = request.body.query.trim();
    if (!query || (request.body.conversationId && request.body.expectedRevision === undefined)) {
      return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Enter a question and current conversation revision.", requestId: request.id } });
    }
    try {
      const requestId = request.body.requestId ?? randomUUID();
      const answer = await engine.answer(context.userId, request.params.organizationId, { query,
        conversationId: request.body.conversationId ?? randomUUID(), requestId,
        expectedRevision: request.body.expectedRevision ?? 0, scopeFilter: request.body.scopeFilter });
      return { ...answer, requestId };
    } catch (error) { return fail(reply, error, request); }
  });
  app.post<{ Params: Params; Body: { requestId: string; rating: "POSITIVE" | "NEGATIVE" } }>(`${base}/feedback`, {
    schema: { params, body: { type: "object", additionalProperties: false, required: ["requestId", "rating"],
      properties: { requestId: { type: "string", pattern: uuidPattern }, rating: { type: "string", enum: ["POSITIVE", "NEGATIVE"] } } } },
  }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    reply.header("Cache-Control", "no-store");
    try {
      const saved = await repository.submitAiAnswerFeedback(context.userId, request.params.organizationId,
        request.body.requestId, request.body.rating);
      if (!saved) return reply.code(404).send({ error: { code: "RESOURCE_NOT_AVAILABLE", message: "This answer is unavailable.", requestId: request.id } });
      return reply.code(204).send();
    } catch (error) { return fail(reply, error, request); }
  });
  app.get<{ Params: Params }>(`${base}/conversations`, { schema: { params } }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    reply.header("Cache-Control", "no-store");
    try {
      if (!await repository.requireActiveMembership(context.userId, request.params.organizationId)) throw new GovernedAnswerError("NOT_FOUND");
      if (!repository.conversations) throw new Error("Conversation persistence unavailable");
      return { items: await repository.conversations.list(context.userId, request.params.organizationId) };
    } catch (error) { return fail(reply, error, request); }
  });
  app.get<{ Params: Params; Querystring: ConversationQuery }>(`${base}/conversations/:conversationId`, {
    schema: {
      params: {
        ...params, required: ["organizationId", "conversationId"], properties: {
          ...params.properties, conversationId: { type: "string", pattern: uuidPattern } },
      },
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50 },
          beforeSequence: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
        },
      },
    },
  }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    reply.header("Cache-Control", "no-store");
    try {
      const found = await engine.load(
        context.userId,
        request.params.organizationId,
        request.params.conversationId,
        { limit: request.query.limit, beforeSequence: request.query.beforeSequence },
      );
      if (!found) throw new GovernedAnswerError("NOT_FOUND");
      return found;
    } catch (error) { return fail(reply, error, request); }
  });
  app.put<{ Params: Params & { turnId: string }; Body: { feedback: AnswerFeedback } }>(
    `${base}/conversations/:conversationId/turns/:turnId/feedback`, {
      schema: {
        params: { ...params, required: ["organizationId", "conversationId", "turnId"],
          properties: { ...params.properties, conversationId: { type: "string", pattern: uuidPattern },
            turnId: { type: "string", pattern: uuidPattern } } },
        querystring: { type: "object", additionalProperties: false, properties: {} },
        body: { type: "object", additionalProperties: false, required: ["feedback"],
          properties: { feedback: { enum: ["GOOD", "BAD", null] } } },
      },
    }, async (request, reply) => {
      const context = await actor(request, reply);
      if (!context) return;
      reply.header("Cache-Control", "no-store");
      const { organizationId, conversationId, turnId } = request.params;
      const { feedback } = request.body;
      try {
        if (!repository.conversations) throw new Error("Conversation persistence unavailable");
        if (!await repository.conversations.setFeedback(context.userId, organizationId, conversationId, turnId, feedback)) {
          throw new GovernedAnswerError("NOT_FOUND");
        }
        return { feedback };
      } catch (error) { return fail(reply, error, request); }
    });
}
