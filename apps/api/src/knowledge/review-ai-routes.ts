import { randomUUID } from "node:crypto";
import { submissionCheckCategories, type SubmissionReviewResult } from "@arden/domain";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ArdenAiAnswerError, type AskArdenClient } from "../answers/ai-client.js";
import type { ArdenDataRepository } from "../db/repository.js";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import { ReaderAdmission } from "../reader-ai/admission.js";
import { ReaderSummaryError } from "../reader-ai/summary-contracts.js";

type Snapshot = { snapshotVersionId: string; snapshotContentHash: string };
type ReviewIdentity = Snapshot & { requestId: string };
type Params = { organizationId: string; submissionId: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): boolean {
  return typeof value === "string" && Boolean(value.trim()) && [...value].length <= max;
}

function reviewResult(value: unknown, expected: ReviewIdentity, pdf: boolean): value is SubmissionReviewResult {
  if (!record(value) || Object.keys(value).sort().join() !==
    "checks,contractVersion,requestId,snapshotContentHash,snapshotVersionId,summary"
    || value.contractVersion !== 1 || value.requestId !== expected.requestId
    || value.snapshotVersionId !== expected.snapshotVersionId || value.snapshotContentHash !== expected.snapshotContentHash
    || !Array.isArray(value.summary) || value.summary.length < 1 || value.summary.length > 3
    || !Array.isArray(value.checks) || value.checks.length > 3) return false;
  const validPoint = (point: unknown, check: boolean) => {
    if (!record(point) || Object.keys(point).sort().join() !== (check ? "category,citation,text" : "citation,text")
      || !boundedText(point.text, 240) || !record(point.citation)
      || Object.keys(point.citation).sort().join() !== "excerpt,page"
      || !boundedText(point.citation.excerpt, 360)) return false;
    const page = point.citation.page;
    return (pdf ? typeof page === "number" && Number.isInteger(page) && page >= 1 && page <= 500 : page === null)
      && (!check || submissionCheckCategories.some(category => category === point.category));
  };
  return value.summary.every(point => validPoint(point, false)) && value.checks.every(point => validPoint(point, true));
}

export function registerReviewerAiRoutes(app: FastifyInstance, repository: Pick<ArdenDataRepository, "getAssignedReview">,
  storage: Pick<PrivateContentStorage, "read" | "readPdf">, ai: Pick<AskArdenClient, "reviewSubmission"> | null,
  actor: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>,
  uuidPattern: string, enabledOrganizations: ReadonlySet<string>) {
  const admission = new ReaderAdmission(Date.now, 10_000);
  const uuid = { type: "string", pattern: uuidPattern };
  app.post<{ Params: Params; Body: Snapshot }>("/api/v1/organizations/:organizationId/knowledge/reviews/:submissionId/ai-review", {
    onRequest: async (_request, reply) => { reply.header("Cache-Control", "no-store"); },
    schema: {
      params: { type: "object", additionalProperties: false, required: ["organizationId", "submissionId"],
        properties: { organizationId: uuid, submissionId: uuid } },
      querystring: { type: "object", additionalProperties: false, properties: {} },
      body: { type: "object", additionalProperties: false, required: ["snapshotVersionId", "snapshotContentHash"],
        properties: { snapshotVersionId: uuid, snapshotContentHash: { type: "string", pattern: "^[0-9a-f]{64}$" } } },
    },
  }, async (request, reply) => {
    const context = await actor(request, reply);
    if (!context) return;
    const { organizationId, submissionId } = request.params;
    const snapshot = request.body;
    const fail = (status: number, code: string, message: string) =>
      reply.code(status).send({ error: { code, message, requestId: request.id } });
    const unavailableReview = () => fail(404, "RESOURCE_NOT_AVAILABLE", "This submission is no longer available for review.");
    const findSnapshot = async () => {
      const detail = await repository.getAssignedReview(context.userId, organizationId, submissionId);
      return detail?.submission.requestType === "CONTENT" && detail.submission.status === "PENDING_REVIEW"
        && detail.submission.snapshotVersionId === snapshot.snapshotVersionId
        && detail.submission.contentHash === snapshot.snapshotContentHash ? detail : null;
    };
    try {
      const detail = await findSnapshot();
      if (!detail) return unavailableReview();
      if (!ai?.reviewSubmission || !enabledOrganizations.has(organizationId)) {
        return fail(503, "REVIEW_AI_DISABLED", "AI review is unavailable for this organization.");
      }
      const { mimeType, sourceUri } = detail;
      if (mimeType !== "text/plain" && mimeType !== "application/pdf") {
        return fail(422, "REVIEW_AI_UNSUPPORTED", "AI review cannot process this submission.");
      }
      const lease = admission.reserve(context.userId, organizationId);
      try {
        const source = mimeType === "application/pdf"
          ? { pdfBase64: (await storage.readPdf(sourceUri, snapshot.snapshotContentHash)).toString("base64") }
          : { content: await storage.read(sourceUri, snapshot.snapshotContentHash) };
        if (!await findSnapshot()) return unavailableReview();
        const identity = { ...snapshot, requestId: randomUUID() };
        lease.dispatch();
        const result = await ai.reviewSubmission({ contractVersion: 1, ...identity, mimeType, ...source });
        if (!await findSnapshot()) return unavailableReview();
        if (!reviewResult(result, identity, mimeType === "application/pdf")) {
          return fail(502, "REVIEW_AI_INVALID_RESULT", "Arden could not verify the AI review. Try again.");
        }
        return result;
      } finally { lease.release(); }
    } catch (error) {
      if (error instanceof ReaderSummaryError && error.code === "BUSY") {
        reply.header("Retry-After", String(error.retryAfterSeconds ?? 10));
        return fail(429, "REVIEW_AI_BUSY", "Please wait a moment before running AI review again.");
      }
      if (error instanceof ArdenAiAnswerError && error.code === "AI_SERVICE_HTTP_422") {
        return fail(422, "REVIEW_AI_UNSUPPORTED",
          "AI review needs extractable text within its size limit. You can still review the submission manually.");
      }
      request.log.warn({ requestId: request.id }, "Submission AI review failed");
      return fail(503, "REVIEW_AI_UNAVAILABLE", "AI review is temporarily unavailable. You can still review the submission manually.");
    }
  });
}
