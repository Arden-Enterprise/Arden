import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import type { AuthProvider, AuthSessionTokens } from "./auth/provider.js";
import type { ArdenDataRepository, DraftCursor, DraftPatch, DraftWrite, PrivateDraft } from "./db/repository.js";
import type { PrivateContentStorage } from "./private-notes/content-storage.js";
import type { InvitationMailer } from "./email/smtp-mailer.js";

const maxBodyBytes = 100_000;
const maxTitleCodePoints = 200;
const defaultListLimit = 50;
const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

type AppDependencies = {
  checkDatabase: () => Promise<void>;
  auth: AuthProvider | null;
  authTrustedOrigins: string[];
  secureCookies: boolean;
  repository: ArdenDataRepository;
  storage: PrivateContentStorage;
  invitationMailer?: InvitationMailer | null;
  publicWebOrigin?: string | null;
};

type SessionContext = { userId: string; email: string; fullName: string | null; emailVerified: boolean };

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: {
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie", "req.body.password", "req.body.token", "res.headers.set-cookie"],
        censor: "[REDACTED]",
      },
    },
    bodyLimit: 128 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
  });
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.code(400).send(safeError("INVALID_REQUEST", "The request is invalid.", request.id));
    }
    if (error.statusCode === 413) {
      return reply.code(413).send(safeError("REQUEST_TOO_LARGE", "The request is too large.", request.id));
    }
    request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Request failed");
    return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
  });

  app.get("/api/health/live", async () => ({ status: "ok" }));

  app.get("/api/health/ready", async (_request, reply) => {
    try {
      await dependencies.checkDatabase();
      return { status: "ok" };
    } catch {
      reply.code(503);
      return { status: "unavailable" };
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
      request.url.startsWith("/api/v1/") && !hasTrustedOrigin(request, dependencies.authTrustedOrigins)) {
      return reply.code(403).send(safeError("UNTRUSTED_ORIGIN", "This request origin is not allowed.", request.id));
    }
  });

  app.post<{ Body: { email: string; password: string } }>("/api/v1/auth/sign-in", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["email", "password"],
        properties: {
          email: { type: "string", minLength: 3, maxLength: 320, format: "email" },
          password: { type: "string", minLength: 1, maxLength: 1024 },
        },
      },
    },
  }, async (request, reply) => {
    if (!dependencies.auth) return authUnavailable(reply, request);
    try {
      const result = await dependencies.auth.signIn({ email: request.body.email.trim().toLowerCase(), password: request.body.password });
      setAuthCookies(reply, result.tokens, dependencies.secureCookies);
      return { authenticated: true };
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
        return reply.code(401).send(safeError("INVALID_CREDENTIALS", "Email or password is incorrect.", request.id));
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Supabase sign-in failed");
      return authUnavailable(reply, request);
    }
  });

  app.post<{ Body: { email: string; password: string; fullName: string } }>("/api/v1/auth/sign-up", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["email", "password", "fullName"],
        properties: {
          email: { type: "string", minLength: 3, maxLength: 320, format: "email" },
          password: { type: "string", minLength: 1, maxLength: 1024 },
          fullName: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (request, reply) => {
    if (!dependencies.auth) return authUnavailable(reply, request);
    try {
      await dependencies.auth.signUp({
        email: request.body.email.trim().toLowerCase(),
        password: request.body.password,
        fullName: request.body.fullName.trim(),
      });
      return reply.code(202).send({
        status: "check_email",
        message: "If account setup can proceed, check your email for confirmation. Then return to this invitation and sign in to accept it.",
      });
    } catch (error) {
      if (error instanceof Error && error.message === "SIGNUP_REJECTED") {
        return reply.code(400).send(safeError("ACCOUNT_SETUP_UNAVAILABLE", "Account setup could not be completed. Check the password requirements or sign in.", request.id));
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Supabase sign-up failed");
      return authUnavailable(reply, request);
    }
  });

  app.post("/api/v1/auth/sign-out", async (request, reply) => {
    if (!dependencies.auth) return authUnavailable(reply, request);
    const tokens = readAuthCookies(request.headers.cookie, dependencies.secureCookies);
    try {
      if (tokens) await dependencies.auth.signOut(tokens);
      clearAuthCookies(reply, dependencies.secureCookies);
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Supabase sign-out failed");
      clearAuthCookies(reply, dependencies.secureCookies);
      return authUnavailable(reply, request);
    }
  });

  app.get("/api/v1/me", async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    try {
      const memberships = await dependencies.repository.listMemberships(context.userId);
      return {
        actor: { id: context.userId },
        memberships: memberships.map((membership) => ({
          organization: { id: membership.organizationId, name: membership.organizationName },
          status: membership.status.toLowerCase(),
          roleCodes: membership.roleCodes,
          canUsePrivateWorkspace: membership.canUsePrivateWorkspace,
        })),
      };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Membership lookup failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Body: { name: string; departmentName: string } }>("/api/v1/organizations", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["name", "departmentName"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 120 },
          departmentName: { type: "string", minLength: 1, maxLength: 80 },
        },
      },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    const name = request.body.name.trim();
    const departmentName = request.body.departmentName.trim();
    if (!isValidLabel(name, 120) || !isValidLabel(departmentName, 80) || !context.emailVerified || !isNormalizedEmail(context.email)) {
      return reply.code(400).send(safeError("INVALID_ORGANIZATION", "Verified account details and non-empty names are required.", request.id));
    }
    try {
      const organization = await dependencies.repository.createOrganization(
        context.userId, context.email, context.fullName, { name, departmentName }, request.id,
      );
      reply.header("Location", `/api/v1/organizations/${organization.organizationId}`);
      return reply.code(201).send({ organization });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.code(409).send(safeError("ORGANIZATION_CONFLICT", "An organization with these details could not be created.", request.id));
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Organization creation failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string } }>("/api/v1/organizations/:organizationId/administration", {
    schema: { params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } } },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    try {
      const administration = await dependencies.repository.getOrganizationAdministration(context.userId, request.params.organizationId);
      if (!administration) return reply.code(404).send(resourceNotAvailable(request.id));
      return administration;
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Organization administration lookup failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string }; Body: { name: string } }>("/api/v1/organizations/:organizationId/departments", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 } } },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    const name = request.body.name.trim();
    if (!isValidLabel(name, 80)) return reply.code(400).send(safeError("INVALID_REQUEST", "Enter a valid department name.", request.id));
    try {
      const created = await dependencies.repository.createDepartment(context.userId, request.params.organizationId, name, request.id);
      if (!created) return reply.code(404).send(resourceNotAvailable(request.id));
      return reply.code(201).send({ name, status: "active" });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Department creation failed");
      return reply.code(isUniqueViolation(error) ? 409 : 500).send(safeError(isUniqueViolation(error) ? "DEPARTMENT_CONFLICT" : "INTERNAL_ERROR", isUniqueViolation(error) ? "A department with this name could not be created." : "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string }; Body: { name: string } }>("/api/v1/organizations/:organizationId/roles", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", minLength: 1, maxLength: 80 } } },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    const name = request.body.name.trim();
    if (!isValidLabel(name, 80)) return reply.code(400).send(safeError("INVALID_REQUEST", "Enter a valid role name.", request.id));
    try {
      const created = await dependencies.repository.createOrganizationRole(context.userId, request.params.organizationId, name, request.id);
      if (!created) return reply.code(404).send(resourceNotAvailable(request.id));
      return reply.code(201).send({ name, audiencePermissions: ["view", "search", "contribute"] });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Role creation failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string; membershipId: string }; Body: { roleId: string } }>("/api/v1/organizations/:organizationId/members/:membershipId/roles", {
    schema: {
      params: {
        type: "object", required: ["organizationId", "membershipId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, membershipId: { type: "string", pattern: uuidPattern } },
      },
      body: { type: "object", additionalProperties: false, required: ["roleId"], properties: { roleId: { type: "string", pattern: uuidPattern } } },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    try {
      const assigned = await dependencies.repository.assignOrganizationRole(context.userId, request.params.organizationId, request.params.membershipId, request.body.roleId, request.id);
      if (!assigned) return reply.code(404).send(resourceNotAvailable(request.id));
      return reply.code(201).send({ membershipId: request.params.membershipId, roleId: request.body.roleId, status: "active" });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Role assignment failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string; membershipId: string }; Body: { departmentId: string } }>("/api/v1/organizations/:organizationId/members/:membershipId/department", {
    schema: {
      params: {
        type: "object", required: ["organizationId", "membershipId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, membershipId: { type: "string", pattern: uuidPattern } },
      },
      body: { type: "object", additionalProperties: false, required: ["departmentId"], properties: { departmentId: { type: "string", pattern: uuidPattern } } },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    try {
      const changed = await dependencies.repository.changePrimaryDepartment(context.userId, request.params.organizationId, request.params.membershipId, request.body.departmentId, request.id);
      if (!changed) return reply.code(404).send(resourceNotAvailable(request.id));
      return reply.code(200).send({ membershipId: request.params.membershipId, departmentId: request.body.departmentId });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Primary department update failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string }; Body: { departmentId: string; email: string } }>("/api/v1/organizations/:organizationId/invitations", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      body: {
        type: "object", additionalProperties: false, required: ["departmentId", "email"],
        properties: {
          departmentId: { type: "string", pattern: uuidPattern },
          email: { type: "string", minLength: 3, maxLength: 320, format: "email" },
        },
      },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    if (!context.emailVerified) return reply.code(403).send(safeError("VERIFIED_EMAIL_REQUIRED", "Verify your account email before inviting a member.", request.id));
    if (!dependencies.invitationMailer || !dependencies.publicWebOrigin) {
      return reply.code(503).send(safeError("INVITATIONS_UNAVAILABLE", "Invitation email is not configured.", request.id));
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashInvitationToken(token);
    const email = request.body.email.trim().toLowerCase();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    try {
      const invitation = await dependencies.repository.createInvitation(
        context.userId, request.params.organizationId, request.body.departmentId, email, tokenHash, expiresAt, request.id,
      );
      if (!invitation) return reply.code(404).send(resourceNotAvailable(request.id));
      try {
        await dependencies.invitationMailer.sendInvitation({
          to: invitation.email, organizationName: invitation.organizationName,
          invitationUrl: `${dependencies.publicWebOrigin}/invite/${token}`, expiresAt: invitation.expiresAt,
        });
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), invitationId: invitation.invitationId, requestId: request.id }, "Invitation email delivery failed");
        return reply.code(502).send({ ...safeError("INVITATION_DELIVERY_FAILED", "The invitation was saved but its email was not delivered. Retry sending it from organization administration.", request.id), invitationId: invitation.invitationId });
      }
      return reply.code(202).send({ invitationId: invitation.invitationId, status: "pending", expiresAt: invitation.expiresAt.toISOString() });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Invitation creation failed");
      return reply.code(isUniqueViolation(error) ? 409 : 500).send(safeError(isUniqueViolation(error) ? "INVITATION_CONFLICT" : "INTERNAL_ERROR", isUniqueViolation(error) ? "A pending invitation already exists for this email." : "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string; invitationId: string } }>("/api/v1/organizations/:organizationId/invitations/:invitationId/resend", {
    schema: {
      params: {
        type: "object", required: ["organizationId", "invitationId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, invitationId: { type: "string", pattern: uuidPattern } },
      },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    if (!context.emailVerified) return reply.code(403).send(safeError("VERIFIED_EMAIL_REQUIRED", "Verify your account email before resending an invitation.", request.id));
    if (!dependencies.invitationMailer || !dependencies.publicWebOrigin) return reply.code(503).send(safeError("INVITATIONS_UNAVAILABLE", "Invitation email is not configured.", request.id));
    const token = randomBytes(32).toString("base64url");
    let invitation: Awaited<ReturnType<ArdenDataRepository["rotateInvitation"]>>;
    try {
      invitation = await dependencies.repository.rotateInvitation(
        context.userId, request.params.organizationId, request.params.invitationId, hashInvitationToken(token), request.id,
      );
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), invitationId: request.params.invitationId, requestId: request.id }, "Invitation resend lookup failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
    if (!invitation) return reply.code(404).send(resourceNotAvailable(request.id));
    try {
      await dependencies.invitationMailer.sendInvitation({
        to: invitation.email, organizationName: invitation.organizationName,
        invitationUrl: `${dependencies.publicWebOrigin}/invite/${token}`, expiresAt: invitation.expiresAt,
      });
      return reply.code(202).send({ invitationId: invitation.invitationId, status: "pending", expiresAt: invitation.expiresAt.toISOString() });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), invitationId: request.params.invitationId, requestId: request.id }, "Invitation resend failed");
      return reply.code(502).send(safeError("INVITATION_DELIVERY_FAILED", "The invitation could not be delivered. Retry sending it from organization administration.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string; invitationId: string } }>("/api/v1/organizations/:organizationId/invitations/:invitationId/revoke", {
    schema: {
      params: {
        type: "object", required: ["organizationId", "invitationId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, invitationId: { type: "string", pattern: uuidPattern } },
      },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    try {
      const revoked = await dependencies.repository.revokeInvitation(
        context.userId, request.params.organizationId, request.params.invitationId, request.id,
      );
      if (!revoked) return reply.code(404).send(resourceNotAvailable(request.id));
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Invitation revoke failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Body: { token: string } }>("/api/v1/invitations/accept", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["token"], properties: { token: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]+$" } } },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    try {
      const accepted = await dependencies.repository.acceptInvitation(
        context.userId, context.email, context.fullName, context.emailVerified,
        hashInvitationToken(request.body.token), request.id,
      );
      if (!accepted) return reply.code(404).send(safeError("INVITATION_NOT_AVAILABLE", "This invitation is not available for this account.", request.id));
      return reply.code(204).send();
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Invitation acceptance failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string }; Body: DraftWrite }>("/api/v1/organizations/:organizationId/private-workspace/drafts", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      body: draftBodySchema,
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    const organizationId = request.params.organizationId;
    const write = normalizeWrite(request.body);
    if (!write) return reply.code(400).send(safeError("INVALID_REQUEST", "The note is invalid.", request.id));
    try {
      if (!await dependencies.repository.canCreateDraft(context.userId, organizationId)) {
        return reply.code(404).send(resourceNotAvailable(request.id));
      }
      const stored = await dependencies.storage.write(write.body);
      const draft = await dependencies.repository.createDraft(context.userId, organizationId, write, stored, request.id);
      if (!draft) {
        await dependencies.storage.remove(stored.sourceUri);
        return reply.code(404).send(resourceNotAvailable(request.id));
      }
      const response = await representDraft(draft, dependencies.storage);
      reply.header("Location", `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draft.id}`);
      reply.header("ETag", etag(draft.currentVersion));
      return reply.code(201).send(response);
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Private draft creation failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string }; Querystring: { limit?: string; cursor?: string } }>("/api/v1/organizations/:organizationId/private-workspace/drafts", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "string", pattern: "^(?:[1-9][0-9]?|100)$", maxLength: 3 },
          cursor: { type: "string", maxLength: 1024 },
        },
      },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    const limit = request.query.limit ? Number(request.query.limit) : defaultListLimit;
    const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : null;
    if (request.query.cursor && !cursor) return reply.code(400).send(safeError("INVALID_REQUEST", "The cursor is invalid.", request.id));
    try {
      const result = await dependencies.repository.listDrafts(context.userId, request.params.organizationId, limit, cursor);
      if (!result) return reply.code(404).send(resourceNotAvailable(request.id));
      return {
        items: result.items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
        nextCursor: result.nextCursor ? encodeCursor(result.nextCursor) : null,
      };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Private draft list failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string; draftId: string } }>("/api/v1/organizations/:organizationId/private-workspace/drafts/:draftId", {
    schema: {
      params: {
        type: "object", required: ["organizationId", "draftId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, draftId: { type: "string", pattern: uuidPattern } },
      },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    try {
      const draft = await dependencies.repository.getDraft(context.userId, request.params.organizationId, request.params.draftId);
      if (!draft) return reply.code(404).send(resourceNotAvailable(request.id));
      const representation = await representDraft(draft, dependencies.storage);
      reply.header("ETag", etag(draft.currentVersion));
      return representation;
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Private draft read failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.patch<{ Params: { organizationId: string; draftId: string }; Body: DraftPatch }>("/api/v1/organizations/:organizationId/private-workspace/drafts/:draftId", {
    schema: {
      params: {
        type: "object", required: ["organizationId", "draftId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, draftId: { type: "string", pattern: uuidPattern } },
      },
      body: {
        type: "object", additionalProperties: false, minProperties: 1,
        properties: {
          title: { type: "string", maxLength: 800 },
          body: { type: "string", maxLength: maxBodyBytes },
        },
      },
      headers: { type: "object", properties: { "if-match": { type: "string", maxLength: 64 } } },
    },
  }, async (request, reply) => {
    const context = await requestContext(request, reply, dependencies.auth, dependencies.secureCookies);
    if (!context) return;
    const expectedVersion = parseEtag(request.headers["if-match"]);
    if (expectedVersion === "missing") return reply.code(428).send(safeError("PRECONDITION_REQUIRED", "Reload the note before saving.", request.id));
    if (expectedVersion === null) return reply.code(400).send(safeError("INVALID_REQUEST", "The version precondition is invalid.", request.id));
    const patch = normalizePatch(request.body);
    if (!patch) return reply.code(400).send(safeError("INVALID_REQUEST", "The note is invalid.", request.id));
    const { organizationId, draftId } = request.params;
    let stored: Awaited<ReturnType<PrivateContentStorage["write"]>> | null = null;
    try {
      if (!await dependencies.repository.canUpdateDraft(context.userId, organizationId, draftId)) {
        return reply.code(404).send(resourceNotAvailable(request.id));
      }
      if (patch.body !== undefined) stored = await dependencies.storage.write(patch.body);
      const result = await dependencies.repository.updateDraft(context.userId, organizationId, draftId, expectedVersion, patch, stored, request.id);
      if (result.kind === "not-found") {
        if (stored) await dependencies.storage.remove(stored.sourceUri);
        return reply.code(404).send(resourceNotAvailable(request.id));
      }
      if (result.kind === "conflict") {
        if (stored) await dependencies.storage.remove(stored.sourceUri);
        return reply.code(412).send(safeError("VERSION_CONFLICT", "This note changed. Reload it before saving again.", request.id));
      }
      const representation = await representDraft(result.draft, dependencies.storage);
      reply.header("ETag", etag(result.draft.currentVersion));
      return representation;
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Private draft update failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  return app;
}

async function requestContext(request: FastifyRequest, reply: FastifyReply, auth: AuthProvider | null, secureCookies: boolean): Promise<SessionContext | null> {
  if (!auth) {
    authUnavailable(reply, request);
    return null;
  }
  const tokens = readAuthCookies(request.headers.cookie, secureCookies);
  if (!tokens) {
    reply.code(401).send(safeError("UNAUTHENTICATED", "Sign in to continue.", request.id));
    return null;
  }
  try {
    const resolution = await auth.resolveSession(tokens);
    if (resolution.kind === "authenticated") {
      if (resolution.rotatedSession) setAuthCookies(reply, resolution.rotatedSession, secureCookies);
      return {
        userId: resolution.userId,
        email: resolution.email,
        fullName: resolution.fullName,
        emailVerified: resolution.emailVerified,
      };
    }
    if (resolution.kind === "unavailable") {
      authUnavailable(reply, request);
      return null;
    }
    clearAuthCookies(reply, secureCookies);
    reply.code(401).send(safeError("UNAUTHENTICATED", "Sign in to continue.", request.id));
    return null;
  } catch (error) {
    request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Supabase session validation failed");
    authUnavailable(reply, request);
    return null;
  }
}

function cookieNames(secure: boolean): { access: string; refresh: string } {
  return secure
    ? { access: "__Host-arden_access", refresh: "__Host-arden_refresh" }
    : { access: "arden_access", refresh: "arden_refresh" };
}

function readAuthCookies(header: string | undefined, secure: boolean): AuthSessionTokens | null {
  if (!header || header.length > 8192) return null;
  const names = cookieNames(secure);
  const parsed = new Map<string, string>();
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name === names.access || name === names.refresh) parsed.set(name, segment.slice(separator + 1).trim());
  }
  const accessToken = parsed.get(names.access);
  const refreshToken = parsed.get(names.refresh);
  if (!accessToken || !refreshToken || accessToken.length > 4096 || refreshToken.length > 2048) return null;
  return { accessToken, refreshToken, expiresIn: 3600 };
}

function setAuthCookies(reply: FastifyReply, tokens: AuthSessionTokens, secure: boolean): void {
  const names = cookieNames(secure);
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  reply.header("set-cookie", [
    `${names.access}=${tokens.accessToken}; ${attributes}`,
    `${names.refresh}=${tokens.refreshToken}; ${attributes}`,
  ]);
}

function clearAuthCookies(reply: FastifyReply, secure: boolean): void {
  const names = cookieNames(secure);
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=0`;
  reply.header("set-cookie", [`${names.access}=; ${attributes}`, `${names.refresh}=; ${attributes}`]);
}

function hasTrustedOrigin(request: FastifyRequest, trustedOrigins: string[]): boolean {
  const origin = request.headers.origin;
  return typeof origin === "string" && trustedOrigins.includes(origin);
}

async function representDraft(draft: PrivateDraft, storage: PrivateContentStorage) {
  const body = await storage.read(draft.sourceUri, draft.contentHash);
  return {
    id: draft.id,
    organizationId: draft.organizationId,
    title: draft.title,
    body,
    currentVersion: {
      id: draft.versionId,
      version: draft.currentVersion,
      mimeType: draft.mimeType,
      contentHash: draft.contentHash,
    },
    version: draft.currentVersion,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

const draftBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "body"],
  properties: {
    title: { type: "string", maxLength: 800 },
    body: { type: "string", maxLength: maxBodyBytes },
  },
};

function normalizeWrite(value: DraftWrite): DraftWrite | null {
  if (!isValidText(value.title, 800, maxTitleCodePoints) || !isValidText(value.body, maxBodyBytes, maxBodyBytes)) return null;
  return { title: value.title.trim() || "Untitled private note", body: value.body };
}

function normalizePatch(value: DraftPatch): DraftPatch | null {
  if (Object.keys(value).length === 0) return null;
  if (value.title !== undefined && !isValidText(value.title, 800, maxTitleCodePoints)) return null;
  if (value.body !== undefined && !isValidText(value.body, maxBodyBytes, maxBodyBytes)) return null;
  return { ...value, title: value.title === undefined ? undefined : value.title.trim() || "Untitled private note" };
}

function isValidText(value: string, maxBytes: number, maxCodePoints: number): boolean {
  return !value.includes("\u0000") && Buffer.byteLength(value, "utf8") <= maxBytes && Array.from(value).length <= maxCodePoints;
}

function parseEtag(value: string | undefined): number | "missing" | null {
  if (value === undefined) return "missing";
  const match = /^"([1-9][0-9]*)"$/.exec(value);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : null;
}

function etag(version: number): string { return `"${version}"`; }

function encodeCursor(cursor: DraftCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): DraftCursor | null {
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) return null;
    if (typeof record.draftId !== "string" || !new RegExp(uuidPattern, "i").test(record.draftId)) return null;
    return { updatedAt: new Date(record.updatedAt).toISOString(), draftId: record.draftId };
  } catch {
    return null;
  }
}

function safeError(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

function safeErrorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

function isNormalizedEmail(email: string): boolean {
  return email.length <= 320 && email === email.trim().toLowerCase() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidLabel(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && !value.includes("\u0000");
}

function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function resourceNotAvailable(requestId: string) {
  return safeError("RESOURCE_NOT_AVAILABLE", "This resource is not available.", requestId);
}

function authUnavailable(reply: FastifyReply, request: FastifyRequest) {
  return reply.code(503).send(safeError("AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.", request.id));
}
