import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { AuthProvider } from "./auth/provider.js";
import type { ArdenDataRepository, DraftCursor, DraftListItem, DraftPatch, DraftWrite, MembershipSummary, OrganizationAdminData, PrivateDraft, StoredContentFields } from "./db/repository.js";
import { LocalPrivateContentStorage } from "./private-notes/content-storage.js";
import type { InvitationEmail, InvitationMailer } from "./email/smtp-mailer.js";
import { LocalFlow1TestInvitationMailer } from "./email/local-flow1-test-mailer.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const draftId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const versionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("API auth and private draft routes", () => {
  let root: string;
  let storage: LocalPrivateContentStorage;
  let repository: MemoryRepository;
  let authProvider: FakeAuthProvider;
  let invitationMailer: FakeInvitationMailer;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "arden-api-test-"));
    storage = new LocalPrivateContentStorage(root);
    repository = new MemoryRepository();
    authProvider = new FakeAuthProvider();
    invitationMailer = new FakeInvitationMailer();
    app = buildApp({
      checkDatabase: async () => undefined,
      auth: authProvider,
      authTrustedOrigins: ["http://localhost:5180"],
      secureCookies: false,
      repository,
      storage,
      invitationMailer,
      publicWebOrigin: "https://arden.example.test",
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps health routes public and reports readiness failures safely", async () => {
    const live = await app.inject("/api/health/live");
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });

    const unavailable = buildApp({
      checkDatabase: async () => { throw new Error("database unavailable"); },
      auth: new FakeAuthProvider(), authTrustedOrigins: ["http://localhost:5180"], secureCookies: false, repository, storage, invitationMailer,
    });
    try {
      const ready = await unavailable.inject("/api/health/ready");
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({ status: "unavailable" });
    } finally {
      await unavailable.close();
    }
  });

  it("signs in through the Supabase adapter and returns only the caller's membership context", async () => {
    const signIn = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", password: "synthetic-password" },
    });
    expect(signIn.statusCode).toBe(200);
    const cookie = cookieHeader(signIn.headers["set-cookie"]);
    expect(cookie).toContain("arden_access=access-owner");
    expect(cookie).toContain("arden_refresh=refresh-owner");
    expect(JSON.stringify(signIn.headers["set-cookie"])).toContain("HttpOnly");
    expect(JSON.stringify(signIn.headers["set-cookie"])).toContain("SameSite=Lax");

    const response = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      actor: { id: ownerId, email: "owner@example.test" },
      memberships: [{
        organization: { id: organizationId, name: "Arden Test Org" },
        status: "active", roleCodes: ["MEMBER"], canUsePrivateWorkspace: true,
      }],
    });
  });

  it("allows the explicitly injected Kiet Local test actor to use core routes without a login cookie", async () => {
    const noLoginApp = buildApp({
      checkDatabase: async () => undefined,
      auth: null,
      authTrustedOrigins: ["http://127.0.0.1:5180"],
      secureCookies: false,
      repository,
      storage,
      invitationMailer: new LocalFlow1TestInvitationMailer(),
      invitationDeliveryMode: "local-test-no-email",
      publicWebOrigin: "http://127.0.0.1:5180",
      testActor: { userId: ownerId, email: "kiet-local@example.test", fullName: "Kiet Local Test Actor", emailVerified: true },
    });
    try {
      const session = await noLoginApp.inject("/api/v1/me");
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({ actor: { id: ownerId }, testMode: true, memberships: [{ organization: { id: organizationId } }] });

      const created = await noLoginApp.inject({
        method: "POST", url: "/api/v1/organizations", headers: { origin: "http://127.0.0.1:5180" },
        payload: { name: "Kiet Test Org", departmentName: "Engineering" },
      });
      expect(created.statusCode).toBe(201);
      expect(repository.createdOrganization).toMatchObject({ userId: ownerId, email: "kiet-local@example.test" });
      expect((await noLoginApp.inject({ method: "POST", url: "/api/v1/auth/sign-out", headers: { origin: "http://127.0.0.1:5180" } })).statusCode).toBe(204);
    } finally {
      await noLoginApp.close();
    }
  });

  it("creates an organization with the verified caller as its first admin and primary-department member", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({
      method: "POST", url: "/api/v1/organizations",
      headers: { cookie: session, origin: "http://localhost:5180" },
      payload: { name: " Product Team ", departmentName: " Product " },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().organization).toEqual({
      organizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Product Team",
      departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", departmentName: "Product",
    });
    expect(repository.createdOrganization).toMatchObject({ userId: ownerId, email: "owner@example.test", name: "Product Team" });
  });

  it("exposes organization administration and role/department mutations only to the Org Admin", async () => {
    const adminSession = await desktopSession(app, "owner@example.test");
    const adminData = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/administration`, headers: { cookie: adminSession } });
    expect(adminData.statusCode).toBe(200);
    expect(adminData.json().departments[0].name).toBe("Product");

    const createdRole = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/roles`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { name: "Reviewer" } });
    expect(createdRole.statusCode).toBe(201);
    const createdDepartment = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/departments`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { name: "Operations" } });
    expect(createdDepartment.statusCode).toBe(201);
    const assigned = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/members/77777777-7777-4777-8777-777777777777/roles`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { roleId: "88888888-8888-4888-8888-888888888888" } });
    expect(assigned.statusCode).toBe(201);

    const memberSession = await desktopSession(app, "member@example.test");
    const denied = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/administration`, headers: { cookie: memberSession } });
    expect(denied.statusCode).toBe(404);
    const deniedRoleWrite = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/roles`, headers: { cookie: memberSession, origin: "http://localhost:5180" }, payload: { name: "Forged role" } });
    expect(deniedRoleWrite.statusCode).toBe(404);
  });

  it("requires a signed-in verified email and validates organization setup input", async () => {
    const noSession = await app.inject({ method: "POST", url: "/api/v1/organizations", headers: { origin: "http://localhost:5180" }, payload: { name: "Org", departmentName: "Team" } });
    expect(noSession.statusCode).toBe(401);
    const session = await desktopSession(app, "owner@example.test");
    const invalid = await app.inject({ method: "POST", url: "/api/v1/organizations", headers: { cookie: session, origin: "http://localhost:5180" }, payload: { name: "  ", departmentName: "Team" } });
    expect(invalid.statusCode).toBe(400);
    expect(repository.createdOrganization).toBeNull();
  });

  it("sends opaque invitations and accepts them only for the matching authenticated email once", async () => {
    const adminSession = await desktopSession(app, "owner@example.test");
    const created = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/invitations`,
      headers: { cookie: adminSession, origin: "http://localhost:5180" },
      payload: { departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", email: "New.Member@Example.Test" },
    });
    expect(created.statusCode).toBe(202);
    expect(JSON.stringify(created.json())).not.toContain("token");
    expect(invitationMailer.sent).toHaveLength(1);
    expect(invitationMailer.sent[0]?.to).toBe("new.member@example.test");
    const token = invitationMailer.sent[0]?.invitationUrl.split("/").at(-1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const resent = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/invitations/${created.json().invitationId}/resend`,
      headers: { cookie: adminSession, origin: "http://localhost:5180" },
    });
    expect(resent.statusCode).toBe(202);
    const resentToken = invitationMailer.sent[1]?.invitationUrl.split("/").at(-1);
    expect(resentToken).not.toBe(token);

    const wrongAccount = await desktopSession(app, "owner@example.test");
    const rejected = await app.inject({ method: "POST", url: "/api/v1/invitations/accept", headers: { cookie: wrongAccount, origin: "http://localhost:5180" }, payload: { token: resentToken } });
    expect(rejected.statusCode).toBe(404);
    expect(rejected.json().error.code).toBe("INVITATION_NOT_AVAILABLE");

    const oldTokenRejected = await app.inject({ method: "POST", url: "/api/v1/invitations/accept", headers: { cookie: await desktopSession(app, "new.member@example.test"), origin: "http://localhost:5180" }, payload: { token } });
    expect(oldTokenRejected.statusCode).toBe(404);
    const invitedSession = await desktopSession(app, "new.member@example.test");
    const accepted = await app.inject({ method: "POST", url: "/api/v1/invitations/accept", headers: { cookie: invitedSession, origin: "http://localhost:5180" }, payload: { token: resentToken } });
    expect(accepted.statusCode).toBe(204);
    const replay = await app.inject({ method: "POST", url: "/api/v1/invitations/accept", headers: { cookie: invitedSession, origin: "http://localhost:5180" }, payload: { token: resentToken } });
    expect(replay.statusCode).toBe(404);
  });

  it("does not acknowledge invitation delivery when SMTP reports a failure", async () => {
    invitationMailer.failDelivery = true;
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/invitations`,
      headers: { cookie: session, origin: "http://localhost:5180" },
      payload: { departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", email: "new.member@example.test" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("INVITATION_DELIVERY_FAILED");
    expect(response.json().invitationId).toBeDefined();
    expect(JSON.stringify(response.json())).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(repository.pendingInvitation).not.toBeNull();
    expect(invitationMailer.sent).toHaveLength(0);
  });

  it("labels local-test invitations as saved without sending email", async () => {
    const localTestApp = buildApp({
      checkDatabase: async () => undefined,
      auth: authProvider,
      authTrustedOrigins: ["http://localhost:5180"],
      secureCookies: false,
      repository,
      storage,
      invitationMailer: new LocalFlow1TestInvitationMailer(),
      invitationDeliveryMode: "local-test-no-email",
      publicWebOrigin: "http://127.0.0.1:5180",
    });
    try {
      const session = await desktopSession(localTestApp, "owner@example.test");
      const response = await localTestApp.inject({
        method: "POST", url: `/api/v1/organizations/${organizationId}/invitations`,
        headers: { cookie: session, origin: "http://localhost:5180" },
        payload: { departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", email: "local.member@example.test" },
      });
      expect(response.statusCode).toBe(202);
      expect(response.json().deliveryMode).toBe("local-test-no-email");
      expect(repository.pendingInvitation?.email).toBe("local.member@example.test");
    } finally {
      await localTestApp.close();
    }
  });

  it("revokes a pending invitation and blocks later acceptance", async () => {
    const adminSession = await desktopSession(app, "owner@example.test");
    const created = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/invitations`,
      headers: { cookie: adminSession, origin: "http://localhost:5180" },
      payload: { departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", email: "new.member@example.test" },
    });
    const token = invitationMailer.sent[0]?.invitationUrl.split("/").at(-1);
    const revoked = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/invitations/${created.json().invitationId}/revoke`,
      headers: { cookie: adminSession, origin: "http://localhost:5180" },
    });
    expect(revoked.statusCode).toBe(204);
    const accepted = await app.inject({
      method: "POST", url: "/api/v1/invitations/accept",
      headers: { cookie: await desktopSession(app, "new.member@example.test"), origin: "http://localhost:5180" },
      payload: { token },
    });
    expect(accepted.statusCode).toBe(404);
  });

  it("rejects bad credentials, missing sessions, and malformed sign-in payloads", async () => {
    const badCredentials = await app.inject({ method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" }, payload: { email: "unknown@example.test", password: "wrong" } });
    expect(badCredentials.statusCode).toBe(401);
    expect(JSON.stringify(badCredentials.json())).not.toContain("unknown@example.test");

    const noSession = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(noSession.statusCode).toBe(401);

    const extraField = await app.inject({ method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" }, payload: { email: "owner@example.test", password: "synthetic-password", userId: otherId } });
    expect(extraField.statusCode).toBe(400);
    expect(JSON.stringify(extraField.json())).not.toContain("userId");
  });

  it("keeps invitation account setup non-enumerating and never starts an authenticated session", async () => {
    const existing = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", password: "synthetic-password", fullName: "Owner" },
    });
    const newAccount = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:5180" },
      payload: { email: "new.member@example.test", password: "synthetic-password", fullName: "New Member" },
    });
    expect(existing.statusCode).toBe(202);
    expect(newAccount.statusCode).toBe(202);
    expect(existing.json()).toEqual(newAccount.json());
    expect(JSON.stringify(existing.headers["set-cookie"] ?? "")).not.toContain("arden_access");
  });

  it("signs out through Supabase and clears the session cookies", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-out",
      headers: { origin: "http://localhost:5180", cookie: "arden_access=access-owner; arden_refresh=refresh-owner" },
    });
    expect(response.statusCode).toBe(204);
    expect(authProvider.revokedSessions).toEqual(["access-owner"]);
    expect(JSON.stringify(response.headers["set-cookie"])).toContain("arden_access=");

    const withEmptyJson = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-out",
      headers: { origin: "http://localhost:5180", "content-type": "application/json", cookie: "arden_access=access-owner; arden_refresh=refresh-owner" },
    });
    expect(withEmptyJson.statusCode).toBe(204);
  });

  it("creates and reads only the authorized owner's note after canonical persistence", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const created = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/private-workspace/drafts`,
      headers: { cookie: session, origin: "http://localhost:5180" },
      payload: { title: "  Review notes  ", body: "Private body" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    expect(created.headers.location).toBe(`/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}`);
    expect(created.json().title).toBe("Review notes");
    expect(created.json().body).toBe("Private body");
    expect(created.json().currentVersion).toMatchObject({ version: 1, mimeType: "text/plain" });

    const read = await app.inject({
      method: "GET",
      url: `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}`,
      headers: { cookie: session },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().body).toBe("Private body");
  });

  it("returns the same safe 404 for forged owner IDs and cross-organization guesses", async () => {
    const session = await desktopSession(app, "other@example.test");
    const ownOrgGuess = await app.inject({
      method: "GET", url: `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}`,
      headers: { cookie: session },
    });
    const crossOrgGuess = await app.inject({
      method: "GET", url: `/api/v1/organizations/${otherOrganizationId}/private-workspace/drafts/${draftId}`,
      headers: { cookie: session },
    });
    expect(ownOrgGuess.statusCode).toBe(404);
    expect(crossOrgGuess.statusCode).toBe(404);
    expect(ownOrgGuess.json().error).toMatchObject({ code: "RESOURCE_NOT_AVAILABLE", message: "This resource is not available." });
    expect(crossOrgGuess.json().error).toMatchObject({ code: "RESOURCE_NOT_AVAILABLE", message: "This resource is not available." });
    expect(ownOrgGuess.json().error.requestId).not.toBe(crossOrgGuess.json().error.requestId);

    const list = await app.inject({
      method: "GET", url: `/api/v1/organizations/${organizationId}/private-workspace/drafts`,
      headers: { cookie: session },
    });
    expect(list.statusCode).toBe(404);
    expect(JSON.stringify(list.json())).not.toContain("Review notes");
  });

  it("checks role permission before owner scope and never grants managers another member's note", async () => {
    const session = await desktopSession(app, "manager@example.test");
    const read = await app.inject({
      method: "GET", url: `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}`,
      headers: { cookie: session },
    });
    expect(read.statusCode).toBe(404);
    expect(JSON.stringify(read.json())).not.toContain("Review notes");
  });

  it("rejects missing and stale update versions without acknowledging an overwrite", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}`;
    const missing = await app.inject({ method: "PATCH", url, headers: { cookie: session, origin: "http://localhost:5180" }, payload: { body: "changed" } });
    expect(missing.statusCode).toBe(428);

    const stale = await app.inject({ method: "PATCH", url, headers: { cookie: session, origin: "http://localhost:5180", "if-match": '"1"' }, payload: { body: "stale overwrite" } });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().error.code).toBe("VERSION_CONFLICT");
    expect(repository.currentBody).toBe("Private body");
  });

  it("updates with an expected version and advances the immutable version number", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}`;
    const updated = await app.inject({ method: "PATCH", url, headers: { cookie: session, origin: "http://localhost:5180", "if-match": '"2"' }, payload: { body: "Revised body" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"3"');
    expect(updated.json().body).toBe("Revised body");
    expect(repository.currentBody).toBe("Revised body");
  });

  it("validates tenant identifiers, unknown fields, NULs, and oversized request bodies", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const headers = { cookie: session, origin: "http://localhost:5180" };
    const invalidId = await app.inject({ method: "GET", url: "/api/v1/organizations/not-a-uuid/private-workspace/drafts", headers });
    expect(invalidId.statusCode).toBe(400);

    const forged = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/private-workspace/drafts`, headers,
      payload: { title: "Forged", body: "private", actorId: otherId },
    });
    expect(forged.statusCode).toBe(400);

    const nul = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/private-workspace/drafts`, headers,
      payload: { title: "NUL", body: "bad\u0000body" },
    });
    expect(nul.statusCode).toBe(400);

    const tooLarge = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/private-workspace/drafts`, headers,
      payload: { title: "Large", body: "x".repeat(129 * 1024) },
    });
    expect(tooLarge.statusCode).toBe(413);
  });

  it("routes desktop-compatible sign-in through the same HttpOnly Supabase session", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", password: "synthetic-password" },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.headers["set-cookie"])).toContain("HttpOnly");
  });
});

async function desktopSession(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  const response = await app.inject({
    method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" },
    payload: { email, password: "synthetic-password" },
  });
  expect(response.statusCode).toBe(200);
  return cookieHeader(response.headers["set-cookie"]);
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const entries = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return entries.map((entry) => entry.split(";", 1)[0]).join("; ");
}

class FakeAuthProvider implements AuthProvider {
  readonly revokedSessions: string[] = [];
  private readonly usersByAccessToken = new Map<string, { userId: string; email: string }>();

  async signIn(credentials: { email: string; password: string }) {
    if (credentials.password !== "synthetic-password" || !credentials.email.endsWith("@example.test")) throw new Error("INVALID_CREDENTIALS");
    const suffix = credentials.email.startsWith("owner") ? "owner" : credentials.email.startsWith("manager") ? "manager" : "other";
    const userId = suffix === "owner" ? ownerId : otherId;
    const tokens = { accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, expiresIn: 3600 };
    const email = credentials.email.trim().toLowerCase();
    this.usersByAccessToken.set(tokens.accessToken, { userId, email });
    return { userId, email, fullName: null, tokens };
  }

  async signUp() { return { tokens: null, emailVerified: false }; }

  async resolveSession(tokens: { accessToken: string }) {
    const user = this.usersByAccessToken.get(tokens.accessToken);
    return user ? { kind: "authenticated" as const, ...user, fullName: null, emailVerified: true } : { kind: "unauthenticated" as const };
  }

  async signOut(tokens: { accessToken: string }) {
    this.usersByAccessToken.delete(tokens.accessToken);
    this.revokedSessions.push(tokens.accessToken);
  }
}

class MemoryRepository implements ArdenDataRepository {
  createdOrganization: { userId: string; email: string; name: string } | null = null;
  pendingInvitation: { invitationId: string; email: string; tokenHash: string; expiresAt: Date; accepted: boolean } | null = null;
  currentBody = "Private body";
  currentVersion = 2;
  currentSource: StoredContentFields = { sourceUri: "arden-private-object://dddddddd-dddd-4ddd-8ddd-dddddddddddd", mimeType: "text/plain", contentHash: "not-used-in-forged-note" };

  async listMemberships(userId: string): Promise<MembershipSummary[]> {
    if (userId !== ownerId) return [];
    return [{ organizationId, organizationName: "Arden Test Org", status: "ACTIVE", roleCodes: ["MEMBER"], canUsePrivateWorkspace: true }];
  }

  async createOrganization(userId: string, email: string, _fullName: string | null, setup: { name: string; departmentName: string }): Promise<{ organizationId: string; name: string; departmentId: string; departmentName: string }> {
    this.createdOrganization = { userId, email, name: setup.name };
    return { organizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: setup.name, departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", departmentName: setup.departmentName };
  }

  async getOrganizationAdministration(userId: string, requestedOrganization: string): Promise<OrganizationAdminData | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    return {
      departments: [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "Product", defaultRoleId: "11111111-aaaa-4aaa-8aaa-111111111111", defaultRoleName: "Product Member" }],
      roles: [{ id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Product Member", code: "DEPT_DEFAULT_TEST", isDefault: true }],
      members: [{ id: "77777777-7777-4777-8777-777777777777", email: "owner@example.test", name: "Owner", status: "ACTIVE", departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", roleIds: [], roleNames: [] }],
      invitations: [],
    };
  }

  async createDepartment(userId: string, requestedOrganization: string, _name: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }
  async createOrganizationRole(userId: string, requestedOrganization: string, _name: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }
  async assignOrganizationRole(userId: string, requestedOrganization: string, _membershipId: string, _roleId: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }
  async changePrimaryDepartment(userId: string, requestedOrganization: string, _membershipId: string, _departmentId: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }

  async createInvitation(userId: string, requestedOrganization: string, departmentId: string, email: string, tokenHash: string, expiresAt: Date): Promise<{ invitationId: string; email: string; organizationName: string; expiresAt: Date } | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId || departmentId !== "ffffffff-ffff-4fff-8fff-ffffffffffff") return null;
    this.pendingInvitation = { invitationId: "99999999-9999-4999-8999-999999999999", email, tokenHash, expiresAt, accepted: false };
    return { invitationId: this.pendingInvitation.invitationId, email, organizationName: "Arden Test Org", expiresAt };
  }

  async rotateInvitation(userId: string, requestedOrganization: string, invitationId: string, tokenHash: string): Promise<{ invitationId: string; email: string; organizationName: string; expiresAt: Date } | null> {
    const invite = this.pendingInvitation;
    if (userId !== ownerId || requestedOrganization !== organizationId || !invite || invite.invitationId !== invitationId || invite.accepted) return null;
    invite.tokenHash = tokenHash;
    return { invitationId, email: invite.email, organizationName: "Arden Test Org", expiresAt: invite.expiresAt };
  }

  async revokeInvitation(userId: string, requestedOrganization: string, invitationId: string): Promise<boolean> {
    const invite = this.pendingInvitation;
    if (userId !== ownerId || requestedOrganization !== organizationId || !invite || invite.invitationId !== invitationId || invite.accepted) return false;
    invite.accepted = true;
    return true;
  }

  async acceptInvitation(userId: string, email: string, _fullName: string | null, emailVerified: boolean, tokenHash: string): Promise<boolean> {
    void userId;
    const invite = this.pendingInvitation;
    if (!invite || invite.accepted || invite.expiresAt <= new Date() || !emailVerified || invite.email !== email || invite.tokenHash !== tokenHash) return false;
    invite.accepted = true;
    return true;
  }

  async listDrafts(userId: string, requestedOrganization: string, _limit: number, _cursor: DraftCursor | null): Promise<{ items: DraftListItem[]; nextCursor: DraftCursor | null } | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    const note = this.note();
    return { items: [{ id: note.id, organizationId, title: note.title, currentVersion: note.currentVersion, createdAt: note.createdAt, updatedAt: note.updatedAt }], nextCursor: null };
  }

  async getDraft(userId: string, requestedOrganization: string, requestedDraft: string): Promise<PrivateDraft | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId || requestedDraft !== draftId) return null;
    return this.note();
  }

  async canCreateDraft(userId: string, requestedOrganization: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }

  async createDraft(_userId: string, requestedOrganization: string, write: DraftWrite, content: StoredContentFields): Promise<PrivateDraft | null> {
    if (requestedOrganization !== organizationId) return null;
    this.currentBody = write.body;
    this.currentVersion = 1;
    this.currentSource = content;
    return { ...this.note(), title: write.title };
  }

  async canUpdateDraft(userId: string, requestedOrganization: string, requestedDraft: string): Promise<boolean> {
    return userId === ownerId && requestedOrganization === organizationId && requestedDraft === draftId;
  }

  async updateDraft(_userId: string, _organization: string, _draft: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null): Promise<{ kind: "not-found" } | { kind: "conflict"; currentVersion: number } | { kind: "updated"; draft: PrivateDraft }> {
    if (expectedVersion !== this.currentVersion) return { kind: "conflict", currentVersion: this.currentVersion };
    this.currentVersion += 1;
    if (patch.body !== undefined) {
      this.currentBody = patch.body;
      if (content) this.currentSource = content;
    }
    const draft = { ...this.note(), title: patch.title ?? this.note().title };
    return { kind: "updated", draft };
  }

  private note(): PrivateDraft {
    return {
      id: draftId, organizationId, title: "Review notes", versionId,
      sourceUri: this.currentSource.sourceUri, mimeType: this.currentSource.mimeType,
      contentHash: this.currentSource.contentHash, currentVersion: this.currentVersion,
      createdAt: new Date("2026-10-05T09:00:00.000Z"), updatedAt: new Date("2026-10-05T09:00:00.000Z"),
    };
  }
}

class FakeInvitationMailer implements InvitationMailer {
  readonly sent: InvitationEmail[] = [];
  failDelivery = false;
  async sendInvitation(message: InvitationEmail) { if (this.failDelivery) throw new Error("SMTP failure"); this.sent.push(message); }
  close() { /* No external resource in request tests. */ }
}
