import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { AuthProvider } from "./auth/provider.js";
import type { ActiveMembership, ArdenDataRepository, AuthorizedAiSource, CreateSharedDraftResult, DecideReviewResult, DraftCursor, DraftListItem, DraftPatch, DraftWrite, KnowledgeOptions, MembershipSummary, OrganizationAdminData, PrivateContributionSource, PrivateDraft, PublishedKnowledge, ReviewerGrantInput, ReviewerGrantRecord, ReviewDetail, SharedDraftPatch, SharedKnowledgeDraft, SharedKnowledgeSubmission, StoredContentFields, SubmitKnowledgeDraftResult, UpdateSharedDraftResult } from "./db/repository.js";
import type { AssignedReview } from "./knowledge/review-queue.js";
import type { ReviewAction } from "./knowledge/review-decision.js";
import { LocalPrivateContentStorage } from "./private-notes/content-storage.js";
import type { InvitationEmail, InvitationMailer } from "./email/smtp-mailer.js";
import { LocalFlow1TestInvitationMailer } from "./email/local-flow1-test-mailer.js";
import { AudienceGroupError, type AudienceGroup, type AudienceGroupStore } from "./audiences/store.js";
import { SystemAdministrationError, type SystemAdministrator, type SystemAdministrationStore } from "./system-administration/store.js";
import { parseSemanticDocument } from "@arden/domain";
import type { AskArdenClient } from "./answers/ai-client.js";
import type { AiAnswerRequest, AiAnswerResponse } from "./answers/contracts.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const draftId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const versionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const sharedDraftId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const sharedVersionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const createKey = "99999999-9999-4999-8999-999999999999";
const systemAdminCandidateId = "33333333-3333-4333-8333-333333333333";
const generationId = "44444444-4444-4444-8444-444444444444";

function semanticDocumentText(body: string): string {
  const parsed = parseSemanticDocument(body);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return "";
  return parsed.document.blocks.flatMap((block) => {
    if (block.type === "asset" || block.type === "table") return [];
    return block.content.flatMap((inline) => inline.type === "link"
      ? inline.content.map((text) => text.text) : [inline.text]).join("");
  }).join("\n");
}

describe("API auth and private draft routes", () => {
  let root: string;
  let storage: LocalPrivateContentStorage;
  let repository: MemoryRepository;
  let authProvider: FakeAuthProvider;
  let invitationMailer: FakeInvitationMailer;
  let askArden: FakeAskArdenClient;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "arden-api-test-"));
    storage = new LocalPrivateContentStorage(root);
    repository = new MemoryRepository();
    authProvider = new FakeAuthProvider();
    invitationMailer = new FakeInvitationMailer();
    askArden = new FakeAskArdenClient();
    app = buildApp({
      checkDatabase: async () => undefined,
      auth: authProvider,
      authTrustedOrigins: ["http://localhost:5180"],
      secureCookies: false,
      repository,
      storage,
      invitationMailer,
      askArden,
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

  it("answers only from the caller's authorized generation and maps a live citation", async () => {
    repository.authorizedAiSources = [{
      generationId, snapshotVersionId: sharedVersionId, snapshotContentHash: "a".repeat(64),
      publishedVersionId: versionId, draftId: sharedDraftId, title: "Security policy", versionNo: 3,
      classification: "INTERNAL", targetScopeType: "ORGANIZATION",
      chunks: [{ chunkId: "b".repeat(64), sourceBlockIds: ["mfa", "pdf-page-2", "pdf-page-2-heading"], parentSectionBlockId: null }],
    }];
    askArden.sourceBlockIds = ["pdf-page-2", "pdf-page-2-heading"];
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/ai/answers`,
      headers: { cookie: session, origin: "http://localhost:5180" }, payload: { query: "How is MFA used?" },
    });
    expect(response.statusCode).toBe(200);
    expect(askArden.lastRequest?.allowedGenerationIds).toEqual([generationId]);
    expect(response.json()).toMatchObject({ status: "ANSWERED", citations: [{
      documentId: sharedDraftId, versionId, blockId: "pdf-page-2", page: 2, title: "Security policy",
      version: "v3", scope: "Company-wide", classification: "INTERNAL",
    }] });
  });

  it("drops the answer when publication access changes before citations are returned", async () => {
    repository.authorizedAiSources = [{
      generationId, snapshotVersionId: sharedVersionId, snapshotContentHash: "a".repeat(64),
      publishedVersionId: versionId, draftId: sharedDraftId, title: "Security policy", versionNo: 3,
      classification: "INTERNAL", targetScopeType: "ORGANIZATION",
      chunks: [{ chunkId: "b".repeat(64), sourceBlockIds: ["mfa", "pdf-page-2", "pdf-page-2-heading"], parentSectionBlockId: null }],
    }];
    askArden.onAnswer = () => { repository.authorizedAiSources = []; };
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/ai/answers`,
      headers: { cookie: session, origin: "http://localhost:5180" }, payload: { query: "How is MFA used?" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("KNOWLEDGE_ACCESS_CHANGED");
  });

  it.each([
    { name: "unlisted chunk", patch: { chunkId: "c".repeat(64) } },
    { name: "invented block", patch: { sourceBlockIds: ["other-block"] } },
    { name: "wrong parent section", patch: { parentSectionBlockId: "actual-heading" } },
  ])("rejects an AI citation with $name even when snapshot permission is valid", async ({ patch }) => {
    repository.authorizedAiSources = [{
      generationId, snapshotVersionId: sharedVersionId, snapshotContentHash: "a".repeat(64),
      publishedVersionId: versionId, draftId: sharedDraftId, title: "Security policy", versionNo: 3,
      classification: "INTERNAL", targetScopeType: "ORGANIZATION",
      chunks: [{ chunkId: "b".repeat(64), sourceBlockIds: ["mfa"], parentSectionBlockId: null, ...patch }],
    }];
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({ method: "POST",
      url: `/api/v1/organizations/${organizationId}/ai/answers`,
      headers: { cookie: session, origin: "http://localhost:5180" }, payload: { query: "MFA policy?" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().answer).toBeUndefined();
  });

  it.each(["x\n".repeat(2001), "x\n".repeat(1500)])("rejects text exceeding semantic block or serialized-envelope limits", async (body) => {
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({ method: "POST",
      url: `/api/v1/organizations/${organizationId}/knowledge/drafts/new`,
      headers: { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey },
      payload: { title: "Too many paragraphs", classification: "INTERNAL", body },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_DOCUMENT");
    expect(repository.sharedCreates).toBe(0);
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
      account: { passwordSetupRequired: false },
      memberships: [{
        organization: { id: organizationId, name: "Arden Test Org" },
        status: "active", roleCodes: ["MEMBER"], canUsePrivateWorkspace: true,
      }],
    });
  });

  it("completes Google PKCE sign-in and requires a one-time Arden password", async () => {
    const started = await app.inject({ method: "GET", url: "/api/v1/auth/google/start?client=web" });
    expect(started.statusCode).toBe(302);
    expect(started.headers.location).toBe("https://accounts.google.test/oauth");
    const oauthCookie = cookieHeader(started.headers["set-cookie"]);
    expect(oauthCookie).toContain("arden_oauth=");

    const callback = await app.inject({
      method: "GET",
      url: "/api/v1/auth/google/callback?code=synthetic-code&sb_flow_id=0123456789abcdef0123456789abcdef",
      headers: { cookie: oauthCookie },
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("https://arden.example.test/?auth=google&status=success&setup=password");
    const sessionCookie = cookieHeader(callback.headers["set-cookie"]);
    expect(sessionCookie).toContain("arden_access=access-google");

    const before = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: sessionCookie } });
    expect(before.json().account).toEqual({ passwordSetupRequired: true });
    const updated = await app.inject({
      method: "POST", url: "/api/v1/auth/password",
      headers: { cookie: sessionCookie, origin: "http://localhost:5180" },
      payload: { password: "new-password" },
    });
    expect(updated.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: sessionCookie } });
    expect(after.json().account).toEqual({ passwordSetupRequired: false });
  });

  it("handles sign-up validation and duplicate account rejection", async () => {
    authProvider.signUpBehavior = "already_exists";
    const conflict = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "existing@example.test", password: "secure-password", fullName: "Existing User" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatchObject({
      code: "ACCOUNT_ALREADY_EXISTS",
      message: "An account with this email address already exists. Please sign in instead.",
    });

    authProvider.signUpBehavior = "rejected";
    const rejected = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "weak@example.test", password: "123", fullName: "Weak User" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toMatchObject({
      code: "ACCOUNT_SETUP_UNAVAILABLE",
    });
    authProvider.signUpBehavior = "success";
  });

  it("handles forgot password requests, verification proxy, and password reset", async () => {
    const forgot = await app.inject({
      method: "POST", url: "/api/v1/auth/forgot-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test" },
    });
    expect(forgot.statusCode).toBe(202);
    expect(forgot.json().status).toBe("recovery_sent");
    expect(authProvider.lastResetEmail).toBe("owner@example.test");

    const verify = await app.inject({
      method: "GET", url: "/auth/v1/verify?token=valid-link&type=recovery",
    });
    expect(verify.statusCode).toBe(303);
    expect(verify.headers.location).toContain("reset-password");

    const rootVerify = await app.inject({
      method: "GET", url: "/verify?token=valid-link&type=recovery",
    });
    expect(rootVerify.statusCode).toBe(303);
    expect(rootVerify.headers.location).toContain("reset-password");

    const resetWithOtp = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", token: "valid-token", newPassword: "new-secure-password" },
    });
    expect(resetWithOtp.statusCode).toBe(200);
    expect(resetWithOtp.json()).toEqual({ status: "password_updated" });
    expect(authProvider.lastUpdatedPassword?.password).toBe("new-secure-password");
    expect(cookieHeader(resetWithOtp.headers["set-cookie"])).toContain("arden_access=access-recovery");

    const invalidOtp = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", token: "wrong-token", newPassword: "new-secure-password" },
    });
    expect(invalidOtp.statusCode).toBe(401);
    expect(invalidOtp.json().error.code).toBe("INVALID_TOKEN");
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

  it("exposes organization administration and audience/department mutations only to the Org Admin", async () => {
    const adminSession = await desktopSession(app, "owner@example.test");
    const adminData = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/administration`, headers: { cookie: adminSession } });
    expect(adminData.statusCode).toBe(200);
    expect(adminData.json().departments[0].name).toBe("Product");

    const createdAudience = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/audience-groups`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { name: "Operations readers", description: "Operations knowledge audience" } });
    expect(createdAudience.statusCode).toBe(201);
    expect(createdAudience.json()).toMatchObject({ name: "Operations readers", members: [] });
    expect(createdAudience.headers.etag).toBe('"audience-group-1"');
    const createdDepartment = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/departments`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { name: "Operations" } });
    expect(createdDepartment.statusCode).toBe(201);
    const assigned = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/audience-groups/${createdAudience.json().id}/members`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { membershipId: "77777777-7777-4777-8777-777777777777" } });
    expect(assigned.statusCode).toBe(201);

    const memberSession = await desktopSession(app, "member@example.test");
    const denied = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/administration`, headers: { cookie: memberSession } });
    expect(denied.statusCode).toBe(404);
    const deniedAudienceWrite = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/audience-groups`, headers: { cookie: memberSession, origin: "http://localhost:5180" }, payload: { name: "Forged audience", description: "" } });
    expect(deniedAudienceWrite.statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/roles`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { name: "Legacy role" } })).statusCode).toBe(404);
  });

  it("requires a signed-in verified email and validates organization setup input", async () => {
    const noSession = await app.inject({ method: "POST", url: "/api/v1/organizations", headers: { origin: "http://localhost:5180" }, payload: { name: "Org", departmentName: "Team" } });
    expect(noSession.statusCode).toBe(401);
    const session = await desktopSession(app, "owner@example.test");
    const invalid = await app.inject({ method: "POST", url: "/api/v1/organizations", headers: { cookie: session, origin: "http://localhost:5180" }, payload: { name: "  ", departmentName: "Team" } });
    expect(invalid.statusCode).toBe(400);
    expect(repository.createdOrganization).toBeNull();
  });

  it("keeps instance administration separate from organization administration", async () => {
    const administrator = await desktopSession(app, "owner@example.test");
    const overview = await app.inject({ method: "GET", url: "/api/v1/system/administrators",
      headers: { cookie: administrator } });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().administrators).toMatchObject([{ userId: ownerId, status: "ACTIVE" }]);
    const granted = await app.inject({ method: "POST", url: "/api/v1/system/administrators",
      headers: { cookie: administrator, origin: "http://localhost:5180" }, payload: { userId: systemAdminCandidateId } });
    expect(granted.statusCode).toBe(201);
    expect(granted.json()).toMatchObject({ userId: systemAdminCandidateId, status: "ACTIVE" });

    const candidate = await desktopSession(app, "system-admin@example.test");
    expect((await app.inject({ method: "GET", url: "/api/v1/system/administrators",
      headers: { cookie: candidate } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET",
      url: `/api/v1/organizations/${organizationId}/administration`,
      headers: { cookie: candidate } })).statusCode).toBe(404);

    const ordinaryMember = await desktopSession(app, "member@example.test");
    const denied = await app.inject({ method: "GET", url: "/api/v1/system/administrators",
      headers: { cookie: ordinaryMember } });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().error.code).toBe("SYSTEM_ADMINISTRATION_UNAVAILABLE");
  });

  it("does not allow revoking the last active Arden System Admin", async () => {
    const administrator = await desktopSession(app, "owner@example.test");
    const revoked = await app.inject({ method: "POST",
      url: `/api/v1/system/administrators/${ownerId}/revoke`,
      headers: { cookie: administrator, origin: "http://localhost:5180" }, payload: {} });
    expect(revoked.statusCode).toBe(409);
    expect(revoked.json().error.code).toBe("SYSTEM_ADMINISTRATOR_LAST_ACTIVE");
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

  it("creates an independent shared copy of the author's private version and replays the same request", async () => {
    repository.currentSource = await storage.write(repository.currentBody);
    const originalUri = repository.currentSource.sourceUri;
    const session = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/knowledge/drafts`;
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    const payload = { sourcePrivateVersionId: versionId, classification: "INTERNAL" };

    const created = await app.inject({ method: "POST", url, headers, payload });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.headers.etag).toBe('"1"');
    expect(created.json()).toMatchObject({
      id: sharedDraftId, title: "Review notes", classification: "INTERNAL", status: "ACTIVE",
      currentVersion: { version: 1 },
    });
    expect(semanticDocumentText(created.json().body)).toBe("Private body");
    expect(repository.currentSource.sourceUri).toBe(originalUri);
    expect(repository.sharedDraft?.sourceUri).not.toBe(originalUri);
    expect(await storage.read(originalUri, repository.currentSource.contentHash)).toBe("Private body");
    expect(semanticDocumentText(await storage.read(repository.sharedDraft!.sourceUri, repository.sharedDraft!.contentHash))).toBe("Private body");

    const replay = await app.inject({ method: "POST", url, headers, payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(sharedDraftId);
    expect(repository.sharedCreates).toBe(1);
    const conflict = await app.inject({ method: "POST", url, headers, payload: { ...payload, classification: "CONFIDENTIAL" } });
    expect(conflict.statusCode).toBe(409);
  });

  it("denies missing sessions, foreign organizations or versions, and malformed create requests", async () => {
    repository.currentSource = await storage.write(repository.currentBody);
    const url = `/api/v1/organizations/${organizationId}/knowledge/drafts`;
    const payload = { sourcePrivateVersionId: versionId, classification: "INTERNAL" };
    const session = await desktopSession(app, "owner@example.test");
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    expect((await app.inject({ method: "POST", url, headers: { origin: "http://localhost:5180", "idempotency-key": createKey }, payload })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/api/v1/organizations/${otherOrganizationId}/knowledge/drafts`, headers, payload })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, sourcePrivateVersionId: otherId } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, classification: "PUBLIC" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers: { cookie: session, origin: "http://localhost:5180" }, payload })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, actorId: ownerId } })).statusCode).toBe(400);
    expect(repository.sharedDraft).toBeNull();
  });

  it("keeps a content copy when database commit outcome is unknown", async () => {
    repository.currentSource = await storage.write(repository.currentBody);
    repository.failSharedCreate = true;
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({
      method: "POST", url: `/api/v1/organizations/${organizationId}/knowledge/drafts`,
      headers: { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey },
      payload: { sourcePrivateVersionId: versionId, classification: "INTERNAL" },
    });
    expect(response.statusCode).toBe(500);
    expect(repository.attemptedSharedCopyUri).not.toBeNull();
    expect(repository.attemptedSharedCopyHash).not.toBeNull();
    const copied = await storage.read(repository.attemptedSharedCopyUri!, repository.attemptedSharedCopyHash!);
    expect(semanticDocumentText(copied)).toBe(repository.currentBody);
  });

  it("creates a server-backed new shared draft, then lists and reopens only that actor's draft", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/knowledge/drafts/new`;
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    const payload = { title: "Runbook", body: "Recovery steps", classification: "INTERNAL" };
    const created = await app.inject({ method: "POST", url, headers, payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ title: "Runbook", status: "ACTIVE" });
    expect(semanticDocumentText(created.json().body)).toBe("Recovery steps");
    expect(JSON.stringify(created.json())).not.toContain("arden-private-object");
    const listed = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/knowledge/drafts`, headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(1);
    expect(JSON.stringify(listed.json())).not.toContain("arden-private-object");
    const reopened = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/knowledge/drafts/${sharedDraftId}`, headers });
    expect(reopened.statusCode).toBe(200);
    expect(semanticDocumentText(reopened.json().body)).toBe("Recovery steps");
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(200);
    expect(repository.sharedCreates).toBe(1);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, title: "Other" } })).statusCode).toBe(409);
  });

  it("preserves an uploaded PDF through metadata, submission, review and preparation", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const reviewer = await desktopSession(app, "manager@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const pdfBase64 = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n").toString("base64");
    const headers = { cookie: owner, origin: "http://localhost:5180", "idempotency-key": createKey };
    const created = await app.inject({ method: "POST", url: `${root}/drafts/pdf`, headers,
      payload: { title: "Original PDF", pdfBase64, classification: "INTERNAL" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ body: "", pdfBase64, currentVersion: { mimeType: "application/pdf" } });
    const reopened = await app.inject({ method: "GET", url: `${root}/drafts/${sharedDraftId}`, headers: { cookie: owner } });
    expect(reopened.json().pdfBase64).toBe(pdfBase64);
    expect((await app.inject({ method: "GET", url: `${root}/drafts/${sharedDraftId}`, headers: { cookie: reviewer } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { body: "Do not overwrite PDF" } })).statusCode).toBe(400);
    const invalidTag = await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { teamTag: "   ", projectTag: null } });
    expect(invalidTag.statusCode).toBe(400);
    const updated = await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { title: "Original PDF", classification: "INTERNAL",
        responsibleDepartmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        targetScopeType: "DEPARTMENT", teamTag: null, projectTag: null,
        audienceIds: ["11111111-aaaa-4aaa-8aaa-111111111111"] } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ pdfBase64, teamTag: null, projectTag: null,
      currentVersion: { mimeType: "application/pdf", version: 2 } });
    const submitted = await app.inject({ method: "POST", url: `${root}/drafts/${sharedDraftId}/submit`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"2"',
        "idempotency-key": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } });
    expect(submitted.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: `${root}/reviewer-grants`,
      headers: { cookie: owner, origin: "http://localhost:5180" },
      payload: { reviewerMembershipId: otherId, departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        classifications: ["INTERNAL"], level: "STANDARD" } })).statusCode).toBe(201);
    const detail = await app.inject({ method: "GET", url: `${root}/reviews/${submitted.json().id}`,
      headers: { cookie: reviewer } });
    expect(detail.json()).toMatchObject({ body: "", pdfBase64, mimeType: "application/pdf" });
    const approved = await app.inject({ method: "POST", url: `${root}/reviews/${submitted.json().id}/decisions`,
      headers: { cookie: reviewer, origin: "http://localhost:5180",
        "idempotency-key": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" },
      payload: { action: "APPROVE", expectedSnapshotVersionId: updated.json().currentVersion.id,
        expectedContentHash: updated.json().currentVersion.contentHash } });
    expect(approved.statusCode).toBe(201);
    expect(approved.json()).toMatchObject({ status: "APPROVED", publicationState: "PREPARING", publishedVersionId: null });
    expect((await app.inject({ method: "GET", url: `${root}/published`, headers: { cookie: owner } })).json().items).toEqual([]);
  });

  it("rejects malformed, oversized and cross-organization PDF uploads", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    const url = `/api/v1/organizations/${organizationId}/knowledge/drafts/pdf`;
    const payload = { title: "PDF", classification: "INTERNAL", pdfBase64: Buffer.from("not a PDF %%EOF").toString("base64") };
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/v1/organizations/${otherOrganizationId}/knowledge/drafts/pdf`,
      headers, payload: { ...payload, pdfBase64: Buffer.from("%PDF-1.4\n%%EOF").toString("base64") } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url, headers,
      payload: { ...payload, pdfBase64: "A".repeat(7_100_000) } })).statusCode).toBe(413);
  });

  it("exposes active knowledge metadata options only within the actor's organization", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const options = await app.inject({ method: "GET",
      url: `/api/v1/organizations/${organizationId}/knowledge/options`, headers: { cookie: session } });
    expect(options.statusCode).toBe(200);
    expect(options.json()).toMatchObject({ departments: [{ name: "Product" }],
      audiences: [{ name: "Product members" }] });
    expect(options.headers["cache-control"]).toBe("no-store");
    const otherOrganization = await app.inject({ method: "GET",
      url: `/api/v1/organizations/${otherOrganizationId}/knowledge/options`, headers: { cookie: session } });
    expect(otherOrganization.statusCode).toBe(404);
  });

  it("rejects invalid new shared drafts and does not reveal another organization", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    const payload = { title: "Runbook", body: "Body", classification: "INTERNAL" };
    const url = `/api/v1/organizations/${organizationId}/knowledge/drafts/new`;
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, title: "   " } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, body: "bad\u0000text" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `/api/v1/organizations/${otherOrganizationId}/knowledge/drafts/new`, headers, payload })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/organizations/${otherOrganizationId}/knowledge/drafts`, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/v1/organizations/${otherOrganizationId}/knowledge/drafts/${sharedDraftId}`, headers })).statusCode).toBe(404);
  });

  it("updates a shared draft as a new version only when If-Match is current", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    const created = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/knowledge/drafts/new`,
      headers, payload: { title: "Runbook", body: "v1", classification: "INTERNAL" } });
    expect(created.statusCode).toBe(201);
    const url = `/api/v1/organizations/${organizationId}/knowledge/drafts/${sharedDraftId}`;
    expect((await app.inject({ method: "PATCH", url, headers, payload: { title: "Updated" } })).statusCode).toBe(428);
    const updated = await app.inject({ method: "PATCH", url, headers: { ...headers, "if-match": '"1"' },
      payload: { title: "Updated", body: "v2", teamTag: "API", projectTag: "Arden" } });
    expect(updated.statusCode).toBe(200);
    expect(updated.headers.etag).toBe('"2"');
    expect(updated.json()).toMatchObject({ title: "Updated", teamTag: "API", projectTag: "Arden",
      currentVersion: { version: 2 } });
    expect(semanticDocumentText(updated.json().body)).toBe("v2");
    expect((await app.inject({ method: "PATCH", url, headers: { ...headers, "if-match": '"1"' },
      payload: { title: "Stale" } })).statusCode).toBe(412);
    expect(semanticDocumentText((await app.inject({ method: "GET", url, headers })).json().body)).toBe("v2");
  });

  it("routes submit, scoped review and preparation without exposing the private source", async () => {
    const ownerSession = await desktopSession(app, "owner@example.test");
    const reviewerSession = await desktopSession(app, "manager@example.test");
    const ownerHeaders = { cookie: ownerSession, origin: "http://localhost:5180" };
    const reviewerHeaders = { cookie: reviewerSession, origin: "http://localhost:5180" };
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const created = await app.inject({ method: "POST", url: `${root}/drafts/new`,
      headers: { ...ownerHeaders, "idempotency-key": createKey },
      payload: { title: "Recovery runbook", body: "Check upstream first", classification: "INTERNAL" } });
    expect(created.statusCode).toBe(201);
    const updated = await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { ...ownerHeaders, "if-match": '"1"' },
      payload: { responsibleDepartmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        targetScopeType: "DEPARTMENT", audienceIds: ["11111111-aaaa-4aaa-8aaa-111111111111"] } });
    expect(updated.statusCode).toBe(200);
    const submit = await app.inject({ method: "POST", url: `${root}/drafts/${sharedDraftId}/submit`,
      headers: { ...ownerHeaders, "idempotency-key": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "if-match": '"2"' } });
    expect(submit.statusCode).toBe(201);
    expect(submit.json().status).toBe("PENDING_REVIEW");
    expect((await app.inject({ method: "GET", url: `${root}/reviews`, headers: reviewerHeaders })).json().items).toEqual([]);
    const grant = await app.inject({ method: "POST", url: `${root}/reviewer-grants`, headers: ownerHeaders,
      payload: { reviewerMembershipId: otherId, departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        classifications: ["INTERNAL"], level: "STANDARD" } });
    expect(grant.statusCode).toBe(201);
    const queue = await app.inject({ method: "GET", url: `${root}/reviews`, headers: reviewerHeaders });
    expect(queue.json().items).toHaveLength(1);
    expect(JSON.stringify(queue.json())).not.toContain("Check upstream first");
    const submissionId = submit.json().id as string;
    const detail = await app.inject({ method: "GET", url: `${root}/reviews/${submissionId}`, headers: reviewerHeaders });
    expect(detail.statusCode).toBe(200);
    expect(semanticDocumentText(detail.json().body)).toBe("Check upstream first");
    expect((await app.inject({ method: "GET", url: `${root}/reviews/${submissionId}`, headers: ownerHeaders })).statusCode).toBe(404);
    const decisionUrl = `${root}/reviews/${submissionId}/decisions`;
    const decisionPayload = { action: "APPROVE", expectedSnapshotVersionId: updated.json().currentVersion.id,
      expectedContentHash: updated.json().currentVersion.contentHash };
    expect((await app.inject({ method: "POST", url: decisionUrl,
      headers: { ...ownerHeaders, "idempotency-key": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" },
      payload: decisionPayload })).statusCode).toBe(404);
    const decided = await app.inject({ method: "POST", url: decisionUrl,
      headers: { ...reviewerHeaders, "idempotency-key": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" },
      payload: decisionPayload });
    expect(decided.statusCode).toBe(201);
    expect(decided.json()).toMatchObject({ status: "APPROVED", publicationState: "PREPARING", publishedVersionId: null });
    expect((await app.inject({ method: "GET", url: `${root}/published`, headers: ownerHeaders })).json().items).toEqual([]);
  });

  it("keeps the working draft mutable while the submitted snapshot remains pending", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const reviewer = await desktopSession(app, "manager@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const created = await app.inject({ method: "POST", url: `${root}/drafts/new`,
      headers: { cookie: owner, origin: "http://localhost:5180", "idempotency-key": createKey },
      payload: { title: "Runbook", body: "First version", classification: "INTERNAL" } });
    expect(created.statusCode).toBe(201);
    const metadata = await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { responsibleDepartmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        targetScopeType: "DEPARTMENT", audienceIds: ["11111111-aaaa-4aaa-8aaa-111111111111"] } });
    expect(metadata.statusCode).toBe(200);
    const first = await app.inject({ method: "POST", url: `${root}/drafts/${sharedDraftId}/submit`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"2"',
        "idempotency-key": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } });
    expect(first.statusCode).toBe(201);
    const edited = await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"2"' },
      payload: { body: "Premature edit" } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().currentVersion.version).toBe(3);
    expect((await app.inject({ method: "GET", url: `${root}/drafts/${sharedDraftId}`, headers: { cookie: owner } })).json().hasPendingSubmission).toBe(true);
    expect((await app.inject({ method: "POST", url: `${root}/reviewer-grants`,
      headers: { cookie: owner, origin: "http://localhost:5180" },
      payload: { reviewerMembershipId: otherId, departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        classifications: ["INTERNAL"], level: "STANDARD" } })).statusCode).toBe(201);
    const rejection = await app.inject({ method: "POST", url: `${root}/reviews/${first.json().id}/decisions`,
      headers: { cookie: reviewer, origin: "http://localhost:5180", "idempotency-key": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" },
      payload: { action: "REJECT", comment: "Clarify the rollback step.",
        expectedSnapshotVersionId: metadata.json().currentVersion.id,
        expectedContentHash: metadata.json().currentVersion.contentHash } });
    expect(rejection.statusCode).toBe(201);
    expect(rejection.json()).toMatchObject({ status: "REJECTED", publicationState: "NONE", publishedVersionId: null,
      decisionComment: "Clarify the rollback step." });
    const authorSubmissions = await app.inject({ method: "GET", url: `${root}/submissions`, headers: { cookie: owner } });
    expect(authorSubmissions.statusCode).toBe(200);
    expect(authorSubmissions.json().items[0].decisionComment).toBe("Clarify the rollback step.");
    expect((await app.inject({ method: "GET", url: `${root}/published`, headers: { cookie: owner } })).json().items).toEqual([]);
    expect((await app.inject({ method: "POST", url: `${root}/drafts/${sharedDraftId}/submit`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"3"',
        "idempotency-key": "cccccccc-dddd-4eee-8fff-111111111111" } })).statusCode).toBe(201);
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
  signUpBehavior: "success" | "already_exists" | "rejected" = "success";
  lastResetEmail: string | null = null;
  lastUpdatedPassword: { token: string; password: string } | null = null;
  private readonly usersByAccessToken = new Map<string, { userId: string; email: string; passwordSetupRequired: boolean }>();

  async signIn(credentials: { email: string; password: string }) {
    if (credentials.password !== "synthetic-password" || !credentials.email.endsWith("@example.test")) throw new Error("INVALID_CREDENTIALS");
    const suffix = credentials.email.startsWith("owner") ? "owner"
      : credentials.email.startsWith("manager") ? "manager"
        : credentials.email.startsWith("system-admin") ? "system-admin" : "other";
    const userId = suffix === "owner" ? ownerId : suffix === "system-admin" ? systemAdminCandidateId : otherId;
    const tokens = { accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}`, expiresIn: 3600 };
    const email = credentials.email.trim().toLowerCase();
    this.usersByAccessToken.set(tokens.accessToken, { userId, email, passwordSetupRequired: false });
    return { userId, email, fullName: null, tokens };
  }

  async signUp() {
    if (this.signUpBehavior === "already_exists") throw new Error("USER_ALREADY_EXISTS");
    if (this.signUpBehavior === "rejected") throw new Error("SIGNUP_REJECTED");
    return { tokens: null, emailVerified: false };
  }

  async resolveSession(tokens: { accessToken: string }) {
    const user = this.usersByAccessToken.get(tokens.accessToken);
    return user ? { kind: "authenticated" as const, ...user, fullName: null, emailVerified: true } : { kind: "unauthenticated" as const };
  }

  async signOut(tokens: { accessToken: string }) {
    this.usersByAccessToken.delete(tokens.accessToken);
    this.revokedSessions.push(tokens.accessToken);
  }

  async startGoogleSignIn() {
    return { url: "https://accounts.google.test/oauth", flowId: "0123456789abcdef0123456789abcdef", verifier: "v".repeat(64) };
  }

  async completeGoogleSignIn() {
    const tokens = { accessToken: "access-google", refreshToken: "refresh-google", expiresIn: 3600 };
    this.usersByAccessToken.set(tokens.accessToken, { userId: ownerId, email: "owner@example.test", passwordSetupRequired: true });
    return { userId: ownerId, email: "owner@example.test", fullName: "Owner", tokens, passwordSetupRequired: true };
  }

  async setInitialPassword(tokens: { accessToken: string }) {
    const user = this.usersByAccessToken.get(tokens.accessToken);
    if (!user) throw new Error("UNAUTHENTICATED");
    user.passwordSetupRequired = false;
  }

  async resetPasswordForEmail(email: string) {
    this.lastResetEmail = email;
  }

  async verifyOtp(params: { email: string; token: string }) {
    if (params.token !== "valid-token") throw new Error("INVALID_OTP");
    const tokens = { accessToken: "access-recovery", refreshToken: "refresh-recovery", expiresIn: 3600 };
    this.usersByAccessToken.set(tokens.accessToken, { userId: ownerId, email: params.email, passwordSetupRequired: false });
    return { tokens };
  }

  async updateUserPassword(tokens: { accessToken: string }, newPassword: string) {
    if (newPassword.length < 6) throw new Error("PASSWORD_UPDATE_REJECTED");
    this.lastUpdatedPassword = { token: tokens.accessToken, password: newPassword };
  }

  async verifyLink(searchParams: string) {
    if (searchParams.includes("token=valid-link")) {
      return "http://localhost:5180/reset-password#access_token=access-recovery&refresh_token=refresh-recovery&type=recovery";
    }
    return null;
  }
}

class MemoryAudienceGroupStore implements AudienceGroupStore {
  private groups: AudienceGroup[] = [];

  private authorize(userId: string, requestedOrganization: string) {
    if (userId !== ownerId || requestedOrganization !== organizationId) {
      throw new AudienceGroupError("AUDIENCE_GROUP_UNAVAILABLE");
    }
  }

  async list(userId: string, requestedOrganization: string) {
    this.authorize(userId, requestedOrganization);
    return this.groups;
  }

  async get(userId: string, requestedOrganization: string, audienceGroupId: string) {
    this.authorize(userId, requestedOrganization);
    const group = this.groups.find(item => item.id === audienceGroupId);
    if (!group) throw new AudienceGroupError("AUDIENCE_GROUP_UNAVAILABLE");
    return group;
  }

  async create(userId: string, requestedOrganization: string,
    input: { name: string; description: string }) {
    this.authorize(userId, requestedOrganization);
    const group: AudienceGroup = {
      id: "88888888-8888-4888-8888-888888888888", name: input.name.trim(),
      description: input.description, status: "ACTIVE", version: 1, members: [],
    };
    this.groups = [group];
    return group;
  }

  async update(userId: string, requestedOrganization: string, audienceGroupId: string,
    version: number, input: { name: string; description: string }) {
    const group = await this.get(userId, requestedOrganization, audienceGroupId);
    if (group.version !== version) throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
    Object.assign(group, input, { version: version + 1 });
    return group;
  }

  async addMember(userId: string, requestedOrganization: string, audienceGroupId: string,
    membershipId: string) {
    const group = await this.get(userId, requestedOrganization, audienceGroupId);
    group.members.push({ id: createKey, membershipId, status: "ACTIVE",
      validFrom: "2026-10-20T00:00:00.000Z", validUntil: null });
    group.version += 1;
    return group;
  }

  async removeMember(userId: string, requestedOrganization: string, audienceGroupId: string,
    groupMembershipId: string) {
    const group = await this.get(userId, requestedOrganization, audienceGroupId);
    const member = group.members.find(item => item.id === groupMembershipId);
    if (!member) throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
    member.status = "REVOKED";
    group.version += 1;
    return group;
  }

  async deactivate(userId: string, requestedOrganization: string, audienceGroupId: string,
    version: number) {
    const group = await this.get(userId, requestedOrganization, audienceGroupId);
    if (group.version !== version) throw new AudienceGroupError("AUDIENCE_GROUP_CONFLICT");
    group.status = "INACTIVE";
    group.version += 1;
    return group;
  }
}

class MemorySystemAdministrationStore implements SystemAdministrationStore {
  private administrators: SystemAdministrator[] = [{ userId: ownerId, status: "ACTIVE", grantedByUserId: null,
    grantedAt: new Date("2026-10-20T00:00:00.000Z"), revokedByUserId: null, revokedAt: null }];

  private authorize(actorUserId: string) {
    if (!this.administrators.some(item => item.userId === actorUserId && item.status === "ACTIVE")) {
      throw new SystemAdministrationError("SYSTEM_ADMINISTRATION_UNAVAILABLE");
    }
  }

  async overview(actorUserId: string) {
    this.authorize(actorUserId);
    return { administrators: this.administrators, recentEvents: [] };
  }

  async grant(actorUserId: string, targetUserId: string) {
    this.authorize(actorUserId);
    const administrator = { userId: targetUserId, status: "ACTIVE" as const,
      grantedByUserId: actorUserId, grantedAt: new Date("2026-10-20T00:00:00.000Z"),
      revokedByUserId: null, revokedAt: null };
    this.administrators.push(administrator);
    return administrator;
  }

  async revoke(actorUserId: string, targetUserId: string) {
    this.authorize(actorUserId);
    const administrator = this.administrators.find(item => item.userId === targetUserId);
    if (!administrator) throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_CONFLICT");
    if (this.administrators.filter(item => item.status === "ACTIVE").length === 1) {
      throw new SystemAdministrationError("SYSTEM_ADMINISTRATOR_LAST_ACTIVE");
    }
    const revoked = { ...administrator, status: "REVOKED" as const, revokedByUserId: actorUserId,
      revokedAt: new Date("2026-10-20T00:01:00.000Z") };
    Object.assign(administrator, revoked);
    return revoked;
  }
}

class FakeAskArdenClient implements AskArdenClient {
  lastRequest: AiAnswerRequest | null = null;
  onAnswer: (() => void) | null = null;
  sourceBlockIds = ["mfa"];

  async answer(request: AiAnswerRequest): Promise<AiAnswerResponse> {
    this.lastRequest = request;
    this.onAnswer?.();
    return {
      contractVersion: 1,
      requestId: request.requestId,
      status: "ANSWERED",
      answer: "MFA is required by the security policy.",
      citations: [{
        generationId,
        snapshotVersionId: sharedVersionId,
        snapshotContentHash: "a".repeat(64),
        chunkId: "b".repeat(64),
        sourceBlockIds: this.sourceBlockIds,
        parentSectionBlockId: null,
        excerpt: "All team members must use MFA.",
      }],
    };
  }
}

class MemoryRepository implements ArdenDataRepository {
  readonly audienceGroups: AudienceGroupStore = new MemoryAudienceGroupStore();
  readonly systemAdministration: SystemAdministrationStore = new MemorySystemAdministrationStore();
  createdOrganization: { userId: string; email: string; name: string } | null = null;
  pendingInvitation: { invitationId: string; email: string; tokenHash: string; expiresAt: Date; accepted: boolean } | null = null;
  currentBody = "Private body";
  currentVersion = 2;
  currentSource: StoredContentFields = { sourceUri: "arden-private-object://dddddddd-dddd-4ddd-8ddd-dddddddddddd", mimeType: "text/plain", contentHash: "not-used-in-forged-note" };
  sharedDraft: SharedKnowledgeDraft | null = null;
  sharedSubmission: SharedKnowledgeSubmission | null = null;
  reviewerGrant: ReviewerGrantRecord | null = null;
  publication: PublishedKnowledge | null = null;
  authorizedAiSources: AuthorizedAiSource[] = [];
  private reviewRequestKey: string | null = null;
  sharedCreates = 0;
  failSharedCreate = false;
  attemptedSharedCopyUri: string | null = null;
  attemptedSharedCopyHash: string | null = null;
  private sharedRequestKey: string | null = null;

  async requireActiveMembership(userId: string, requestedOrganization: string): Promise<ActiveMembership | null> {
    return (userId === ownerId || userId === otherId) && requestedOrganization === organizationId
      ? { membershipId: userId, organizationId, userId } : null;
  }

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

  async getKnowledgeOptions(userId: string, requestedOrganization: string): Promise<KnowledgeOptions | null> {
    if ((userId !== ownerId && userId !== otherId) || requestedOrganization !== organizationId) return null;
    return {
      departments: [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "Product" }],
      audiences: [{ id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Product members",
        departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", kind: "DEPARTMENT_ALL" }],
    };
  }

  async createDepartment(userId: string, requestedOrganization: string, _name: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }
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

  async getPrivateContributionSource(userId: string, requestedOrganization: string, requestedVersion: string): Promise<PrivateContributionSource | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId || requestedVersion !== versionId) return null;
    return {
      versionId, organizationId, ownerMembershipId: ownerId, title: "Review notes",
      sourceUri: this.currentSource.sourceUri, mimeType: this.currentSource.mimeType, contentHash: this.currentSource.contentHash,
    };
  }

  async createKnowledgeDraft(_userId: string, _organizationId: string, input: {
    sourceVersionId: string; classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
    idempotencyKey: string; expectedSource: PrivateContributionSource; copiedContent: StoredContentFields; requestId: string;
  }): Promise<CreateSharedDraftResult> {
    this.attemptedSharedCopyUri = input.copiedContent.sourceUri;
    this.attemptedSharedCopyHash = input.copiedContent.contentHash;
    if (this.failSharedCreate) throw new Error("Synthetic database failure");
    if (this.sharedDraft && this.sharedRequestKey === input.idempotencyKey) {
      return this.sharedDraft.sourcePrivateVersionId === input.sourceVersionId && this.sharedDraft.classification === input.classification
        ? { kind: "replayed", draft: this.sharedDraft } : { kind: "idempotency-conflict" };
    }
    this.sharedRequestKey = input.idempotencyKey;
    this.sharedCreates += 1;
    this.sharedDraft = {
      id: sharedDraftId, organizationId, title: input.expectedSource.title,
      classification: input.classification, sourcePrivateVersionId: input.sourceVersionId,
      responsibleDepartmentId: null, targetScopeType: null, teamTag: null, projectTag: null, audienceRoleIds: [],
      versionId: sharedVersionId, sourceUri: input.copiedContent.sourceUri,
      mimeType: input.copiedContent.mimeType, contentHash: input.copiedContent.contentHash,
      currentVersion: 1, hasPendingSubmission: false, createdAt: new Date("2026-10-10T09:00:00.000Z"), updatedAt: new Date("2026-10-10T09:00:00.000Z"),
    };
    return { kind: "created", draft: this.sharedDraft };
  }

  async createNewKnowledgeDraft(userId: string, requestedOrganization: string, input: {
    title: string; classification: "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
    idempotencyKey: string; content: StoredContentFields;
  }): Promise<CreateSharedDraftResult> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return { kind: "unavailable" };
    if (this.failSharedCreate) throw new Error("Synthetic database failure");
    if (this.sharedDraft && this.sharedRequestKey === input.idempotencyKey) {
      return this.sharedDraft.sourcePrivateVersionId === null && this.sharedDraft.title === input.title
        && this.sharedDraft.classification === input.classification && this.sharedDraft.contentHash === input.content.contentHash
        ? { kind: "replayed", draft: this.sharedDraft } : { kind: "idempotency-conflict" };
    }
    this.sharedRequestKey = input.idempotencyKey;
    this.sharedCreates += 1;
    this.sharedDraft = {
      id: sharedDraftId, organizationId, title: input.title, classification: input.classification,
      sourcePrivateVersionId: null, responsibleDepartmentId: null, targetScopeType: null,
      teamTag: null, projectTag: null, audienceRoleIds: [], versionId: sharedVersionId,
      sourceUri: input.content.sourceUri, mimeType: input.content.mimeType, contentHash: input.content.contentHash,
      currentVersion: 1, hasPendingSubmission: false, createdAt: new Date("2026-10-10T09:00:00.000Z"), updatedAt: new Date("2026-10-10T09:00:00.000Z"),
    };
    return { kind: "created", draft: this.sharedDraft };
  }

  async listKnowledgeDrafts(userId: string, requestedOrganization: string): Promise<SharedKnowledgeDraft[] | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    return this.sharedDraft ? [this.sharedDraft] : [];
  }

  async getKnowledgeDraft(userId: string, requestedOrganization: string, requestedDraft: string): Promise<SharedKnowledgeDraft | null> {
    return userId === ownerId && requestedOrganization === organizationId && this.sharedDraft?.id === requestedDraft
      ? this.sharedDraft : null;
  }

  async updateKnowledgeDraft(userId: string, requestedOrganization: string, requestedDraft: string,
    expectedVersion: number, patch: SharedDraftPatch, content: StoredContentFields | null): Promise<UpdateSharedDraftResult> {
    const draft = await this.getKnowledgeDraft(userId, requestedOrganization, requestedDraft);
    if (!draft) return { kind: "not-found" };
    if (draft.currentVersion !== expectedVersion) return { kind: "conflict", currentVersion: draft.currentVersion };
    this.sharedDraft = {
      ...draft, title: patch.title ?? draft.title, classification: patch.classification ?? draft.classification,
      responsibleDepartmentId: patch.responsibleDepartmentId === undefined ? draft.responsibleDepartmentId : patch.responsibleDepartmentId,
      targetScopeType: patch.targetScopeType === undefined ? draft.targetScopeType : patch.targetScopeType,
      teamTag: patch.teamTag === undefined ? draft.teamTag : patch.teamTag,
      projectTag: patch.projectTag === undefined ? draft.projectTag : patch.projectTag,
      audienceRoleIds: patch.audienceRoleIds ?? draft.audienceRoleIds,
      sourceUri: content?.sourceUri ?? draft.sourceUri,
      contentHash: content?.contentHash ?? draft.contentHash,
      versionId: expectedVersion + 1 === 2
        ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      currentVersion: expectedVersion + 1,
    };
    return { kind: "updated", draft: this.sharedDraft };
  }

  async submitKnowledgeDraft(userId: string, requestedOrganization: string, requestedDraft: string,
    expectedVersion: number, _key: string): Promise<SubmitKnowledgeDraftResult> {
    const draft = await this.getKnowledgeDraft(userId, requestedOrganization, requestedDraft);
    if (!draft) return { kind: "not-found" };
    if (draft.currentVersion !== expectedVersion) return { kind: "conflict" };
    if (!draft.responsibleDepartmentId || !draft.targetScopeType || draft.audienceRoleIds.length === 0) return { kind: "not-ready" };
    if (this.sharedSubmission?.snapshotVersionId === draft.versionId) return { kind: "replayed", submission: this.sharedSubmission };
    this.sharedSubmission = {
      id: "abababab-abab-4aba-8aba-abababababab", draftId: draft.id,
      snapshotVersionId: draft.versionId, title: draft.title, classification: draft.classification,
      responsibleDepartmentId: draft.responsibleDepartmentId, targetScopeType: draft.targetScopeType,
      targetDepartmentId: draft.targetScopeType === "DEPARTMENT" ? draft.responsibleDepartmentId : null,
      audienceRoleIds: draft.audienceRoleIds, contentHash: draft.contentHash,
      status: "PENDING_REVIEW", submittedAt: new Date("2026-10-10T10:00:00.000Z"), publishedVersionId: null,
      publicationState: "NONE",
      decisionComment: null,
    };
    this.sharedDraft = { ...draft, hasPendingSubmission: true };
    return { kind: "submitted", submission: this.sharedSubmission! };
  }

  async listKnowledgeSubmissions(userId: string, requestedOrganization: string): Promise<SharedKnowledgeSubmission[] | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    return this.sharedSubmission ? [this.sharedSubmission] : [];
  }

  async listReviewerGrants(userId: string, requestedOrganization: string): Promise<ReviewerGrantRecord[] | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    return this.reviewerGrant ? [this.reviewerGrant] : [];
  }

  async createReviewerGrant(userId: string, requestedOrganization: string, input: ReviewerGrantInput): Promise<ReviewerGrantRecord | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId || input.reviewerMembershipId !== otherId) return null;
    this.reviewerGrant = { ...input, id: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", status: "ACTIVE",
      validFrom: new Date("2026-10-10T09:00:00.000Z") };
    return this.reviewerGrant;
  }

  async deactivateReviewerGrant(userId: string, requestedOrganization: string, grantId: string): Promise<boolean> {
    if (userId !== ownerId || requestedOrganization !== organizationId || this.reviewerGrant?.id !== grantId) return false;
    this.reviewerGrant = { ...this.reviewerGrant, status: "INACTIVE" };
    return true;
  }

  async listAssignedReviews(userId: string, requestedOrganization: string): Promise<AssignedReview[] | null> {
    if (requestedOrganization !== organizationId) return null;
    const submission = this.sharedSubmission;
    if (userId !== otherId || this.reviewerGrant?.status !== "ACTIVE"
      || !submission || submission.status !== "PENDING_REVIEW") return [];
    return [{ submissionId: submission.id, snapshotId: submission.snapshotVersionId,
      title: submission.title, departmentId: submission.responsibleDepartmentId,
      classification: submission.classification, submittedAt: submission.submittedAt, approvalBlocked: false }];
  }

  async getAssignedReview(userId: string, requestedOrganization: string, submissionId: string): Promise<ReviewDetail | null> {
    const queue = await this.listAssignedReviews(userId, requestedOrganization);
    if (!queue?.some((item) => item.submissionId === submissionId) || !this.sharedSubmission || !this.sharedDraft) return null;
    return { submission: this.sharedSubmission, sourceUri: this.sharedDraft.sourceUri,
      mimeType: this.sharedDraft.mimeType, submittedByMembershipId: ownerId,
      teamTag: this.sharedDraft.teamTag, projectTag: this.sharedDraft.projectTag };
  }

  async decideReview(userId: string, requestedOrganization: string, submissionId: string, action: ReviewAction,
    expectedSnapshotVersionId: string, expectedContentHash: string, comment: string | null,
    idempotencyKey: string): Promise<DecideReviewResult> {
    const submission = this.sharedSubmission;
    if (this.reviewRequestKey === idempotencyKey && submission && submissionId === submission.id) {
      return { kind: "replayed", submission };
    }
    if (userId !== otherId || requestedOrganization !== organizationId || !submission || submission.id !== submissionId
      || this.reviewerGrant?.status !== "ACTIVE") return { kind: "not-found" };
    if (submission.status !== "PENDING_REVIEW") return { kind: "conflict" };
    if (submission.snapshotVersionId !== expectedSnapshotVersionId || submission.contentHash !== expectedContentHash) {
      return { kind: "denied", reason: "STALE_SNAPSHOT" };
    }
    if (action !== "APPROVE" && !comment?.trim()) return { kind: "denied", reason: "COMMENT_REQUIRED" };
    this.reviewRequestKey = idempotencyKey;
    if (action === "APPROVE") {
      this.sharedSubmission = { ...submission, status: "APPROVED", publicationState: "PREPARING", publishedVersionId: null,
        decisionComment: comment?.trim() || null };
    } else this.sharedSubmission = { ...submission, status: "REJECTED", publicationState: "NONE",
      decisionComment: comment?.trim() || null };
    if (this.sharedDraft) this.sharedDraft = { ...this.sharedDraft, hasPendingSubmission: false };
    return { kind: "decided", submission: this.sharedSubmission! };
  }

  async listPublishedKnowledge(userId: string, requestedOrganization: string): Promise<PublishedKnowledge[] | null> {
    if (requestedOrganization !== organizationId) return null;
    return userId === ownerId && this.publication ? [this.publication] : [];
  }

  async getPublishedKnowledge(userId: string, requestedOrganization: string, publishedVersionId: string): Promise<PublishedKnowledge | null> {
    return userId === ownerId && requestedOrganization === organizationId && this.publication?.id === publishedVersionId
      ? this.publication : null;
  }

  async listAuthorizedAiSources(userId: string, requestedOrganization: string): Promise<AuthorizedAiSource[] | null> {
    if (requestedOrganization !== organizationId) return null;
    return userId === ownerId ? this.authorizedAiSources : [];
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
