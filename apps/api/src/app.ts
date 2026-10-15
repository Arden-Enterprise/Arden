import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import type { AuthProvider, AuthSessionTokens } from "./auth/provider.js";
import type { ArdenDataRepository, DraftCursor, DraftPatch, DraftWrite, PrivateDraft, ReviewerGrantInput, SharedDraftPatch, SharedKnowledgeDraft, SharedKnowledgeSubmission } from "./db/repository.js";
import type { PrivateContentStorage } from "./private-notes/content-storage.js";
import type { InvitationMailer } from "./email/smtp-mailer.js";
import type { KnowledgeClassification } from "./knowledge/policy.js";
import { registerCustomRoleRoutes, roleFailure, roleWriteProperties } from "./roles/routes.js";
import { validCustomRoleName, type RolePermission } from "./roles/policy.js";
import { RoleError } from "./roles/store.js";

const maxBodyBytes = 100_000;
const maxPdfBytes = 5 * 1024 * 1024;
const maxPdfBase64Length = Math.ceil(maxPdfBytes / 3) * 4;
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
  invitationDeliveryMode?: "email" | "local-test-no-email";
  testActor?: SessionContext;
};

type SessionContext = { userId: string; email: string; fullName: string | null; emailVerified: boolean };
type CreateSharedDraftBody = { sourcePrivateVersionId: string; classification: KnowledgeClassification };

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
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    if (typeof body === "string" && body.trim().length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });
  const requestActor = (request: FastifyRequest, reply: FastifyReply) =>
    requireAuthenticatedActor(request, reply, dependencies.auth, dependencies.secureCookies, dependencies.testActor);
  registerCustomRoleRoutes(app, dependencies.repository.customRoles, requestActor, uuidPattern);
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.code(400).send(safeError("INVALID_REQUEST", "The request is invalid.", request.id));
    }
    if (error.statusCode === 413) {
      return reply.code(413).send(safeError("REQUEST_TOO_LARGE", "The request is too large.", request.id));
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send(safeError("INVALID_REQUEST", "The request is invalid.", request.id));
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
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Authentication provider sign-in failed");
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
    if (dependencies.testActor) return reply.code(204).send();
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
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const memberships = await dependencies.repository.listMemberships(context.userId);
      return {
        actor: { id: context.userId, email: context.email },
        ...(dependencies.testActor ? { testMode: true } : {}),
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
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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

  app.post<{ Params: { organizationId: string }; Body: { name: string; description?: string; permissions?: RolePermission[] } }>("/api/v1/organizations/:organizationId/roles", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      body: { type: "object", additionalProperties: false, required: ["name"], properties: roleWriteProperties },
    },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    const name = request.body.name.trim();
    if (!isValidLabel(name, 80) || !validCustomRoleName(name)) return reply.code(400).send(safeError("INVALID_REQUEST", "Enter a valid custom role name.", request.id));
    try {
      if (dependencies.repository.customRoles) {
        const role = await dependencies.repository.customRoles.create(context.userId, request.params.organizationId,
          { name, description: request.body.description ?? "", permissions: request.body.permissions ?? [] }, request.id);
        reply.header("Cache-Control", "no-store").header("ETag", `"role-${role.version}"`);
        return reply.code(201).send(role);
      }
      const created = await dependencies.repository.createOrganizationRole(context.userId, request.params.organizationId, name, request.id);
      if (!created) return reply.code(404).send(resourceNotAvailable(request.id));
      return reply.code(201).send({ name, audiencePermissions: [] });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Role creation failed");
      if (error instanceof RoleError) return roleFailure(reply, error);
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
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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
      return reply.code(202).send({
        invitationId: invitation.invitationId,
        status: "pending",
        deliveryMode: dependencies.invitationDeliveryMode ?? "email",
        expiresAt: invitation.expiresAt.toISOString(),
      });
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
    const context = await requestActor(request, reply);
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
      return reply.code(202).send({
        invitationId: invitation.invitationId,
        status: "pending",
        deliveryMode: dependencies.invitationDeliveryMode ?? "email",
        expiresAt: invitation.expiresAt.toISOString(),
      });
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
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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

  app.post<{ Params: { organizationId: string }; Body: CreateSharedDraftBody }>("/api/v1/organizations/:organizationId/knowledge/drafts", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      headers: { type: "object", required: ["idempotency-key"], properties: {
        "idempotency-key": { type: "string", pattern: uuidPattern },
      } },
      body: { type: "object", additionalProperties: false, required: ["sourcePrivateVersionId", "classification"], properties: {
        sourcePrivateVersionId: { type: "string", pattern: uuidPattern },
        classification: { type: "string", enum: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] },
      } },
    },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    const { organizationId } = request.params;
    let copied: Awaited<ReturnType<PrivateContentStorage["write"]>> | null = null;
    let committed = false;
    let creationAttempted = false;
    try {
      const actor = await dependencies.repository.requireActiveMembership(context.userId, organizationId);
      if (!actor) return reply.code(404).send(resourceNotAvailable(request.id));
      const source = await dependencies.repository.getPrivateContributionSource(
        context.userId, organizationId, request.body.sourcePrivateVersionId,
      );
      if (!source) return reply.code(404).send(resourceNotAvailable(request.id));
      if (source.mimeType !== "text/plain" || !isValidText(source.title, 800, maxTitleCodePoints)) {
        return reply.code(409).send(safeError("SOURCE_NOT_SUPPORTED", "This note version cannot be copied.", request.id));
      }
      const body = await dependencies.storage.read(source.sourceUri, source.contentHash);
      if (!isValidText(body, maxBodyBytes, maxBodyBytes)) {
        return reply.code(409).send(safeError("SOURCE_NOT_SUPPORTED", "This note version cannot be copied.", request.id));
      }
      copied = await dependencies.storage.write(body);
      creationAttempted = true;
      const result = await dependencies.repository.createKnowledgeDraft(context.userId, organizationId, {
        actorMembershipId: actor.membershipId,
        sourceVersionId: source.versionId,
        classification: request.body.classification,
        idempotencyKey: request.headers["idempotency-key"] as string,
        expectedSource: source,
        copiedContent: copied,
        requestId: request.id,
      });
      if (result.kind === "unavailable" || result.kind === "idempotency-conflict") {
        await dependencies.storage.remove(copied.sourceUri);
        copied = null;
        return result.kind === "unavailable"
          ? reply.code(404).send(resourceNotAvailable(request.id))
          : reply.code(409).send(safeError("IDEMPOTENCY_CONFLICT", "Use a new idempotency key for a different request.", request.id));
      }
      if (result.kind === "created") committed = true;
      else {
        await dependencies.storage.remove(copied.sourceUri);
        copied = null;
      }
      const responseBody = result.kind === "created" ? body
        : await dependencies.storage.read(result.draft.sourceUri, result.draft.contentHash);
      reply.header("Cache-Control", "no-store");
      reply.header("ETag", etag(result.draft.currentVersion));
      return reply.code(result.kind === "created" ? 201 : 200).send({
        id: result.draft.id,
        organizationId,
        title: result.draft.title,
        classification: result.draft.classification,
        status: "ACTIVE",
        body: responseBody,
        currentVersion: {
          id: result.draft.versionId,
          version: result.draft.currentVersion,
          mimeType: result.draft.mimeType,
          contentHash: result.draft.contentHash,
        },
        createdAt: result.draft.createdAt.toISOString(),
        updatedAt: result.draft.updatedAt.toISOString(),
      });
    } catch (error) {
      // A failed COMMIT acknowledgement is ambiguous: the database may already
      // reference this copy. Keep it until a reconciler can prove it is orphaned.
      if (copied && !committed && !creationAttempted) {
        try { await dependencies.storage.remove(copied.sourceUri); }
        catch (cleanupError) {
          request.log.error({ errorType: safeErrorType(cleanupError), requestId: request.id }, "Shared draft copy cleanup failed");
        }
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Shared draft creation failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string }; Body: { title: string; body: string; classification: KnowledgeClassification } }>(
    "/api/v1/organizations/:organizationId/knowledge/drafts/new", {
      schema: {
        params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
        headers: { type: "object", required: ["idempotency-key"], properties: {
          "idempotency-key": { type: "string", pattern: uuidPattern },
        } },
        body: { type: "object", additionalProperties: false, required: ["title", "body", "classification"], properties: {
          title: { type: "string", minLength: 1, maxLength: 800 },
          body: { type: "string", maxLength: maxBodyBytes },
          classification: { type: "string", enum: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] },
        } },
      },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      const { organizationId } = request.params;
      const title = request.body.title.trim();
      if (!title || !isValidText(title, 800, maxTitleCodePoints)
        || !isValidText(request.body.body, maxBodyBytes, maxBodyBytes)) {
        return reply.code(400).send(safeError("INVALID_REQUEST", "The draft is invalid.", request.id));
      }
      let stored: Awaited<ReturnType<PrivateContentStorage["write"]>> | null = null;
      let creationAttempted = false;
      try {
        const actor = await dependencies.repository.requireActiveMembership(context.userId, organizationId);
        if (!actor) return reply.code(404).send(resourceNotAvailable(request.id));
        stored = await dependencies.storage.write(request.body.body);
        creationAttempted = true;
        const result = await dependencies.repository.createNewKnowledgeDraft(context.userId, organizationId, {
          actorMembershipId: actor.membershipId, title, classification: request.body.classification,
          idempotencyKey: request.headers["idempotency-key"] as string, content: stored, requestId: request.id,
        });
        if (result.kind === "unavailable" || result.kind === "idempotency-conflict") {
          await dependencies.storage.remove(stored.sourceUri);
          return result.kind === "unavailable"
            ? reply.code(404).send(resourceNotAvailable(request.id))
            : reply.code(409).send(safeError("IDEMPOTENCY_CONFLICT", "Use a new idempotency key for a different request.", request.id));
        }
        if (result.kind === "replayed") await dependencies.storage.remove(stored.sourceUri);
        const body = result.kind === "created" ? request.body.body
          : await dependencies.storage.read(result.draft.sourceUri, result.draft.contentHash);
        reply.header("Cache-Control", "no-store");
        reply.header("ETag", etag(result.draft.currentVersion));
        return reply.code(result.kind === "created" ? 201 : 200).send(representSharedDraft(result.draft, body));
      } catch (error) {
        if (stored && !creationAttempted) {
          try { await dependencies.storage.remove(stored.sourceUri); }
          catch (cleanupError) {
            request.log.error({ errorType: safeErrorType(cleanupError), requestId: request.id }, "Shared draft cleanup failed");
          }
        }
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Shared draft creation failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.post<{ Params: { organizationId: string }; Body: { title: string; pdfBase64: string; classification: KnowledgeClassification } }>(
    "/api/v1/organizations/:organizationId/knowledge/drafts/pdf", {
      bodyLimit: maxPdfBase64Length + 4096,
      schema: {
        params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
        headers: { type: "object", required: ["idempotency-key"], properties: {
          "idempotency-key": { type: "string", pattern: uuidPattern },
        } },
        body: { type: "object", additionalProperties: false, required: ["title", "pdfBase64", "classification"], properties: {
          title: { type: "string", minLength: 1, maxLength: 800 },
          pdfBase64: { type: "string", minLength: 8, maxLength: maxPdfBase64Length },
          classification: { type: "string", enum: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] },
        } },
      },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      const title = request.body.title.trim();
      const encoded = request.body.pdfBase64;
      if (!title || !isValidText(title, 800, maxTitleCodePoints) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        return reply.code(400).send(safeError("INVALID_PDF", "Choose a valid PDF file.", request.id));
      }
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length === 0 || bytes.length > maxPdfBytes || bytes.toString("base64") !== encoded
        || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
        || !bytes.subarray(-1024).toString("latin1").includes("%%EOF")) {
        return reply.code(400).send(safeError("INVALID_PDF", "Choose a valid PDF file up to 5 MB.", request.id));
      }
      let stored: Awaited<ReturnType<PrivateContentStorage["writePdf"]>> | null = null;
      let creationAttempted = false;
      try {
        const actor = await dependencies.repository.requireActiveMembership(context.userId, request.params.organizationId);
        if (!actor) return reply.code(404).send(resourceNotAvailable(request.id));
        stored = await dependencies.storage.writePdf(bytes);
        creationAttempted = true;
        const result = await dependencies.repository.createNewKnowledgeDraft(context.userId, request.params.organizationId, {
          actorMembershipId: actor.membershipId, title, classification: request.body.classification,
          idempotencyKey: request.headers["idempotency-key"] as string, content: stored, requestId: request.id,
        });
        if (result.kind === "unavailable" || result.kind === "idempotency-conflict") {
          await dependencies.storage.remove(stored.sourceUri);
          return result.kind === "unavailable" ? reply.code(404).send(resourceNotAvailable(request.id))
            : reply.code(409).send(safeError("IDEMPOTENCY_CONFLICT", "Use a new idempotency key for a different request.", request.id));
        }
        if (result.kind === "replayed") await dependencies.storage.remove(stored.sourceUri);
        const pdfBase64 = result.kind === "created" ? encoded
          : (await dependencies.storage.readPdf(result.draft.sourceUri, result.draft.contentHash)).toString("base64");
        reply.header("Cache-Control", "no-store");
        reply.header("ETag", etag(result.draft.currentVersion));
        return reply.code(result.kind === "created" ? 201 : 200).send({ ...representSharedDraft(result.draft, ""), pdfBase64 });
      } catch (error) {
        if (stored && !creationAttempted) {
          try { await dependencies.storage.remove(stored.sourceUri); }
          catch (cleanupError) { request.log.error({ errorType: safeErrorType(cleanupError), requestId: request.id }, "PDF cleanup failed"); }
        }
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "PDF draft creation failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.get<{ Params: { organizationId: string } }>("/api/v1/organizations/:organizationId/knowledge/options", {
    schema: { params: { type: "object", required: ["organizationId"], properties: {
      organizationId: { type: "string", pattern: uuidPattern },
    } } },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const options = await dependencies.repository.getKnowledgeOptions(context.userId, request.params.organizationId);
      if (!options) return reply.code(404).send(resourceNotAvailable(request.id));
      reply.header("Cache-Control", "no-store");
      return options;
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Knowledge options failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string } }>("/api/v1/organizations/:organizationId/knowledge/drafts", {
    schema: { params: { type: "object", required: ["organizationId"], properties: {
      organizationId: { type: "string", pattern: uuidPattern },
    } } },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const drafts = await dependencies.repository.listKnowledgeDrafts(context.userId, request.params.organizationId);
      if (!drafts) return reply.code(404).send(resourceNotAvailable(request.id));
      reply.header("Cache-Control", "no-store");
      return { items: drafts.map(({ sourceUri: _sourceUri, sourcePrivateVersionId: _privateSource, ...draft }) => draft) };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Shared draft list failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string; draftId: string } }>("/api/v1/organizations/:organizationId/knowledge/drafts/:draftId", {
    schema: { params: { type: "object", required: ["organizationId", "draftId"], properties: {
      organizationId: { type: "string", pattern: uuidPattern }, draftId: { type: "string", pattern: uuidPattern },
    } } },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const draft = await dependencies.repository.getKnowledgeDraft(context.userId, request.params.organizationId, request.params.draftId);
      if (!draft) return reply.code(404).send(resourceNotAvailable(request.id));
      const content = await readKnowledgeContent(dependencies.storage, draft.sourceUri, draft.contentHash, draft.mimeType);
      const stillAuthorized = await dependencies.repository.getKnowledgeDraft(context.userId, request.params.organizationId, request.params.draftId);
      if (!stillAuthorized || stillAuthorized.versionId !== draft.versionId || stillAuthorized.contentHash !== draft.contentHash) {
        return reply.code(404).send(resourceNotAvailable(request.id));
      }
      reply.header("Cache-Control", "no-store");
      reply.header("ETag", etag(draft.currentVersion));
      return { ...representSharedDraft(draft, content.body), ...(content.pdfBase64 ? { pdfBase64: content.pdfBase64 } : {}) };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Shared draft read failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.patch<{ Params: { organizationId: string; draftId: string }; Body: SharedDraftPatch }>(
    "/api/v1/organizations/:organizationId/knowledge/drafts/:draftId", {
      schema: {
        params: { type: "object", required: ["organizationId", "draftId"], properties: {
          organizationId: { type: "string", pattern: uuidPattern }, draftId: { type: "string", pattern: uuidPattern },
        } },
        headers: { type: "object", properties: { "if-match": { type: "string", maxLength: 64 } } },
        body: { type: "object", additionalProperties: false, minProperties: 1, properties: {
          title: { type: "string", minLength: 1, maxLength: 800 },
          body: { type: "string", maxLength: maxBodyBytes },
          classification: { type: "string", enum: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] },
          responsibleDepartmentId: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
          targetScopeType: { enum: ["ORGANIZATION", "DEPARTMENT", null] },
          teamTag: { type: ["string", "null"], maxLength: 100 },
          projectTag: { type: ["string", "null"], maxLength: 100 },
          audienceRoleIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", pattern: uuidPattern } },
        } },
      },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      const expectedVersion = parseEtag(request.headers["if-match"]);
      if (expectedVersion === "missing") return reply.code(428).send(safeError("PRECONDITION_REQUIRED", "Reload the draft before saving.", request.id));
      if (expectedVersion === null) return reply.code(400).send(safeError("INVALID_REQUEST", "The version precondition is invalid.", request.id));
      const patch = request.body;
      if ((patch.title !== undefined && (!patch.title.trim() || !isValidText(patch.title, 800, maxTitleCodePoints)))
        || (patch.body !== undefined && !isValidText(patch.body, maxBodyBytes, maxBodyBytes))
        || (patch.teamTag !== undefined && patch.teamTag !== null && !patch.teamTag.trim())
        || (patch.projectTag !== undefined && patch.projectTag !== null && !patch.projectTag.trim())) {
        return reply.code(400).send(safeError("INVALID_REQUEST", "The draft is invalid.", request.id));
      }
      const { organizationId, draftId } = request.params;
      let stored: Awaited<ReturnType<PrivateContentStorage["write"]>> | null = null;
      let updateAttempted = false;
      try {
        const existing = await dependencies.repository.getKnowledgeDraft(context.userId, organizationId, draftId);
        if (!existing) return reply.code(404).send(resourceNotAvailable(request.id));
        if (existing.currentVersion !== expectedVersion) {
          return reply.code(412).send(safeError("VERSION_CONFLICT", "This draft changed. Reload it before saving again.", request.id));
        }
        if (existing.hasPendingSubmission) {
          return reply.code(409).send(safeError("REVIEW_PENDING", "A submitted version is awaiting review. Editing can resume after a decision.", request.id));
        }
        if (existing.mimeType === "application/pdf" && patch.body !== undefined) {
          return reply.code(400).send(safeError("INVALID_REQUEST", "Uploaded PDFs cannot be edited as text.", request.id));
        }
        if (patch.body !== undefined) stored = await dependencies.storage.write(patch.body);
        updateAttempted = true;
        const result = await dependencies.repository.updateKnowledgeDraft(context.userId, organizationId, draftId,
          expectedVersion, { ...patch, title: patch.title?.trim(),
            teamTag: patch.teamTag === null ? null : patch.teamTag?.trim(),
            projectTag: patch.projectTag === null ? null : patch.projectTag?.trim() },
          stored, request.id);
        if (result.kind !== "updated") {
          if (stored) await dependencies.storage.remove(stored.sourceUri);
          if (result.kind === "conflict") return reply.code(412).send(safeError("VERSION_CONFLICT", "This draft changed. Reload it before saving again.", request.id));
          if (result.kind === "pending") return reply.code(409).send(safeError("REVIEW_PENDING", "A submitted version is awaiting review. Editing can resume after a decision.", request.id));
          if (result.kind === "invalid-metadata") return reply.code(400).send(safeError("INVALID_METADATA", "The draft metadata is invalid.", request.id));
          return reply.code(404).send(resourceNotAvailable(request.id));
        }
        const content = patch.body !== undefined ? { body: patch.body }
          : await readKnowledgeContent(dependencies.storage, result.draft.sourceUri, result.draft.contentHash, result.draft.mimeType);
        reply.header("Cache-Control", "no-store");
        reply.header("ETag", etag(result.draft.currentVersion));
        return { ...representSharedDraft(result.draft, content.body), ...(content.pdfBase64 ? { pdfBase64: content.pdfBase64 } : {}) };
      } catch (error) {
        if (stored && !updateAttempted) {
          try { await dependencies.storage.remove(stored.sourceUri); }
          catch (cleanupError) {
            request.log.error({ errorType: safeErrorType(cleanupError), requestId: request.id }, "Shared draft update cleanup failed");
          }
        }
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Shared draft update failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.post<{ Params: { organizationId: string; draftId: string } }>(
    "/api/v1/organizations/:organizationId/knowledge/drafts/:draftId/submit", {
      schema: {
        params: { type: "object", required: ["organizationId", "draftId"], properties: {
          organizationId: { type: "string", pattern: uuidPattern }, draftId: { type: "string", pattern: uuidPattern },
        } },
        headers: { type: "object", required: ["idempotency-key"], properties: {
          "idempotency-key": { type: "string", pattern: uuidPattern },
          "if-match": { type: "string", maxLength: 64 },
        } },
      },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      const expectedVersion = parseEtag(request.headers["if-match"]);
      if (expectedVersion === "missing") return reply.code(428).send(safeError("PRECONDITION_REQUIRED", "Reload the draft before submitting.", request.id));
      if (expectedVersion === null) return reply.code(400).send(safeError("INVALID_REQUEST", "The version precondition is invalid.", request.id));
      try {
        const currentDraft = await dependencies.repository.getKnowledgeDraft(context.userId,
          request.params.organizationId, request.params.draftId);
        if (currentDraft && currentDraft.currentVersion === expectedVersion) {
          await readKnowledgeContent(dependencies.storage, currentDraft.sourceUri, currentDraft.contentHash, currentDraft.mimeType);
        }
        const result = await dependencies.repository.submitKnowledgeDraft(context.userId,
          request.params.organizationId, request.params.draftId, expectedVersion,
          request.headers["idempotency-key"] as string, request.id);
        if (result.kind === "not-found") return reply.code(404).send(resourceNotAvailable(request.id));
        if (result.kind === "conflict") return reply.code(409).send(safeError("SUBMISSION_CONFLICT", "Reload this draft and its review status.", request.id));
        if (result.kind === "not-ready") return reply.code(409).send(safeError("DRAFT_NOT_READY", "Add an active responsible department, access scope and audience before submitting.", request.id));
        reply.header("Cache-Control", "no-store");
        return reply.code(result.kind === "submitted" ? 201 : 200).send(representSubmission(result.submission));
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Knowledge submission failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.get<{ Params: { organizationId: string } }>("/api/v1/organizations/:organizationId/knowledge/submissions", {
    schema: { params: { type: "object", required: ["organizationId"], properties: {
      organizationId: { type: "string", pattern: uuidPattern },
    } } },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const submissions = await dependencies.repository.listKnowledgeSubmissions(context.userId, request.params.organizationId);
      if (!submissions) return reply.code(404).send(resourceNotAvailable(request.id));
      reply.header("Cache-Control", "no-store");
      return { items: submissions.map(representSubmission) };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Knowledge submission list failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string } }>("/api/v1/organizations/:organizationId/knowledge/reviewer-grants", {
    schema: { params: { type: "object", required: ["organizationId"], properties: {
      organizationId: { type: "string", pattern: uuidPattern },
    } } },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const grants = await dependencies.repository.listReviewerGrants(context.userId, request.params.organizationId);
      if (!grants) return reply.code(404).send(resourceNotAvailable(request.id));
      reply.header("Cache-Control", "no-store");
      return { items: grants.map((grant) => ({ ...grant, validFrom: grant.validFrom.toISOString(),
        validUntil: grant.validUntil?.toISOString() ?? null })) };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Reviewer grant list failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string }; Body: Omit<ReviewerGrantInput, "validUntil"> & { validUntil: string | null } }>(
    "/api/v1/organizations/:organizationId/knowledge/reviewer-grants", {
      schema: {
        params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
        body: { type: "object", additionalProperties: false,
          required: ["reviewerMembershipId", "departmentId", "classifications", "level"], properties: {
            reviewerMembershipId: { type: "string", pattern: uuidPattern },
            departmentId: { type: "string", pattern: uuidPattern },
            classifications: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true,
              items: { type: "string", enum: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] } },
            level: { type: "string", enum: ["STANDARD", "SPECIALIST", "SENIOR"] },
            teamTag: { anyOf: [{ type: "string", minLength: 1, maxLength: 100 }, { type: "null" }] },
            projectTag: { anyOf: [{ type: "string", minLength: 1, maxLength: 100 }, { type: "null" }] },
            validUntil: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
          } },
      },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      const { validUntil, ...rest } = request.body;
      const expiry = validUntil ? new Date(validUntil) : null;
      if ((expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date()))
        || (rest.teamTag !== undefined && rest.teamTag !== null && !rest.teamTag.trim())
        || (rest.projectTag !== undefined && rest.projectTag !== null && !rest.projectTag.trim())) {
        return reply.code(400).send(safeError("INVALID_REQUEST", "The reviewer grant is invalid.", request.id));
      }
      try {
        const grant = await dependencies.repository.createReviewerGrant(context.userId, request.params.organizationId, {
          ...rest, teamTag: rest.teamTag?.trim() ?? null,
          projectTag: rest.projectTag?.trim() ?? null, validUntil: expiry,
        }, request.id);
        if (!grant) return reply.code(404).send(resourceNotAvailable(request.id));
        reply.header("Cache-Control", "no-store");
        return reply.code(201).send({ ...grant, validFrom: grant.validFrom.toISOString(),
          validUntil: grant.validUntil?.toISOString() ?? null });
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Reviewer grant creation failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.post<{ Params: { organizationId: string; grantId: string } }>(
    "/api/v1/organizations/:organizationId/knowledge/reviewer-grants/:grantId/deactivate", {
      schema: { params: { type: "object", required: ["organizationId", "grantId"], properties: {
        organizationId: { type: "string", pattern: uuidPattern }, grantId: { type: "string", pattern: uuidPattern },
      } } },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      try {
        const deactivated = await dependencies.repository.deactivateReviewerGrant(context.userId,
          request.params.organizationId, request.params.grantId, request.id);
        return deactivated ? reply.code(204).send() : reply.code(404).send(resourceNotAvailable(request.id));
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Reviewer grant deactivation failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.get<{ Params: { organizationId: string } }>("/api/v1/organizations/:organizationId/knowledge/reviews", {
    schema: { params: { type: "object", required: ["organizationId"], properties: {
      organizationId: { type: "string", pattern: uuidPattern },
    } } },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const assigned = await dependencies.repository.listAssignedReviews(context.userId, request.params.organizationId);
      if (!assigned) return reply.code(404).send(resourceNotAvailable(request.id));
      reply.header("Cache-Control", "no-store");
      return { items: assigned.map((item) => ({ ...item, submittedAt: item.submittedAt.toISOString() })) };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Review queue failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string; submissionId: string } }>(
    "/api/v1/organizations/:organizationId/knowledge/reviews/:submissionId", {
      schema: { params: { type: "object", required: ["organizationId", "submissionId"], properties: {
        organizationId: { type: "string", pattern: uuidPattern }, submissionId: { type: "string", pattern: uuidPattern },
      } } },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      try {
        const { organizationId, submissionId } = request.params;
        const detail = await dependencies.repository.getAssignedReview(context.userId, organizationId, submissionId);
        if (!detail) return reply.code(404).send(resourceNotAvailable(request.id));
        const content = await readKnowledgeContent(dependencies.storage, detail.sourceUri, detail.submission.contentHash, detail.mimeType);
        const stillAuthorized = await dependencies.repository.getAssignedReview(context.userId, organizationId, submissionId);
        if (!stillAuthorized || stillAuthorized.submission.snapshotVersionId !== detail.submission.snapshotVersionId
          || stillAuthorized.submission.contentHash !== detail.submission.contentHash) {
          return reply.code(404).send(resourceNotAvailable(request.id));
        }
        reply.header("Cache-Control", "no-store");
        return { ...representSubmission(detail.submission), ...content, mimeType: detail.mimeType,
          submittedByMembershipId: detail.submittedByMembershipId,
          teamTag: detail.teamTag, projectTag: detail.projectTag };
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Review detail failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.post<{ Params: { organizationId: string; submissionId: string }; Body: {
    action: "APPROVE" | "REQUEST_REVISION" | "REJECT";
    expectedSnapshotVersionId: string; expectedContentHash: string; comment?: string | null;
  } }>("/api/v1/organizations/:organizationId/knowledge/reviews/:submissionId/decisions", {
    schema: {
      params: { type: "object", required: ["organizationId", "submissionId"], properties: {
        organizationId: { type: "string", pattern: uuidPattern }, submissionId: { type: "string", pattern: uuidPattern },
      } },
      headers: { type: "object", required: ["idempotency-key"], properties: {
        "idempotency-key": { type: "string", pattern: uuidPattern },
      } },
      body: { type: "object", additionalProperties: false,
        required: ["action", "expectedSnapshotVersionId", "expectedContentHash"], properties: {
          action: { type: "string", enum: ["APPROVE", "REQUEST_REVISION", "REJECT"] },
          expectedSnapshotVersionId: { type: "string", pattern: uuidPattern },
          expectedContentHash: { type: "string", pattern: "^[0-9a-f]{64}$" },
          comment: { anyOf: [{ type: "string", maxLength: 2000 }, { type: "null" }] },
        } },
    },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      if (request.body.action === "APPROVE") {
        const pendingReview = await dependencies.repository.getAssignedReview(context.userId,
          request.params.organizationId, request.params.submissionId);
        if (pendingReview
          && pendingReview.submission.snapshotVersionId === request.body.expectedSnapshotVersionId
          && pendingReview.submission.contentHash === request.body.expectedContentHash) {
          await readKnowledgeContent(dependencies.storage, pendingReview.sourceUri, pendingReview.submission.contentHash, pendingReview.mimeType);
        }
      }
      const result = await dependencies.repository.decideReview(context.userId, request.params.organizationId,
        request.params.submissionId, request.body.action, request.body.expectedSnapshotVersionId,
        request.body.expectedContentHash, request.body.comment ?? null,
        request.headers["idempotency-key"] as string, request.id);
      if (result.kind === "not-found" || (result.kind === "denied" && result.reason === "NOT_AUTHORIZED")) {
        return reply.code(404).send(resourceNotAvailable(request.id));
      }
      if (result.kind === "conflict") return reply.code(409).send(safeError("REVIEW_CONFLICT", "This submission changed. Reload it before deciding.", request.id));
      if (result.kind === "denied") {
        return reply.code(result.reason === "COMMENT_REQUIRED" ? 400 : 409)
          .send(safeError(result.reason, "This review decision cannot be applied.", request.id));
      }
      reply.header("Cache-Control", "no-store");
      return reply.code(result.kind === "decided" ? 201 : 200).send(representSubmission(result.submission));
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Review decision failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string } }>("/api/v1/organizations/:organizationId/knowledge/published", {
    schema: { params: { type: "object", required: ["organizationId"], properties: {
      organizationId: { type: "string", pattern: uuidPattern },
    } } },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const items = await dependencies.repository.listPublishedKnowledge(context.userId, request.params.organizationId);
      if (!items) return reply.code(404).send(resourceNotAvailable(request.id));
      reply.header("Cache-Control", "no-store");
      return { items: items.map(({ sourceUri: _sourceUri, ...item }) => ({ ...item,
        publishedAt: item.publishedAt.toISOString(), validFrom: item.validFrom.toISOString(),
        validUntil: item.validUntil?.toISOString() ?? null })) };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Published knowledge list failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.get<{ Params: { organizationId: string; publishedVersionId: string } }>(
    "/api/v1/organizations/:organizationId/knowledge/published/:publishedVersionId", {
      schema: { params: { type: "object", required: ["organizationId", "publishedVersionId"], properties: {
        organizationId: { type: "string", pattern: uuidPattern }, publishedVersionId: { type: "string", pattern: uuidPattern },
      } } },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      try {
        const { organizationId, publishedVersionId } = request.params;
        const publication = await dependencies.repository.getPublishedKnowledge(context.userId, organizationId, publishedVersionId);
        if (!publication) return reply.code(404).send(resourceNotAvailable(request.id));
        const mimeType = publication.sourceUri.endsWith(".pdf") ? "application/pdf" : "text/plain";
        const content = await readKnowledgeContent(dependencies.storage, publication.sourceUri, publication.contentHash, mimeType);
        const stillAuthorized = await dependencies.repository.getPublishedKnowledge(context.userId, organizationId, publishedVersionId);
        if (!stillAuthorized || stillAuthorized.contentHash !== publication.contentHash) {
          return reply.code(404).send(resourceNotAvailable(request.id));
        }
        reply.header("Cache-Control", "no-store");
        return { id: publication.id, draftId: publication.draftId, title: publication.title,
          classification: publication.classification, ...content, mimeType, contentHash: publication.contentHash,
          audienceRoleIds: publication.audienceRoleIds,
          publishedAt: publication.publishedAt.toISOString(), validFrom: publication.validFrom.toISOString(),
          validUntil: publication.validUntil?.toISOString() ?? null };
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Published knowledge read failed");
        return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
      }
    });

  app.post<{ Params: { organizationId: string }; Body: DraftWrite }>("/api/v1/organizations/:organizationId/private-workspace/drafts", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      body: draftBodySchema,
    },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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
    const context = await requestActor(request, reply);
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

async function requireAuthenticatedActor(request: FastifyRequest, reply: FastifyReply, auth: AuthProvider | null, secureCookies: boolean, testActor?: SessionContext): Promise<SessionContext | null> {
  if (testActor) return testActor;
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
    request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Session validation failed");
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

async function readKnowledgeContent(storage: PrivateContentStorage, sourceUri: string, contentHash: string, mimeType: string): Promise<{ body: string; pdfBase64?: string }> {
  if (mimeType === "application/pdf") {
    return { body: "", pdfBase64: (await storage.readPdf(sourceUri, contentHash)).toString("base64") };
  }
  if (mimeType === "text/plain") return { body: await storage.read(sourceUri, contentHash) };
  throw new Error("Unsupported knowledge content type");
}

function representSharedDraft(draft: SharedKnowledgeDraft, body: string) {
  return {
    id: draft.id,
    organizationId: draft.organizationId,
    title: draft.title,
    classification: draft.classification,
    status: "ACTIVE" as const,
    hasPendingSubmission: draft.hasPendingSubmission,
    body,
    responsibleDepartmentId: draft.responsibleDepartmentId,
    targetScopeType: draft.targetScopeType,
    teamTag: draft.teamTag,
    projectTag: draft.projectTag,
    audienceRoleIds: draft.audienceRoleIds,
    currentVersion: {
      id: draft.versionId,
      version: draft.currentVersion,
      mimeType: draft.mimeType,
      contentHash: draft.contentHash,
    },
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function representSubmission(submission: SharedKnowledgeSubmission) {
  return {
    id: submission.id,
    draftId: submission.draftId,
    snapshotVersionId: submission.snapshotVersionId,
    title: submission.title,
    classification: submission.classification,
    responsibleDepartmentId: submission.responsibleDepartmentId,
    targetScopeType: submission.targetScopeType,
    targetDepartmentId: submission.targetDepartmentId,
    audienceRoleIds: submission.audienceRoleIds,
    contentHash: submission.contentHash,
    status: submission.status,
    decisionComment: submission.decisionComment,
    submittedAt: submission.submittedAt.toISOString(),
    publishedVersionId: submission.publishedVersionId,
  };
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
