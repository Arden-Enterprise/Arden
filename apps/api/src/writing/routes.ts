import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ArdenAiAnswerError, type AskArdenClient } from "../answers/ai-client.js";
import type { ArdenDataRepository } from "../db/repository.js";
import { ReaderAdmission } from "../reader-ai/admission.js";
import { ReaderSummaryError } from "../reader-ai/summary-contracts.js";

type Action = "IMPROVE" | "REFORMAT" | "EXPLAIN";
type Scope = "SELECTION" | "PAGE";
type Body = { requestId: string; action: Action; scope: Scope; text: string };
type Result = { contractVersion: 1; requestId: string; action: Action;
  status: "CHANGED" | "UNCHANGED" | "EXPLAINED"; text: string; sourceQuote: string };

const protectedContent = /```[\s\S]*?```|`[^`\n]+`|!?\[[^\]]*\]\([^\n)]*\)|https?:\/\/[^\s)]+/g;
const protectedSegments = (text: string) => text.match(protectedContent) ?? [];
const reformatSource = (text: string) => text.split(/\r\n|\n|\r/).filter(line => line.trim())
  .map(line => line.replace(/^#{1,3} +/, "").trim()).join(" ").replace(/\s+/g, " ").trim();

function validResult(value: unknown, input: Body): value is Result {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return Object.keys(result).sort().join() === "action,contractVersion,requestId,sourceQuote,status,text"
    && result.contractVersion === 1 && result.requestId === input.requestId && result.action === input.action
    && ["CHANGED", "UNCHANGED", "EXPLAINED"].includes(String(result.status))
    && (input.action === "EXPLAIN") === (result.status === "EXPLAINED")
    && typeof result.text === "string" && Boolean(result.text.trim()) && result.text.length <= 24_000
    && typeof result.sourceQuote === "string" && result.sourceQuote.length <= 300
    && (input.action !== "EXPLAIN" || result.text.length <= 1_200)
    && (result.status !== "UNCHANGED" || result.text.length <= 240)
    && (input.action !== "EXPLAIN" || input.scope !== "PAGE"
      || (Boolean(result.sourceQuote) && input.text.includes(result.sourceQuote as string)))
    && ((input.action === "EXPLAIN" && input.scope === "PAGE") || result.sourceQuote === "")
    && (result.status !== "CHANGED" || (result.text !== input.text
      && JSON.stringify(protectedSegments(result.text as string)) === JSON.stringify(protectedSegments(input.text))
      && (input.action !== "REFORMAT" || reformatSource(result.text as string) === reformatSource(input.text))));
}

export function registerWritingRoutes(app: FastifyInstance,
  repository: Pick<ArdenDataRepository, "requireActiveMembership">, ai: Pick<AskArdenClient, "writing"> | null,
  actor: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>,
  uuidPattern: string, enabledOrganizations: ReadonlySet<string>) {
  const admission = new ReaderAdmission(Date.now, 10_000);
  const uuid = { type: "string", pattern: uuidPattern };
  app.post<{ Params: { organizationId: string }; Body: Body }>("/api/v1/organizations/:organizationId/ai/writing-actions", {
    onRequest: async (_request, reply) => { reply.header("Cache-Control", "no-store"); },
    schema: {
      params: { type: "object", required: ["organizationId"], additionalProperties: false, properties: { organizationId: uuid } },
      querystring: { type: "object", additionalProperties: false, properties: {} },
      body: { type: "object", additionalProperties: false, required: ["requestId", "action", "scope", "text"], properties: {
        requestId: uuid, action: { type: "string", enum: ["IMPROVE", "REFORMAT", "EXPLAIN"] },
        scope: { type: "string", enum: ["SELECTION", "PAGE"] },
        text: { type: "string", minLength: 1, maxLength: 12_000, pattern: "\\S" },
      } },
    },
  }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    const { organizationId } = request.params;
    const fail = (status: number, code: string, message: string) =>
      reply.code(status).send({ error: { code, message, requestId: request.id } });
    try {
      if (!await repository.requireActiveMembership(context.userId, organizationId)) {
        return fail(404, "RESOURCE_NOT_AVAILABLE", "This organization is unavailable.");
      }
      // Client supplied text may come from a private note. Require the existing organization opt-in for every
      // writing request because Core cannot safely infer the provenance of arbitrary text from the renderer.
      if (!enabledOrganizations.has(organizationId)) {
        return fail(503, "WRITING_AI_DISABLED", "AI writing is not enabled for this organization.");
      }
      if (!ai?.writing) return fail(503, "WRITING_UNAVAILABLE", "Writing assistant is unavailable.");
      const lease = admission.reserve(context.userId, organizationId, "writing");
      try {
        lease.dispatch();
        const result = await ai.writing({ contractVersion: 1, ...request.body });
        if (!await repository.requireActiveMembership(context.userId, organizationId)) {
          return fail(409, "ACCESS_CHANGED", "Your access changed. Try again.");
        }
        if (!validResult(result, request.body)) throw new Error("InvalidWritingResponse");
        return result;
      } finally { lease.release(); }
    } catch (error) {
      if (error instanceof ReaderSummaryError && error.code === "BUSY") {
        reply.header("Retry-After", String(error.retryAfterSeconds ?? 10));
        return fail(429, "WRITING_BUSY", "Please wait before trying again.");
      }
      if (error instanceof ArdenAiAnswerError && error.code === "AI_SERVICE_HTTP_422") {
        return fail(422, "WRITING_UNSUPPORTED", "This text cannot be processed here.");
      }
      request.log.warn({ requestId: request.id, errorType: error instanceof Error ? error.name : "Unknown" }, "Writing action failed");
      return fail(503, "WRITING_UNAVAILABLE", "Writing assistant is unavailable.");
    }
  });
}
