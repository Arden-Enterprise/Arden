import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  documentRelationshipTypes,
  GRAPH_MAX_DOCUMENTS,
  graphReaderScopes,
  graphTypeCodes,
  graphValidityFilters,
  graphViewModes,
  type DocumentRelationshipType,
  type KnowledgeGraphQuery,
} from "@arden/domain";
import type { GraphProjectionService } from "./graph-service.js";
import type { DocumentRelationshipService } from "./relationship-service.js";

type RequestActor = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;

const relationshipTypesPattern = `^(${documentRelationshipTypes.join("|")})(,(${documentRelationshipTypes.join("|")}))*$`;

function hasUniqueRelationshipTypes(raw: string): boolean {
  const parts = raw.split(",");
  return parts.length <= documentRelationshipTypes.length && new Set(parts).size === parts.length;
}

export function registerGraphRoutes(
  app: FastifyInstance,
  input: {
    service?: GraphProjectionService;
    relationshipService?: DocumentRelationshipService;
    requestActor: RequestActor;
    uuidPattern: string;
  },
) {
  const { service, relationshipService, requestActor, uuidPattern } = input;
  const uuid = { type: "string", pattern: uuidPattern } as const;

  const paramsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["organizationId"],
    properties: {
      organizationId: uuid,
    },
  } as const;

  const querystringSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      view: { type: "string", enum: [...graphViewModes] },
      q: { type: "string", maxLength: 120 },
      ownerDepartmentId: uuid,
      typeCode: { type: "string", enum: [...graphTypeCodes] },
      collectionId: {
        anyOf: [
          { type: "string", const: "UNASSIGNED" },
          uuid,
        ],
      },
      readerScope: { type: "string", enum: [...graphReaderScopes] },
      validity: { type: "string", enum: [...graphValidityFilters] },
      includeLinks: { type: "boolean" },
      relationshipTypes: {
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: relationshipTypesPattern,
      },
      monitor: { type: "boolean" },
      onlyOpenCases: { type: "boolean" },
      onlyUnassignedOrg: { type: "boolean" },
      includeExpired: { type: "boolean" },
      focusDocumentId: uuid,
      limit: { type: "integer", minimum: 1, maximum: GRAPH_MAX_DOCUMENTS },
    },
  } as const;

  app.get<{ Params: { organizationId: string }; Querystring: KnowledgeGraphQuery }>(
    "/api/v1/organizations/:organizationId/knowledge/graph",
    {
      schema: {
        params: paramsSchema,
        querystring: querystringSchema,
      },
    },
    async (request, reply) => {
      const actor = await requestActor(request, reply);
      if (!actor) return;

      reply.header("Cache-Control", "no-store");

      if (
        (request.query.q !== undefined && Array.from(request.query.q).length > 120)
        || (request.query.relationshipTypes !== undefined && !hasUniqueRelationshipTypes(request.query.relationshipTypes))
      ) {
        return reply.code(400).send({
          error: {
            code: "INVALID_REQUEST",
            message: "The request is invalid.",
            requestId: request.id,
          },
        });
      }

      if (!service) {
        return reply.code(503).send({
          error: {
            code: "GRAPH_UNAVAILABLE",
            message: "Knowledge graph is unavailable.",
            requestId: request.id,
          },
        });
      }

      try {
        const payload = await service.getGraph(actor.userId, request.params.organizationId, request.query);
        if (!payload) {
          return reply.code(404).send({
            error: {
              code: "RESOURCE_NOT_AVAILABLE",
              message: "This resource is not available.",
              requestId: request.id,
            },
          });
        }
        return payload;
      } catch (cause) {
        request.log.error(
          { errorType: cause instanceof Error ? cause.name : "UnknownError", requestId: request.id },
          "Knowledge graph projection failed",
        );
        return reply.code(500).send({
          error: {
            code: "INTERNAL_ERROR",
            message: "The request could not be completed.",
            requestId: request.id,
          },
        });
      }
    },
  );

  const idempotencyHeaderSchema = {
    type: "object",
    required: ["idempotency-key"],
    properties: {
      "idempotency-key": uuid,
    },
  } as const;

  const emptyQuerystringSchema = {
    type: "object",
    additionalProperties: false,
    properties: {},
  } as const;

  const createRelationshipParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["organizationId", "documentId"],
    properties: {
      organizationId: uuid,
      documentId: uuid,
    },
  } as const;

  const createRelationshipBodySchema = {
    type: "object",
    additionalProperties: false,
    required: ["targetDocumentId", "relationshipType"],
    properties: {
      targetDocumentId: uuid,
      relationshipType: { type: "string", enum: [...documentRelationshipTypes] },
    },
  } as const;

  const removeRelationshipParamsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["organizationId", "documentId", "relationshipId"],
    properties: {
      organizationId: uuid,
      documentId: uuid,
      relationshipId: uuid,
    },
  } as const;

  const removeRelationshipBodySchema = {
    type: "object",
    additionalProperties: false,
    properties: {},
  } as const;

  app.post<{
    Params: { organizationId: string; documentId: string };
    Headers: { "idempotency-key": string };
    Body: { targetDocumentId: string; relationshipType: DocumentRelationshipType };
  }>(
    "/api/v1/organizations/:organizationId/knowledge/documents/:documentId/relationships",
    {
      schema: {
        params: createRelationshipParamsSchema,
        headers: idempotencyHeaderSchema,
        querystring: emptyQuerystringSchema,
        body: createRelationshipBodySchema,
      },
    },
    async (request, reply) => {
      const actor = await requestActor(request, reply);
      if (!actor) return;

      reply.header("Cache-Control", "no-store");

      if (!relationshipService) {
        return reply.code(503).send({
          error: {
            code: "GRAPH_UNAVAILABLE",
            message: "Knowledge graph is unavailable.",
            requestId: request.id,
          },
        });
      }

      try {
        const result = await relationshipService.createRelationship(
          actor.userId,
          request.params.organizationId,
          request.params.documentId,
          {
            targetDocumentId: request.body.targetDocumentId,
            relationshipType: request.body.relationshipType,
          },
          request.headers["idempotency-key"],
        );
        switch (result.kind) {
          case "created":
            return reply.code(201).send(result.edge);
          case "replayed":
            return reply.code(result.statusCode).send(result.response);
          case "invalid-request":
            return reply.code(400).send({
              error: {
                code: "INVALID_REQUEST",
                message: result.message,
                requestId: request.id,
              },
            });
          case "not-available":
            return reply.code(404).send({
              error: {
                code: "RESOURCE_NOT_AVAILABLE",
                message: "This resource is not available.",
                requestId: request.id,
              },
            });
          case "idempotency-conflict":
            return reply.code(409).send({
              error: {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Use a new idempotency key for a different request.",
                requestId: request.id,
              },
            });
          case "relationship-exists":
            return reply.code(409).send({
              error: {
                code: "RELATIONSHIP_EXISTS",
                message: "This relationship already exists.",
                requestId: request.id,
              },
            });
          case "relationship-cycle":
            return reply.code(409).send({
              error: {
                code: "RELATIONSHIP_CYCLE",
                message: "This supersedes relationship would form a cycle.",
                requestId: request.id,
              },
            });
        }
      } catch (cause) {
        request.log.error(
          { errorType: cause instanceof Error ? cause.name : "UnknownError", requestId: request.id },
          "Document relationship creation failed",
        );
        return reply.code(500).send({
          error: {
            code: "INTERNAL_ERROR",
            message: "The request could not be completed.",
            requestId: request.id,
          },
        });
      }
    },
  );

  app.post<{
    Params: { organizationId: string; documentId: string; relationshipId: string };
    Headers: { "idempotency-key": string };
    Body: Record<string, never>;
  }>(
    "/api/v1/organizations/:organizationId/knowledge/documents/:documentId/relationships/:relationshipId/remove",
    {
      schema: {
        params: removeRelationshipParamsSchema,
        headers: idempotencyHeaderSchema,
        querystring: emptyQuerystringSchema,
        body: removeRelationshipBodySchema,
      },
    },
    async (request, reply) => {
      const actor = await requestActor(request, reply);
      if (!actor) return;

      reply.header("Cache-Control", "no-store");

      if (!relationshipService) {
        return reply.code(503).send({
          error: {
            code: "GRAPH_UNAVAILABLE",
            message: "Knowledge graph is unavailable.",
            requestId: request.id,
          },
        });
      }

      try {
        const result = await relationshipService.removeRelationship(
          actor.userId,
          request.params.organizationId,
          request.params.documentId,
          request.params.relationshipId,
          request.headers["idempotency-key"],
        );
        switch (result.kind) {
          case "removed":
            return reply.code(200).send(result.response);
          case "replayed":
            return reply.code(result.statusCode).send(result.response);
          case "not-available":
            return reply.code(404).send({
              error: {
                code: "RESOURCE_NOT_AVAILABLE",
                message: "This resource is not available.",
                requestId: request.id,
              },
            });
          case "idempotency-conflict":
            return reply.code(409).send({
              error: {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Use a new idempotency key for a different request.",
                requestId: request.id,
              },
            });
        }
      } catch (cause) {
        request.log.error(
          { errorType: cause instanceof Error ? cause.name : "UnknownError", requestId: request.id },
          "Document relationship removal failed",
        );
        return reply.code(500).send({
          error: {
            code: "INTERNAL_ERROR",
            message: "The request could not be completed.",
            requestId: request.id,
          },
        });
      }
    },
  );
}
