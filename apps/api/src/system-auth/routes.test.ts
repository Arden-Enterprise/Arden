import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSystemConsoleRoutes } from "../system-console/routes.js";
import { createSystemActorResolver, registerSystemAuthRoutes } from "./routes.js";
import { SystemAuthError, type SystemAdminAccount, type SystemAuthStore } from "./store.js";

class MemorySystemAuthStore implements SystemAuthStore {
  private readonly admins = new Map<string, { account: SystemAdminAccount; passwordHash: string }>();
  constructor(private readonly hasOrganizations = false) {}

  async setupStatus() {
    const hasManager = [...this.admins.values()].some(
      ({ account }) => account.status === "ACTIVE" && account.canManageSystemAdmins,
    );
    return { needsInitialSetup: !hasManager, hasOrganizations: this.hasOrganizations };
  }

  async completeInitialSetup(input: { email: string; fullName: string; passwordHash: string; requestId: string }) {
    if (!(await this.setupStatus()).needsInitialSetup) {
      throw new SystemAuthError("SYSTEM_SETUP_ALREADY_COMPLETED");
    }
    for (const entry of this.admins.values()) {
      if (entry.account.email === input.email) throw new SystemAuthError("SYSTEM_ADMIN_EMAIL_CONFLICT");
    }
    const account: SystemAdminAccount = {
      id: randomUUID(),
      email: input.email,
      fullName: input.fullName,
      status: "ACTIVE",
      canManageSystemAdmins: true,
    };
    this.admins.set(account.id, { account, passwordHash: input.passwordHash });
    return account;
  }

  async authenticateByEmail(email: string) {
    for (const entry of this.admins.values()) {
      if (entry.account.email === email && entry.account.status === "ACTIVE") return entry;
    }
    return null;
  }

  async recordSignIn() {}

  async getActiveAdministrator(adminId: string) {
    const entry = this.admins.get(adminId);
    return entry && entry.account.status === "ACTIVE" ? entry.account : null;
  }

  revoke(adminId: string) {
    const entry = this.admins.get(adminId);
    if (entry) entry.account = { ...entry.account, status: "REVOKED" };
  }
}

const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const setupToken = "setup-token-secret-value-1234567890";

describe("Isolated System Admin setup and authentication", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createApp(hasOrganizations = false) {
    const store = new MemorySystemAuthStore(hasOrganizations);
    const sessionKey = randomBytes(32);
    const report = vi.fn(async () => ({ organizations: { total: hasOrganizations ? 2 : 0 } }));
    const app = Fastify();
    registerSystemAuthRoutes(app, { store, setupToken, sessionKey, secureCookies: false });
    const systemActor = createSystemActorResolver(store, sessionKey, false);
    registerSystemConsoleRoutes(app, { canAccess: async () => true, report }, systemActor, uuid, async () => ({
      auth: { status: "ok", latencyMs: 5 },
      ardenAi: { status: "ok", latencyMs: 10 },
    }));
    apps.push(app);
    return { app, store, report };
  }

  it("completes first-time setup with a valid token even when organizations already exist, then permanently closes setup", async () => {
    const { app, report } = createApp(true);

    const statusBefore = await app.inject("/api/v1/system/setup/status");
    expect(statusBefore.statusCode).toBe(200);
    expect(statusBefore.headers["cache-control"]).toBe("no-store");
    expect(statusBefore.json()).toEqual({ needsInitialSetup: true, hasOrganizations: true });

    const wrongToken = await app.inject({
      method: "POST",
      url: "/api/v1/system/setup",
      payload: {
        setupToken: "wrong-token-value",
        email: "sysadmin@arden.local",
        fullName: "System Operator",
        password: "StrongPassword!1",
      },
    });
    expect(wrongToken.statusCode).toBe(403);
    expect(wrongToken.json().error.code).toBe("INVALID_SETUP_TOKEN");

    const weakPassword = await app.inject({
      method: "POST",
      url: "/api/v1/system/setup",
      payload: {
        setupToken,
        email: "sysadmin@arden.local",
        fullName: "System Operator",
        password: "weakpassword",
      },
    });
    expect(weakPassword.statusCode).toBe(400);
    expect(weakPassword.json().error.code).toBe("INVALID_PASSWORD");

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/system/setup",
      payload: {
        setupToken,
        email: "  SysAdmin@Arden.Local ",
        fullName: "System Operator",
        password: "StrongPassword!1",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().administrator).toMatchObject({
      email: "sysadmin@arden.local",
      fullName: "System Operator",
      canManageSystemAdmins: true,
    });
    const setCookie = String(created.headers["set-cookie"]);
    expect(setCookie).toContain("arden_system_session=");
    expect(setCookie).toContain("HttpOnly");
    const cookiePair = setCookie.split(";", 1)[0]!;

    // Layer 1 protection: even with the exact valid token, setup cannot be run again.
    const repeat = await app.inject({
      method: "POST",
      url: "/api/v1/system/setup",
      payload: {
        setupToken,
        email: "second@arden.local",
        fullName: "Second Operator",
        password: "StrongPassword!2",
      },
    });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json().error.code).toBe("SYSTEM_SETUP_ALREADY_COMPLETED");

    const statusAfter = await app.inject("/api/v1/system/setup/status");
    expect(statusAfter.json()).toEqual({ needsInitialSetup: false, hasOrganizations: true });

    // Authenticated system session can access System Console reports.
    const overview = await app.inject({
      method: "GET",
      url: "/api/v1/system/overview",
      headers: { cookie: cookiePair },
    });
    expect(overview.statusCode).toBe(200);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("isolates System Admin sign-in/session from normal user cookies and blocks revoked admins", async () => {
    const { app, store } = createApp(false);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/system/setup",
      payload: {
        setupToken,
        email: "admin@arden.local",
        fullName: "Primary Admin",
        password: "StrongPassword!1",
      },
    });
    const adminId = created.json().administrator.id as string;

    // Ordinary user cookies are never accepted on System Admin endpoints.
    const normalCookieMe = await app.inject({
      method: "GET",
      url: "/api/v1/system/auth/me",
      headers: { cookie: "arden_access_token=fake-supabase-jwt; arden_refresh_token=fake-refresh" },
    });
    expect(normalCookieMe.statusCode).toBe(401);

    const normalCookieConsole = await app.inject({
      method: "GET",
      url: "/api/v1/system/overview",
      headers: { cookie: "arden_access_token=fake-supabase-jwt; arden_refresh_token=fake-refresh" },
    });
    expect(normalCookieConsole.statusCode).toBe(404);

    // Wrong password rejected.
    const badLogin = await app.inject({
      method: "POST",
      url: "/api/v1/system/auth/sign-in",
      payload: { email: "admin@arden.local", password: "WrongPassword!1" },
    });
    expect(badLogin.statusCode).toBe(401);

    // Valid sign-in succeeds.
    const goodLogin = await app.inject({
      method: "POST",
      url: "/api/v1/system/auth/sign-in",
      payload: { email: "admin@arden.local", password: "StrongPassword!1" },
    });
    expect(goodLogin.statusCode).toBe(200);
    const cookiePair = String(goodLogin.headers["set-cookie"]).split(";", 1)[0]!;

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/system/auth/me",
      headers: { cookie: cookiePair },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().administrator.id).toBe(adminId);

    // Revoking the admin immediately invalidates active cookies.
    store.revoke(adminId);
    const meRevoked = await app.inject({
      method: "GET",
      url: "/api/v1/system/auth/me",
      headers: { cookie: cookiePair },
    });
    expect(meRevoked.statusCode).toBe(401);
    const consoleRevoked = await app.inject({
      method: "GET",
      url: "/api/v1/system/overview",
      headers: { cookie: cookiePair },
    });
    expect(consoleRevoked.statusCode).toBe(404);

    // Sign-out clears the system cookie.
    const signOut = await app.inject({ method: "POST", url: "/api/v1/system/auth/sign-out" });
    expect(signOut.statusCode).toBe(204);
    expect(String(signOut.headers["set-cookie"])).toContain("Max-Age=0");
  });
});
