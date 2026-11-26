import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  accountPasswordMaximumLength,
  accountPasswordMaximumLengthMessage,
  meetsAccountPasswordRequirements,
} from "@arden/domain";
import { hashSystemAdminPassword, verifySetupToken, verifySystemAdminPassword } from "./password.js";
import {
  clearSystemSessionCookie,
  createSystemSessionCookie,
  newSystemSessionExpiry,
  readSystemSessionCookie,
} from "./session.js";
import { SystemAuthError, type SystemAdminAccount, type SystemAuthStore } from "./store.js";

const passwordRequirementsMessage =
  "Password must have at least 8 characters, one uppercase letter, and one special character.";

function isNormalizedEmail(value: string): boolean {
  if (value.length < 3 || value.length > 320 || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return domain.split(".").every((label) => label.length >= 1 && label.length <= 63 && /^[a-z0-9-]+$/.test(label) && !label.startsWith("-") && !label.endsWith("-"));
}

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

export type SystemAuthRouteOptions = {
  store: SystemAuthStore | undefined;
  setupToken: string | undefined;
  sessionKey: Buffer;
  secureCookies: boolean;
};

export function createSystemActorResolver(
  store: SystemAuthStore | undefined,
  sessionKey: Buffer,
  secureCookies: boolean,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<{ userId: string } | null> => {
    const session = readSystemSessionCookie(request.headers.cookie, sessionKey, secureCookies);
    if (!session || !store) {
      reply.header("Cache-Control", "no-store");
      reply.code(404).send({ error: { code: "SYSTEM_CONSOLE_UNAVAILABLE", message: "The resource is not available." } });
      return null;
    }
    const admin = await store.getActiveAdministrator(session.adminId);
    if (!admin) {
      reply.header("Cache-Control", "no-store");
      reply.header("set-cookie", clearSystemSessionCookie(secureCookies));
      reply.code(404).send({ error: { code: "SYSTEM_CONSOLE_UNAVAILABLE", message: "The resource is not available." } });
      return null;
    }
    return { userId: admin.id };
  };
}

export function registerSystemAuthRoutes(app: FastifyInstance, options: SystemAuthRouteOptions) {
  const { store, setupToken, sessionKey, secureCookies } = options;

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
    // Layer 1 check before revealing token validity if setup is already closed.
    const currentStatus = await store.setupStatus();
    if (!currentStatus.needsInitialSetup) {
      return reply.code(409).send(safeError(
        "SYSTEM_SETUP_ALREADY_COMPLETED",
        "Initial System Admin setup has already been completed.",
        request.id,
      ));
    }
    // Layer 2 check: one-time operator setup token prevents unauthorized takeover while uninitialized.
    if (!verifySetupToken(request.body.setupToken, setupToken)) {
      return reply.code(403).send(safeError(
        "INVALID_SETUP_TOKEN",
        "The setup token is invalid. Check ARDEN_SYSTEM_SETUP_TOKEN or the API startup logs.",
        request.id,
      ));
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
      return reply.code(400).send(safeError("INVALID_PASSWORD", passwordRequirementsMessage, request.id));
    }
    try {
      const passwordHash = await hashSystemAdminPassword(request.body.password);
      const administrator = await store.completeInitialSetup({
        email,
        fullName,
        passwordHash,
        requestId: request.id,
      });
      const expiresAt = newSystemSessionExpiry();
      reply.header("set-cookie", createSystemSessionCookie(administrator.id, expiresAt, sessionKey, secureCookies));
      return reply.code(201).send({
        administrator: publicAdmin(administrator),
        sessionExpiresAt: new Date(expiresAt * 1000).toISOString(),
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
    const found = await store.authenticateByEmail(email);
    const verified = await verifySystemAdminPassword(request.body.password, found?.passwordHash ?? null);
    if (!found || !verified) {
      return reply.code(401).send(safeError("INVALID_CREDENTIALS", "Email or password is incorrect.", request.id));
    }
    await store.recordSignIn(found.account.id, request.id);
    const expiresAt = newSystemSessionExpiry();
    reply.header("set-cookie", createSystemSessionCookie(found.account.id, expiresAt, sessionKey, secureCookies));
    return {
      administrator: publicAdmin(found.account),
      sessionExpiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  });

  app.post("/api/v1/system/auth/sign-out", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("set-cookie", clearSystemSessionCookie(secureCookies));
    return reply.code(204).send();
  });

  app.get("/api/v1/system/auth/me", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const session = readSystemSessionCookie(request.headers.cookie, sessionKey, secureCookies);
    if (!session || !store) {
      return reply.code(401).send(safeError("UNAUTHENTICATED", "Sign in to the System Console to continue.", request.id));
    }
    const administrator = await store.getActiveAdministrator(session.adminId);
    if (!administrator) {
      reply.header("set-cookie", clearSystemSessionCookie(secureCookies));
      return reply.code(401).send(safeError("UNAUTHENTICATED", "Sign in to the System Console to continue.", request.id));
    }
    return {
      administrator: publicAdmin(administrator),
      sessionExpiresAt: new Date(session.expiresAt * 1000).toISOString(),
    };
  });
}
