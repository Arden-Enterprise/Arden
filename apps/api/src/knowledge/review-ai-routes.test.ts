import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { ArdenAiAnswerError } from "../answers/ai-client.js";
import type { ReviewDetail } from "../db/repository.js";
import { registerReviewerAiRoutes } from "./review-ai-routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

function harness(enabled = true, mimeType = "text/plain") {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  apps.push(app);
  const userId = randomUUID(), organizationId = randomUUID(), submissionId = randomUUID();
  const snapshot = { snapshotVersionId: randomUUID(), snapshotContentHash: "a".repeat(64) };
  const detail: ReviewDetail = {
    submission: {
      id: submissionId, draftId: randomUUID(), snapshotVersionId: snapshot.snapshotVersionId, title: "Guide",
      contentHash: snapshot.snapshotContentHash, classification: "INTERNAL", targetScopeType: "ORGANIZATION",
      targetDepartmentId: null, responsibleDepartmentId: randomUUID(), audienceRoleIds: [],
      proposedTargetReaders: null, approvedTargetReaders: null, status: "PENDING_REVIEW",
      publicationState: "NONE", submittedAt: new Date(), publishedVersionId: null, decisionComment: null,
      requestType: "CONTENT", requestReason: null, publicationFailure: null, withdrawal: null,
    },
    submittedByMembershipId: randomUUID(), mimeType, sourceUri: "frozen-source",
    teamTag: null, projectTag: null, proposedReaders: null,
  };
  const assigned = vi.fn(async (actor: string, org: string, submission: string) =>
    actor === userId && org === organizationId && submission === submissionId ? detail : null);
  const storage = {
    read: vi.fn(async () => "Frozen text."),
    readPdf: vi.fn(async () => Buffer.from("%PDF-1.7")),
  };
  const ai = vi.fn(async (payload: unknown): Promise<unknown> => {
    const input = payload as { requestId: string };
    return { contractVersion: 2, requestId: input.requestId, ...snapshot,
      summary: [{ text: "This is a guide.", citation: { excerpt: "Frozen text.", page: mimeType === "text/plain" ? null : 2 },
        additionalCitations: [{ excerpt: "A second passage.", page: mimeType === "text/plain" ? null : 3 }] }],
      checks: [] };
  });
  registerReviewerAiRoutes(app, { getAssignedReview: assigned }, storage, { reviewSubmission: ai },
    async (request, reply) => {
      if (request.headers.authorization === "test") return { userId };
      if (request.headers.authorization === "different-user") return { userId: randomUUID() };
      reply.code(401).send();
      return null;
    }, "^[0-9a-f-]{36}$", new Set(enabled ? [organizationId] : []));
  const path = `/api/v1/organizations/${organizationId}/knowledge/reviews/${submissionId}/ai-review`;
  const run = (options = {}) => app.inject({ method: "POST", url: path, payload: snapshot,
    headers: { authorization: "test" }, ...options });
  return { run, assigned, storage, ai, organizationId, path, snapshot, detail };
}

it("blocks unauthorized, stale, change-request and client-text input before storage or AI", async () => {
  const h = harness();
  expect((await h.run({ headers: {} })).statusCode).toBe(401);
  expect((await h.run({ headers: { authorization: "different-user" } })).statusCode).toBe(404);
  expect((await h.run({ url: h.path.replace(h.organizationId, randomUUID()) })).statusCode).toBe(404);
  expect((await h.run({ payload: { ...h.snapshot, snapshotVersionId: randomUUID() } })).statusCode).toBe(404);
  expect((await h.run({ payload: { ...h.snapshot, snapshotContentHash: "c".repeat(64) } })).statusCode).toBe(404);
  expect((await h.run({ payload: { ...h.snapshot, content: "substitute source" } })).statusCode).toBe(400);
  h.detail.submission.requestType = "READER_CHANGE";
  expect((await h.run()).statusCode).toBe(404);
  expect(h.storage.read).not.toHaveBeenCalled();
  expect(h.ai).not.toHaveBeenCalled();
  const disabled = harness(false);
  expect((await disabled.run()).json()).toMatchObject({ error: { code: "REVIEW_AI_DISABLED" } });
  expect(disabled.storage.read).not.toHaveBeenCalled();
  expect(disabled.ai).not.toHaveBeenCalled();
});

it.each(["text/plain", "application/pdf"])("reviews only the frozen %s snapshot", async mimeType => {
  const h = harness(true, mimeType);
  const result = await h.run();
  expect(result.statusCode).toBe(200);
  expect(result.headers["cache-control"]).toBe("no-store");
  expect(h.assigned).toHaveBeenCalledTimes(3);
  expect(h.ai).toHaveBeenCalledWith({
    contractVersion: 2, requestId: expect.any(String), ...h.snapshot, mimeType,
    ...(mimeType === "text/plain" ? { content: "Frozen text." } : { pdfBase64: Buffer.from("%PDF-1.7").toString("base64") }),
  });
  expect(result.json()).toMatchObject({ ...h.snapshot, summary: [{ additionalCitations: [{ excerpt: "A second passage." }] }], checks: [] });
  expect((await h.run()).statusCode).toBe(429);
});

it("withholds results after authorization changes before or during inference", async () => {
  const early = harness();
  early.storage.read.mockImplementationOnce(async () => {
    early.assigned.mockResolvedValueOnce(null);
    return "Frozen text.";
  });
  expect((await early.run()).statusCode).toBe(404);
  expect(early.ai).not.toHaveBeenCalled();

  const late = harness();
  late.ai.mockImplementationOnce(async () => {
    late.assigned.mockResolvedValueOnce(null);
    return { leaked: "should never appear" };
  });
  const response = await late.run();
  expect(response.statusCode).toBe(404);
  expect(response.body).not.toContain("should never appear");
});

it("rejects unverifiable service results and reports unsupported input separately", async () => {
  const invalid = harness();
  invalid.ai.mockResolvedValueOnce({ decision: "APPROVE", summary: [] });
  expect((await invalid.run()).json()).toMatchObject({ error: { code: "REVIEW_AI_INVALID_RESULT" } });
  const unsupported = harness();
  unsupported.ai.mockRejectedValueOnce(new ArdenAiAnswerError("AI_SERVICE_HTTP_422"));
  expect((await unsupported.run()).statusCode).toBe(422);
});
