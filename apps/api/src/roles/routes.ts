import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { configurableRolePermissions } from "./policy.js";
import { RoleError, type CustomRoleStore, type CustomRole, type RoleWrite } from "./store.js";

export const roleWriteProperties = {
  name: { type: "string", minLength: 1, maxLength: 80 },
  description: { type: "string", maxLength: 300 },
  permissions: { type: "array", maxItems: 1, uniqueItems: true,
    items: { type: "string", enum: [...configurableRolePermissions] } },
};
export function roleFailure(reply: FastifyReply, error: unknown) {
  if (!(error instanceof RoleError)) throw error;
  const status = error.code === "ROLE_UNAVAILABLE" ? 404 : error.code === "ROLE_INVALID" ? 400
    : error.code === "ROLE_CONFLICT" ? 412 : 409;
  return reply.code(status).send({ error: { code: error.code,
    message: error.code === "ROLE_IN_USE" ? "This role is used by published content or a pending review."
      : error.code === "ROLE_UNAVAILABLE" ? "The resource is not available."
      : "The role could not be changed. Refresh its configuration and try again." } });
}
function roleVersion(request: FastifyRequest): number | null {
  const header = request.headers["if-match"];
  const match = typeof header === "string" ? /^"role-(\d+)"$/.exec(header) : null;
  const version = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}
function representation(reply: FastifyReply, role: CustomRole) {
  reply.header("ETag", `"role-${role.version}"`);
  return role;
}
type ActorResolver = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;
export function registerCustomRoleRoutes(app: FastifyInstance, store: CustomRoleStore | undefined, actor: ActorResolver, uuid: string) {
  type Params = { organizationId: string; roleId: string; assignmentId: string };
  const params = (names: string[]) => ({ type: "object", additionalProperties: false, required: names,
    properties: Object.fromEntries(names.map(name => [name, { type: "string", pattern: uuid }])) });
  const orgPath = "/api/v1/organizations/:organizationId";
  const run = async (req: FastifyRequest, reply: FastifyReply,
    work: (service: CustomRoleStore, userId: string) => Promise<unknown>) => {
    const user = await actor(req, reply);
    if (!user) return;
    reply.header("Cache-Control", "no-store");
    if (!store) return reply.code(503).send({ error: { code: "ROLE_SERVICE_UNAVAILABLE", message: "Role configuration is unavailable." } });
    try { return await work(store, user.userId); }
    catch (error) { return roleFailure(reply, error); }
  };
  app.get<{ Params: Params }>(`${orgPath}/permissions`, { schema: { params: params(["organizationId"]) } },
    (req, reply) => run(req, reply, async (service, user) => {
      await service.list(user, req.params.organizationId);
      return { items: configurableRolePermissions.map(code => ({ code, name: "Read published knowledge", group: "Reading" })) };
    }));
  app.get<{ Params: Params }>(`${orgPath}/roles`, { schema: { params: params(["organizationId"]) } },
    (req, reply) => run(req, reply, async (service, user) => ({ items: await service.list(user, req.params.organizationId) })));
  app.get<{ Params: Params }>(`${orgPath}/roles/:roleId`, { schema: { params: params(["organizationId", "roleId"]) } },
    (req, reply) => run(req, reply, async (service, user) => representation(reply, await service.get(user, req.params.organizationId, req.params.roleId))));
  app.patch<{ Params: Params; Body: RoleWrite }>(`${orgPath}/roles/:roleId`, {
    schema: { params: params(["organizationId", "roleId"]), body: { type: "object", additionalProperties: false,
      required: ["name", "description", "permissions"], properties: roleWriteProperties } },
  }, (req, reply) => run(req, reply, async (service, user) => {
    const version = roleVersion(req);
    if (version === null) return reply.code(428).send({ error: { code: "PRECONDITION_REQUIRED", message: "Reload the role before saving." } });
    return representation(reply, await service.update(user, req.params.organizationId, req.params.roleId, version, req.body, req.id));
  }));
  app.post<{ Params: Params; Body: { membershipId: string; scopeType: "ORGANIZATION" | "DEPARTMENT"; departmentId: string | null } }>(
    `${orgPath}/roles/:roleId/assignments`, { schema: { params: params(["organizationId", "roleId"]),
      body: { type: "object", additionalProperties: false, required: ["membershipId", "scopeType", "departmentId"], properties: {
        membershipId: { type: "string", pattern: uuid }, scopeType: { type: "string", enum: ["ORGANIZATION", "DEPARTMENT"] },
        departmentId: { anyOf: [{ type: "string", pattern: uuid }, { type: "null" }] },
      } } } }, (req, reply) => run(req, reply, async (service, user) => {
      const { membershipId, scopeType, departmentId } = req.body;
      if ((scopeType === "ORGANIZATION" && departmentId !== null) || (scopeType === "DEPARTMENT" && !departmentId)) {
        throw new RoleError("ROLE_INVALID");
      }
      const scope = scopeType === "ORGANIZATION" ? { type: "ORGANIZATION" as const, departmentId: null }
        : { type: "DEPARTMENT" as const, departmentId: departmentId! };
      reply.code(201);
      return representation(reply, await service.assign(user, req.params.organizationId, req.params.roleId, membershipId, scope, req.id));
    }));
  app.post<{ Params: Params }>(`${orgPath}/roles/:roleId/assignments/:assignmentId/revoke`, {
    schema: { params: params(["organizationId", "roleId", "assignmentId"]), body: { type: "object", additionalProperties: false, properties: {} } },
  }, (req, reply) => run(req, reply, async (service, user) =>
    representation(reply, await service.revoke(user, req.params.organizationId, req.params.roleId, req.params.assignmentId, req.id))));
  app.post<{ Params: Params }>(`${orgPath}/roles/:roleId/deactivate`, {
    schema: { params: params(["organizationId", "roleId"]), body: { type: "object", additionalProperties: false, properties: {} } },
  }, (req, reply) => run(req, reply, async (service, user) => {
    const version = roleVersion(req);
    if (version === null) return reply.code(428).send({ error: { code: "PRECONDITION_REQUIRED", message: "Reload the role before deactivating." } });
    return representation(reply, await service.deactivate(user, req.params.organizationId, req.params.roleId, version, req.id));
  }));
}
