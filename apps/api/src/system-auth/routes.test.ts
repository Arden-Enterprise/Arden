import Fastify from "fastify";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSystemConsoleRoutes } from "../system-console/routes.js";
import { PasswordWorkLimiter } from "./password.js";
import { createSystemActorResolver, registerSystemAuthRoutes } from "./routes.js";
import { createSystemSessionCookie } from "./session.js";
import {
  SystemAuthError, throttleBucket, throttleLockSeconds,
  type SystemAdminAccount, type SystemAdminSessionRecord, type SystemAuthStore, type ThrottleScope,
} from "./store.js";

/** In-memory stand-in with the same observable rules as `PgSystemAuthStore`. */
class MemorySystemAuthStore implements SystemAuthStore {
  readonly admins = new Map<string, { account: SystemAdminAccount; passwordHash: string }>();
  readonly sessions = new Map<string, SystemAdminSessionRecord & { revoked: boolean }>();
  readonly throttles = new Map<string, number>();
  readonly events: string[] = [];
  /** Setup closes on the first administrator row, independent of later revocations. */
  private setupCompleted = false;
  constructor(private readonly hasOrganizations = false) {}

  async setupStatus() {
    return { needsInitialSetup: !this.setupCompleted, hasOrganizations: this.hasOrganizations };
  }

  private session(adminId: string, expiresAt: Date) {
    const record = { sessionId: randomUUID(), adminId, expiresAt, revoked: false };
    this.sessions.set(record.sessionId, record);
    return { sessionId: record.sessionId, adminId, expiresAt };
  }

  async completeInitialSetup(input: { email: string; fullName: string; passwordHash: string; requestId: string;
    sessionExpiresAt: Date }) {
    if (this.setupCompleted) throw new SystemAuthError("SYSTEM_SETUP_ALREADY_COMPLETED");
    for (const entry of this.admins.values()) {
      if (entry.account.email === input.email) throw new SystemAuthError("SYSTEM_ADMIN_EMAIL_CONFLICT");
    }
    const account: SystemAdminAccount = {
      id: randomUUID(), email: input.email, fullName: input.fullName, status: "ACTIVE", canManageSystemAdmins: true,
    };
    this.admins.set(account.id, { account, passwordHash: input.passwordHash });
    this.setupCompleted = true;
    this.events.push("SYSTEM_ADMIN_FIRST_SETUP");
    return { account, session: this.session(account.id, input.sessionExpiresAt) };
  }

  async authenticateByEmail(email: string) {
    for (const entry of this.admins.values()) {
      if (entry.account.email === email && entry.account.status === "ACTIVE") return entry;
    }
    return null;
  }

  async startSession(adminId: string, _requestId: string, expiresAt: Date) {
    this.events.push("SYSTEM_ADMIN_SIGNED_IN");
    return this.session(adminId, expiresAt);
  }

  async recordFailedSignIn() { this.events.push("SYSTEM_ADMIN_SIGN_IN_FAILED"); }

  async getActiveSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.revoked || session.expiresAt.valueOf() <= Date.now()) return null;
    const entry = this.admins.get(session.adminId);
    if (!entry || entry.account.status !== "ACTIVE") return null;
    return { session: { sessionId, adminId: session.adminId, expiresAt: session.expiresAt }, account: entry.account };
  }

  async endSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && !session.revoked) {
      session.revoked = true;
      this.events.push("SYSTEM_ADMIN_SIGNED_OUT");
    }
  }

  async throttleState(scope: ThrottleScope, key: string) {
    const seconds = throttleLockSeconds(this.throttles.get(throttleBucket(scope, key)) ?? 0);
    return seconds ? { retryAfterSeconds: seconds } : null;
  }

  async recordThrottleFailure(scope: ThrottleScope, key: string) {
    const bucket = throttleBucket(scope, key);
    const failures = (this.throttles.get(bucket) ?? 0) + 1;
    this.throttles.set(bucket, failures);
    const seconds = throttleLockSeconds(failures);
    return seconds ? { retryAfterSeconds: seconds } : null;
  }

  async clearThrottle(scope: ThrottleScope, key: string) { this.throttles.delete(throttleBucket(scope, key)); }

  revoke(adminId: string) {
    const entry = this.admins.get(adminId);
    if (entry) entry.account = { ...entry.account, status: "REVOKED", canManageSystemAdmins: false };
  }
}

const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const setupToken = "setup-token-secret-value-1234567890";
const strongPassword = "StrongPassword!1";

describe("Isolated System Admin setup and authentication", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function createApp(options: { hasOrganizations?: boolean; setupToken?: string | undefined;
    store?: SystemAuthStore | undefined; passwordWork?: PasswordWorkLimiter } = {}) {
    const store = new MemorySystemAuthStore(options.hasOrganizations ?? false);
    const effectiveStore = "store" in options ? options.store : store;
    const sessionKey = randomBytes(32);
    const report = vi.fn(async () => ({ organizations: { total: options.hasOrganizations ? 2 : 0 } }));
    const app = Fastify();
    registerSystemAuthRoutes(app, { store: effectiveStore,
      setupToken: "setupToken" in options ? options.setupToken : setupToken,
      sessionKey, secureCookies: false, ...(options.passwordWork ? { passwordWork: options.passwordWork } : {}) });
    const systemActor = createSystemActorResolver(effectiveStore, sessionKey, false);
    registerSystemConsoleRoutes(app, { report }, systemActor, uuid, async () => ({
      auth: { status: "ok", latencyMs: 5 },
      ardenAi: { status: "ok", latencyMs: 10 },
    }));
    apps.push(app);
    return { app, store, report, sessionKey };
  }

  const setup = (app: ReturnType<typeof Fastify>, overrides: Record<string, string> = {}) => app.inject({
    method: "POST", url: "/api/v1/system/setup",
    payload: { setupToken, email: "admin@arden.local", fullName: "Primary Admin", password: strongPassword, ...overrides },
  });
  const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"]).split(";", 1)[0]!;

  it("completes first-time setup with a valid token even when organizations already exist, then permanently closes setup", async () => {
    const { app, report, store } = createApp({ hasOrganizations: true });

    const statusBefore = await app.inject("/api/v1/system/setup/status");
    expect(statusBefore.statusCode).toBe(200);
    expect(statusBefore.headers["cache-control"]).toBe("no-store");
    expect(statusBefore.json()).toEqual({ needsInitialSetup: true, hasOrganizations: true });

    const wrongToken = await setup(app, { setupToken: "wrong-token-value" });
    expect(wrongToken.statusCode).toBe(403);
    expect(wrongToken.json().error.code).toBe("INVALID_SETUP_TOKEN");
    // The response does not name the operator's configuration variable or log location.
    expect(wrongToken.body).not.toContain("ARDEN_SYSTEM_SETUP_TOKEN");
    expect(wrongToken.body).not.toContain("log");

    const weakPassword = await setup(app, { password: "weakpassword" });
    expect(weakPassword.statusCode).toBe(400);
    expect(weakPassword.json().error.code).toBe("INVALID_PASSWORD");

    const created = await setup(app, { email: "  SysAdmin@Arden.Local ", fullName: "System Operator" });
    expect(created.statusCode).toBe(201);
    expect(created.json().administrator).toMatchObject({
      email: "sysadmin@arden.local", fullName: "System Operator", canManageSystemAdmins: true,
    });
    const setCookie = String(created.headers["set-cookie"]);
    expect(setCookie).toContain("arden_system_session=");
    expect(setCookie).toContain("HttpOnly");

    // Layer 1 protection: even with the exact valid token, setup cannot be run again.
    const repeat = await setup(app, { email: "second@arden.local" });
    expect(repeat.statusCode).toBe(409);
    expect(repeat.json().error.code).toBe("SYSTEM_SETUP_ALREADY_COMPLETED");

    // Setup stays closed even after the first administrator is revoked.
    store.revoke(created.json().administrator.id as string);
    const statusAfter = await app.inject("/api/v1/system/setup/status");
    expect(statusAfter.json()).toEqual({ needsInitialSetup: false, hasOrganizations: true });
    expect(report).not.toHaveBeenCalled();
  });

  it("opens the Console with the setup session and fails closed when setup is not configured", async () => {
    const { app, report } = createApp();
    const created = await setup(app);
    const overview = await app.inject({ url: "/api/v1/system/overview", headers: { cookie: cookieOf(created) } });
    expect(overview.statusCode).toBe(200);
    expect(report).toHaveBeenCalledTimes(1);

    const unconfigured = createApp({ setupToken: undefined }).app;
    const closed = await setup(unconfigured);
    expect(closed.statusCode).toBe(503);
    expect(closed.json().error.code).toBe("SYSTEM_SETUP_UNAVAILABLE");

    const withoutDatabase = createApp({ store: undefined }).app;
    expect((await withoutDatabase.inject("/api/v1/system/setup/status")).statusCode).toBe(503);
    expect((await withoutDatabase.inject("/api/v1/system/overview")).statusCode).toBe(503);
  });

  it("throttles repeated setup-token guesses before checking the token", async () => {
    const { app } = createApp();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await setup(app, { setupToken: `wrong-${attempt}` })).statusCode).toBe(403);
    }
    const locked = await setup(app);
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("isolates System Admin sign-in/session from normal user cookies and blocks revoked admins", async () => {
    const { app, store } = createApp();
    const created = await setup(app);
    const adminId = created.json().administrator.id as string;

    // Ordinary user cookies are never accepted on System Admin endpoints.
    const memberCookie = "arden_access_token=fake-supabase-jwt; arden_refresh_token=fake-refresh";
    expect((await app.inject({ url: "/api/v1/system/auth/me", headers: { cookie: memberCookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/system/overview", headers: { cookie: memberCookie } })).statusCode).toBe(404);

    const badLogin = await app.inject({ method: "POST", url: "/api/v1/system/auth/sign-in",
      payload: { email: "admin@arden.local", password: "WrongPassword!1" } });
    expect(badLogin.statusCode).toBe(401);
    expect(store.events).toContain("SYSTEM_ADMIN_SIGN_IN_FAILED");

    const goodLogin = await app.inject({ method: "POST", url: "/api/v1/system/auth/sign-in",
      payload: { email: "admin@arden.local", password: strongPassword } });
    expect(goodLogin.statusCode).toBe(200);
    const cookiePair = cookieOf(goodLogin);

    const me = await app.inject({ url: "/api/v1/system/auth/me", headers: { cookie: cookiePair } });
    expect(me.statusCode).toBe(200);
    expect(me.json().administrator.id).toBe(adminId);

    // Revoking the admin immediately invalidates active cookies.
    store.revoke(adminId);
    expect((await app.inject({ url: "/api/v1/system/auth/me", headers: { cookie: cookiePair } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/system/overview", headers: { cookie: cookiePair } })).statusCode).toBe(404);
  });

  it("revokes the server-side session on sign-out so a copied cookie stops working", async () => {
    const { app, store } = createApp();
    const cookiePair = cookieOf(await setup(app));
    const signOut = await app.inject({ method: "POST", url: "/api/v1/system/auth/sign-out", headers: { cookie: cookiePair } });
    expect(signOut.statusCode).toBe(204);
    expect(String(signOut.headers["set-cookie"])).toContain("Max-Age=0");
    expect(store.events).toContain("SYSTEM_ADMIN_SIGNED_OUT");
    expect((await app.inject({ url: "/api/v1/system/auth/me", headers: { cookie: cookiePair } })).statusCode).toBe(401);
    expect((await app.inject({ url: "/api/v1/system/overview", headers: { cookie: cookiePair } })).statusCode).toBe(404);
  });

  it("rejects a validly signed cookie whose expiry is beyond the session lifetime", async () => {
    const { app, store, sessionKey } = createApp();
    const created = await setup(app);
    const sessionId = [...store.sessions.keys()][0]!;
    const farFuture = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const forged = createSystemSessionCookie(sessionId, farFuture, sessionKey, false).split(";", 1)[0]!;
    expect(created.statusCode).toBe(201);
    expect((await app.inject({ url: "/api/v1/system/auth/me", headers: { cookie: forged } })).statusCode).toBe(401);
  });

  it("locks an account after repeated wrong passwords, including for unknown emails", async () => {
    const { app } = createApp();
    await setup(app);
    const attempt = (email: string, password: string) => app.inject({ method: "POST", url: "/api/v1/system/auth/sign-in",
      payload: { email, password } });
    for (let index = 0; index < 5; index++) expect((await attempt("admin@arden.local", "WrongPassword!1")).statusCode).toBe(401);
    const locked = await attempt("admin@arden.local", strongPassword);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("TOO_MANY_ATTEMPTS");

    for (let index = 0; index < 5; index++) expect((await attempt("nobody@arden.local", "WrongPassword!1")).statusCode).toBe(401);
    expect((await attempt("nobody@arden.local", "WrongPassword!1")).statusCode).toBe(429);
  });

  it("refuses sign-in work beyond the password-hashing capacity instead of queueing it", async () => {
    const busy = new PasswordWorkLimiter(0);
    const { app } = createApp({ passwordWork: busy });
    const response = await app.inject({ method: "POST", url: "/api/v1/system/auth/sign-in",
      payload: { email: "admin@arden.local", password: strongPassword } });
    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("1");
  });
});
