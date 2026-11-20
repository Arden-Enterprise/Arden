import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ArdenDataRepository } from "../db/repository.js";
import { decodeNotificationCursor, type NotificationType } from "./contracts.js";
import type { NotificationStore } from "./store.js";
import { signNotificationReaderToken, type NotificationRealtimeConfiguration } from "./realtime.js";

const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const messages: Record<NotificationType, string> = {
  REVIEW_REQUESTED: "A knowledge item is waiting for your review.",
  REVIEW_APPROVED: "Your knowledge request was approved.",
  REVIEW_REJECTED: "Your knowledge request was rejected.",
  PUBLICATION_ACTIVE: "Your approved knowledge is now published.",
  PUBLICATION_FAILED: "Your approved knowledge could not be published yet.",
  PRIMARY_DEPARTMENT_CHANGED: "Your primary department was updated.",
  REVIEWER_GRANT_CREATED: "You received a reviewer grant.",
  REVIEWER_GRANT_REVOKED: "A reviewer grant was removed.",
};

export function registerNotificationRoutes(app: FastifyInstance, input: {
  repository: ArdenDataRepository;
  store?: NotificationStore;
  requestActor: (request: FastifyRequest, reply: FastifyReply) => Promise<{
    userId: string; email: string; fullName: string | null; emailVerified: boolean;
  } | null>;
  realtime: NotificationRealtimeConfiguration | null;
}) {
  const { repository, store, realtime } = input;
  app.get<{ Params: { organizationId: string }; Querystring: { cursor?: string; unreadOnly?: boolean; limit?: number } }>(
    "/api/v1/organizations/:organizationId/notifications", {
      schema: {
        params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
        querystring: { type: "object", additionalProperties: false,
          properties: { cursor: { type: "string", maxLength: 180 }, unreadOnly: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 50 } } },
      },
    }, async (request, reply) => {
      const actor = await input.requestActor(request, reply);
      if (!actor) return;
      if (!store) return reply.code(503).send({ error: { code: "NOTIFICATIONS_UNAVAILABLE", message: "Notifications are unavailable." } });
      let cursor;
      try { cursor = decodeNotificationCursor(request.query.cursor); }
      catch { return reply.code(400).send({ error: { code: "INVALID_CURSOR", message: "The notification page cursor is invalid." } }); }
      const unreadOnly = request.query.unreadOnly === true;
      const reviewResourceIds = await store.listReviewRequestResourceIds(actor.userId,
        request.params.organizationId, unreadOnly);
      if (reviewResourceIds === null) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The organization is unavailable." } });
      const visibleReviews = await repository.listAssignedReviewsForSubmissions(actor.userId,
        request.params.organizationId, reviewResourceIds);
      if (visibleReviews === null) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The organization is unavailable." } });
      const visibleReviewIds = visibleReviews.map(item => item.submissionId);
      const page = await store.list(actor.userId, request.params.organizationId, {
        cursor, unreadOnly, limit: request.query.limit ?? 30, visibleReviewIds,
      });
      if (!page) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The organization is unavailable." } });
      const outcomeSubmissionIds = [...new Set(page.items
        .filter(item => ["REVIEW_APPROVED", "REVIEW_REJECTED", "PUBLICATION_ACTIVE", "PUBLICATION_FAILED"].includes(item.type))
        .map(item => item.resourceId))];
      const ownedSubmissionIds = await repository.listOwnedKnowledgeSubmissionIds(actor.userId,
        request.params.organizationId, outcomeSubmissionIds);
      const ownedIds = new Set(ownedSubmissionIds ?? []);
      return reply.header("cache-control", "no-store").send({
        ...page,
        items: page.items.map(item => {
          if (item.type === "REVIEW_REQUESTED") return { id: item.id, type: item.type, message: messages[item.type],
            createdAt: item.createdAt, readAt: item.readAt, target: { view: "review-queue", id: item.resourceId } };
          if (["REVIEW_APPROVED", "REVIEW_REJECTED", "PUBLICATION_ACTIVE", "PUBLICATION_FAILED"].includes(item.type)) {
            const visible = ownedIds.has(item.resourceId);
            return { id: item.id, type: item.type, message: visible ? messages[item.type] : "This notification's item is no longer available.",
              createdAt: item.createdAt, readAt: item.readAt, ...(visible ? { target: { view: "knowledge" } } : {}) };
          }
          return { id: item.id, type: item.type, message: messages[item.type], createdAt: item.createdAt, readAt: item.readAt };
        }),
      });
    });

  app.patch<{ Params: { organizationId: string; notificationId: string } }>(
    "/api/v1/organizations/:organizationId/notifications/:notificationId/read", {
      schema: { params: { type: "object", required: ["organizationId", "notificationId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, notificationId: { type: "string", pattern: uuidPattern } } } },
    }, async (request, reply) => {
      const actor = await input.requestActor(request, reply);
      if (!actor) return;
      if (!store) return reply.code(503).send({ error: { code: "NOTIFICATIONS_UNAVAILABLE", message: "Notifications are unavailable." } });
      const result = await store.markRead(actor.userId, request.params.organizationId, request.params.notificationId);
      if (result === null || result === false) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The notification is unavailable." } });
      return reply.code(204).send();
    });

  app.post<{ Params: { organizationId: string } }>(
    "/api/v1/organizations/:organizationId/notifications/read-all", {
      schema: { params: { type: "object", required: ["organizationId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern } } } },
    }, async (request, reply) => {
      const actor = await input.requestActor(request, reply);
      if (!actor) return;
      if (!store) return reply.code(503).send({ error: { code: "NOTIFICATIONS_UNAVAILABLE", message: "Notifications are unavailable." } });
      const updated = await store.markAllRead(actor.userId, request.params.organizationId);
      if (updated === null) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The organization is unavailable." } });
      return { updated };
    });

  app.get<{ Params: { organizationId: string } }>(
    "/api/v1/organizations/:organizationId/notifications/realtime-credential", {
      schema: { params: { type: "object", required: ["organizationId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern } } } },
    }, async (request, reply) => {
      const actor = await input.requestActor(request, reply);
      if (!actor) return;
      if (!realtime) return reply.code(503).send({ error: { code: "REALTIME_UNAVAILABLE", message: "Notification updates are temporarily unavailable." } });
      const membership = await repository.requireActiveMembership(actor.userId, request.params.organizationId);
      if (!membership) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "The organization is unavailable." } });
      const credential = await signNotificationReaderToken(realtime, { userId: actor.userId,
        organizationId: request.params.organizationId, membershipId: membership.membershipId });
      return reply.header("cache-control", "no-store").send(credential);
    });
}
