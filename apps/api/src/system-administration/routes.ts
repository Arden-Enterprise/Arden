import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  accountPasswordMaximumLength,
  accountPasswordMaximumLengthMessage,
  accountPasswordRequirementsMessage,
  meetsAccountPasswordRequirements,
} from "@arden/domain";
import { isNormalizedEmail } from "../email-address.js";
import { hashSystemAdminPassword, type PasswordWorkLimiter } from "../system-auth/password.js";
import type { SystemActor, SystemActorResolver } from "../system-auth/routes.js";
import { SystemAdministrationError, type SystemAdministrationStore } from "./store.js";

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

/**
 * MANAGE_SYSTEM_ADMINS API for the isolated System Admin identity (API only; the Console
 * has no admin-grant UI). The caller must hold a live System Admin session; the store
 * rechecks manager capability inside each transaction.
 */
export function registerSystemAdministrationRoutes(app: FastifyInstance,
  store: SystemAdministrationStore | undefined, resolveActor: SystemActorResolver, uuid: string,
  passwordWork: PasswordWorkLimiter) {
  const actors = new WeakMap<FastifyRequest, SystemActor>();
  const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await resolveActor(request, reply);
    if (!actor) return reply;
    actors.set(request, actor);
  };
  const run = async (request: FastifyRequest, reply: FastifyReply,
    work: (service: SystemAdministrationStore, actor: SystemActor) => Promise<unknown>) => {
    const actor = actors.get(request);
    if (!actor) return reply;
    if (!store) return reply.code(503).send({ error: { code: "SYSTEM_ADMINISTRATION_SERVICE_UNAVAILABLE",
      message: "System administration is unavailable." } });
    // Monitoring-only administrators are not told that the management API exists.
    if (!actor.canManageSystemAdmins) return failure(reply, new SystemAdministrationError("SYSTEM_ADMINISTRATION_UNAVAILABLE"));
    try { return await work(store, actor); }
    catch (error) { return failure(reply, error); }
  };
  const root = "/api/v1/system/administrators";
  const adminParams = { type: "object", additionalProperties: false, required: ["adminId"],
    properties: { adminId: { type: "string", pattern: uuid } } };

  app.get(root, { onRequest: authenticate }, (request, reply) => run(request, reply,
    (service, actor) => service.overview(actor)));

  app.post<{ Body: { email: string; fullName: string; password: string } }>(root, {
    onRequest: authenticate,
    schema: { body: { type: "object", additionalProperties: false, required: ["email", "fullName", "password"],
      properties: {
        email: { type: "string", minLength: 3, maxLength: 320 },
        fullName: { type: "string", minLength: 1, maxLength: 200 },
        password: { type: "string", minLength: 8, maxLength: accountPasswordMaximumLength },
      } } },
  }, (request, reply) => run(request, reply, async (service, actor) => {
    const email = request.body.email.trim().toLowerCase();
    const fullName = request.body.fullName.trim();
    if (!isNormalizedEmail(email)) {
      return reply.code(400).send({ error: { code: "INVALID_EMAIL", message: "Enter a valid email address." } });
    }
    if (!fullName) return reply.code(400).send({ error: { code: "INVALID_FULL_NAME", message: "Enter a name." } });
    if (request.body.password.length > accountPasswordMaximumLength) {
      return reply.code(400).send({ error: { code: "INVALID_PASSWORD", message: accountPasswordMaximumLengthMessage } });
    }
    if (!meetsAccountPasswordRequirements(request.body.password)) {
      return reply.code(400).send({ error: { code: "INVALID_PASSWORD", message: accountPasswordRequirementsMessage } });
    }
    const hashed = await passwordWork.run(() => hashSystemAdminPassword(request.body.password));
    if (!hashed) {
      reply.header("Retry-After", "1");
      return reply.code(429).send({ error: { code: "TOO_MANY_ATTEMPTS", message: "Try again in a moment." } });
    }
    const created = await service.grant(actor, { email, fullName, passwordHash: hashed.value }, request.id);
    return reply.code(201).send(created);
  }));

  app.post<{ Params: { adminId: string } }>(`${root}/:adminId/revoke`, {
    onRequest: authenticate,
    schema: { params: adminParams, body: { type: "object", additionalProperties: false, properties: {} } },
  }, (request, reply) => run(request, reply,
    (service, actor) => service.revoke(actor, request.params.adminId, request.id)));

  app.patch<{ Params: { adminId: string }; Body: { canManageSystemAdmins: boolean } }>(`${root}/:adminId`, {
    onRequest: authenticate,
    schema: {
      params: adminParams,
      body: { type: "object", additionalProperties: false, required: ["canManageSystemAdmins"],
        properties: { canManageSystemAdmins: { type: "boolean" } } },
    },
  }, (request, reply) => run(request, reply, (service, actor) =>
    service.setManagerCapability(actor, request.params.adminId, request.body.canManageSystemAdmins, request.id)));
}
