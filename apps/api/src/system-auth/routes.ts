import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  accountPasswordMaximumLength,
  accountPasswordMaximumLengthMessage,
  accountPasswordRequirementsMessage,
  meetsAccountPasswordRequirements,
} from "@arden/domain";
import { isNormalizedEmail } from "../email-address.js";
import { hashSystemAdminPassword, PasswordWorkLimiter, verifySetupToken, verifySystemAdminPassword } from "./password.js";
import {
  clearSystemSessionCookie,
  createSystemSessionCookie,
  newSystemSessionExpiry,
  readSystemSessionCookie,
} from "./session.js";
import { SystemAuthError, type SystemAdminAccount, type SystemAdminSessionRecord, type SystemAuthStore } from "./store.js";

/** The isolated System Admin identity resolved from a valid server-side session. */
export type SystemActor = { adminId: string; sessionId: string; canManageSystemAdmins: boolean };
export type SystemActorResolver = (request: FastifyRequest, reply: FastifyReply) => Promise<SystemActor | null>;

/** Setup is installation-wide; its throttle bucket is one fixed key. */
const setupThrottleKey = "installation";

function safeError(code: string, message: string, requestId: string) {
  return { error: { code, message, requestId } };
}

function publicAdmin(account: SystemAdminAccount) {
  return {
    id: account.id,
    email: account.email,
    fullName: account.fullName,
    canManageSystemAdmins: account.canManageSystemAdmins,
  };
}

function sessionCookie(session: SystemAdminSessionRecord, sessionKey: Buffer, secureCookies: boolean) {
  return createSystemSessionCookie(session.sessionId, Math.floor(session.expiresAt.valueOf() / 1000), sessionKey, secureCookies);
}

function tooManyAttempts(reply: FastifyReply, retryAfterSeconds: number, requestId: string) {
  reply.header("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  return reply.code(429).send(safeError("TOO_MANY_ATTEMPTS", "Too many attempts. Wait a moment and try again.", requestId));
}

export type SystemAuthRouteOptions = {
  store: SystemAuthStore | undefined;
  /** Undefined when setup is not configured; setup then fails closed with 503. */
  setupToken: string | undefined;
  sessionKey: Buffer;
  secureCookies: boolean;
  passwordWork?: PasswordWorkLimiter;
};

export function createSystemActorResolver(
  store: SystemAuthStore | undefined,
  sessionKey: Buffer,
  secureCookies: boolean,
): SystemActorResolver {
  return async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const cookie = readSystemSessionCookie(request.headers.cookie, sessionKey, secureCookies);
    if (!store) {
      reply.code(503).send({ error: { code: "SYSTEM_AUTH_UNAVAILABLE", message: "System administration is unavailable." } });
      return null;
    }
    const active = cookie ? await store.getActiveSession(cookie.sessionId) : null;
    if (!active) {
      if (cookie) reply.header("set-cookie", clearSystemSessionCookie(secureCookies));
      reply.code(404).send({ error: { code: "SYSTEM_CONSOLE_UNAVAILABLE", message: "The resource is not available." } });
      return null;
    }
    return { adminId: active.account.id, sessionId: active.session.sessionId,
      canManageSystemAdmins: active.account.canManageSystemAdmins };
  };
}

export function registerSystemAuthRoutes(app: FastifyInstance, options: SystemAuthRouteOptions) {
  const { store, setupToken, sessionKey, secureCookies } = options;
  const passwordWork = options.passwordWork ?? new PasswordWorkLimiter();

  app.get("/api/v1/system/setup/status", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!store) {
      return reply.code(503).send(safeError("SYSTEM_AUTH_UNAVAILABLE", "System administration setup is unavailable.", request.id));
    }
    return store.setupStatus();
  });

  app.post<{
    Body: { setupToken: string; email: string; fullName: string; password: string };
  }>("/api/v1/system/setup", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["setupToken", "email", "fullName", "password"],
        properties: {
          setupToken: { type: "string", minLength: 1, maxLength: 512 },
          email: { type: "string", minLength: 3, maxLength: 320 },
          fullName: { type: "string", minLength: 1, maxLength: 200 },
          password: { type: "string", minLength: 8, maxLength: accountPasswordMaximumLength },
        },
      },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!store || !setupToken) {
      return reply.code(503).send(safeError("SYSTEM_SETUP_UNAVAILABLE", "Initial System Admin setup is unavailable.", request.id));
    }
    // Layer 1: a completed setup is closed before the token is examined.
    const currentStatus = await store.setupStatus();
    if (!currentStatus.needsInitialSetup) {
      return reply.code(409).send(safeError(
        "SYSTEM_SETUP_ALREADY_COMPLETED",
        "Initial System Admin setup has already been completed.",
        request.id,
      ));
    }
    const locked = await store.throttleState("setup", setupThrottleKey);
    if (locked) return tooManyAttempts(reply, locked.retryAfterSeconds, request.id);
    // Layer 2: the one-time operator setup token prevents takeover while uninitialized.
    if (!verifySetupToken(request.body.setupToken, setupToken)) {
      await store.recordThrottleFailure("setup", setupThrottleKey);
      request.log.warn({ requestId: request.id, code: "INVALID_SETUP_TOKEN" }, "System Admin setup token rejected");
      return reply.code(403).send(safeError("INVALID_SETUP_TOKEN", "The setup token is invalid.", request.id));
    }
    const email = request.body.email.trim().toLowerCase();
    if (!isNormalizedEmail(email)) {
      return reply.code(400).send(safeError("INVALID_EMAIL", "Enter a valid email address.", request.id));
    }
    const fullName = request.body.fullName.trim();
    if (!fullName) {
      return reply.code(400).send(safeError("INVALID_FULL_NAME", "Enter your name.", request.id));
    }
    if (request.body.password.length > accountPasswordMaximumLength) {
      return reply.code(400).send(safeError("INVALID_PASSWORD", accountPasswordMaximumLengthMessage, request.id));
    }
    if (!meetsAccountPasswordRequirements(request.body.password)) {
      return reply.code(400).send(safeError("INVALID_PASSWORD", accountPasswordRequirementsMessage, request.id));
    }
    const hashed = await passwordWork.run(() => hashSystemAdminPassword(request.body.password));
    if (!hashed) return tooManyAttempts(reply, 1, request.id);
    try {
      const created = await store.completeInitialSetup({
        email,
        fullName,
        passwordHash: hashed.value,
        requestId: request.id,
        sessionExpiresAt: new Date(newSystemSessionExpiry() * 1000),
      });
      await store.clearThrottle("setup", setupThrottleKey);
      reply.header("set-cookie", sessionCookie(created.session, sessionKey, secureCookies));
      return reply.code(201).send({
        administrator: publicAdmin(created.account),
        sessionExpiresAt: created.session.expiresAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof SystemAuthError) {
        return reply.code(409).send(safeError(
          error.code,
          error.code === "SYSTEM_SETUP_ALREADY_COMPLETED"
            ? "Initial System Admin setup has already been completed."
            : "A System Admin account with this email already exists.",
          request.id,
        ));
      }
      throw error;
    }
  });

  app.post<{ Body: { email: string; password: string } }>("/api/v1/system/auth/sign-in", {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["email", "password"],
        properties: {
          email: { type: "string", minLength: 3, maxLength: 320 },
          password: { type: "string", minLength: 1, maxLength: accountPasswordMaximumLength },
        },
      },
    },
  }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!store) {
      return reply.code(503).send(safeError("SYSTEM_AUTH_UNAVAILABLE", "System Admin sign-in is unavailable.", request.id));
    }
    const email = request.body.email.trim().toLowerCase();
    if (!isNormalizedEmail(email)) {
      return reply.code(400).send(safeError("INVALID_EMAIL", "Enter a valid email address.", request.id));
    }
    // Throttle before any password work, including for unknown email addresses.
    const locked = await store.throttleState("sign-in", email);
    if (locked) return tooManyAttempts(reply, locked.retryAfterSeconds, request.id);
    const checked = await passwordWork.run(async () => {
      const found = await store.authenticateByEmail(email);
      const verified = await verifySystemAdminPassword(request.body.password, found?.passwordHash ?? null);
      return { found, verified };
    });
    if (!checked) return tooManyAttempts(reply, 1, request.id);
    const { found, verified } = checked.value;
    if (!found || !verified) {
      if (found) await store.recordFailedSignIn(found.account.id, request.id);
      await store.recordThrottleFailure("sign-in", email);
      return reply.code(401).send(safeError("INVALID_CREDENTIALS", "Email or password is incorrect.", request.id));
    }
    await store.clearThrottle("sign-in", email);
    const session = await store.startSession(found.account.id, request.id, new Date(newSystemSessionExpiry() * 1000));
    reply.header("set-cookie", sessionCookie(session, sessionKey, secureCookies));
    return {
      administrator: publicAdmin(found.account),
      sessionExpiresAt: session.expiresAt.toISOString(),
    };
  });

  app.post("/api/v1/system/auth/sign-out", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const cookie = readSystemSessionCookie(request.headers.cookie, sessionKey, secureCookies);
    if (cookie && store) {
      try { await store.endSession(cookie.sessionId, request.id); }
      catch (error) {
        request.log.error({ requestId: request.id, errorType: error instanceof Error ? error.name : "Unknown" },
          "System Admin session revocation failed");
        reply.header("set-cookie", clearSystemSessionCookie(secureCookies));
        return reply.code(503).send(safeError("SYSTEM_AUTH_UNAVAILABLE", "Sign-out could not be completed. Try again.", request.id));
      }
    }
    reply.header("set-cookie", clearSystemSessionCookie(secureCookies));
    return reply.code(204).send();
  });

  app.get("/api/v1/system/auth/me", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const cookie = readSystemSessionCookie(request.headers.cookie, sessionKey, secureCookies);
    if (!store) {
      return reply.code(503).send(safeError("SYSTEM_AUTH_UNAVAILABLE", "System administration is unavailable.", request.id));
    }
    const active = cookie ? await store.getActiveSession(cookie.sessionId) : null;
    if (!active) {
      if (cookie) reply.header("set-cookie", clearSystemSessionCookie(secureCookies));
      return reply.code(401).send(safeError("UNAUTHENTICATED", "Sign in to the System Console to continue.", request.id));
    }
    return {
      administrator: publicAdmin(active.account),
      sessionExpiresAt: active.session.expiresAt.toISOString(),
    };
  });
}
