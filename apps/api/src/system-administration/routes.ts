import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SystemAdministrationError, type SystemAdministrationStore } from "./store.js";

type ActorResolver = (request: FastifyRequest, reply: FastifyReply) =>
  Promise<{ userId: string } | null>;

function failure(reply: FastifyReply, error: unknown) {
  if (!(error instanceof SystemAdministrationError)) throw error;
  if (error.code === "SYSTEM_ADMINISTRATION_UNAVAILABLE") {
    return reply.code(404).send({ error: { code: error.code, message: "The resource is not available." } });
  }
  if (error.code === "SYSTEM_ADMINISTRATOR_LAST_ACTIVE" || error.code === "SYSTEM_ADMINISTRATOR_LAST_MANAGER") {
    return reply.code(409).send({ error: { code: error.code,
      message: error.code === "SYSTEM_ADMINISTRATOR_LAST_MANAGER"
        ? "The last System Admin manager cannot be removed or demoted."
        : "The last active Arden System Admin cannot be revoked." } });
  }
  return reply.code(409).send({ error: { code: error.code,
    message: "The System Admin assignment could not be changed." } });
}

export function registerSystemAdministrationRoutes(app: FastifyInstance,
  store: SystemAdministrationStore | undefined, actor: ActorResolver, uuid: string) {
  const run = async (request: FastifyRequest, reply: FastifyReply,
    work: (service: SystemAdministrationStore, actorUserId: string) => Promise<unknown>) => {
    const session = await actor(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    if (!store) return reply.code(503).send({ error: { code: "SYSTEM_ADMINISTRATION_SERVICE_UNAVAILABLE",
      message: "System administration is unavailable." } });
    try { return await work(store, session.userId); }
    catch (error) { return failure(reply, error); }
  };
  const root = "/api/v1/system/administrators";
  const targetSchema = { type: "object", additionalProperties: false, required: ["userId"],
    properties: { userId: { type: "string", pattern: uuid } } };

  app.get(root, (request, reply) => run(request, reply,
    (service, actorUserId) => service.overview(actorUserId)));
  app.get("/api/v1/system/analytics/private-feedback", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {} } },
  }, (request, reply) => run(request, reply, async (service, actorUserId) =>
    ({ weeks: await service.privateFeedback(actorUserId) })));
  app.post<{ Body: { userId: string } }>(root, { schema: { body: targetSchema } },
    (request, reply) => run(request, reply, async (service, actorUserId) => {
      reply.code(201);
      return service.grant(actorUserId, request.body.userId, request.id);
    }));
  app.post<{ Params: { userId: string } }>(`${root}/:userId/revoke`, {
    schema: { params: { type: "object", additionalProperties: false, required: ["userId"],
      properties: { userId: { type: "string", pattern: uuid } } },
      body: { type: "object", additionalProperties: false, properties: {} } },
  }, (request, reply) => run(request, reply,
    (service, actorUserId) => service.revoke(actorUserId, request.params.userId, request.id)));

  app.patch<{ Params: { userId: string }; Body: { canManageSystemAdmins: boolean } }>(`${root}/:userId`, {
    schema: {
      params: { type: "object", additionalProperties: false, required: ["userId"],
        properties: { userId: { type: "string", pattern: uuid } } },
      body: { type: "object", additionalProperties: false, required: ["canManageSystemAdmins"],
        properties: { canManageSystemAdmins: { type: "boolean" } } },
    },
  }, (request, reply) => run(request, reply, (service, actorUserId) =>
    service.setManagerCapability(actorUserId, request.params.userId, request.body.canManageSystemAdmins, request.id)));
}
