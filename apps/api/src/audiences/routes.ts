import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AudienceGroupError, type AudienceGroup, type AudienceGroupStore,
  type AudienceGroupWrite } from "./store.js";

export const audienceGroupWriteProperties = {
  name: { type: "string", minLength: 1, maxLength: 80 },
  description: { type: "string", maxLength: 300 },
};

export function audienceGroupFailure(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AudienceGroupError)) throw error;
  const status = error.code === "AUDIENCE_GROUP_UNAVAILABLE" ? 404
    : error.code === "AUDIENCE_GROUP_INVALID" ? 400
      : error.code === "AUDIENCE_GROUP_CONFLICT" ? 412 : 409;
  return reply.code(status).send({ error: { code: error.code,
    message: error.code === "AUDIENCE_GROUP_IN_USE"
      ? "This audience group is used by published content or a pending review."
      : error.code === "AUDIENCE_GROUP_UNAVAILABLE" ? "The resource is not available."
        : "The audience group could not be changed. Refresh it and try again." } });
}

function groupVersion(request: FastifyRequest): number | null {
  const header = request.headers["if-match"];
  const match = typeof header === "string" ? /^"audience-group-(\d+)"$/.exec(header) : null;
  const version = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

function representation(reply: FastifyReply, group: AudienceGroup) {
  reply.header("ETag", `"audience-group-${group.version}"`);
  return group;
}

type ActorResolver = (request: FastifyRequest, reply: FastifyReply) =>
  Promise<{ userId: string } | null>;

export function registerAudienceGroupRoutes(app: FastifyInstance, store: AudienceGroupStore | undefined,
  actor: ActorResolver, uuid: string) {
  type Params = { organizationId: string; audienceGroupId: string; groupMembershipId: string };
  const params = (names: string[]) => ({ type: "object", additionalProperties: false, required: names,
    properties: Object.fromEntries(names.map(name => [name, { type: "string", pattern: uuid }])) });
  const path = "/api/v1/organizations/:organizationId/audience-groups";
  const run = async (request: FastifyRequest, reply: FastifyReply,
    work: (service: AudienceGroupStore, userId: string) => Promise<unknown>) => {
    const user = await actor(request, reply);
    if (!user) return;
    reply.header("Cache-Control", "no-store");
    if (!store) return reply.code(503).send({ error: {
      code: "AUDIENCE_GROUP_SERVICE_UNAVAILABLE", message: "Audience group administration is unavailable." } });
    try { return await work(store, user.userId); }
    catch (error) { return audienceGroupFailure(reply, error); }
  };

  app.get<{ Params: Params }>(path, { schema: { params: params(["organizationId"]) } },
    (request, reply) => run(request, reply, async (service, userId) =>
      ({ items: await service.list(userId, request.params.organizationId) })));
  app.get<{ Params: Params }>(`${path}/:audienceGroupId`, {
    schema: { params: params(["organizationId", "audienceGroupId"]) },
  }, (request, reply) => run(request, reply, async (service, userId) => representation(reply,
    await service.get(userId, request.params.organizationId, request.params.audienceGroupId))));
  app.post<{ Params: Params; Body: AudienceGroupWrite }>(path, {
    schema: { params: params(["organizationId"]), body: { type: "object", additionalProperties: false,
      required: ["name", "description"], properties: audienceGroupWriteProperties } },
  }, (request, reply) => run(request, reply, async (service, userId) => {
    reply.code(201);
    return representation(reply, await service.create(userId, request.params.organizationId,
      request.body, request.id));
  }));
  app.patch<{ Params: Params; Body: AudienceGroupWrite }>(`${path}/:audienceGroupId`, {
    schema: { params: params(["organizationId", "audienceGroupId"]), body: {
      type: "object", additionalProperties: false, required: ["name", "description"],
      properties: audienceGroupWriteProperties } },
  }, (request, reply) => run(request, reply, async (service, userId) => {
    const version = groupVersion(request);
    if (version === null) return reply.code(428).send({ error: {
      code: "PRECONDITION_REQUIRED", message: "Reload the audience group before saving." } });
    return representation(reply, await service.update(userId, request.params.organizationId,
      request.params.audienceGroupId, version, request.body, request.id));
  }));
  app.post<{ Params: Params; Body: { membershipId: string } }>(`${path}/:audienceGroupId/members`, {
    schema: { params: params(["organizationId", "audienceGroupId"]), body: {
      type: "object", additionalProperties: false, required: ["membershipId"],
      properties: { membershipId: { type: "string", pattern: uuid } } } },
  }, (request, reply) => run(request, reply, async (service, userId) => {
    reply.code(201);
    return representation(reply, await service.addMember(userId, request.params.organizationId,
      request.params.audienceGroupId, request.body.membershipId, request.id));
  }));
  app.post<{ Params: Params }>(`${path}/:audienceGroupId/members/:groupMembershipId/remove`, {
    schema: { params: params(["organizationId", "audienceGroupId", "groupMembershipId"]),
      body: { type: "object", additionalProperties: false, properties: {} } },
  }, (request, reply) => run(request, reply, async (service, userId) => representation(reply,
    await service.removeMember(userId, request.params.organizationId,
      request.params.audienceGroupId, request.params.groupMembershipId, request.id))));
  app.post<{ Params: Params }>(`${path}/:audienceGroupId/deactivate`, {
    schema: { params: params(["organizationId", "audienceGroupId"]),
      body: { type: "object", additionalProperties: false, properties: {} } },
  }, (request, reply) => run(request, reply, async (service, userId) => {
    const version = groupVersion(request);
    if (version === null) return reply.code(428).send({ error: {
      code: "PRECONDITION_REQUIRED", message: "Reload the audience group before deactivating." } });
    return representation(reply, await service.deactivate(userId, request.params.organizationId,
      request.params.audienceGroupId, version, request.id));
  }));
}

