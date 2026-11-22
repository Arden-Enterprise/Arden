import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MaintenanceError, canonicalIds, type IntakeInput } from "./contracts.js";
import type { MaintenanceCaseService } from "./case-service.js";

export function registerMaintenanceRoutes(app: FastifyInstance, service: MaintenanceCaseService | undefined,
  actor: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>, uuid: string) {
  const base = "/api/v1/organizations/:organizationId/knowledge/maintenance";
  const orgParams = { type: "object", additionalProperties: false, required: ["organizationId"], properties: {
    organizationId: { type: "string", pattern: uuid },
  } };
  const caseParams = { type: "object", additionalProperties: false, required: ["organizationId", "caseId"], properties: {
    organizationId: { type: "string", pattern: uuid }, caseId: { type: "string", pattern: uuid },
  } };
  const run = async (request: FastifyRequest, reply: FastifyReply, work: (userId: string) => Promise<unknown>) => {
    const user = await actor(request, reply);
    if (!user) return;
    reply.header("Cache-Control", "no-store");
    if (!service) return reply.code(503).send({ error: { code: "MAINTENANCE_UNAVAILABLE", message: "Maintenance is unavailable." } });
    request.params = canonicalIds(request.params);
    request.body = canonicalIds(request.body);
    const key = request.headers["idempotency-key"];
    if (typeof key === "string") request.headers["idempotency-key"] = canonicalIds(key);
    try {
      return await work(user.userId);
    } catch (error) {
      if (!(error instanceof MaintenanceError)) throw error;
      const status = error.code === "INVALID" ? 400 : error.code === "DENIED" ? 404 : error.code === "UNAVAILABLE" ? 503 : 409;
      const code = error.code === "DENIED" ? "MAINTENANCE_UNAVAILABLE" : error.code === "STALE" ? "MAINTENANCE_STALE"
        : error.code === "CONFLICT" ? "MAINTENANCE_CONFLICT" : error.code === "UNAVAILABLE" ? "MAINTENANCE_ANALYSIS_UNAVAILABLE" : "INVALID_REQUEST";
      return reply.code(status).send({ error: { code, message: error.code === "DENIED" ? "That case is unavailable."
        : error.code === "UNAVAILABLE" ? "Analysis is not available. Continue the review manually."
        : error.code === "CONFLICT" ? "This request conflicts with an existing case."
          : error.code === "STALE" ? "This case changed. Reload it and try again."
            : "Check the report and try again." } });
    }
  };
  app.post<{ Params: { organizationId: string }; Body: IntakeInput }>(`${base}/cases`, {
    schema: { params: orgParams, body: { type: "object", additionalProperties: false, required: ["origin", "documentId", "publishedVersionId", "description"],
      properties: {
        origin: { enum: ["READER_REPORT", "REVIEWER_INTAKE"] },
        documentId: { type: "string", pattern: uuid },
        publishedVersionId: { type: "string", pattern: uuid },
        description: { type: "string", minLength: 1, maxLength: 4000 },
        anchor: { type: "object", additionalProperties: false, properties: {
          page: { type: "integer", minimum: 1, maximum: 10000 },
          passage: { type: "string", maxLength: 500 },
        } },
      } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = request.headers["idempotency-key"];
    if (typeof requestKey !== "string") return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.createCase(userId, request.params.organizationId, request.body, requestKey).then((body) => {
      reply.code(201);
      return body;
    });
  }));
  app.get<{ Params: { organizationId: string }; Querystring: { scope?: string } }>(`${base}/cases`, {
    schema: { params: orgParams, querystring: { type: "object", additionalProperties: false, properties: {
      scope: { enum: ["mine", "queue"] },
    } } },
  }, (request, reply) => run(request, reply, (userId) => service!.listCases(userId, request.params.organizationId,
    request.query.scope === "queue" ? "queue" : "mine")));
  app.get<{ Params: { organizationId: string; caseId: string } }>(`${base}/cases/:caseId`, { schema: { params: caseParams } },
    (request, reply) => run(request, reply, (userId) => service!.getCase(userId, request.params.organizationId, request.params.caseId)));
  const command = (request: FastifyRequest) => {
    const requestKey = request.headers["idempotency-key"];
    return typeof requestKey === "string" ? requestKey : null;
  };
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { expectedRevision: number } }>(`${base}/cases/:caseId/claim`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["expectedRevision"], properties: {
      expectedRevision: { type: "integer", minimum: 1 },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.claimCase(userId, request.params.organizationId, request.params.caseId, request.body.expectedRevision, requestKey);
  }));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { expectedRevision: number; membershipId: string; reason: string } }>(`${base}/cases/:caseId/reassign`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["expectedRevision", "membershipId", "reason"], properties: {
      expectedRevision: { type: "integer", minimum: 1 }, membershipId: { type: "string", pattern: uuid }, reason: { type: "string", minLength: 1, maxLength: 500 },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.reassignCase(userId, request.params.organizationId, request.params.caseId, request.body.expectedRevision,
      request.body.membershipId, request.body.reason, requestKey);
  }));
  app.get<{ Params: { organizationId: string; caseId: string } }>(`${base}/cases/:caseId/analysis`, { schema: { params: caseParams } },
    (request, reply) => run(request, reply, (userId) => service!.readAnalysis(userId, request.params.organizationId, request.params.caseId)));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { versionIds: string[] } }>(`${base}/cases/:caseId/analysis`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["versionIds"], properties: {
      versionIds: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", pattern: uuid } },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.startAnalysis(userId, request.params.organizationId, request.params.caseId, request.body.versionIds, requestKey);
  }));
  app.post<{ Params: { organizationId: string; caseId: string } }>(`${base}/cases/:caseId/analysis-cancellation`, {
    schema: { params: caseParams },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.cancelAnalysis(userId, request.params.organizationId, request.params.caseId, requestKey);
  }));
  app.get<{ Params: { organizationId: string; caseId: string } }>(`${base}/cases/:caseId/links`, { schema: { params: caseParams } },
    (request, reply) => run(request, reply, (userId) => service!.listRelated(userId, request.params.organizationId, request.params.caseId)
      .then((items) => ({ items }))));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { relatedCaseId: string } }>(`${base}/cases/:caseId/links`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["relatedCaseId"], properties: {
      relatedCaseId: { type: "string", pattern: uuid },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.linkRelated(userId, request.params.organizationId, request.params.caseId, request.body.relatedCaseId, requestKey);
  }));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { expectedRevision: number; message: string } }>(`${base}/cases/:caseId/messages`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["expectedRevision", "message"], properties: {
      expectedRevision: { type: "integer", minimum: 1 }, message: { type: "string", minLength: 1, maxLength: 2000 },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.postMessage(userId, request.params.organizationId, request.params.caseId, request.body.expectedRevision, request.body.message, requestKey);
  }));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { expectedRevision: number; reporterExplanation: string; reviewerRationale: string; evidencePublishedVersionId: string } }>(`${base}/cases/:caseId/publication-confirmation`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["expectedRevision", "reporterExplanation", "reviewerRationale", "evidencePublishedVersionId"], properties: {
      expectedRevision: { type: "integer", minimum: 1 },
      reporterExplanation: { type: "string", minLength: 1, maxLength: 2000 },
      reviewerRationale: { type: "string", minLength: 1, maxLength: 2000 },
      evidencePublishedVersionId: { type: "string", pattern: uuid },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.confirmPublication(userId, request.params.organizationId, request.params.caseId, request.body.expectedRevision,
      request.body.reporterExplanation, request.body.reviewerRationale, request.body.evidencePublishedVersionId, requestKey);
  }));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { expectedRevision: number; publishedVersionId?: string; submissionId?: string; reason: string } }>(`${base}/cases/:caseId/publication-link`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["expectedRevision", "reason"], properties: {
      expectedRevision: { type: "integer", minimum: 1 },
      publishedVersionId: { type: "string", pattern: uuid },
      submissionId: { type: "string", pattern: uuid },
      reason: { type: "string", minLength: 1, maxLength: 2000 },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.linkPublication(userId, request.params.organizationId, request.params.caseId, request.body.expectedRevision,
      { publishedVersionId: request.body.publishedVersionId, submissionId: request.body.submissionId }, request.body.reason, requestKey);
  }));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { expectedRevision: number; reporterExplanation: string; reviewerRationale: string } }>(`${base}/cases/:caseId/decisions`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["expectedRevision", "reporterExplanation", "reviewerRationale"], properties: {
      expectedRevision: { type: "integer", minimum: 1 },
      reporterExplanation: { type: "string", minLength: 1, maxLength: 2000 },
      reviewerRationale: { type: "string", minLength: 1, maxLength: 2000 },
    } } },
  }, (request, reply) => run(request, reply, (userId) => {
    const requestKey = command(request);
    if (!requestKey) return Promise.resolve(reply.code(400).send({ error: { code: "INVALID_REQUEST", message: "Check the report and try again." } }));
    return service!.decideNoChange(userId, request.params.organizationId, request.params.caseId, request.body.expectedRevision,
      request.body.reporterExplanation, request.body.reviewerRationale, requestKey);
  }));
  app.get<{ Params: { organizationId: string; caseId: string } }>(`${base}/cases/:caseId/versions`, { schema: { params: caseParams } },
    (request, reply) => run(request, reply, (userId) => service!.listVersions(userId, request.params.organizationId, request.params.caseId)));
  const versionParams = { type: "object", additionalProperties: false, required: ["organizationId", "caseId", "publishedVersionId"], properties: {
    organizationId: { type: "string", pattern: uuid }, caseId: { type: "string", pattern: uuid }, publishedVersionId: { type: "string", pattern: uuid },
  } };
  app.get<{ Params: { organizationId: string; caseId: string; publishedVersionId: string } }>(`${base}/cases/:caseId/versions/:publishedVersionId`, { schema: { params: versionParams } },
    (request, reply) => run(request, reply, (userId) => service!.readOriginal(userId, request.params.organizationId, request.params.caseId, request.params.publishedVersionId)));
  app.post<{ Params: { organizationId: string; caseId: string }; Body: { fromPublishedVersionId: string; toPublishedVersionId: string } }>(`${base}/cases/:caseId/compare`, {
    schema: { params: caseParams, body: { type: "object", additionalProperties: false, required: ["fromPublishedVersionId", "toPublishedVersionId"], properties: {
      fromPublishedVersionId: { type: "string", pattern: uuid }, toPublishedVersionId: { type: "string", pattern: uuid },
    } } },
  }, (request, reply) => run(request, reply, (userId) => service!.compareCase(userId, request.params.organizationId, request.params.caseId,
    request.body.fromPublishedVersionId, request.body.toPublishedVersionId)));
  app.post<{ Params: { organizationId: string } }>(`${base}/imports`, { schema: { params: orgParams } },
    (request, reply) => run(request, reply, (userId) => service!.importOpenReports(userId, request.params.organizationId)));
  app.get<{ Params: { organizationId: string; caseId: string } }>(`${base}/cases/:caseId/reviewers`, { schema: { params: caseParams } },
    (request, reply) => run(request, reply, (userId) => service!.listEligibleReviewers(userId, request.params.organizationId, request.params.caseId)));
  app.get<{ Params: { organizationId: string; caseId: string }; Querystring: { cursor?: string } }>(`${base}/cases/:caseId/history`, {
    schema: { params: caseParams, querystring: { type: "object", additionalProperties: false, properties: {
      cursor: { type: "string", maxLength: 40 },
    } } },
  }, (request, reply) => run(request, reply, (userId) => service!.listHistory(userId, request.params.organizationId, request.params.caseId, request.query.cursor ?? null)));
}
