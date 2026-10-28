import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { parseSemanticDocument, plainTextToSemanticDocument, serializeSemanticDocument, validateSemanticDocument } from "@arden/domain";
import type { AuthProvider, AuthSessionTokens } from "./auth/provider.js";
import type { ArdenDataRepository, DraftCursor, DraftPatch, DraftWrite, PrivateDraft, ReviewerGrantInput, SharedDraftPatch, SharedKnowledgeDraft, SharedKnowledgeSubmission } from "./db/repository.js";
import type { PrivateContentStorage } from "./private-notes/content-storage.js";
import type { InvitationMailer } from "./email/smtp-mailer.js";
import { allKnowledgeClassifications, defaultKnowledgeClassification, type KnowledgeClassification } from "./knowledge/policy.js";
import { registerAudienceGroupRoutes } from "./audiences/routes.js";
import { registerSystemAdministrationRoutes } from "./system-administration/routes.js";
import type { AskArdenClient } from "./answers/ai-client.js";
import { citationPage } from "./answers/citation-page.js";
import { citationMatchesManifest } from "./answers/contracts.js";

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
  publicApiOrigin?: string | null;
  invitationDeliveryMode?: "email" | "local-test-no-email";
  askArden?: AskArdenClient | null;
  testActor?: SessionContext;
};

type SessionContext = { userId: string; email: string; fullName: string | null; emailVerified: boolean; passwordSetupRequired?: boolean };
// Decision 0013: classification is optional and defaults to INTERNAL; review strictness comes from audience breadth.
type CreateSharedDraftBody = { sourcePrivateVersionId: string; classification?: KnowledgeClassification };

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
  registerAudienceGroupRoutes(app, dependencies.repository.audienceGroups, requestActor, uuidPattern);
  registerSystemAdministrationRoutes(app, dependencies.repository.systemAdministration, requestActor, uuidPattern);
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
      if (error instanceof Error && error.message === "EMAIL_NOT_CONFIRMED") {
        return reply.code(403).send(safeError("EMAIL_NOT_CONFIRMED", "Your email address has not been confirmed yet. Please check your inbox for the confirmation link.", request.id));
      }
      if (error instanceof Error && error.message === "INVALID_CREDENTIALS") {
        return reply.code(401).send(safeError("INVALID_CREDENTIALS", "Email or password is incorrect.", request.id));
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Authentication provider sign-in failed");
      return authUnavailable(reply, request);
    }
  });

  app.get<{ Querystring: { client?: string } }>("/api/v1/auth/google/start", async (request, reply) => {
    if (!dependencies.auth?.startGoogleSignIn) return authUnavailable(reply, request);
    const client = request.query.client === "desktop" ? "desktop" : "web";
    const callbackOrigin = client === "desktop" ? dependencies.publicApiOrigin : dependencies.publicWebOrigin;
    if (!callbackOrigin) return authUnavailable(reply, request);
    try {
      const callbackUrl = `${callbackOrigin}/api/v1/auth/google/callback`;
      const result = await dependencies.auth.startGoogleSignIn(callbackUrl);
      const state = Buffer.from(JSON.stringify({ flowId: result.flowId, verifier: result.verifier, client }), "utf8").toString("base64url");
      if (state.length > 3000) throw new Error("INVALID_AUTH_RESPONSE");
      reply.header("set-cookie", oauthStateCookie(state, dependencies.secureCookies));
      return reply.redirect(result.url);
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Google sign-in could not be started");
      return authUnavailable(reply, request);
    }
  });

  app.get<{ Querystring: { code?: string; error?: string; error_description?: string; sb_flow_id?: string } }>(
    "/api/v1/auth/google/callback",
    async (request, reply) => {
      const state = readOAuthState(request.headers.cookie, dependencies.secureCookies);
      const fallbackClient = state?.client === "desktop" ? "desktop" : "web";
      const completeUrl = fallbackClient === "desktop"
        ? "/api/v1/auth/google/desktop-complete"
        : `${dependencies.publicWebOrigin ?? ""}/?auth=google`;
      if (!dependencies.auth?.completeGoogleSignIn || !state || request.query.error || !request.query.code ||
        request.query.sb_flow_id && request.query.sb_flow_id !== state.flowId) {
        reply.header("set-cookie", clearOAuthStateCookie(dependencies.secureCookies));
        return reply.redirect(`${completeUrl}${completeUrl.includes("?") ? "&" : "?"}status=error`);
      }
      try {
        const result = await dependencies.auth.completeGoogleSignIn(request.query.code, state.flowId, state.verifier);
        setAuthCookies(reply, result.tokens, dependencies.secureCookies, [clearOAuthStateCookie(dependencies.secureCookies)]);
        const suffix = `status=success${result.passwordSetupRequired ? "&setup=password" : ""}`;
        return reply.redirect(`${completeUrl}${completeUrl.includes("?") ? "&" : "?"}${suffix}`);
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Google sign-in callback failed");
        reply.header("set-cookie", clearOAuthStateCookie(dependencies.secureCookies));
        return reply.redirect(`${completeUrl}${completeUrl.includes("?") ? "&" : "?"}status=error`);
      }
    },
  );

  app.get("/api/v1/auth/google/desktop-complete", async (_request, reply) => {
    return reply.type("text/html; charset=utf-8").send("<!doctype html><html><body>Authentication complete. You may return to Arden.</body></html>");
  });

  app.post<{ Body: { password: string } }>("/api/v1/auth/password", {
    schema: {
      body: { type: "object", additionalProperties: false, required: ["password"], properties: {
        password: { type: "string", minLength: 8, maxLength: 1024 },
      } },
    },
  }, async (request, reply) => {
    if (!dependencies.auth?.setInitialPassword) return authUnavailable(reply, request);
    const tokens = readAuthCookies(request.headers.cookie, dependencies.secureCookies);
    if (!tokens) return reply.code(401).send(safeError("UNAUTHENTICATED", "Sign in to continue.", request.id));
    try {
      const resolution = await dependencies.auth.resolveSession(tokens);
      if (resolution.kind !== "authenticated") return reply.code(401).send(safeError("UNAUTHENTICATED", "Sign in to continue.", request.id));
      if (!resolution.passwordSetupRequired) return reply.code(409).send(safeError("PASSWORD_ALREADY_INITIALIZED", "This account already has a password.", request.id));
      await dependencies.auth.setInitialPassword(tokens, request.body.password);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === "PASSWORD_REJECTED") {
        return reply.code(400).send(safeError("PASSWORD_REJECTED", "Choose a stronger password and try again.", request.id));
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Initial password setup failed");
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
      if (error instanceof Error && error.message === "USER_ALREADY_EXISTS") {
        return reply.code(409).send(safeError("ACCOUNT_ALREADY_EXISTS", "An account with this email address already exists. Please sign in instead.", request.id));
      }
      if (error instanceof Error && error.message === "SIGNUP_REJECTED") {
        return reply.code(400).send(safeError("ACCOUNT_SETUP_UNAVAILABLE", "Account setup could not be completed. Check the password requirements or sign in.", request.id));
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Supabase sign-up failed");
      return authUnavailable(reply, request);
    }
  });

  app.post<{ Body: { email: string } }>("/api/v1/auth/forgot-password", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["email"],
        properties: {
          email: { type: "string", minLength: 3, maxLength: 320, format: "email" },
        },
      },
    },
  }, async (request, reply) => {
    if (!dependencies.auth) return authUnavailable(reply, request);
    try {
      if (dependencies.auth.resetPasswordForEmail) {
        const origin = request.headers.origin || dependencies.publicWebOrigin || "http://127.0.0.1:5180";
        await dependencies.auth.resetPasswordForEmail(request.body.email.trim().toLowerCase(), `${origin}/reset-password`);
      }
      return reply.code(202).send({
        status: "recovery_sent",
        message: "If an account with this email exists, a password reset email has been sent.",
      });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Password reset request failed");
      return authUnavailable(reply, request);
    }
  });

  const handleVerify = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!dependencies.auth || !dependencies.auth.verifyLink) {
      return reply.redirect("/?error=verify_unavailable", 303);
    }
    const query = new URL(request.url, "http://localhost").search.slice(1);
    try {
      const location = await dependencies.auth.verifyLink(query);
      if (location) {
        return reply.redirect(location, 303);
      }
      return reply.redirect("/?error=verification_failed", 303);
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Auth verification failed");
      return reply.redirect("/?error=verification_failed", 303);
    }
  };

  app.get("/auth/v1/verify", handleVerify);
  app.get("/api/v1/auth/verify", handleVerify);
  app.get("/verify", handleVerify);

  app.post<{ Body: { email?: string; token?: string; accessToken?: string; refreshToken?: string; newPassword: string } }>("/api/v1/auth/reset-password", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["newPassword"],
        properties: {
          email: { type: "string", minLength: 3, maxLength: 320, format: "email" },
          token: { type: "string", minLength: 1, maxLength: 100 },
          accessToken: { type: "string", minLength: 10 },
          refreshToken: { type: "string", minLength: 10 },
          newPassword: { type: "string", minLength: 6, maxLength: 1024 },
        },
      },
    },
  }, async (request, reply) => {
    if (!dependencies.auth || !dependencies.auth.updateUserPassword) return authUnavailable(reply, request);
    try {
      let tokens: AuthSessionTokens | null = null;
      if (request.body.accessToken && request.body.refreshToken) {
        tokens = { accessToken: request.body.accessToken, refreshToken: request.body.refreshToken, expiresIn: 3600 };
      } else if (request.body.email && request.body.token && dependencies.auth.verifyOtp) {
        const verified = await dependencies.auth.verifyOtp({
          email: request.body.email.trim().toLowerCase(),
          token: request.body.token.trim(),
          type: "recovery",
        });
        tokens = verified.tokens;
      } else {
        tokens = readAuthCookies(request.headers.cookie, dependencies.secureCookies);
      }

      if (!tokens) {
        return reply.code(401).send(safeError("UNAUTHENTICATED", "A valid reset token or session is required.", request.id));
      }

      await dependencies.auth.updateUserPassword(tokens, request.body.newPassword);
      setAuthCookies(reply, tokens, dependencies.secureCookies);
      return reply.code(200).send({ status: "password_updated" });
    } catch (error) {
      if (error instanceof Error && (error.message === "INVALID_OTP" || error.message === "INVALID_SESSION")) {
        return reply.code(401).send(safeError("INVALID_TOKEN", "The reset link or code is invalid or has expired.", request.id));
      }
      if (error instanceof Error && error.message === "PASSWORD_UPDATE_REJECTED") {
        return reply.code(400).send(safeError("PASSWORD_REJECTED", "Password does not meet requirements.", request.id));
      }
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Password update failed");
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
        account: { passwordSetupRequired: Boolean(context.passwordSetupRequired) },
        ...(dependencies.testActor ? { testMode: true } : {}),
        memberships: memberships.map((membership) => ({
          organization: { id: membership.organizationId, name: membership.organizationName },
          status: membership.status.toLowerCase(),
          departmentId: membership.departmentId ?? null,
          departmentName: membership.departmentName ?? null,
          roleCodes: membership.roleCodes,
          canUsePrivateWorkspace: membership.canUsePrivateWorkspace,
        })),
      };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Membership lookup failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Body: { name: string; departmentName?: string } }>("/api/v1/organizations", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["name"],
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
    const departmentName = request.body.departmentName?.trim() || "General";
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

  app.post<{ Params: { organizationId: string; departmentId: string } }>("/api/v1/organizations/:organizationId/departments/:departmentId/delete", {
    schema: {
      params: {
        type: "object", required: ["organizationId", "departmentId"],
        properties: { organizationId: { type: "string", pattern: uuidPattern }, departmentId: { type: "string", pattern: uuidPattern } },
      },
    },
  }, async (request, reply) => {
    const context = await requestActor(request, reply);
    if (!context) return;
    try {
      const result = await dependencies.repository.deleteDepartment(context.userId, request.params.organizationId, request.params.departmentId, request.id);
      if (!result.success) {
        if (result.errorReason === "BASE_DEPARTMENT") {
          return reply.code(409).send(safeError("CANNOT_DELETE_BASE_DEPARTMENT", "The base department of the organization cannot be deleted.", request.id));
        }
        return reply.code(404).send(resourceNotAvailable(request.id));
      }
      return reply.code(200).send({ departmentId: request.params.departmentId, status: "archived", unassignedCount: result.unassignedCount ?? 0, reassignedCount: result.reassignedCount ?? 0 });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Department deletion failed");
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

  app.post<{ Params: { organizationId: string }; Body: { departmentId?: string | null; email: string } }>("/api/v1/organizations/:organizationId/invitations", {
    schema: {
      params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
      body: {
        type: "object", additionalProperties: false, required: ["email"],
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
    const departmentId = request.body.departmentId ? request.body.departmentId.trim() : null;
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    try {
      const invitation = await dependencies.repository.createInvitation(
        context.userId, request.params.organizationId, departmentId, email, tokenHash, expiresAt, request.id,
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

  app.get<{ Params: { token: string } }>("/api/v1/invitations/:token", {
    schema: {
      params: {
        type: "object", additionalProperties: false, required: ["token"],
        properties: { token: { type: "string", minLength: 43, maxLength: 43, pattern: "^[A-Za-z0-9_-]+$" } },
      },
    },
  }, async (request, reply) => {
    try {
      const invitation = await dependencies.repository.getInvitationByToken(hashInvitationToken(request.params.token));
      if (!invitation) {
        return reply.code(404).send(safeError("INVITATION_NOT_AVAILABLE", "This invitation is invalid, has expired, or has already been accepted.", request.id));
      }
      return reply.code(200).send({
        organizationName: invitation.organizationName,
        email: invitation.email,
        expiresAt: invitation.expiresAt.toISOString(),
      });
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Invitation lookup failed");
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
      body: { type: "object", additionalProperties: false, required: ["sourcePrivateVersionId"], properties: {
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
      const semanticBody = normalizeSharedDraftBody(body);
      if (!semanticBody) {
        return reply.code(409).send(safeError("SOURCE_NOT_SUPPORTED", "This note uses an unsupported Arden document envelope.", request.id));
      }
      copied = await dependencies.storage.write(semanticBody);
      creationAttempted = true;
      const result = await dependencies.repository.createKnowledgeDraft(context.userId, organizationId, {
        actorMembershipId: actor.membershipId,
        sourceVersionId: source.versionId,
        classification: request.body.classification ?? defaultKnowledgeClassification,
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
      const responseBody = result.kind === "created" ? semanticBody
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

  app.post<{ Params: { organizationId: string }; Body: { title: string; body: string; classification?: KnowledgeClassification } }>(
    "/api/v1/organizations/:organizationId/knowledge/drafts/new", {
      schema: {
        params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
        headers: { type: "object", required: ["idempotency-key"], properties: {
          "idempotency-key": { type: "string", pattern: uuidPattern },
        } },
        body: { type: "object", additionalProperties: false, required: ["title", "body"], properties: {
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
        const semanticBody = normalizeSharedDraftBody(request.body.body);
        if (!semanticBody) return reply.code(400).send(safeError("INVALID_DOCUMENT", "The Semantic Document is invalid.", request.id));
        stored = await dependencies.storage.write(semanticBody);
        creationAttempted = true;
        const result = await dependencies.repository.createNewKnowledgeDraft(context.userId, organizationId, {
          actorMembershipId: actor.membershipId, title, classification: request.body.classification ?? defaultKnowledgeClassification,
          idempotencyKey: request.headers["idempotency-key"] as string, content: stored, requestId: request.id,
        });
        if (result.kind === "unavailable" || result.kind === "idempotency-conflict") {
          await dependencies.storage.remove(stored.sourceUri);
          return result.kind === "unavailable"
            ? reply.code(404).send(resourceNotAvailable(request.id))
            : reply.code(409).send(safeError("IDEMPOTENCY_CONFLICT", "Use a new idempotency key for a different request.", request.id));
        }
        if (result.kind === "replayed") await dependencies.storage.remove(stored.sourceUri);
        const body = result.kind === "created" ? semanticBody
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

  app.post<{ Params: { organizationId: string }; Body: { title: string; pdfBase64: string; classification?: KnowledgeClassification } }>(
    "/api/v1/organizations/:organizationId/knowledge/drafts/pdf", {
      bodyLimit: maxPdfBase64Length + 4096,
      schema: {
        params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
        headers: { type: "object", required: ["idempotency-key"], properties: {
          "idempotency-key": { type: "string", pattern: uuidPattern },
        } },
        body: { type: "object", additionalProperties: false, required: ["title", "pdfBase64"], properties: {
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
          actorMembershipId: actor.membershipId, title, classification: request.body.classification ?? defaultKnowledgeClassification,
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
      return { items: drafts.map(representSharedDraftSummary) };
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

  app.patch<{ Params: { organizationId: string; draftId: string }; Body: Omit<SharedDraftPatch, "audienceRoleIds"> & { audienceIds?: string[] } }>(
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
          audienceIds: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", pattern: uuidPattern } },
        } },
      },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      const expectedVersion = parseEtag(request.headers["if-match"]);
      if (expectedVersion === "missing") return reply.code(428).send(safeError("PRECONDITION_REQUIRED", "Reload the draft before saving.", request.id));
      if (expectedVersion === null) return reply.code(400).send(safeError("INVALID_REQUEST", "The version precondition is invalid.", request.id));
      const { audienceIds, ...patch } = request.body;
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
        if (existing.mimeType === "application/pdf" && patch.body !== undefined) {
          return reply.code(400).send(safeError("INVALID_REQUEST", "Uploaded PDFs cannot be edited as text.", request.id));
        }
        const semanticBody = patch.body === undefined ? undefined : normalizeSharedDraftBody(patch.body);
        if (semanticBody === null) {
          return reply.code(400).send(safeError("INVALID_DOCUMENT", "The Semantic Document is invalid.", request.id));
        }
        if (typeof semanticBody === "string") stored = await dependencies.storage.write(semanticBody);
        updateAttempted = true;
        const result = await dependencies.repository.updateKnowledgeDraft(context.userId, organizationId, draftId,
          expectedVersion, { ...patch, audienceRoleIds: audienceIds, title: patch.title?.trim(),
            teamTag: patch.teamTag === null ? null : patch.teamTag?.trim(),
            projectTag: patch.projectTag === null ? null : patch.projectTag?.trim() },
          stored, request.id);
        if (result.kind !== "updated") {
          if (stored) await dependencies.storage.remove(stored.sourceUri);
          if (result.kind === "conflict") return reply.code(412).send(safeError("VERSION_CONFLICT", "This draft changed. Reload it before saving again.", request.id));
          if (result.kind === "invalid-metadata") return reply.code(400).send(safeError("INVALID_METADATA", "The draft metadata is invalid.", request.id));
          return reply.code(404).send(resourceNotAvailable(request.id));
        }
        const content: { body: string; pdfBase64?: string } = typeof semanticBody === "string" ? { body: semanticBody }
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
        if (result.kind === "not-ready") return reply.code(409).send(safeError("DRAFT_NOT_READY", "Choose who can read this draft and save it before submitting. You need an active primary department; ask an Org Admin if you have none.", request.id));
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

  app.post<{ Params: { organizationId: string }; Body: {
    reviewerMembershipId: string; scope?: ReviewerGrantInput["scope"]; departmentId?: string | null;
    classifications?: ReviewerGrantInput["classifications"]; level?: ReviewerGrantInput["level"];
    teamTag?: string | null; projectTag?: string | null; validUntil: string | null;
  } }>(
    "/api/v1/organizations/:organizationId/knowledge/reviewer-grants", {
      schema: {
        params: { type: "object", required: ["organizationId"], properties: { organizationId: { type: "string", pattern: uuidPattern } } },
        body: { type: "object", additionalProperties: false,
          required: ["reviewerMembershipId"], properties: {
            reviewerMembershipId: { type: "string", pattern: uuidPattern },
            scope: { type: "string", enum: ["DEPARTMENT", "ORGANIZATION"], default: "DEPARTMENT" },
            departmentId: { anyOf: [{ type: "string", pattern: uuidPattern }, { type: "null" }] },
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
      const scope = rest.scope ?? "DEPARTMENT";
      const departmentId = rest.departmentId ?? null;
      const expiry = validUntil ? new Date(validUntil) : null;
      if ((expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date()))
        || (scope === "DEPARTMENT" && departmentId === null)
        || (scope === "ORGANIZATION" && departmentId !== null)
        || (rest.teamTag !== undefined && rest.teamTag !== null && !rest.teamTag.trim())
        || (rest.projectTag !== undefined && rest.projectTag !== null && !rest.projectTag.trim())) {
        return reply.code(400).send(safeError("INVALID_REQUEST", "The reviewer grant is invalid.", request.id));
      }
      try {
        const grant = await dependencies.repository.createReviewerGrant(context.userId, request.params.organizationId, {
          reviewerMembershipId: rest.reviewerMembershipId, scope, departmentId,
          level: rest.level, teamTag: rest.teamTag?.trim() ?? null,
          // Decision 0013: a grant no longer narrows by classification; legacy pending submissions still match a level.
          classifications: rest.classifications ?? [...allKnowledgeClassifications],
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
    action: "APPROVE" | "REJECT";
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
          action: { type: "string", enum: ["APPROVE", "REJECT"] },
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
      return { items: items.map(({ sourceUri: _sourceUri, audienceRoleIds, ...item }) => ({ ...item,
        audienceIds: audienceRoleIds ?? [],
        publishedAt: item.publishedAt.toISOString(), validFrom: item.validFrom.toISOString(),
        validUntil: item.validUntil?.toISOString() ?? null })) };
    } catch (error) {
      request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Published knowledge list failed");
      return reply.code(500).send(safeError("INTERNAL_ERROR", "The request could not be completed.", request.id));
    }
  });

  app.post<{ Params: { organizationId: string }; Body: { query: string } }>(
    "/api/v1/organizations/:organizationId/ai/answers", {
      schema: {
        params: { type: "object", required: ["organizationId"], additionalProperties: false, properties: {
          organizationId: { type: "string", pattern: uuidPattern },
        } },
        body: { type: "object", required: ["query"], additionalProperties: false, properties: {
          query: { type: "string", minLength: 1, maxLength: 4_000 },
        } },
      },
    }, async (request, reply) => {
      const context = await requestActor(request, reply);
      if (!context) return;
      const query = request.body.query.trim();
      if (!query) return reply.code(400).send(safeError("INVALID_REQUEST", "The question is empty.", request.id));
      if (!dependencies.askArden) {
        return reply.code(503).send(safeError("AI_UNAVAILABLE", "Ask Arden is temporarily unavailable.", request.id));
      }
      try {
        const { organizationId } = request.params;
        const before = await dependencies.repository.listAuthorizedAiSources(context.userId, organizationId);
        if (!before) return reply.code(404).send(resourceNotAvailable(request.id));
        if (before.length === 0) {
          reply.header("Cache-Control", "no-store");
          return { status: "INSUFFICIENT_EVIDENCE", answer: "I could not find any indexed published knowledge you are allowed to read.", citations: [] };
        }
        const requestId = randomUUID();
        const aiResponse = await dependencies.askArden.answer({
          contractVersion: 1,
          requestId,
          organizationId,
          query,
          allowedGenerationIds: before.map((source) => source.generationId),
        });
        const after = await dependencies.repository.listAuthorizedAiSources(context.userId, organizationId,
          [...new Set(aiResponse.citations.map((citation) => citation.generationId))],
          [...new Set(aiResponse.citations.map((citation) => citation.chunkId))]);
        if (!after) return reply.code(404).send(resourceNotAvailable(request.id));
        const beforeByGeneration = new Map(before.map((source) => [source.generationId, source]));
        const afterByGeneration = new Map(after.map((source) => [source.generationId, source]));
        const citations = aiResponse.citations.map((citation) => {
          const initial = beforeByGeneration.get(citation.generationId);
          const current = afterByGeneration.get(citation.generationId);
          if (!initial || !current || initial.publishedVersionId !== current.publishedVersionId
            || current.snapshotVersionId !== citation.snapshotVersionId
            || current.snapshotContentHash !== citation.snapshotContentHash
            || !citationMatchesManifest(citation, current.chunks)) {
            return null;
          }
          return {
            documentId: current.draftId,
            versionId: current.publishedVersionId,
            blockId: citation.sourceBlockIds[0] ?? citation.parentSectionBlockId ?? undefined,
            page: citationPage(citation.sourceBlockIds, citation.parentSectionBlockId),
            excerpt: citation.excerpt,
            title: current.title,
            version: `v${current.versionNo}`,
            scope: current.targetScopeType === "ORGANIZATION" ? "Company-wide" : "Department",
            classification: current.classification,
          };
        });
        if (citations.some((citation) => citation === null)) {
          return reply.code(409).send(safeError("KNOWLEDGE_ACCESS_CHANGED",
            "Knowledge access changed while the answer was being prepared. Please ask again.", request.id));
        }
        const authorizedCitations = citations.filter((citation): citation is NonNullable<typeof citation> => citation !== null);
        const uniqueCitations = authorizedCitations.filter((citation, index, all) => {
          const location = citation.page === undefined ? citation.blockId ?? "source" : `page-${citation.page}`;
          return all.findIndex((candidate) => {
            const candidateLocation = candidate.page === undefined ? candidate.blockId ?? "source" : `page-${candidate.page}`;
            return candidate.versionId === citation.versionId && candidateLocation === location;
          }) === index;
        });
        reply.header("Cache-Control", "no-store");
        return { status: aiResponse.status, answer: aiResponse.answer, citations: uniqueCitations };
      } catch (error) {
        request.log.error({ errorType: safeErrorType(error), requestId: request.id }, "Ask Arden answer failed");
        return reply.code(503).send(safeError("AI_UNAVAILABLE", "Ask Arden is temporarily unavailable.", request.id));
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
          classification: publication.classification,
          responsibleDepartmentId: publication.responsibleDepartmentId,
          ...content, mimeType, contentHash: publication.contentHash,
          audienceIds: publication.audienceRoleIds,
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
        passwordSetupRequired: resolution.passwordSetupRequired,
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

function setAuthCookies(reply: FastifyReply, tokens: AuthSessionTokens, secure: boolean, additional: string[] = []): void {
  const names = cookieNames(secure);
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  reply.header("set-cookie", [
    `${names.access}=${tokens.accessToken}; ${attributes}`,
    `${names.refresh}=${tokens.refreshToken}; ${attributes}`,
    ...additional,
  ]);
}

function oauthStateName(secure: boolean): string { return secure ? "__Host-arden_oauth" : "arden_oauth"; }
function oauthStateCookie(value: string, secure: boolean): string {
  return `${oauthStateName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=600`;
}
function clearOAuthStateCookie(secure: boolean): string {
  return `${oauthStateName(secure)}=; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=0`;
}
function readOAuthState(header: string | undefined, secure: boolean): { flowId: string; verifier: string; client: "web" | "desktop" } | null {
  if (!header || header.length > 8192) return null;
  const prefix = `${oauthStateName(secure)}=`;
  const value = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (!value || value.length > 3000) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || !("flowId" in parsed) || !("verifier" in parsed) || !("client" in parsed)) return null;
    const state = parsed as Record<string, unknown>;
    if (typeof state.flowId !== "string" || !/^[a-f0-9]{32}$/i.test(state.flowId) ||
      typeof state.verifier !== "string" || state.verifier.length < 32 || state.verifier.length > 256 ||
      (state.client !== "web" && state.client !== "desktop")) return null;
    return state as { flowId: string; verifier: string; client: "web" | "desktop" };
  } catch { return null; }
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
    audienceIds: draft.audienceRoleIds,
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

function representSharedDraftSummary(draft: SharedKnowledgeDraft) {
  return {
    id: draft.id,
    organizationId: draft.organizationId,
    title: draft.title,
    classification: draft.classification,
    status: "ACTIVE" as const,
    responsibleDepartmentId: draft.responsibleDepartmentId,
    targetScopeType: draft.targetScopeType,
    teamTag: draft.teamTag,
    projectTag: draft.projectTag,
    hasPendingSubmission: draft.hasPendingSubmission,
    versionId: draft.versionId,
    mimeType: draft.mimeType,
    contentHash: draft.contentHash,
    currentVersion: draft.currentVersion,
    audienceIds: draft.audienceRoleIds ?? [],
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
    audienceIds: submission.audienceRoleIds,
    contentHash: submission.contentHash,
    status: submission.status,
    publicationState: submission.publicationState,
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

function normalizeSharedDraftBody(body: string): string | null {
  const parsed = parseSemanticDocument(body);
  if (!parsed.ok && body.startsWith("arden-document:")) return null;
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const converted = parsed.ok ? parsed.document : plainTextToSemanticDocument(body, (index) => `import-${digest}-${index}`);
  const validated = validateSemanticDocument(converted);
  if (!validated) return null;
  const serialized = serializeSemanticDocument(validated);
  return isValidText(serialized, maxBodyBytes, maxBodyBytes) ? serialized : null;
}

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
