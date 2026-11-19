import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArdenDataRepository } from "../db/repository.js";
import { registerNotificationRoutes } from "./routes.js";
import type { NotificationStore } from "./store.js";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const notificationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reviewId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ownedSubmissionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const userId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("notification routes", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.restoreAllMocks(); });

  function makeApp(input: { reviewIds?: string[]; ownedSubmissionIds?: string[];
    list?: NotificationStore["list"]; realtime?: boolean } = {}) {
    const app = Fastify();
    apps.push(app);
    const list = vi.fn(input.list ?? (async (_user, _organization, options) => {
      const allItems = [
        { id: notificationId, type: "REVIEW_REQUESTED" as const, resourceType: "SUBMISSION" as const,
          resourceId: reviewId, createdAt: "2026-11-19T12:00:00.000Z", readAt: null },
        { id: "11111111-1111-4111-8111-111111111111", type: "REVIEW_APPROVED" as const,
          resourceType: "SUBMISSION" as const, resourceId: ownedSubmissionId,
          createdAt: "2026-11-19T11:00:00.000Z", readAt: null },
      ];
      const items = allItems.filter(item => item.type !== "REVIEW_REQUESTED" || options.visibleReviewIds.includes(item.resourceId));
      return { items, unreadCount: items.length, nextCursor: null };
    }));
    const store: NotificationStore = {
      list,
      markRead: vi.fn(async (_user, _organization, id) => id === notificationId),
      markAllRead: vi.fn(async () => 2),
    };
    const repository = {
      listAssignedReviews: vi.fn(async () => (input.reviewIds ?? [reviewId]).map(submissionId => ({ submissionId } as never))),
      listKnowledgeSubmissions: vi.fn(async () => (input.ownedSubmissionIds ?? [ownedSubmissionId]).map(id => ({ id } as never))),
      requireActiveMembership: vi.fn(async () => ({ organizationId, membershipId: "ffffffff-ffff-4fff-8fff-ffffffffffff", userId })),
    } as unknown as ArdenDataRepository;
    const secret = "ab".repeat(32);
    registerNotificationRoutes(app, {
      repository, store,
      requestActor: async () => ({ userId, email: "member@example.test", fullName: null, emailVerified: true }),
      realtime: input.realtime ? { endpoint: "https://realtime.example.test/realtime/v1", apiKey: "publishable-key-value",
        signingKey: new TextEncoder().encode(secret), namespace: "staging-blue" } : null,
    });
    return { app, list, store, repository };
  }

  it("returns generic messages and links only items currently visible to the actor", async () => {
    const { app, list, repository } = makeApp();
    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications?unreadOnly=true`);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ unreadCount: 2, items: [
      { id: notificationId, message: "A knowledge item is waiting for your review.",
        target: { view: "review-queue", id: reviewId } },
      { message: "Your knowledge request was approved.", target: { view: "knowledge" } },
    ] });
    expect(JSON.stringify(response.json())).not.toContain("resourceId");
    expect(repository.listAssignedReviews).toHaveBeenCalledWith(userId, organizationId);
    expect(list.mock.calls[0]?.[2]).toMatchObject({ unreadOnly: true, visibleReviewIds: [reviewId] });
  });

  it("does not return a review target after current reviewer authority is lost", async () => {
    const { app, list } = makeApp({ reviewIds: [] });
    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications`);
    expect(response.statusCode).toBe(200);
    expect(list.mock.calls[0]?.[2].visibleReviewIds).toEqual([]);
  });

  it("hides an outcome target and specific message after the author loses current ownership access", async () => {
    const { app } = makeApp({ ownedSubmissionIds: [] });
    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications`);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toContainEqual(expect.objectContaining({
      type: "REVIEW_APPROVED", message: "This notification's item is no longer available.",
    }));
    expect(response.json().items.find((item: { type: string }) => item.type === "REVIEW_APPROVED")).not.toHaveProperty("target");
    expect(JSON.stringify(response.json())).not.toContain(ownedSubmissionId);
  });

  it("rejects an invalid page cursor", async () => {
    const { app } = makeApp();
    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications?cursor=invalid`);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_CURSOR");
  });

  it("marks only owned notifications and hides absent or foreign IDs", async () => {
    const { app, store } = makeApp();
    const response = await app.inject({ method: "PATCH", url: `/api/v1/organizations/${organizationId}/notifications/${notificationId}/read` });
    expect(response.statusCode).toBe(204);
    expect(store.markRead).toHaveBeenCalledWith(userId, organizationId, notificationId);
    const unavailable = await app.inject({ method: "PATCH", url: `/api/v1/organizations/${organizationId}/notifications/${reviewId}/read` });
    expect(unavailable.statusCode).toBe(404);
    expect(unavailable.json().error.message).toBe("The notification is unavailable.");
  });

  it("supports read-all and issues a no-store two-minute Realtime credential", async () => {
    const { app, store } = makeApp({ realtime: true });
    const readAll = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/notifications/read-all` });
    expect(readAll.statusCode).toBe(200);
    expect(readAll.json()).toEqual({ updated: 2 });
    expect(store.markAllRead).toHaveBeenCalledWith(userId, organizationId);
    const credential = await app.inject(`/api/v1/organizations/${organizationId}/notifications/realtime-credential`);
    expect(credential.statusCode).toBe(200);
    expect(credential.headers["cache-control"]).toBe("no-store");
    expect(credential.json()).toMatchObject({ topic: `arden-notifications:staging-blue:${organizationId}:ffffffff-ffff-4fff-8fff-ffffffffffff` });
    expect(Date.parse(credential.json().expiresAt)).toBeGreaterThan(Date.now());
  });

  it("fails closed when Realtime is not configured", async () => {
    const { app } = makeApp();
    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications/realtime-credential`);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("REALTIME_UNAVAILABLE");
  });
});
