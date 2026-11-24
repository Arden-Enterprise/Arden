import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArdenDataRepository } from "../db/repository.js";
import { registerNotificationRoutes } from "./routes.js";
import type { NotificationStore } from "./store.js";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const notificationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reviewId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ownedSubmissionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const sharedPublicationId = "abababab-abab-4aba-8aba-abababababab";
const userId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("notification routes", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.restoreAllMocks(); });

  function makeApp(input: { reviewResourceIds?: string[]; reviewIds?: string[]; ownedSubmissionIds?: string[];
    readablePublicationIds?: string[];
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
      listReviewRequestResourceIds: vi.fn(async () => input.reviewResourceIds ?? [reviewId]),
      list,
      markRead: vi.fn(async (_user, _organization, id) => id === notificationId),
      markAllRead: vi.fn(async () => 2),
    };
    const repository = {
      listAssignedReviews: vi.fn(async () => (input.reviewIds ?? [reviewId]).map(submissionId => ({ submissionId } as never))),
      listAssignedReviewsForSubmissions: vi.fn(async (_userId, _organizationId, submissionIds: readonly string[]) =>
        (input.reviewIds ?? [reviewId]).filter(submissionId => submissionIds.includes(submissionId))
          .map(submissionId => ({ submissionId } as never))),
      listKnowledgeSubmissions: vi.fn(async () => (input.ownedSubmissionIds ?? [ownedSubmissionId]).map(id => ({ id } as never))),
      listOwnedKnowledgeSubmissionIds: vi.fn(async (_userId, _organizationId, submissionIds: readonly string[]) =>
        (input.ownedSubmissionIds ?? [ownedSubmissionId]).filter(id => submissionIds.includes(id))),
      listReadableCurrentPublicationIds: vi.fn(async (_userId, _organizationId, publishedVersionIds: readonly string[]) =>
        (input.readablePublicationIds ?? [sharedPublicationId]).filter(id => publishedVersionIds.includes(id))),
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

  it("shows renewal notices only while the member is still responsible for the document (0032)", async () => {
    const documentId = "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2", goneId = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
    const { app, repository } = makeApp({ list: async () => ({ unreadCount: 3, nextCursor: null, items: [
      { id: "21212121-2121-4212-8212-212121212121", type: "PUBLICATION_EXPIRING", resourceType: "DOCUMENT", resourceId: documentId,
        publicationTitle: "Travel policy", expiresOn: "2026-12-01", createdAt: "2026-11-24T10:00:00.000Z", readAt: null },
      { id: "31313131-3131-4313-8313-313131313131", type: "PUBLICATION_RENEWAL_ON_BEHALF", resourceType: "DOCUMENT",
        resourceId: documentId, publicationTitle: "Travel policy", sharedByName: "Blake Reviewer", requestReason: "Still valid",
        createdAt: "2026-11-24T09:00:00.000Z", readAt: null },
      { id: "41414141-4141-4414-8414-414141414141", type: "PUBLICATION_EXPIRING", resourceType: "DOCUMENT", resourceId: goneId,
        publicationTitle: "Secret plan", expiresOn: "2026-12-02", createdAt: "2026-11-24T08:00:00.000Z", readAt: null },
    ] }) });
    (repository as unknown as Record<string, unknown>).listPublicationRenewalState = vi.fn(async () => [{ documentId }]);
    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications`);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({ message: "“Travel policy” expires on 2026-12-01. Renew it to keep it visible to readers.",
        target: { view: "knowledge" } }),
      expect.objectContaining({ message: "Blake Reviewer asked to renew “Travel policy” on your behalf: Still valid" }),
      expect.objectContaining({ message: "This notification's item is no longer available." }),
    ]);
    expect(JSON.stringify(response.json())).not.toContain("Secret plan");
  });

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
    expect(repository.listAssignedReviewsForSubmissions).toHaveBeenCalledWith(userId, organizationId, [reviewId]);
    expect(repository.listAssignedReviews).not.toHaveBeenCalled();
    expect(list.mock.calls[0]?.[2]).toMatchObject({ unreadOnly: true, visibleReviewIds: [reviewId] });
    expect(repository.listKnowledgeSubmissions).not.toHaveBeenCalled();
    expect(repository.listOwnedKnowledgeSubmissionIds).toHaveBeenCalledWith(userId, organizationId, [ownedSubmissionId]);
  });

  it("keeps author outcome details for a notification resource outside the submissions list limit", async () => {
    const { app, repository } = makeApp({ ownedSubmissionIds: [ownedSubmissionId] });

    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications`);

    expect(response.statusCode).toBe(200);
    expect(repository.listKnowledgeSubmissions).not.toHaveBeenCalled();
    expect(repository.listOwnedKnowledgeSubmissionIds).toHaveBeenCalledWith(userId, organizationId, [ownedSubmissionId]);
    expect(response.json().items).toContainEqual(expect.objectContaining({
      type: "REVIEW_APPROVED", message: "Your knowledge request was approved.", target: { view: "knowledge" },
    }));
  });

  it("checks review permission for notification resources beyond the newest 100 unrelated requests", async () => {
    const olderAuthorizedSubmissionId = reviewId;
    const newerUnrelatedSubmissionIds = Array.from({ length: 100 }, (_, index) =>
      `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
    const reviewResourceIds = [...newerUnrelatedSubmissionIds, olderAuthorizedSubmissionId];
    const { app, list, repository, store } = makeApp({ reviewResourceIds, reviewIds: [olderAuthorizedSubmissionId] });

    const response = await app.inject(`/api/v1/organizations/${organizationId}/notifications`);

    expect(response.statusCode).toBe(200);
    expect(store.listReviewRequestResourceIds).toHaveBeenCalledWith(userId, organizationId, false);
    expect(repository.listAssignedReviewsForSubmissions).toHaveBeenCalledWith(userId, organizationId, reviewResourceIds);
    expect(list.mock.calls[0]?.[2].visibleReviewIds).toEqual([olderAuthorizedSubmissionId]);
    expect(response.json().unreadCount).toBe(2);
    expect(response.json().items[0]).toMatchObject({ target: { view: "review-queue", id: olderAuthorizedSubmissionId } });
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

  it("distinguishes personal and group shares while the actor can read the current publication", async () => {
    const personalShare = { id: "12121212-1212-4121-8121-121212121212", type: "DOCUMENT_SHARED_PERSONAL" as const,
      resourceType: "PUBLICATION" as const, resourceId: sharedPublicationId,
      publicationTitle: "Contract review procedure", sharedByName: "Ava Patel",
      createdAt: "2026-11-22T08:00:00.000Z", readAt: null };
    const groupShare = { ...personalShare, id: "13131313-1313-4131-8131-131313131313", type: "DOCUMENT_SHARED_GROUP" as const };
    const list = vi.fn(async () => ({ items: [personalShare, groupShare], unreadCount: 2, nextCursor: null }));
    const allowed = makeApp({ list, readablePublicationIds: [sharedPublicationId] });
    const response = await allowed.app.inject(`/api/v1/organizations/${organizationId}/notifications`);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      expect.objectContaining({ type: "DOCUMENT_SHARED_PERSONAL",
        message: "Ava Patel shared “Contract review procedure” with you.", target: { view: "knowledge", publicationId: sharedPublicationId } }),
      expect.objectContaining({ type: "DOCUMENT_SHARED_GROUP",
        message: "Ava Patel shared “Contract review procedure” with your group.", target: { view: "knowledge", publicationId: sharedPublicationId } }),
    ]);
    expect(allowed.repository.listReadableCurrentPublicationIds).toHaveBeenCalledWith(userId, organizationId, [sharedPublicationId]);

    const revoked = makeApp({ list, readablePublicationIds: [] });
    const hiddenResponse = await revoked.app.inject(`/api/v1/organizations/${organizationId}/notifications`);
    expect(hiddenResponse.statusCode).toBe(200);
    expect(hiddenResponse.json().items).toHaveLength(2);
    for (const item of hiddenResponse.json().items) {
      expect(item.message).toBe("This notification's item is no longer available.");
      expect(item).not.toHaveProperty("target");
    }
    expect(JSON.stringify(hiddenResponse.json())).not.toContain(sharedPublicationId);
    expect(JSON.stringify(hiddenResponse.json())).not.toContain("Ava Patel");
    expect(JSON.stringify(hiddenResponse.json())).not.toContain("Contract review procedure");
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
