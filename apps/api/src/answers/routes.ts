import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ArdenDataRepository } from "../db/repository.js";
import type { AskArdenClient } from "./ai-client.js";
import { GovernedAnswering } from "./governed-answering.js";
import { GovernedAnswerError, type VersionScope } from "./governed-contracts.js";

type Actor = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;
type Params = { organizationId: string; conversationId: string };
type Body = { query: string; conversationId?: string; requestId?: string; expectedRevision?: number; versionScope?: VersionScope };
export function registerAnswerRoutes(app: FastifyInstance, repository: ArdenDataRepository, ai: AskArdenClient | null,
  actor: Actor, uuidPattern: string): void {
  const base = "/api/v1/organizations/:organizationId/ai";
  const engine = new GovernedAnswering(repository, ai);
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
      versionScope: { type: "string", enum: ["CURRENT", "UPCOMING", "COMPARE"] },
    } } } }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    reply.header("Cache-Control", "no-store");
    const query = request.body.query.trim();
    if (!query || (request.body.conversationId && request.body.expectedRevision === undefined)) {
      return reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Enter a question and current conversation revision.", requestId: request.id } });
    }
    try {
      return await engine.answer(context.userId, request.params.organizationId, { query,
        conversationId: request.body.conversationId ?? randomUUID(), requestId: request.body.requestId ?? randomUUID(),
        expectedRevision: request.body.expectedRevision ?? 0, versionScope: request.body.versionScope ?? "CURRENT" });
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
  app.get<{ Params: Params }>(`${base}/conversations/:conversationId`, { schema: { params: {
    ...params, required: ["organizationId", "conversationId"], properties: {
      ...params.properties, conversationId: { type: "string", pattern: uuidPattern } },
  } } }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    reply.header("Cache-Control", "no-store");
    try {
      const found = await engine.load(context.userId, request.params.organizationId, request.params.conversationId);
      if (!found) throw new GovernedAnswerError("NOT_FOUND");
      return found;
    } catch (error) { return fail(reply, error, request); }
  });
}
