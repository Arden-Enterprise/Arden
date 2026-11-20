import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { knowledgeTypes } from "@arden/domain";
import { CatalogError, type CatalogKind, type CatalogWrite, type KnowledgeCatalogStore } from "./catalog-store.js";

export const managementSchema = { type: "object", additionalProperties: false,
  required: ["type", "version", "effectiveDate", "expirationDate", "changeNote"], properties: {
    type: { enum: [...knowledgeTypes, null] },
    version: { type: "string", maxLength: 30 },
    effectiveDate: { type: ["string", "null"], maxLength: 10 },
    expirationDate: { type: ["string", "null"], maxLength: 10 }, changeNote: { type: "string", maxLength: 1000 },
  } };

export function registerKnowledgeCatalogRoutes(app: FastifyInstance, store: KnowledgeCatalogStore | undefined,
  actor: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>, uuid: string) {
  type Params = { organizationId: string; kind: CatalogKind; id: string };
  const base = "/api/v1/organizations/:organizationId/knowledge/catalog";
  const params = (write: boolean, edit = false) => ({ type: "object", additionalProperties: false,
    required: ["organizationId", ...(write ? ["kind"] : []), ...(edit ? ["id"] : [])], properties: {
      organizationId: { type: "string", pattern: uuid }, ...(write ? { kind: { enum: ["collections"] } } : {}),
      ...(edit ? { id: { type: "string", pattern: uuid } } : {}),
    } });
  const body = { type: "object", additionalProperties: false, required: ["name", "status"], properties: {
    name: { type: "string", minLength: 1, maxLength: 80 }, description: { type: "string", maxLength: 300 },
    status: { enum: ["ACTIVE", "INACTIVE"] }, cover: { enum: ["handbook", "production"] },
    allowedTypes: { type: "array", minItems: 1, maxItems: knowledgeTypes.length, uniqueItems: true, items: { enum: [...knowledgeTypes] } },
    // Accepted only to return a clear upgrade error; never written to legacy storage.
    documentIds: { type: "array", maxItems: 200, uniqueItems: true, items: { type: "string", pattern: uuid } },
  } };
  const run = async (request: FastifyRequest, reply: FastifyReply,
    work: (service: KnowledgeCatalogStore, user: string) => Promise<unknown>) => {
    const user = await actor(request, reply);
    if (!user) return;
    reply.header("Cache-Control", "no-store");
    if (!store) return reply.code(503).send({ error: { code: "CATALOG_UNAVAILABLE", message: "Catalog is unavailable." } });
    try { return await work(store, user.userId); }
    catch (error) {
      if (!(error instanceof CatalogError)) throw error;
      return reply.code(error.code === "UNAVAILABLE" ? 404 : error.code === "CONFLICT" ? 412 : ["DUPLICATE", "UPGRADE_REQUIRED"].includes(error.code) ? 409 : 400)
        .send({ error: { code: `CATALOG_${error.code}`, message: error.code === "CONFLICT" ? "Catalog changed. Reload before saving."
          : error.code === "DUPLICATE" ? "This name is already used." : error.code === "UPGRADE_REQUIRED" ? "Reload to manage document placement separately."
          : error.code === "INVALID" ? "Check catalog details and allowed types." : "Catalog item is unavailable." } });
    }
  };
  app.get<{ Params: Params }>(base, { schema: { params: params(false) } }, (request, reply) =>
    run(request, reply, (service, user) => service.list(user, request.params.organizationId)));
  const placementParams = { type: "object", additionalProperties: false, required: ["organizationId", "id"], properties: {
    organizationId: { type: "string", pattern: uuid }, id: { type: "string", pattern: uuid },
  } };
  const noQuery = { type: "object", additionalProperties: false, properties: {} };
  app.get<{ Params: Params }>(`${base}/placements/:id`, { schema: { params: placementParams, querystring: noQuery } }, (request, reply) =>
    run(request, reply, async (service, user) => {
      const result = await service.getPlacement(user, request.params.organizationId, request.params.id);
      reply.header("ETag", `"placement-${result.revision}"`); return result;
    }));
  app.patch<{ Params: Params; Body: { collectionId: string | null } }>(`${base}/placements/:id`, { schema: {
    params: placementParams, querystring: noQuery, body: { type: "object", additionalProperties: false, required: ["collectionId"], properties: {
      collectionId: { type: ["string", "null"], pattern: uuid },
    } },
  } }, (request, reply) => run(request, reply, async (service, user) => {
    const match = typeof request.headers["if-match"] === "string" ? /^"placement-(0|[1-9][0-9]*)"$/.exec(request.headers["if-match"]) : null;
    const revision = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(revision)) return reply.code(428).send({ error: {
      code: "PRECONDITION_REQUIRED", message: "Reload document placement before saving." } });
    const result = await service.place(user, request.params.organizationId, request.params.id, revision, request.body.collectionId, request.id);
    reply.header("ETag", `"placement-${result.revision}"`); return result;
  }));
  app.get<{ Params: Params; Querystring: { q?: string; ids?: string } }>(`${base}/readers`, { schema: {
    params: params(false), querystring: { type: "object", additionalProperties: false, properties: {
      q: { type: "string", maxLength: 80 }, ids: { type: "string", maxLength: 3699,
        pattern: "^[0-9a-fA-F,-]*$" },
    } },
  } }, (request, reply) => run(request, reply, async (service, user) => {
    const ids = request.query.ids ? request.query.ids.split(",") : [];
    if (ids.length > 100 || ids.some(id => !new RegExp(uuid).test(id))) return reply.code(400).send({ error: {
      code: "INVALID_REQUEST", message: "Invalid reader selection." } });
    return { items: await service.readers(user, request.params.organizationId, request.query.q ?? "", ids) };
  }));
  app.post<{ Params: Params; Body: CatalogWrite }>(`${base}/:kind`, { schema: { params: params(true), body } }, (request, reply) =>
    run(request, reply, async (service, user) => { const result = await service.write(user, request.params.organizationId,
      request.params.kind, null, null, request.body, request.id); reply.code(201); return result; }));
  app.patch<{ Params: Params; Body: CatalogWrite }>(`${base}/:kind/:id`, { schema: { params: params(true, true), body } }, (request, reply) =>
    run(request, reply, (service, user) => {
      const match = typeof request.headers["if-match"] === "string" ? /^"catalog-(\d+)"$/.exec(request.headers["if-match"]) : null;
      const version = match ? Number(match[1]) : NaN;
      if (!Number.isSafeInteger(version) || version < 1) return Promise.resolve(reply.code(428).send({ error: {
        code: "PRECONDITION_REQUIRED", message: "Reload the catalog before saving." } }));
      return service.write(user, request.params.organizationId, request.params.kind, request.params.id, version, request.body, request.id);
    }));
}
