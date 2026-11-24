import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AnswerFeedback } from "../answers/conversation-store.js";

const tokenPattern = "^[0-9a-f-]{36}\\.[0-9]{13}\\.[A-Za-z0-9_-]{43}$";
const tokenAgeMs = 24 * 60 * 60 * 1_000;

/** A capability for an answered question. The signature binds it to the caller without encoding an identity. */
export function privateFeedbackTickets(key: Buffer, clock = Date.now) {
  const sign = (payload: string, userId: string, organizationId: string) =>
    createHmac("sha256", key).update(`private-feedback-v1:${userId}:${organizationId}:${payload}`).digest();
  return {
    issue(userId: string, organizationId: string) {
      const payload = `${randomUUID()}.${clock() + tokenAgeMs}`;
      return `${payload}.${sign(payload, userId, organizationId).toString("base64url")}`;
    },
    verify(token: string, userId: string, organizationId: string): string | null {
      if (!new RegExp(tokenPattern).test(token)) return null;
      const [voteKey, expiry, signature] = token.split(".") as [string, string, string];
      if (Number(expiry) <= clock()) return null;
      const actual = Buffer.from(signature, "base64url");
      const expected = sign(`${voteKey}.${expiry}`, userId, organizationId);
      return actual.length === expected.length && timingSafeEqual(actual, expected) ? voteKey : null;
    },
  };
}

type FeedbackWriter = (userId: string, organizationId: string, voteKey: string, feedback: AnswerFeedback) => Promise<boolean>;

export function registerPrivateFeedbackRoute(app: FastifyInstance, write: FeedbackWriter | undefined,
  actor: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>,
  uuidPattern: string, enabledOrganizations: ReadonlySet<string>, tickets: ReturnType<typeof privateFeedbackTickets>) {
  app.put<{ Params: { organizationId: string }; Body: { token: string; feedback: AnswerFeedback } }>(
    "/api/v1/organizations/:organizationId/ai/private-feedback", {
      onRequest: async (_request, reply) => { reply.header("Cache-Control", "no-store"); },
      schema: {
        params: { type: "object", required: ["organizationId"], properties: {
          organizationId: { type: "string", pattern: uuidPattern },
        } },
        querystring: { type: "object", additionalProperties: false, properties: {} },
        body: { type: "object", required: ["token", "feedback"], additionalProperties: false, properties: {
          token: { type: "string", pattern: tokenPattern }, feedback: { enum: ["GOOD", "BAD", null] },
        } },
      },
    }, async (request, reply) => {
      const context = await actor(request, reply);
      if (!context) return;
      const { organizationId } = request.params;
      const { token, feedback } = request.body;
      const voteKey = enabledOrganizations.has(organizationId) ? tickets.verify(token, context.userId, organizationId) : null;
      const unavailable = () => reply.code(404).send({ error: { code: "PRIVATE_FEEDBACK_UNAVAILABLE",
        message: "Feedback is unavailable for this answer." } });
      if (!voteKey) return unavailable();
      try {
        if (!write) throw new Error("Private feedback store unavailable");
        if (!await write(context.userId, organizationId, voteKey, feedback)) return unavailable();
        return { feedback };
      } catch {
        request.log.warn({ requestId: request.id }, "Private feedback could not be saved");
        return reply.code(503).send({ error: { code: "PRIVATE_FEEDBACK_WRITE_FAILED", message: "Feedback could not be saved." } });
      }
    });
}
