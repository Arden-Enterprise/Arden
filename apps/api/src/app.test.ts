import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import type { AuthProvider, SupabaseSignUp } from "./auth/provider.js";
import { ReviewerGrantConflictError, type ActiveMembership, type ArdenDataRepository, type DecidedReview, type AuthorizedAiSource, type CreatedOrganization, type CreateSharedDraftResult, type OrganizationSetup, type DecideReviewResult, type DeleteDepartmentResult, type DraftCursor, type DraftListItem, type DraftPatch, type DraftUpdateResult, type DraftWrite, type KnowledgeDraftVersion, type KnowledgeOptions, type MembershipSummary, type OrganizationAdminData, type PrivateContributionSource, type PrivateDraft, type PublishedKnowledge, type ReviewerGrantInput, type ReviewerGrantRecord, type ReviewDetail, type SharedDraftPatch, type SharedKnowledgeDraft, type SharedKnowledgeSubmission, type StoredContentFields, type SubmitKnowledgeDraftResult, type UpdateSharedDraftResult, type WithdrawKnowledgeSubmissionResult, type RetryKnowledgePublicationResult, type GovernancePublication, type GovernanceInspectionView, type GovernanceDocumentView, type PublicationReport, type OpenGovernanceInspectionResult, type DirectWithdrawalResult, type ReportPublicationResult, type PublicationChangeInput, type RequestPublicationChangeResult, type PublicationRenewalInput, type PublicationRenewalState, type RequestPublicationRenewalResult } from "./db/repository.js";
import type { AssignedReview } from "./knowledge/review-queue.js";
import type { ReviewAction } from "./knowledge/review-decision.js";
import { LocalPrivateContentStorage } from "./private-notes/content-storage.js";
import { MemoryPrivateOrganizationStore } from "./private-notes/organization.test-support.js";
import type { InvitationEmail, InvitationMailer } from "./email/smtp-mailer.js";
import { LocalFlow1TestInvitationMailer } from "./email/local-flow1-test-mailer.js";
import { AudienceGroupError, type AudienceGroup, type AudienceGroupStore } from "./audiences/store.js";
import { SystemAdministrationError, type SystemAdministrator, type SystemAdministrationStore } from "./system-administration/store.js";
import { parseSemanticDocument } from "@arden/domain";
import type { AskArdenClient } from "./answers/ai-client.js";
import { evidenceManifest, evidenceText, MemoryConversationStore } from "./answers/conversation.test-support.js";
import type { RetrievalRequest, RetrievalResponse, GenerationRequest, GenerationResponse } from "./answers/governed-contracts.js";
import { validateSelection, type ReaderActor, type SelectionFacts, type TargetReadersInput } from "./target-readers/policy.js";
import { resolveApprovedReaders, sameReaders } from "./target-readers/narrowing.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOrganizationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const draftId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const versionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherDraftA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const otherDraftB = "ffffffff-ffff-4fff-8fff-fffffffffff2";
const sharedDraftId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const sharedVersionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const createKey = "99999999-9999-4999-8999-999999999999";
const systemAdminCandidateId = "33333333-3333-4333-8333-333333333333";
const generationId = "44444444-4444-4444-8444-444444444444";
const salesDepartmentId = "55555555-5555-4555-8555-555555555555";
const engineeringDepartmentId = "66666666-6666-4666-8666-666666666666";
const archivedDepartmentId = "77777777-7777-4777-8777-777777777777";
const suspendedMemberId = "88888888-8888-4888-8888-888888888888";
const foreignMemberId = "12121212-1212-4121-8121-121212121212";
/** 101 distinct active members of the synthetic organization. */
const activeMemberIds = Array.from({ length: 101 }, (_, index) =>
  `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`);

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
    vi.restoreAllMocks();
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
      classification: "INTERNAL", targetScopeType: "ORGANIZATION", targetReaders: null,
      chunks: [{ ...evidenceManifest, chunkId: "b".repeat(64), sourceBlockIds: ["pdf-page-2", "pdf-page-2-heading"], parentSectionBlockId: null }],
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
      version: "Version unavailable", scope: "Company-wide", classification: "INTERNAL",
    }] });
  });

  it("drops the answer when publication access changes before citations are returned", async () => {
    repository.authorizedAiSources = [{
      generationId, snapshotVersionId: sharedVersionId, snapshotContentHash: "a".repeat(64),
      publishedVersionId: versionId, draftId: sharedDraftId, title: "Security policy", versionNo: 3,
      classification: "INTERNAL", targetScopeType: "ORGANIZATION", targetReaders: null,
      chunks: [{ ...evidenceManifest, chunkId: "b".repeat(64), sourceBlockIds: ["mfa"], parentSectionBlockId: null }],
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

  it("exposes only owner-private persisted history with no-store responses and strict continuation", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const other = await desktopSession(app, "other@example.test");
    const headers = { cookie: owner, origin: "http://localhost:5180" };
    const base = `/api/v1/organizations/${organizationId}/ai`;
    const payload = { query: "No matching knowledge?", conversationId: versionId,
      requestId: createKey, expectedRevision: 0 };
    const answer = await app.inject({ method: "POST", url: `${base}/answers`, headers, payload });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", conversationId: versionId, revision: 1 });
    const listed = await app.inject({ method: "GET", url: `${base}/conversations`, headers });
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().items).toHaveLength(1);
    const loaded = await app.inject({ method: "GET", url: `${base}/conversations/${versionId}`, headers });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().turns).toHaveLength(1);
    expect(loaded.json().turns[0]).not.toHaveProperty("evidence");
    expect(loaded.json().turns[0]).not.toHaveProperty("versionScope");
    const feedbackUrl = `${base}/conversations/${versionId}/turns/${answer.json().turnId}/feedback`;
    const rate = (feedback: unknown, cookie = owner) => app.inject({ method: "PUT", url: feedbackUrl,
      headers: { ...headers, cookie }, payload: { feedback } });
    expect((await rate("BAD", other)).statusCode).toBe(404);
    expect((await rate("INVALID")).statusCode).toBe(400);
    expect((await rate("GOOD")).json()).toEqual({ feedback: "GOOD" });
    expect((await rate("BAD")).json()).toEqual({ feedback: "BAD" });
    const rated = await app.inject({ method: "GET", url: `${base}/conversations/${versionId}`, headers });
    expect(rated.json()).toMatchObject({ revision: 1, turns: [{ feedback: "BAD" }] });
    expect((await rate(null)).json()).toEqual({ feedback: null });
    for (const versionScope of ["CURRENT", "UPCOMING", "COMPARE"]) {
      expect((await app.inject({ method: "POST", url: `${base}/answers`, headers,
        payload: { ...payload, versionScope } })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: `${base}/conversations/${versionId}`,
      headers: { cookie: other } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `${base}/conversations` })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `${base}/answers`, headers,
      payload: { ...payload, query: "Changed request" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `${base}/answers`, headers,
      payload: { query: "No revision", conversationId: versionId } })).statusCode).toBe(400);
  });

  it.each([
    { name: "unlisted chunk", patch: { chunkId: "c".repeat(64) } },
    { name: "invented block", patch: { sourceBlockIds: ["other-block"] } },
    { name: "wrong parent section", patch: { parentSectionBlockId: "actual-heading" } },
  ])("rejects an AI citation with $name even when snapshot permission is valid", async ({ patch }) => {
    repository.authorizedAiSources = [{
      generationId, snapshotVersionId: sharedVersionId, snapshotContentHash: "a".repeat(64),
      publishedVersionId: versionId, draftId: sharedDraftId, title: "Security policy", versionNo: 3,
      classification: "INTERNAL", targetScopeType: "ORGANIZATION", targetReaders: null,
      chunks: [{ ...evidenceManifest, chunkId: "b".repeat(64), sourceBlockIds: ["mfa"], parentSectionBlockId: null, ...patch }],
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
      actor: { id: ownerId, email: "owner@example.test", fullName: "Owner" },
      account: { passwordSetupRequired: false },
      sessionExpiresAt: expect.any(String),
      systemAdmin: true,
      memberships: [{
        organization: { id: organizationId, name: "Arden Test Org" },
        status: "active", departmentId: null, departmentName: null, roleCodes: ["MEMBER"], canUsePrivateWorkspace: true,
      }],
    });
  });

  it.each(["password", "google"])("expires a %s session exactly 24 hours after sign-in", async (method) => {
    const startedAt = Date.UTC(2026, 10, 13, 8);
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    let cookie: string;
    let setCookies: string | string[] | undefined;
    if (method === "password") {
      const signedIn = await app.inject({ method: "POST", url: "/api/v1/auth/sign-in",
        headers: { origin: "http://localhost:5180" },
        payload: { email: "owner@example.test", password: "synthetic-password" } });
      expect(signedIn.statusCode).toBe(200);
      setCookies = signedIn.headers["set-cookie"];
      cookie = cookieHeader(setCookies);
    } else {
      const started = await app.inject("/api/v1/auth/google/start");
      const callback = await app.inject({ method: "GET",
        url: "/api/v1/auth/google/callback?code=synthetic-code&sb_flow_id=0123456789abcdef0123456789abcdef",
        headers: { cookie: cookieHeader(started.headers["set-cookie"]) } });
      expect(callback.statusCode).toBe(302);
      setCookies = callback.headers["set-cookie"];
      cookie = cookieHeader(setCookies);
    }
    expect(cookie).toContain("arden_session=v1.");
    expect(JSON.stringify(setCookies)).toContain("Max-Age=86400");
    const expectedExpiry = new Date(startedAt + 24 * 60 * 60 * 1000).toISOString();
    expect((await app.inject({ url: "/api/v1/me", headers: { cookie } })).json().sessionExpiresAt).toBe(expectedExpiry);

    const withoutSeal = cookie.split("; ").filter((part) => !part.startsWith("arden_session=")).join("; ");
    const unbound = await app.inject({ url: "/api/v1/me", headers: { cookie: withoutSeal } });
    expect(unbound.statusCode).toBe(401);
    expect(JSON.stringify(unbound.headers["set-cookie"])).toContain("arden_session=; ");

    clock.mockReturnValue(startedAt + 24 * 60 * 60 * 1000 - 1000);
    expect((await app.inject({ url: "/api/v1/me", headers: { cookie } })).statusCode).toBe(200);
    clock.mockReturnValue(startedAt + 24 * 60 * 60 * 1000);
    const expired = await app.inject({ url: "/api/v1/me", headers: { cookie } });
    expect(expired.statusCode).toBe(401);
    expect(JSON.stringify(expired.headers["set-cookie"])).toContain("Max-Age=0");
  });

  it("keeps the original deadline when refresh tokens rotate", async () => {
    const startedAt = Date.UTC(2026, 10, 13, 8);
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const signedIn = await app.inject({ method: "POST", url: "/api/v1/auth/sign-in",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", password: "synthetic-password" } });
    const originalCookie = cookieHeader(signedIn.headers["set-cookie"]);
    authProvider.rotatedSession = { accessToken: "access-rotated", refreshToken: "refresh-rotated", expiresIn: 3600 };
    clock.mockReturnValue(startedAt + 60 * 60 * 1000);
    const refreshed = await app.inject({ url: "/api/v1/me", headers: { cookie: originalCookie } });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().sessionExpiresAt).toBe(new Date(startedAt + 24 * 60 * 60 * 1000).toISOString());
    expect(JSON.stringify(refreshed.headers["set-cookie"])).toContain("Max-Age=82800");
    const rotatedCookie = cookieHeader(refreshed.headers["set-cookie"]);
    expect(rotatedCookie).toContain("arden_access=access-rotated");
    expect((await app.inject({ url: "/api/v1/me", headers: { cookie: rotatedCookie } })).statusCode).toBe(200);
    const mixedCookie = rotatedCookie.replace("arden_session=", "arden_session=wrong");
    expect((await app.inject({ url: "/api/v1/me", headers: { cookie: mixedCookie } })).statusCode).toBe(401);
  });

  it("shares secure password and desktop Google sessions across API replicas with one key", async () => {
    const key = Buffer.alloc(32, 9);
    const makeReplica = (sessionSigningKey: Buffer) => buildApp({
      checkDatabase: async () => undefined, auth: authProvider,
      authTrustedOrigins: ["https://arden.example.test"], secureCookies: true,
      sessionSigningKey, repository, storage, invitationMailer,
      publicWebOrigin: "https://arden.example.test", publicApiOrigin: "https://api.example.test",
    });
    const first = makeReplica(key);
    const second = makeReplica(key);
    const otherKey = makeReplica(Buffer.alloc(32, 8));
    try {
      const signedIn = await first.inject({ method: "POST", url: "/api/v1/auth/sign-in",
        headers: { origin: "https://arden.example.test" },
        payload: { email: "owner@example.test", password: "synthetic-password" } });
      const passwordCookie = cookieHeader(signedIn.headers["set-cookie"]);
      expect(passwordCookie).toContain("__Host-arden_session=v1.");
      expect(JSON.stringify(signedIn.headers["set-cookie"])).toContain("Secure");
      expect((await second.inject({ url: "/api/v1/me", headers: { cookie: passwordCookie } })).statusCode).toBe(200);
      expect((await otherKey.inject({ url: "/api/v1/me", headers: { cookie: passwordCookie } })).statusCode).toBe(401);

      const started = await first.inject("/api/v1/auth/google/start?client=desktop");
      const callback = await first.inject({ method: "GET",
        url: "/api/v1/auth/google/callback?code=synthetic-code&sb_flow_id=0123456789abcdef0123456789abcdef",
        headers: { cookie: cookieHeader(started.headers["set-cookie"]) } });
      expect(callback.headers.location).toContain("/api/v1/auth/google/desktop-complete?status=success");
      const googleCookie = cookieHeader(callback.headers["set-cookie"]);
      expect(googleCookie).toContain("__Host-arden_session=v1.");
      expect((await second.inject({ url: "/api/v1/me", headers: { cookie: googleCookie } })).statusCode).toBe(200);
    } finally {
      await Promise.all([first.close(), second.close(), otherKey.close()]);
    }
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
    for (const password of ["Abcdef!", "abcdefgh!", "Abcdefgh"]) {
      const invalid = await app.inject({
        method: "POST", url: "/api/v1/auth/password",
        headers: { cookie: sessionCookie, origin: "http://localhost:5180" },
        payload: { password },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().error.code).toBe("INVALID_PASSWORD");
      expect(invalid.json().error.message).toBe("Password must have at least 8 characters, one uppercase letter, and one special character.");
    }
    const stillPending = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: sessionCookie } });
    expect(stillPending.json().account).toEqual({ passwordSetupRequired: true });
    const tooLong = await app.inject({
      method: "POST", url: "/api/v1/auth/password",
      headers: { cookie: sessionCookie, origin: "http://localhost:5180" },
      payload: { password: "A!" + "a".repeat(99) },
    });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.code).toBe("INVALID_PASSWORD");
    expect(tooLong.json().error.message).toBe("Password must be 100 characters or fewer.");
    const updated = await app.inject({
      method: "POST", url: "/api/v1/auth/password",
      headers: { cookie: sessionCookie, origin: "http://localhost:5180" },
      payload: { password: "A!" + "a".repeat(98) },
    });
    expect(updated.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: sessionCookie } });
    expect(after.json().account).toEqual({ passwordSetupRequired: false });
  });

  it("keeps sign-up confirmation non-enumerating and handles validation", async () => {
    authProvider.signUpBehavior = "already_exists";
    const conflict = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "existing@example.test", password: "Secure-password1!", fullName: "Existing User" },
    });
    expect(conflict.statusCode).toBe(202);
    authProvider.signUpBehavior = "success";
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: { email: " fresh@example.test ", password: "Secure-password1!", fullName: "New User" },
    });
    expect(signup.statusCode).toBe(202);
    expect(signup.json()).toEqual(conflict.json());
    expect(authProvider.lastSignUpCredentials?.email).toBe("fresh@example.test");

    authProvider.signUpBehavior = "rejected";
    const rejected = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "rejected@example.test", password: "Secure-password1!", fullName: "Rejected User" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toMatchObject({
      code: "ACCOUNT_SETUP_UNAVAILABLE",
      message: "Account setup could not be completed. Try a different password or sign in.",
    });
    authProvider.signUpBehavior = "success";

    const invalidEmail = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "123@gmail", password: "Secure-password1!", fullName: "Invalid Email User" },
    });
    expect(invalidEmail.statusCode).toBe(400);
    expect(invalidEmail.json().error).toMatchObject({
      code: "INVALID_EMAIL",
      message: "Enter a valid email address.",
    });

    const invalidSignIn = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "123@gmail", password: "secure-password" },
    });
    expect(invalidSignIn.statusCode).toBe(400);
    expect(invalidSignIn.json().error).toMatchObject({
      code: "INVALID_EMAIL",
      message: "Enter a valid email address.",
    });
  });

  it("rejects a whitespace-only account name before requesting provider sign-up", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "fresh@example.test", password: "Secure-password1!", fullName: "   " },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: "INVALID_FULL_NAME", message: "Enter your name." });
    expect(authProvider.lastSignUpCredentials).toBeNull();
  });

  it("trims surrounding email whitespace but rejects whitespace inside an address", async () => {
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "  OWNER@EXAMPLE.TEST  ", password: "synthetic-password" },
    });
    expect(response.statusCode).toBe(200);
    const session = await app.inject({ method: "GET", url: "/api/v1/me",
      headers: { cookie: cookieHeader(response.headers["set-cookie"]) } });
    expect(session.json().actor.email).toBe("owner@example.test");
    const internalSpace = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner @example.test", password: "synthetic-password" },
    });
    expect(internalSpace.statusCode).toBe(400);
    expect(internalSpace.json().error.code).toBe("INVALID_EMAIL");
  });

  it.each(["sign-in", "sign-up", "forgot-password", "invitation"])("rejects malformed email domains before %s side effects", async (route) => {
    const cookie = await desktopSession(app, "owner@example.test");
    const signIn = vi.spyOn(authProvider, "signIn"), signUp = vi.spyOn(authProvider, "signUp");
    const recover = vi.spyOn(authProvider, "resetPasswordForEmail"), invite = vi.spyOn(repository, "createInvitation");
    for (const email of ["user@example..test", "user@.example.test", "user@example.test.", "user@-example.test", "user@example-.test", "user@exam_ple.test"]) {
      const response = await app.inject({ method: "POST",
        url: route === "invitation" ? `/api/v1/organizations/${organizationId}/invitations` : `/api/v1/auth/${route}`,
        headers: { cookie, origin: "http://localhost:5180" },
        payload: { email: ` ${email} `, ...(route === "sign-in" || route === "sign-up" ? { password: "Synthetic-password!" } : {}),
          ...(route === "sign-up" ? { fullName: "Synthetic member" } : {}) },
      });
      expect(response.statusCode, email).toBe(400);
      expect(response.json().error.code).toBe("INVALID_EMAIL");
    }
    expect(signIn).not.toHaveBeenCalled(); expect(signUp).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled(); expect(invite).not.toHaveBeenCalled();
    expect(invitationMailer.sent).toHaveLength(0);
  });

  it("sends a recovery link and accepts only its verified browser session", async () => {
    const forgot = await app.inject({
      method: "POST", url: "/api/v1/auth/forgot-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: " owner@example.test " },
    });
    expect(forgot.statusCode).toBe(202);
    expect(forgot.json().status).toBe("recovery_sent");
    expect(authProvider.lastResetEmail).toBe("owner@example.test");
    expect(authProvider.lastResetRedirectTo).toBe("http://localhost:5180/reset-password");

    const verify = await app.inject({
      method: "GET", url: "/auth/v1/verify?token=valid-link&type=recovery",
    });
    expect(verify.statusCode).toBe(303);
    expect(verify.headers.location).toContain("reset-password");
    const recoveryCookie = cookieHeader(verify.headers["set-cookie"]);
    expect(recoveryCookie).toContain("arden_recovery=");

    const rootVerify = await app.inject({
      method: "GET", url: "/verify?token=valid-link&type=recovery",
    });
    expect(rootVerify.statusCode).toBe(303);
    expect(rootVerify.headers.location).toContain("reset-password");

    const invalidLink = await app.inject({
      method: "GET", url: "/auth/v1/verify?token=wrong-link&type=recovery",
    });
    expect(invalidLink.statusCode).toBe(303);
    expect(invalidLink.headers.location).toBe("/reset-password?error=verification_failed");
    expect(invalidLink.headers["set-cookie"]).toBeUndefined();

    const resetWithCode = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", token: "valid-token", newPassword: "new-secure-password" },
    });
    expect(resetWithCode.statusCode).toBe(400);
    expect(authProvider.lastUpdatedPassword).toBeNull();

    const missingProof = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180" },
      payload: { accessToken: "access-recovery", refreshToken: "refresh-recovery", newPassword: "new-secure-password" },
    });
    expect(missingProof.statusCode).toBe(401);
    expect(missingProof.json().error.code).toBe("INVALID_TOKEN");

    const shortPassword = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180", cookie: recoveryCookie },
      payload: { accessToken: "access-recovery", refreshToken: "refresh-recovery", newPassword: "short" },
    });
    expect(shortPassword.statusCode).toBe(400);
    expect(shortPassword.json().error.code).toBe("INVALID_PASSWORD");
    expect(shortPassword.json().error.message).toBe("Password must be at least 8 characters long.");

    const rejectedPassword = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180", cookie: recoveryCookie },
      payload: { accessToken: "access-recovery", refreshToken: "refresh-recovery", newPassword: "rejected-password" },
    });
    expect(rejectedPassword.statusCode).toBe(400);
    expect(rejectedPassword.json().error.code).toBe("PASSWORD_REJECTED");
    expect(authProvider.lastUpdatedPassword).toBeNull();

    const resetWithLink = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180", cookie: recoveryCookie },
      payload: { accessToken: "access-recovery", refreshToken: "refresh-recovery", newPassword: "new-secure-password" },
    });
    expect(resetWithLink.statusCode).toBe(200);
    expect(resetWithLink.json()).toEqual({ status: "password_updated" });
    expect(authProvider.lastUpdatedPassword?.password).toBe("new-secure-password");
    expect(cookieHeader(resetWithLink.headers["set-cookie"])).toContain("arden_access=access-recovery");

    const reusedLink = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180", cookie: recoveryCookie },
      payload: { accessToken: "access-recovery", refreshToken: "refresh-recovery", newPassword: "second-password" },
    });
    expect(reusedLink.statusCode).toBe(401);
    expect(reusedLink.json().error.code).toBe("INVALID_TOKEN");
    expect(reusedLink.json().error.message).toBe("The reset link has already been used.");
  });

  it("keeps recovery cooldown responses indistinguishable from successful requests", async () => {
    const request = {
      method: "POST" as const, url: "/api/v1/auth/forgot-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test" },
    };
    const firstResponse = await app.inject(request);
    authProvider.resetFailure = "RESET_RATE_LIMITED";
    const cooldownResponse = await app.inject(request);
    expect(firstResponse.statusCode).toBe(202);
    expect(cooldownResponse.statusCode).toBe(202);
    expect(cooldownResponse.json()).toEqual(firstResponse.json());
  });

  it("keeps provider client rejections non-enumerating", async () => {
    authProvider.resetFailure = "RESET_REQUEST_REJECTED";
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/forgot-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test" },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("recovery_sent");
  });

  it("uses recovery-specific wording for provider outages", async () => {
    authProvider.resetFailure = "SUPABASE_AUTH_UNAVAILABLE";
    const response = await app.inject({
      method: "POST", url: "/api/v1/auth/forgot-password",
      headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toMatchObject({ code: "RESET_UNAVAILABLE",
      message: "A reset link could not be requested right now. Try again later." });
  });

  it("rejects a recovery proof after its ten-minute lifetime", async () => {
    const verify = await app.inject({ method: "GET", url: "/verify?token=valid-link&type=recovery" });
    const recoveryCookie = cookieHeader(verify.headers["set-cookie"]);
    const afterExpiry = Date.now() + 601_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(afterExpiry);
    try {
      const reset = await app.inject({
        method: "POST", url: "/api/v1/auth/reset-password",
        headers: { origin: "http://localhost:5180", cookie: recoveryCookie },
        payload: { accessToken: "access-recovery", refreshToken: "refresh-recovery", newPassword: "new-secure-password" },
      });
      expect(reset.statusCode).toBe(401);
      expect(reset.json().error.code).toBe("INVALID_TOKEN");
      expect(authProvider.lastUpdatedPassword).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it("requires a verified current password for account changes and rejects session-only recovery", async () => {
    const startedAt = Date.UTC(2026, 10, 13, 8);
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const signIn = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", password: "synthetic-password" },
    });
    const headers = { origin: "http://localhost:5180", cookie: cookieHeader(signIn.headers["set-cookie"]) };
    const submit = (url: string, payload: object) => app.inject({ method: "POST", url, headers, payload });
    const change = "/api/v1/auth/change-password";
    const reset = "/api/v1/auth/reset-password";
    const newPassword = "new-secure-password";
    expect((await submit(reset, { newPassword })).statusCode).toBe(401);
    expect((await submit(reset, { accessToken: "access-owner", refreshToken: "refresh-owner", newPassword })).statusCode).toBe(401);
    expect((await submit(change, { newPassword })).statusCode).toBe(400);
    const wrong = await submit(change, { currentPassword: "wrong", newPassword });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect(authProvider.lastUpdatedPassword).toBeNull();
    const tooLong = await submit(change, { currentPassword: "synthetic-password", newPassword: "b".repeat(101) });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.code).toBe("INVALID_PASSWORD");
    expect(tooLong.json().error.message).toBe("Password must be 100 characters or fewer.");
    clock.mockReturnValue(startedAt + 60 * 60 * 1000);
    const updated = await submit(change, { currentPassword: "synthetic-password", newPassword });
    expect(updated.statusCode).toBe(200);
    expect(authProvider.lastUpdatedPassword).toEqual({ token: "access-owner", password: newPassword });
    expect((await app.inject({ url: "/api/v1/me",
      headers: { cookie: cookieHeader(updated.headers["set-cookie"]) } })).json().sessionExpiresAt)
      .toBe(new Date(startedAt + 24 * 60 * 60 * 1000).toISOString());
  });

  it("binds a recovery-link update to the verified browser flow", async () => {
    const verify = await app.inject({ method: "GET", url: "/verify?token=valid-link&type=recovery" });
    const cookie = cookieHeader(verify.headers["set-cookie"]);
    const reset = (refreshToken: string) => app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180", cookie },
      payload: { accessToken: "access-recovery", refreshToken, newPassword: "new-secure-password" },
    });
    expect((await reset("different-refresh")).statusCode).toBe(401);
    const tooLong = await app.inject({
      method: "POST", url: "/api/v1/auth/reset-password",
      headers: { origin: "http://localhost:5180", cookie },
      payload: { accessToken: "access-recovery", refreshToken: "refresh-recovery", newPassword: "b".repeat(101) },
    });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json().error.code).toBe("INVALID_PASSWORD");
    expect((await reset("refresh-recovery")).statusCode).toBe(200);
    expect((await reset("refresh-recovery")).statusCode).toBe(401);
  });

  it("enforces the account-creation requirements and the 100-character password cap", async () => {
    const headers = { origin: "http://localhost:5180" };
    for (const password of ["Abcdef!", "abcdefgh!", "Abcdefgh"]) {
      const signup = await app.inject({
        method: "POST", url: "/api/v1/auth/sign-up", headers,
        payload: { email: "owner@example.test", password, fullName: "Owner" },
      });
      expect(signup.statusCode).toBe(400);
      expect(signup.json().error.code).toBe("INVALID_PASSWORD");
      expect(signup.json().error.message).toBe("Password must have at least 8 characters, one uppercase letter, and one special character.");
      expect(authProvider.lastSignUpCredentials).toBeNull();
    }
    const signup = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up", headers,
      payload: { email: "owner@example.test", password: "Abcdefg!", fullName: "Owner" },
    });
    expect(signup.statusCode).toBe(202);
    const longSignup = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up", headers,
      payload: { email: "long@example.test", password: "A!" + "a".repeat(98), fullName: "Long Password" },
    });
    expect(longSignup.statusCode).toBe(202);
    const overLimit = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up", headers,
      payload: { email: "longer@example.test", password: "A!" + "a".repeat(99), fullName: "Long Password" },
    });
    expect(overLimit.statusCode).toBe(400);
    expect(overLimit.json().error.code).toBe("INVALID_PASSWORD");
    expect(overLimit.json().error.message).toBe("Password must be 100 characters or fewer.");
    const signin = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in", headers, payload: { email: "owner@example.test", password: "" },
    });
    expect(signin.json().error.code).toBe("INVALID_REQUEST");
    const longSignIn = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-in", headers, payload: { email: "owner@example.test", password: "a".repeat(101) },
    });
    expect(longSignIn.statusCode).toBe(400);
    expect(longSignIn.json().error.code).toBe("INVALID_PASSWORD");
    expect(longSignIn.json().error.message).toBe("Password must be 100 characters or fewer.");
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

  it("creates an organization without initial departments when departmentName is omitted", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const response = await app.inject({
      method: "POST", url: "/api/v1/organizations",
      headers: { cookie: session, origin: "http://localhost:5180" },
      payload: { name: "Blank Org" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().organization).toEqual({
      organizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Blank Org",
      departmentId: null,
      departmentName: null,
    });
  });

  it("exposes organization administration and audience/department mutations only to the Org Admin", async () => {
    const adminSession = await desktopSession(app, "owner@example.test");
    const adminData = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/administration`, headers: { cookie: adminSession } });
    expect(adminData.statusCode).toBe(200);
    expect(adminData.json().departments[0].name).toBe("Product");
    expect(adminData.json().members[0]).toMatchObject({ isOrganizationAdmin: true });

    const createdAudience = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/audience-groups`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { name: "Operations readers", description: "Operations knowledge audience" } });
    expect(createdAudience.statusCode).toBe(201);
    expect(createdAudience.json()).toMatchObject({ name: "Operations readers", members: [] });
    expect(createdAudience.headers.etag).toBe('"audience-group-1"');
    const createdDepartment = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/departments`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { name: "Operations" } });
    expect(createdDepartment.statusCode).toBe(201);
    const assigned = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/audience-groups/${createdAudience.json().id}/members`, headers: { cookie: adminSession, origin: "http://localhost:5180" }, payload: { membershipId: "77777777-7777-4777-8777-777777777777" } });
    expect(assigned.statusCode).toBe(201);

    const changedDepartment = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/members/77777777-7777-4777-8777-777777777777/department`,
      headers: { cookie: adminSession, origin: "http://localhost:5180" },
      payload: { departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    });
    expect(changedDepartment.statusCode).toBe(200);
    expect(changedDepartment.json()).toEqual({
      membershipId: "77777777-7777-4777-8777-777777777777",
      departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });

    const deleteFirstDept = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/departments/ffffffff-ffff-4fff-8fff-ffffffffffff/delete`,
      headers: { cookie: adminSession, origin: "http://localhost:5180" },
    });
    expect(deleteFirstDept.statusCode).toBe(200);

    const customDelete = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/departments/44444444-4444-4444-8444-444444444444/delete`,
      headers: { cookie: adminSession, origin: "http://localhost:5180" },
    });
    expect(customDelete.statusCode).toBe(200);
    expect(customDelete.json()).toEqual({ departmentId: "44444444-4444-4444-8444-444444444444", status: "archived", unassignedCount: 0, reassignedCount: 0 });

    const memberSession = await desktopSession(app, "member@example.test");
    const denied = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/administration`, headers: { cookie: memberSession } });
    expect(denied.statusCode).toBe(404);
    const deniedDepartmentChange = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/members/77777777-7777-4777-8777-777777777777/department`,
      headers: { cookie: memberSession, origin: "http://localhost:5180" },
      payload: { departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
    });
    expect(deniedDepartmentChange.statusCode).toBe(404);
    const deniedDelete = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${organizationId}/departments/44444444-4444-4444-8444-444444444444/delete`,
      headers: { cookie: memberSession, origin: "http://localhost:5180" },
    });
    expect(deniedDelete.statusCode).toBe(404);
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

    const feedbackUrl = "/api/v1/system/analytics/private-feedback";
    const analytics = await app.inject({ method: "GET", url: feedbackUrl, headers: { cookie: candidate } });
    expect(analytics.statusCode).toBe(200);
    expect(analytics.headers["cache-control"]).toBe("no-store");
    expect(analytics.json()).toEqual({ weeks: [{ weekStart: "2026-11-23", good: 2, bad: 1 }] });
    expect((await app.inject({ method: "GET", url: feedbackUrl, headers: { cookie: ordinaryMember } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: feedbackUrl })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `${feedbackUrl}?userId=${ownerId}`, headers: { cookie: candidate } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: candidate } })).json().systemAdmin).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/v1/me", headers: { cookie: ordinaryMember } })).json().systemAdmin).toBeUndefined();
    await app.inject({ method: "POST", url: `/api/v1/system/administrators/${systemAdminCandidateId}/revoke`,
      headers: { cookie: administrator, origin: "http://localhost:5180" }, payload: {} });
    expect((await app.inject({ method: "GET", url: feedbackUrl, headers: { cookie: candidate } })).statusCode).toBe(404);
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
      payload: { email: " New.Member@Example.Test " },
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

    const preview = await app.inject({ method: "GET", url: `/api/v1/invitations/${resentToken}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      organizationName: "Arden Test Org",
      email: "new.member@example.test",
    });
    const invalidPreview = await app.inject({ method: "GET", url: `/api/v1/invitations/${token}` });
    expect(invalidPreview.statusCode).toBe(404);

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

    const unconfirmed = await app.inject({ method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" }, payload: { email: "unconfirmed@example.test", password: "synthetic-password" } });
    expect(unconfirmed.statusCode).toBe(403);
    expect(unconfirmed.json().error.code).toBe("EMAIL_NOT_CONFIRMED");

    const extraField = await app.inject({ method: "POST", url: "/api/v1/auth/sign-in", headers: { origin: "http://localhost:5180" }, payload: { email: "owner@example.test", password: "synthetic-password", userId: otherId } });
    expect(extraField.statusCode).toBe(400);
    expect(JSON.stringify(extraField.json())).not.toContain("userId");
  });

  it("keeps invitation account setup non-enumerating and never starts an authenticated session", async () => {
    const existing = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:5180" },
      payload: { email: "owner@example.test", password: "Synthetic-password1!", fullName: "Owner" },
    });
    const newAccount = await app.inject({
      method: "POST", url: "/api/v1/auth/sign-up", headers: { origin: "http://localhost:5180" },
      payload: { email: "new.member@example.test", password: "Synthetic-password1!", fullName: "New Member" },
    });
    expect(existing.statusCode).toBe(202);
    expect(newAccount.statusCode).toBe(202);
    expect(existing.json()).toEqual(newAccount.json());
    expect(JSON.stringify(existing.headers["set-cookie"] ?? "")).not.toContain("arden_access");
  });

  it("forwards trusted redirectTo for sign-up confirmation", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: {
        email: "invited.member@example.test",
        password: "Synthetic-password1!",
        fullName: "Invited Member",
        redirectTo: "http://localhost:5180/invite/test-token-123",
      },
    });
    expect(authProvider.lastSignUpCredentials?.redirectTo).toBe("http://localhost:5180/invite/test-token-123");

    await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: {
        email: "invited2@example.test",
        password: "Synthetic-password1!",
        fullName: "Invited Member 2",
        redirectTo: "https://evil.site/phish",
      },
    });
    expect(authProvider.lastSignUpCredentials?.redirectTo).toBeUndefined();
  });

  it("manages pending invitation lifecycle via http-only cookies across sign-up, preview, me, and sign-out", async () => {
    const validToken = "A".repeat(43);
    // 1. Sign up with invitation redirectTo sets the pending invitation cookie
    const signUpRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-up",
      headers: { origin: "http://localhost:5180" },
      payload: {
        email: "invited.cookie@example.test",
        password: "Synthetic-password1!",
        fullName: "Cookie Member",
        redirectTo: `http://localhost:5180/invite/${validToken}`,
      },
    });
    expect(signUpRes.statusCode).toBe(202);
    const signUpCookies = JSON.stringify(signUpRes.headers["set-cookie"] ?? "");
    expect(signUpCookies).toContain("arden_pending_invite=");
    expect(signUpCookies).toContain(validToken);
    expect(signUpCookies).toContain("HttpOnly");

    // 2. GET /api/v1/me returns pendingInvitationToken when cookie is present
    const session = await desktopSession(app, "invited.cookie@example.test");
    const meRes = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: {
        cookie: `${session}; arden_pending_invite=${validToken}`,
      },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().pendingInvitationToken).toBe(validToken);

    // 3. GET /api/v1/invitations/:token with 404 clears the cookie
    const notFoundPreview = await app.inject({
      method: "GET",
      url: `/api/v1/invitations/${"B".repeat(43)}`,
    });
    expect(notFoundPreview.statusCode).toBe(404);
    const notFoundCookies = JSON.stringify(notFoundPreview.headers["set-cookie"] ?? "");
    expect(notFoundCookies).toContain("arden_pending_invite=");
    expect(notFoundCookies).toContain("Max-Age=0");

    // 4. POST /api/v1/auth/sign-out clears the pending invitation cookie
    const signOutRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-out",
      headers: { origin: "http://localhost:5180", cookie: session },
    });
    expect(signOutRes.statusCode).toBe(204);
    const signOutCookies = JSON.stringify(signOutRes.headers["set-cookie"] ?? "");
    expect(signOutCookies).toContain("arden_pending_invite=");
    expect(signOutCookies).toContain("Max-Age=0");
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

  describe("private PDF items (decision 0034, spec F03-FILE)", () => {
    const pdf = (marker: string) => Buffer.from(`%PDF-1.4\n${marker}\n%%EOF\n`).toString("base64");
    const base = `/api/v1/organizations/${organizationId}/private-workspace/drafts`;
    const objects = async () => (await readdir(root)).sort();

    it("keeps an original PDF with its extracted text and serves the file only to the owner", async () => {
      const session = await desktopSession(app, "owner@example.test");
      const headers = { cookie: session, origin: "http://localhost:5180" };
      const created = await app.inject({ method: "POST", url: `${base}/pdf`, headers,
        payload: { title: " Board minutes ", pdfBase64: pdf("minutes"), text: "Decision: hire two engineers." } });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ title: "Board minutes", body: "", kind: "pdf", textAvailable: true,
        currentVersion: { mimeType: "application/pdf" } });
      expect((await objects()).filter((name) => name.endsWith(".pdf"))).toHaveLength(1);
      expect((await objects()).filter((name) => name.endsWith(".txt"))).toHaveLength(1);

      const read = await app.inject({ method: "GET", url: `${base}/${draftId}`, headers: { cookie: session } });
      expect(read.json()).toMatchObject({ kind: "pdf", body: "", textAvailable: true });
      const file = await app.inject({ method: "GET", url: `${base}/${draftId}/pdf`, headers: { cookie: session } });
      expect(file.statusCode).toBe(200);
      expect(file.headers["cache-control"]).toBe("no-store");
      expect(file.json().pdfBase64).toBe(pdf("minutes"));

      const other = await desktopSession(app, "other@example.test");
      const denied = await app.inject({ method: "GET", url: `${base}/${draftId}/pdf`, headers: { cookie: other } });
      expect(denied.statusCode).toBe(404);
      expect(JSON.stringify(denied.json())).not.toContain("minutes");
    });

    it("accepts a PDF without text and refuses files that are not PDFs or are too large, storing nothing", async () => {
      const session = await desktopSession(app, "owner@example.test");
      const headers = { cookie: session, origin: "http://localhost:5180" };
      const scan = await app.inject({ method: "POST", url: `${base}/pdf`, headers, payload: { title: "Scan", pdfBase64: pdf("scan"), text: "  " } });
      expect(scan.statusCode).toBe(201);
      expect(scan.json()).toMatchObject({ kind: "pdf", textAvailable: false });
      const before = await objects();
      const notPdf = await app.inject({ method: "POST", url: `${base}/pdf`, headers,
        payload: { title: "Fake", pdfBase64: Buffer.from("plain text, not a PDF").toString("base64") } });
      expect(notPdf.statusCode).toBe(400);
      expect(notPdf.json().error.code).toBe("INVALID_PDF");
      const large = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5 * 1024 * 1024), Buffer.from("\n%%EOF\n")]).toString("base64");
      const oversized = await app.inject({ method: "POST", url: `${base}/pdf`, headers, payload: { title: "Big", pdfBase64: large } });
      expect(oversized.statusCode).toBe(400);
      expect(await objects()).toEqual(before);
    });

    it("replaces the file under a version check, erases the old objects and keeps text notes and PDFs apart", async () => {
      const session = await desktopSession(app, "owner@example.test");
      const headers = { cookie: session, origin: "http://localhost:5180" };
      await app.inject({ method: "POST", url: `${base}/pdf`, headers, payload: { title: "Policy", pdfBase64: pdf("v1"), text: "First text" } });
      const stale = await app.inject({ method: "PUT", url: `${base}/${draftId}/pdf`, headers: { ...headers, "if-match": '"7"' },
        payload: { pdfBase64: pdf("v2"), text: "Second text" } });
      expect(stale.statusCode).toBe(412);
      expect((await objects()).filter((name) => name.endsWith(".pdf"))).toHaveLength(1);

      const replaced = await app.inject({ method: "PUT", url: `${base}/${draftId}/pdf`, headers: { ...headers, "if-match": '"1"' },
        payload: { pdfBase64: pdf("v2"), text: "Second text" } });
      expect(replaced.statusCode).toBe(200);
      expect(replaced.headers.etag).toBe('"2"');
      const file = await app.inject({ method: "GET", url: `${base}/${draftId}/pdf`, headers: { cookie: session } });
      expect(file.json().pdfBase64).toBe(pdf("v2"));

      const asText = await app.inject({ method: "PATCH", url: `${base}/${draftId}`, headers: { ...headers, "if-match": '"2"' }, payload: { body: "typed" } });
      expect(asText.statusCode).toBe(409);
      expect(asText.json().error.code).toBe("PDF_ITEM_NOT_EDITABLE");
      const renamed = await app.inject({ method: "PATCH", url: `${base}/${draftId}`, headers: { ...headers, "if-match": '"2"' }, payload: { title: "Policy 2027" } });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({ kind: "pdf", body: "" });

      await app.inject({ method: "POST", url: base, headers, payload: { title: "Text note", body: "words" } });
      const onText = await app.inject({ method: "PUT", url: `${base}/${draftId}/pdf`, headers: { ...headers, "if-match": '"1"' },
        payload: { pdfBase64: pdf("v3") } });
      expect(onText.statusCode).toBe(409);
      expect(onText.json().error.code).toBe("NOT_A_PDF_ITEM");
      const textNoteFile = await app.inject({ method: "GET", url: `${base}/${draftId}/pdf`, headers: { cookie: session } });
      expect(textNoteFile.statusCode).toBe(404);
    });
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

  describe("private notes organization, favorites and trash (decision 0029)", () => {
    const base = `/api/v1/organizations/${organizationId}/private-workspace`;
    const noteUrl = `${base}/drafts/${draftId}`;
    async function ownerHeaders() {
      return { cookie: await desktopSession(app, "owner@example.test"), origin: "http://localhost:5180" };
    }
    async function createCollection(headers: Record<string, string>, title: string, parentId: string | null = null) {
      const response = await app.inject({ method: "POST", url: `${base}/collections`, headers, payload: { title, parentId } });
      expect(response.statusCode).toBe(201);
      return response.json() as { id: string; title: string; parentId: string | null };
    }

    it("creates, renames and nests collections, rejecting a move into itself or a descendant", async () => {
      const headers = await ownerHeaders();
      const parent = await createCollection(headers, "  ");
      expect(parent.title).toBe("Untitled collection");
      const child = await createCollection(headers, "Child", parent.id);
      expect(child.parentId).toBe(parent.id);

      const renamed = await app.inject({ method: "PATCH", url: `${base}/collections/${parent.id}`, headers, payload: { title: " Projects " } });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json()).toMatchObject({ id: parent.id, title: "Projects", parentId: null, favoritedAt: null });
      for (const target of [parent.id, child.id]) {
        const cycle = await app.inject({ method: "PATCH", url: `${base}/collections/${parent.id}`, headers, payload: { parentId: target } });
        expect(cycle.statusCode).toBe(409);
        expect(cycle.json().error.code).toBe("COLLECTION_CYCLE");
      }
      const toRoot = await app.inject({ method: "PATCH", url: `${base}/collections/${child.id}`, headers, payload: { parentId: null } });
      expect(toRoot.json().parentId).toBeNull();
      expect((await app.inject({ method: "PATCH", url: `${base}/collections/${child.id}`, headers, payload: {} })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: `${base}/collections`, headers, payload: { title: "Orphan", parentId: otherId } })).statusCode).toBe(404);

      const list = await app.inject({ method: "GET", url: `${base}/collections`, headers });
      expect(list.statusCode).toBe(200);
      expect(list.headers["cache-control"]).toBe("no-store");
      expect(list.json().items.map((item: { title: string }) => item.title).sort()).toEqual(["Child", "Projects"]);
      expect(repository.privateOrganization.audit.map((event) => event.eventType)).toContain("PRIVATE_COLLECTION_UPDATED");
      expect(JSON.stringify(repository.privateOrganization.audit)).not.toContain("Projects");

      repository.privateOrganization.collectionLimit = 2;
      const overLimit = await app.inject({ method: "POST", url: `${base}/collections`, headers, payload: { title: "Third" } });
      expect(overLimit.statusCode).toBe(409);
      expect(overLimit.json().error.code).toBe("COLLECTION_LIMIT_REACHED");
      repository.privateOrganization.collectionLimit = 1_000;
    });

    it("returns a non-enumerating 404 to another member for every organization route", async () => {
      const owner = await ownerHeaders();
      const collection = await createCollection(owner, "Secret plans");
      const trashed = await app.inject({ method: "POST", url: `${base}/drafts/${draftId}/trash`, headers: owner });
      const batchId = trashed.json().batchId as string;
      const other = { cookie: await desktopSession(app, "other@example.test"), origin: "http://localhost:5180" };
      const attempts = [
        { method: "PATCH" as const, url: `${base}/collections/${collection.id}`, payload: { title: "Taken" } },
        { method: "PUT" as const, url: `${base}/collections/${collection.id}/favorite`, payload: { favorite: true } },
        { method: "POST" as const, url: `${base}/collections/${collection.id}/duplicate` },
        { method: "POST" as const, url: `${base}/collections/${collection.id}/trash` },
        { method: "POST" as const, url: `${base}/collections`, payload: { title: "Inside", parentId: collection.id } },
        { method: "PUT" as const, url: `${noteUrl}/collection`, payload: { collectionId: null } },
        { method: "PUT" as const, url: `${noteUrl}/favorite`, payload: { favorite: true } },
        { method: "POST" as const, url: `${noteUrl}/duplicate` },
        { method: "POST" as const, url: `${noteUrl}/trash` },
        { method: "PUT" as const, url: `${noteUrl}/archive`, payload: { archived: true } },
        { method: "PUT" as const, url: `${noteUrl}/collection`, payload: { collectionId: null, index: 0 } },
        { method: "POST" as const, url: `${base}/trash/${batchId}/restore` },
        { method: "POST" as const, url: `${base}/trash/${batchId}/purge` },
      ];
      for (const attempt of attempts) {
        const response = await app.inject({ ...attempt, headers: other });
        expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
        expect(response.json().error.code).toBe("RESOURCE_NOT_AVAILABLE");
      }
      for (const url of [`${base}/collections`, `${base}/trash`, `${base}/archive`]) {
        const response = await app.inject({ method: "GET", url, headers: other });
        expect(response.statusCode).toBe(200);
        expect(response.json().items).toEqual([]);
      }
      const foreign = await app.inject({ method: "GET", url: `/api/v1/organizations/${otherOrganizationId}/private-workspace/trash`, headers: owner });
      expect(foreign.statusCode).toBe(404);
      expect(repository.privateOrganization.isActiveCollection(collection.id)).toBe(true);
      expect((await app.inject({ method: "GET", url: `${base}/trash`, headers: owner })).json().items).toHaveLength(1);
    });

    it("moves notes between collections and root, and favorites notes and collections idempotently", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      const headers = await ownerHeaders();
      const collection = await createCollection(headers, "Research");
      const moved = await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id } });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ id: draftId, collectionId: collection.id, favoritedAt: null,
        currentVersion: { id: versionId, version: 2, mimeType: "text/plain" } });
      const read = await app.inject({ method: "GET", url: noteUrl, headers });
      expect(read.json()).toMatchObject({ collectionId: collection.id, favoritedAt: null });

      const first = await app.inject({ method: "PUT", url: `${noteUrl}/favorite`, headers, payload: { favorite: true } });
      const second = await app.inject({ method: "PUT", url: `${noteUrl}/favorite`, headers, payload: { favorite: true } });
      expect(first.json().favoritedAt).not.toBeNull();
      expect(second.json().favoritedAt).toBe(first.json().favoritedAt);
      const list = await app.inject({ method: "GET", url: `${base}/drafts`, headers });
      expect(list.json().items[0]).toMatchObject({ id: draftId, collectionId: collection.id, favoritedAt: first.json().favoritedAt });
      expect((await app.inject({ method: "PUT", url: `${noteUrl}/favorite`, headers, payload: { favorite: false } })).json().favoritedAt).toBeNull();
      const favoriteCollection = await app.inject({ method: "PUT", url: `${base}/collections/${collection.id}/favorite`, headers, payload: { favorite: true } });
      expect(favoriteCollection.json().favoritedAt).not.toBeNull();
      expect((await app.inject({ method: "PUT", url: `${noteUrl}/favorite`, headers, payload: { favorite: "yes" } })).statusCode).toBe(400);

      const toRoot = await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: null } });
      expect(toRoot.json().collectionId).toBeNull();
      await app.inject({ method: "POST", url: `${base}/collections/${collection.id}/trash`, headers });
      expect((await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `${base}/collections`, headers, payload: { title: "Nested", parentId: collection.id } })).statusCode).toBe(404);
      const created = await app.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { title: "New", body: "Body", collectionId: collection.id } });
      expect(created.statusCode).toBe(404);
    });

    it("places notes at an index of their collection order, clamping past the end (spec F03-ARR)", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      const headers = await ownerHeaders();
      const collection = await createCollection(headers, "Ordered");
      const store = repository.privateOrganization;
      for (const id of [otherDraftA, otherDraftB]) {
        store.addNote({ id, title: id, collectionId: collection.id, content: () => ({ versionId, version: 1, ...repository.currentSource }) });
      }
      const placed = await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id, index: 1 } });
      expect(placed.statusCode).toBe(200);
      expect(placed.json()).toMatchObject({ id: draftId, collectionId: collection.id, position: 2, archivedAt: null });
      expect(store.ordered(collection.id).map((note) => [note.id, note.position])).toEqual([[otherDraftB, 1], [draftId, 2], [otherDraftA, 3]]);
      // Without an index the note goes last; an index past the end is clamped.
      const last = await app.inject({ method: "PUT", url: `${base}/drafts/${otherDraftB}/collection`, headers, payload: { collectionId: collection.id } });
      expect(last.json().position).toBe(3);
      const clamped = await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id, index: 99 } });
      expect(clamped.json().position).toBe(3);
      for (const index of [-1, 1.5, "first", 2_000_000]) {
        const invalid = await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id, index } });
        expect(invalid.statusCode, String(index)).toBe(400);
      }
      const list = await app.inject({ method: "GET", url: `${base}/drafts`, headers });
      expect(list.json().items.find((item: { id: string }) => item.id === draftId)).toMatchObject({ position: 3 });
    });

    it("overwrites an open version and erases its old content, but keeps a contributed version's content (decision 0031)", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      const headers = await ownerHeaders();
      const before = repository.currentSource;
      const saved = await app.inject({ method: "PATCH", url: noteUrl, headers: { ...headers, "if-match": '"2"' }, payload: { body: "Autosaved body" } });
      expect(saved.statusCode).toBe(200);
      expect(saved.headers.etag).toBe('"3"');
      expect(saved.json()).toMatchObject({ body: "Autosaved body", currentVersion: { id: versionId, version: 3 } });
      await expect(storage.read(before.sourceUri, before.contentHash)).rejects.toThrow();
      const stale = await app.inject({ method: "PATCH", url: noteUrl, headers: { ...headers, "if-match": '"2"' }, payload: { body: "Stale" } });
      expect(stale.statusCode).toBe(412);

      repository.sourceVersionSealed = true;
      const contributed = repository.currentSource;
      await app.inject({ method: "PATCH", url: noteUrl, headers: { ...headers, "if-match": '"3"' }, payload: { body: "After contribution" } });
      await expect(storage.read(contributed.sourceUri, contributed.contentHash)).resolves.toBe("Autosaved body");
      repository.sourceVersionSealed = false;
    });

    it("archives a note out of the tree and lists, and unarchives it to its collection or the root (spec F03-ARR)", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      const headers = await ownerHeaders();
      const collection = await createCollection(headers, "Projects");
      await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id } });
      await app.inject({ method: "PUT", url: `${noteUrl}/favorite`, headers, payload: { favorite: true } });

      const archived = await app.inject({ method: "PUT", url: `${noteUrl}/archive`, headers, payload: { archived: true } });
      expect(archived.statusCode).toBe(200);
      expect(archived.headers["cache-control"]).toBe("no-store");
      expect(archived.json().archivedAt).not.toBeNull();
      const again = await app.inject({ method: "PUT", url: `${noteUrl}/archive`, headers, payload: { archived: true } });
      expect(again.json().archivedAt).toBe(archived.json().archivedAt);
      expect((await app.inject({ method: "GET", url: `${base}/drafts`, headers })).json().items).toEqual([]);
      // Archived notes are outside the tree: no favorite, move or duplicate until unarchived.
      expect((await app.inject({ method: "PUT", url: `${noteUrl}/favorite`, headers, payload: { favorite: false } })).statusCode).toBe(404);
      expect((await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: null } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `${noteUrl}/duplicate`, headers })).statusCode).toBe(404);
      // Trashing the collection leaves the archived note archived.
      const trashed = await app.inject({ method: "POST", url: `${base}/collections/${collection.id}/trash`, headers });
      expect(trashed.json().itemCount).toBe(1);

      const archive = await app.inject({ method: "GET", url: `${base}/archive`, headers });
      expect(archive.statusCode).toBe(200);
      expect(archive.headers["cache-control"]).toBe("no-store");
      expect(archive.json()).toEqual({ hasMore: false, items: [expect.objectContaining({
        id: draftId, title: "Review notes", collectionId: null, collectionTitle: null, archivedAt: archived.json().archivedAt })] });
      expect((await app.inject({ method: "PUT", url: `${noteUrl}/archive`, headers, payload: { archived: "no" } })).statusCode).toBe(400);

      const restored = await app.inject({ method: "PUT", url: `${noteUrl}/archive`, headers, payload: { archived: false } });
      expect(restored.json()).toMatchObject({ id: draftId, collectionId: null, archivedAt: null, position: null });
      expect(restored.json().favoritedAt).not.toBeNull();
      expect((await app.inject({ method: "GET", url: `${base}/archive`, headers })).json().items).toEqual([]);
      expect((await app.inject({ method: "GET", url: `${base}/drafts`, headers })).json().items).toHaveLength(1);
      expect(repository.privateOrganization.audit.map((event) => event.eventType))
        .toEqual(expect.arrayContaining(["PRIVATE_DRAFT_ARCHIVED", "PRIVATE_DRAFT_UNARCHIVED"]));
      expect(JSON.stringify(repository.privateOrganization.audit)).not.toContain("Review notes");

      // Delete from the Archived view is Move to trash, which clears the archive flag.
      await app.inject({ method: "PUT", url: `${noteUrl}/archive`, headers, payload: { archived: true } });
      const toTrash = await app.inject({ method: "POST", url: `${noteUrl}/trash`, headers });
      expect(toTrash.statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `${base}/archive`, headers })).json().items).toEqual([]);
      await app.inject({ method: "POST", url: `${base}/trash/${toTrash.json().batchId}/restore`, headers });
      expect((await app.inject({ method: "GET", url: `${base}/drafts`, headers })).json().items).toHaveLength(1);
    });

    it("hides a trashed note from get, patch, list and contribution, and restores it to the root when its collection is gone", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      let tick = Date.parse("2026-11-01T00:00:00.000Z");
      repository.privateOrganization.now = () => new Date(tick += 1_000);
      const headers = await ownerHeaders();
      const collection = await createCollection(headers, "Archive");
      await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id } });
      const trashed = await app.inject({ method: "POST", url: `${noteUrl}/trash`, headers });
      expect(trashed.statusCode).toBe(200);
      const entry = trashed.json();
      expect(entry).toMatchObject({ kind: "note", id: draftId, title: "Review notes", fromCollectionTitle: "Archive", itemCount: 1 });
      expect(Date.parse(entry.purgeAfter) - Date.parse(entry.trashedAt)).toBe(30 * 24 * 60 * 60 * 1000);

      expect((await app.inject({ method: "GET", url: noteUrl, headers })).statusCode).toBe(404);
      expect((await app.inject({ method: "PATCH", url: noteUrl, headers: { ...headers, "if-match": '"2"' }, payload: { body: "Edited" } })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `${noteUrl}/trash`, headers })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `${noteUrl}/duplicate`, headers })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: `${base}/drafts`, headers })).json().items).toEqual([]);
      const contribute = await app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/knowledge/drafts`,
        headers: { ...headers, "idempotency-key": createKey }, payload: { sourcePrivateVersionId: versionId, classification: "INTERNAL" } });
      expect(contribute.statusCode).toBe(404);
      expect(repository.sharedDraft).toBeNull();

      const collectionTrash = await app.inject({ method: "POST", url: `${base}/collections/${collection.id}/trash`, headers });
      expect(collectionTrash.json()).toMatchObject({ kind: "collection", itemCount: 1, fromCollectionTitle: null });
      const trash = await app.inject({ method: "GET", url: `${base}/trash`, headers });
      expect(trash.json().items.map((item: { kind: string }) => item.kind)).toEqual(["collection", "note"]);

      const restored = await app.inject({ method: "POST", url: `${base}/trash/${entry.batchId}/restore`, headers });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().notes).toEqual([expect.objectContaining({ id: draftId, collectionId: null })]);
      expect((await app.inject({ method: "GET", url: noteUrl, headers })).json()).toMatchObject({ body: "Private body", collectionId: null });
      expect((await app.inject({ method: "POST", url: `${base}/trash/${entry.batchId}/restore`, headers })).statusCode).toBe(404);
    });

    it("restores a trashed collection with its subtree into its still-active parent", async () => {
      const headers = await ownerHeaders();
      const parent = await createCollection(headers, "Parent");
      const child = await createCollection(headers, "Child", parent.id);
      await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: child.id } });
      const trashed = await app.inject({ method: "POST", url: `${base}/collections/${child.id}/trash`, headers });
      expect(trashed.json()).toMatchObject({ kind: "collection", id: child.id, fromCollectionTitle: "Parent", itemCount: 2 });
      expect((await app.inject({ method: "GET", url: `${base}/collections`, headers })).json().items).toHaveLength(1);
      const restored = await app.inject({ method: "POST", url: `${base}/trash/${trashed.json().batchId}/restore`, headers });
      expect(restored.json().collections).toEqual([expect.objectContaining({ id: child.id, parentId: parent.id })]);
      expect(restored.json().notes).toEqual([expect.objectContaining({ id: draftId, collectionId: child.id })]);
    });

    it("duplicates a note into a new content object and a collection with its whole subtree", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      const headers = await ownerHeaders();
      const duplicate = await app.inject({ method: "POST", url: `${noteUrl}/duplicate`, headers });
      expect(duplicate.statusCode).toBe(201);
      expect(duplicate.headers.etag).toBe('"1"');
      expect(duplicate.json()).toMatchObject({ title: "Review notes (copy)", body: "Private body", version: 1, collectionId: null });
      expect(duplicate.json().id).not.toBe(draftId);
      const copied = repository.privateOrganization.notes.get(duplicate.json().id)?.content();
      expect(copied?.sourceUri).not.toBe(repository.currentSource.sourceUri);
      expect(await storage.read(copied!.sourceUri, copied!.contentHash)).toBe("Private body");

      const root = await createCollection(headers, "Team");
      const nested = await createCollection(headers, "Nested", root.id);
      await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: nested.id } });
      const copy = await app.inject({ method: "POST", url: `${base}/collections/${root.id}/duplicate`, headers });
      expect(copy.statusCode).toBe(201);
      const result = copy.json();
      expect(result.collection).toMatchObject({ title: "Team (copy)", parentId: null });
      expect(result.collections).toHaveLength(2);
      const nestedCopy = result.collections.find((item: { title: string }) => item.title === "Nested");
      expect(nestedCopy.parentId).toBe(result.collection.id);
      expect(result.notes).toEqual([expect.objectContaining({ title: "Review notes", collectionId: nestedCopy.id })]);
      const copiedNote = repository.privateOrganization.notes.get(result.notes[0].id)?.content();
      expect(copiedNote?.sourceUri).not.toBe(repository.currentSource.sourceUri);
      expect(await storage.read(copiedNote!.sourceUri, copiedNote!.contentHash)).toBe("Private body");
      expect(repository.privateOrganization.notes.get(draftId)?.collectionId).toBe(nested.id);
    });

    it("purges a batch permanently: content objects are erased and the items never appear again", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      const headers = await ownerHeaders();
      const collection = await createCollection(headers, "Old");
      await app.inject({ method: "PUT", url: `${noteUrl}/collection`, headers, payload: { collectionId: collection.id } });
      const trashed = await app.inject({ method: "POST", url: `${base}/collections/${collection.id}/trash`, headers });
      const purge = await app.inject({ method: "POST", url: `${base}/trash/${trashed.json().batchId}/purge`, headers });
      expect(purge.statusCode).toBe(204);
      await expect(storage.read(repository.currentSource.sourceUri, repository.currentSource.contentHash)).rejects.toThrow();
      expect(repository.privateOrganization.notes.get(draftId)).toMatchObject({ status: "PURGED", title: "", contentPurged: true });
      expect((await app.inject({ method: "GET", url: `${base}/trash`, headers })).json().items).toEqual([]);
      expect((await app.inject({ method: "GET", url: `${base}/collections`, headers })).json().items).toEqual([]);
      expect((await app.inject({ method: "GET", url: noteUrl, headers })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `${base}/trash/${trashed.json().batchId}/restore`, headers })).statusCode).toBe(404);
      expect((await app.inject({ method: "POST", url: `${base}/trash/${trashed.json().batchId}/purge`, headers })).statusCode).toBe(404);
      const audit = repository.privateOrganization.audit.find((event) => event.eventType === "PRIVATE_ITEM_PURGED");
      expect(audit?.details).toMatchObject({ itemCount: 2 });
      expect(JSON.stringify(repository.privateOrganization.audit)).not.toMatch(/Old|Review notes|Private body/);
    });

    it("keeps the purge committed and reports success when content erasure fails", async () => {
      repository.currentSource = await storage.write(repository.currentBody);
      const headers = await ownerHeaders();
      const trashed = await app.inject({ method: "POST", url: `${noteUrl}/trash`, headers });
      vi.spyOn(storage, "remove").mockRejectedValueOnce(new Error("disk unavailable"));
      const purge = await app.inject({ method: "POST", url: `${base}/trash/${trashed.json().batchId}/purge`, headers });
      expect(purge.statusCode).toBe(204);
      expect(repository.privateOrganization.notes.get(draftId)).toMatchObject({ status: "PURGED", contentPurged: false });
      expect((await app.inject({ method: "GET", url: noteUrl, headers })).statusCode).toBe(404);
    });
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
    // The copy route returns the same draft representation as /drafts/new and the draft detail.
    const detail = await app.inject({ method: "GET", url: `${url}/${sharedDraftId}`, headers: { cookie: session } });
    const { body: _createdBody, ...createdFields } = created.json();
    const { body: _detailBody, ...detailFields } = detail.json();
    expect(Object.keys(createdFields).sort()).toEqual(Object.keys(detailFields).sort());
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
    expect(listed.json().items[0]).toMatchObject({ title: "Runbook", status: "ACTIVE", audienceIds: [] });
    expect(listed.json().items[0].audienceRoleIds).toBeUndefined();
    expect(JSON.stringify(listed.json())).not.toContain("arden-private-object");
    const reopened = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/knowledge/drafts/${sharedDraftId}`, headers });
    expect(reopened.statusCode).toBe(200);
    expect(semanticDocumentText(reopened.json().body)).toBe("Recovery steps");
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(200);
    expect(repository.sharedCreates).toBe(1);
    expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, title: "Other" } })).statusCode).toBe(409);
  });

  it("lists saved draft versions and reads old content only for the author", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const other = await desktopSession(app, "manager@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge/drafts`;
    const created = await app.inject({ method: "POST", url: `${root}/new`,
      headers: { cookie: owner, origin: "http://localhost:5180", "idempotency-key": createKey },
      payload: { title: "Runbook", body: "Original steps" } });
    expect(created.statusCode).toBe(201);
    const updated = await app.inject({ method: "PATCH", url: `${root}/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { body: "Revised steps" } });
    expect(updated.statusCode).toBe(200);
    const listUrl = `${root}/${sharedDraftId}/versions`;
    const listed = await app.inject({ method: "GET", url: listUrl, headers: { cookie: owner } });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toBe("no-store");
    expect(listed.json().items.map((item: { version: number }) => item.version)).toEqual([2, 1]);
    expect(JSON.stringify(listed.json())).not.toContain("arden-private-object");
    const old = await app.inject({ method: "GET", url: `${listUrl}/${sharedVersionId}`, headers: { cookie: owner } });
    expect(old.statusCode).toBe(200);
    expect(semanticDocumentText(old.json().body)).toBe("Original steps");
    expect(JSON.stringify(old.json())).not.toContain("arden-private-object");
    expect((await app.inject({ method: "GET", url: listUrl, headers: { cookie: other } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `${listUrl}/${sharedVersionId}`, headers: { cookie: other } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: listUrl })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `${listUrl}/${versionId}`, headers: { cookie: owner } })).statusCode).toBe(404);
  });

  it("accepts new drafts and reviewer grants without a classification (decision 0013)", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    const payload = { title: "Runbook", body: "Recovery steps" };
    const created = await app.inject({ method: "POST", url: `${root}/drafts/new`, headers, payload });
    expect(created.statusCode).toBe(201);
    expect(repository.sharedDraft?.classification).toBe("INTERNAL");
    expect((await app.inject({ method: "POST", url: `${root}/drafts/new`, headers, payload })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${root}/drafts/new`, headers,
      payload: { ...payload, classification: "SECRET" } })).statusCode).toBe(400);

    const grant = await app.inject({ method: "POST", url: `${root}/reviewer-grants`,
      headers: { cookie: session, origin: "http://localhost:5180" },
      payload: { reviewerMembershipId: otherId, departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", level: "STANDARD" } });
    expect(grant.statusCode).toBe(201);
    expect(repository.reviewerGrant?.classifications).toEqual(["INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);
    expect(repository.reviewerGrant).toMatchObject({ scope: "DEPARTMENT", level: "STANDARD" });
    const duplicate = await app.inject({ method: "POST", url: `${root}/reviewer-grants`,
      headers: { cookie: session, origin: "http://localhost:5180" },
      payload: { reviewerMembershipId: otherId, departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff" } });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("REVIEWER_GRANT_EXISTS");
  });

  it("creates whole-organization grants and rejects mismatched scope metadata (decision 0015)", async () => {
    const session = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/knowledge/reviewer-grants`;
    const headers = { cookie: session, origin: "http://localhost:5180" };
    const created = await app.inject({ method: "POST", url, headers,
      payload: { reviewerMembershipId: otherId, scope: "ORGANIZATION" } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ scope: "ORGANIZATION", departmentId: null, level: "STANDARD" });
    expect((await app.inject({ method: "POST", url, headers,
      payload: { reviewerMembershipId: otherId, scope: "ORGANIZATION",
        departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url, headers,
      payload: { reviewerMembershipId: otherId, scope: "DEPARTMENT" } })).statusCode).toBe(400);
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
    const historicPdf = await app.inject({ method: "GET",
      url: `${root}/drafts/${sharedDraftId}/versions/${sharedVersionId}`, headers: { cookie: owner } });
    expect(historicPdf.statusCode).toBe(200);
    expect(historicPdf.json()).toMatchObject({ version: 1, mimeType: "application/pdf", pdfBase64 });
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
    // Decision0027: an older client that still sends a Topic is refused rather than silently dropped.
    const withTopic = await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { management: { type: "Guide", topicId: "11111111-1111-4111-8111-111111111111", version: "1.0", expirationDate: null, changeNote: "" } } });
    expect(withTopic.statusCode).toBe(400);
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
      primaryDepartmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      organizationReviewerAvailable: false, audiences: [{ name: "Product members" }] });
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

  it.each([undefined, null, versionId])("accepts only Topic-free metadata input (legacy Topic: %s)", async topicId => {
    const session = await desktopSession(app, "owner@example.test");
    const headers = { cookie: session, origin: "http://localhost:5180", "idempotency-key": createKey };
    const root = `/api/v1/organizations/${organizationId}/knowledge/drafts`;
    expect((await app.inject({ method: "POST", url: `${root}/new`, headers,
      payload: { title: "Topic-free", body: "Synthetic guidance" } })).statusCode).toBe(201);
    const update = vi.spyOn(repository, "updateKnowledgeDraft");
    const management = { type: "Guide", version: "1.0", expirationDate: null, changeNote: "",
      ...(topicId === undefined ? {} : { topicId }) };
    const response = await app.inject({ method: "PATCH", url: `${root}/${sharedDraftId}`,
      headers: { ...headers, "if-match": '"1"' }, payload: { management } });
    expect(response.statusCode).toBe(topicId === undefined ? 200 : 400);
    if (topicId === undefined) expect(update.mock.calls[0]?.[4].management).toEqual(management);
    else expect(update).not.toHaveBeenCalled();
    // This checks the HTTP schema; real normalization/freezing is covered by PostgreSQL fixtures.
    expect(askArden.lastRequest).toBeNull();
  });

  it.each([
    { topicId: "malformed" }, { type: "Free text" }, { version: "x".repeat(31) },
    { effectiveDate: null }, { effectiveDate: "2027-01-01" },
  ])("rejects malformed metadata at the request boundary: %j", async invalid => {
    const session = await desktopSession(app, "owner@example.test");
    const update = vi.spyOn(repository, "updateKnowledgeDraft");
    const response = await app.inject({ method: "PATCH", url: `/api/v1/organizations/${organizationId}/knowledge/drafts/${sharedDraftId}`,
      headers: { cookie: session, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { management: { type: "Guide", version: "1.0", expirationDate: null, changeNote: "", ...invalid } } });
    expect(response.statusCode).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("replaces a PDF under the same draft identity and rejects stale, invalid and other-author writes", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const other = await desktopSession(app, "manager@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge/drafts`;
    const headers = { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' };
    const original = Buffer.from("%PDF-1.4\noriginal\n%%EOF\n").toString("base64");
    const replacement = Buffer.from("%PDF-1.4\nreplacement\n%%EOF\n").toString("base64");
    expect((await app.inject({ method: "POST", url: `${root}/pdf`, headers: { ...headers, "idempotency-key": createKey },
      payload: { title: "Versioned PDF", pdfBase64: original } })).statusCode).toBe(201);
    const url = `${root}/${sharedDraftId}`;
    expect((await app.inject({ method: "PATCH", url, headers: { ...headers, cookie: other }, payload: { pdfBase64: replacement } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url, headers, payload: { pdfBase64: Buffer.from("not a PDF").toString("base64") } })).statusCode).toBe(400);
    const updated = await app.inject({ method: "PATCH", url, headers, payload: { pdfBase64: replacement } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: sharedDraftId, pdfBase64: replacement, currentVersion: { version: 2, mimeType: "application/pdf" } });
    expect((await app.inject({ method: "PATCH", url, headers, payload: { pdfBase64: original } })).statusCode).toBe(412);
    expect((await app.inject({ method: "GET", url, headers: { cookie: owner } })).json().pdfBase64).toBe(replacement);
  });

  it("keeps an empty editor draft saveable but refuses to submit it as knowledge", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge/drafts`;
    const headers = { cookie: owner, origin: "http://localhost:5180", "idempotency-key": createKey };
    expect((await app.inject({ method: "POST", url: `${root}/new`, headers, payload: { title: "Incomplete", body: "   " } })).statusCode).toBe(201);
    const result = await app.inject({ method: "POST", url: `${root}/${sharedDraftId}/submit`, headers: { ...headers, "if-match": '"1"' } });
    expect(result.statusCode).toBe(409);
    expect(result.json().error.message).toBe("Add document content before submitting.");
  });

  describe("Target Readers on draft save (T1.4)", () => {
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    async function createDraft() {
      const session = await desktopSession(app, "owner@example.test");
      const headers = { cookie: session, origin: "http://localhost:5180" };
      const created = await app.inject({ method: "POST", url: `${root}/drafts/new`,
        headers: { ...headers, "idempotency-key": createKey },
        payload: { title: "Readers", body: "Body", classification: "INTERNAL" } });
      expect(created.statusCode).toBe(201);
      return headers;
    }
    const save = (headers: Record<string, string>, version: number, payload: object) => app.inject({
      method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { ...headers, "if-match": `"${version}"` }, payload });

    it.each([
      { name: "1 member", targetReaders: { mode: "SELECTED_MEMBERS", memberIds: activeMemberIds.slice(0, 1) },
        field: "targetReaders.memberIds" },
      { name: "101 members", targetReaders: { mode: "SELECTED_MEMBERS", memberIds: activeMemberIds },
        field: "targetReaders.memberIds" },
      { name: "a suspended member", targetReaders: { mode: "SELECTED_MEMBERS",
        memberIds: [activeMemberIds[0], suspendedMemberId] }, field: "targetReaders.memberIds" },
      { name: "a member of another organization", targetReaders: { mode: "SELECTED_MEMBERS",
        memberIds: [activeMemberIds[0], foreignMemberId] }, field: "targetReaders.memberIds" },
      { name: "an archived department", targetReaders: { mode: "DEPARTMENT", departmentId: archivedDepartmentId },
        field: "targetReaders.departmentId" },
      { name: "a department without an ID", targetReaders: { mode: "DEPARTMENT" },
        field: "targetReaders.departmentId" },
      { name: "a repeated member", targetReaders: { mode: "SELECTED_MEMBERS",
        memberIds: [activeMemberIds[0], activeMemberIds[0]] }, field: "targetReaders.memberIds" },
    ])("rejects $name with 400 and a field error, leaving the draft unchanged", async ({ targetReaders, field }) => {
      const headers = await createDraft();
      const response = await save(headers, 1, { targetReaders });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatchObject({ code: "INVALID_TARGET_READERS", field });
      const reread = await app.inject({ method: "GET", url: `${root}/drafts/${sharedDraftId}`, headers });
      expect(reread.headers.etag).toBe('"1"');
      expect(reread.json().targetReaders).toBeNull();
    });

    it.each([
      { mode: "SELECTED_MEMBERS", departmentId: null,
        memberIds: [activeMemberIds[2], activeMemberIds[0], activeMemberIds[1]] },
      { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: activeMemberIds.slice(0, 100) },
      { mode: "DEPARTMENT", departmentId: engineeringDepartmentId, memberIds: [] },
      { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
    ])("saves valid $mode readers with 200 and reads them back unchanged", async (targetReaders) => {
      const headers = await createDraft();
      const response = await save(headers, 1, { targetReaders });
      expect(response.statusCode).toBe(200);
      expect(response.json().targetReaders).toEqual(targetReaders);
      const reread = await app.inject({ method: "GET", url: `${root}/drafts/${sharedDraftId}`, headers });
      expect(reread.json().targetReaders).toEqual(targetReaders);
      const listed = await app.inject({ method: "GET", url: `${root}/drafts`, headers });
      expect(listed.json().items[0].targetReaders).toEqual(targetReaders);
    });

    it("keeps saved readers when a later save omits them and freezes them at submit", async () => {
      const headers = await createDraft();
      const targetReaders = { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: activeMemberIds.slice(0, 2) };
      expect((await save(headers, 1, { targetReaders })).statusCode).toBe(200);
      const later = await save(headers, 2, { title: "Readers v2", responsibleDepartmentId: salesDepartmentId,
        targetScopeType: "DEPARTMENT", audienceIds: ["11111111-aaaa-4aaa-8aaa-111111111111"] });
      expect(later.statusCode).toBe(200);
      expect(later.json().targetReaders).toEqual(targetReaders);
      const submit = await app.inject({ method: "POST", url: `${root}/drafts/${sharedDraftId}/submit`,
        headers: { ...headers, "idempotency-key": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "if-match": '"3"' } });
      expect(submit.statusCode).toBe(201);
      expect(submit.json().proposedTargetReaders).toEqual(targetReaders);
    });
  });

  it("returns the pending queue with version and author plus the reviewer's decided submissions (REV-02)", async () => {
    repository.sharedSubmission = { id: "abababab-abab-4aba-8aba-abababababab", draftId: sharedDraftId,
      snapshotVersionId: sharedVersionId, title: "Runbook", classification: "INTERNAL",
      responsibleDepartmentId: salesDepartmentId, targetScopeType: "ORGANIZATION", targetDepartmentId: null,
      audienceRoleIds: [], proposedTargetReaders: null, approvedTargetReaders: null, contentHash: "a".repeat(64),
      status: "PENDING_REVIEW", publicationState: "NONE", submittedAt: new Date("2026-11-10T09:00:00.000Z"),
      requestType: "CONTENT", requestReason: null,
      publishedVersionId: null, decisionComment: null, publicationFailure: null, withdrawal: null };
    repository.reviewerGrant = { id: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", reviewerMembershipId: otherId, scope: "DEPARTMENT",
      departmentId: salesDepartmentId, classifications: ["INTERNAL"], level: "STANDARD", teamTag: null, projectTag: null,
      status: "ACTIVE", validFrom: new Date("2026-11-01T00:00:00.000Z"), validUntil: null };
    repository.decidedReviews = [{ submissionId: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd", title: "Old policy",
      departmentId: salesDepartmentId, classification: "INTERNAL", versionNo: 4, decision: "REJECTED",
      decidedAt: new Date("2026-11-09T10:00:00.000Z"), submittedAt: new Date("2026-11-08T10:00:00.000Z"),
      publicationState: "NONE", authorName: "Owner" }];
    const reviewer = { cookie: await desktopSession(app, "manager@example.test"), origin: "http://localhost:5180" };
    const response = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/knowledge/reviews`, headers: reviewer });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [expect.objectContaining({ title: "Runbook", versionNo: 2, authorName: "Owner",
        submittedAt: "2026-11-10T09:00:00.000Z" })],
      decided: [expect.objectContaining({ title: "Old policy", decision: "REJECTED", versionNo: 4, authorName: "Owner",
        decidedAt: "2026-11-09T10:00:00.000Z", submittedAt: "2026-11-08T10:00:00.000Z" })],
    });
    const other = await app.inject({ method: "GET", url: `/api/v1/organizations/${otherOrganizationId}/knowledge/reviews`, headers: reviewer });
    expect(other.statusCode).toBe(404);
  });

  describe("Approve with approved readers (T2.1)", () => {
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const reviewKey = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    const engineeringMembers = activeMemberIds.slice(0, 5);
    const salesMember = activeMemberIds[20]!;
    type Readers = { mode: string; departmentId?: string | null; memberIds?: string[] };

    /** Owner submits a draft with the given proposed readers; manager receives a reviewer grant. */
    async function submitted(proposed: Readers | null) {
      const owner = { cookie: await desktopSession(app, "owner@example.test"), origin: "http://localhost:5180" };
      const reviewer = { cookie: await desktopSession(app, "manager@example.test"), origin: "http://localhost:5180" };
      expect((await app.inject({ method: "POST", url: `${root}/drafts/new`, headers: { ...owner, "idempotency-key": createKey },
        payload: { title: "Readers runbook", body: "Body", classification: "INTERNAL" } })).statusCode).toBe(201);
      const saved = await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
        headers: { ...owner, "if-match": '"1"' }, payload: { responsibleDepartmentId: salesDepartmentId,
          targetScopeType: "ORGANIZATION", audienceIds: ["11111111-aaaa-4aaa-8aaa-111111111111"],
          ...(proposed ? { targetReaders: proposed } : {}) } });
      expect(saved.statusCode).toBe(200);
      const submit = await app.inject({ method: "POST", url: `${root}/drafts/${sharedDraftId}/submit`,
        headers: { ...owner, "idempotency-key": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "if-match": '"2"' } });
      expect(submit.statusCode).toBe(201);
      expect((await app.inject({ method: "POST", url: `${root}/reviewer-grants`, headers: owner,
        payload: { reviewerMembershipId: otherId, departmentId: salesDepartmentId } })).statusCode).toBe(201);
      const submissionId: string = submit.json().id;
      const decide = (payload: Record<string, unknown>, key = reviewKey, headers = reviewer) => app.inject({
        method: "POST", url: `${root}/reviews/${submissionId}/decisions`, headers: { ...headers, "idempotency-key": key },
        payload: { action: "APPROVE", expectedSnapshotVersionId: saved.json().currentVersion.id,
          expectedContentHash: saved.json().currentVersion.contentHash, ...payload } });
      return { owner, reviewer, submissionId, decide };
    }

    it("returns the proposed readers to the reviewer and approves them as proposed by default", async () => {
      const proposed = { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: activeMemberIds.slice(0, 3) };
      const { owner, reviewer, submissionId, decide } = await submitted(proposed);
      const detail = await app.inject({ method: "GET", url: `${root}/reviews/${submissionId}`, headers: reviewer });
      expect(detail.json().proposedReaders).toEqual({ mode: "SELECTED_MEMBERS", department: null,
        members: proposed.memberIds.map((membershipId) => ({ membershipId, displayName: `Member ${membershipId.slice(-3)}` })) });
      expect((await app.inject({ method: "GET", url: `${root}/reviews/${submissionId}`, headers: owner })).statusCode).toBe(404);
      const approved = await decide({});
      expect(approved.statusCode).toBe(201);
      expect(approved.json().approvedTargetReaders).toEqual(proposed);
      const myWork = await app.inject({ method: "GET", url: `${root}/submissions`, headers: owner });
      expect(myWork.json().items[0]).toMatchObject({ proposedTargetReaders: proposed, approvedTargetReaders: proposed });
    });

    it("narrows 10 proposed members to 5 and refuses adding an outsider", async () => {
      const proposed = { mode: "SELECTED_MEMBERS", memberIds: activeMemberIds.slice(0, 10) };
      const { decide } = await submitted(proposed);
      const widened = await decide({ approvedReaders: { mode: "SELECTED_MEMBERS",
        memberIds: [...activeMemberIds.slice(0, 5), activeMemberIds[30]!] } });
      expect(widened.statusCode).toBe(409);
      expect(widened.json().error.code).toBe("READERS_WIDENED");
      expect(repository.sharedSubmission?.status).toBe("PENDING_REVIEW");
      const narrowed = await decide({ approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: activeMemberIds.slice(0, 5) } });
      expect(narrowed.statusCode).toBe(201);
      expect(narrowed.json()).toMatchObject({ status: "APPROVED", proposedTargetReaders: { memberIds: activeMemberIds.slice(0, 10) },
        approvedTargetReaders: { mode: "SELECTED_MEMBERS", memberIds: activeMemberIds.slice(0, 5) } });
    });

    it("keeps a Department proposal within the department", async () => {
      const { decide } = await submitted({ mode: "DEPARTMENT", departmentId: engineeringDepartmentId });
      for (const approvedReaders of [{ mode: "ORGANIZATION" },
        { mode: "SELECTED_MEMBERS", memberIds: [engineeringMembers[0]!, salesMember] }]) {
        const response = await decide({ approvedReaders });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("READERS_WIDENED");
      }
      const narrowed = await decide({ approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: engineeringMembers.slice(0, 2) } });
      expect(narrowed.statusCode).toBe(201);
    });

    it.each([
      { name: "one member", approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: [activeMemberIds[0]] }, field: "approvedReaders.memberIds" },
      { name: "a repeated member", approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: [activeMemberIds[0], activeMemberIds[0]] }, field: "approvedReaders.memberIds" },
      { name: "a suspended member", approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: [activeMemberIds[0], suspendedMemberId] }, field: "approvedReaders.memberIds" },
      { name: "another organization's member", approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: [activeMemberIds[0], foreignMemberId] }, field: "approvedReaders.memberIds" },
      { name: "an archived department", approvedReaders: { mode: "DEPARTMENT", departmentId: archivedDepartmentId }, field: "approvedReaders.departmentId" },
    ])("returns 400 INVALID_READERS for $name", async ({ approvedReaders, field }) => {
      const { decide } = await submitted({ mode: "ORGANIZATION" });
      const response = await decide({ approvedReaders });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatchObject({ code: "INVALID_READERS", field });
      expect(repository.sharedSubmission?.status).toBe("PENDING_REVIEW");
    });

    it("refuses readers on a rejection and on a legacy audience submission", async () => {
      const targetReaders = await submitted({ mode: "ORGANIZATION" });
      const reject = await targetReaders.decide({ action: "REJECT", comment: "Clarify", approvedReaders: { mode: "ORGANIZATION" } });
      expect(reject.statusCode).toBe(400);
      expect(reject.json().error.code).toBe("INVALID_REQUEST");
      expect((await targetReaders.decide({ action: "REJECT", comment: " " })).json().error.code).toBe("COMMENT_REQUIRED");
    });

    it("keeps legacy audience approvals unchanged", async () => {
      const { decide } = await submitted(null);
      const refused = await decide({ approvedReaders: { mode: "ORGANIZATION" } });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.code).toBe("READERS_NOT_SUPPORTED");
      const approved = await decide({});
      expect(approved.statusCode).toBe(201);
      expect(approved.json()).toMatchObject({ proposedTargetReaders: null, approvedTargetReaders: null });
    });

    it("replays the same key and readers, and conflicts on different readers", async () => {
      const { decide } = await submitted({ mode: "SELECTED_MEMBERS", memberIds: activeMemberIds.slice(0, 4) });
      const approvedReaders = { mode: "SELECTED_MEMBERS", memberIds: [activeMemberIds[1]!, activeMemberIds[0]!] };
      expect((await decide({ approvedReaders })).statusCode).toBe(201);
      const sameSet = await decide({ approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: [activeMemberIds[0]!, activeMemberIds[1]!] } });
      expect(sameSet.statusCode).toBe(200);
      const different = await decide({ approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: activeMemberIds.slice(2, 4) } });
      expect(different.statusCode).toBe(409);
      expect(different.json().error.code).toBe("REVIEW_CONFLICT");
    });

    it("answers an unauthorized caller with 404 before looking at readers", async () => {
      const { owner, decide } = await submitted({ mode: "SELECTED_MEMBERS", memberIds: activeMemberIds.slice(0, 4) });
      const response = await decide({ approvedReaders: { mode: "ORGANIZATION" } }, "cccccccc-dddd-4eee-8fff-aaaaaaaaaaaa", owner);
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("RESOURCE_NOT_AVAILABLE");
    });
  });

  describe("Target Readers enforced by the API, not only RLS (T1.3)", () => {
    const root = `/api/v1/organizations/${organizationId}`;
    const otherGenerationId = "13131313-1313-4131-8131-131313131313";
    const missingVersionId = "14141414-1414-4141-8141-141414141414";
    // The synthetic repository returns these rows to the owner, as if RLS allowed them;
    // only TargetReaderPolicy in the route can hide them.
    async function publish(targetReaders: PublishedKnowledge["targetReaders"]) {
      const stored = await storage.write("Restricted runbook");
      repository.publication = { id: versionId, draftId: sharedDraftId, title: "Restricted runbook",
        classification: "INTERNAL", responsibleDepartmentId: engineeringDepartmentId,
        responsibleDepartmentName: "Engineering",
        contentHash: stored.contentHash, sourceUri: stored.sourceUri, audienceRoleIds: [], targetReaders,
        publishedAt: new Date("2026-11-01T00:00:00.000Z"), validFrom: new Date("2026-11-01T00:00:00.000Z"),
        validUntil: null };
      repository.authorizedAiSources = [{
        generationId, snapshotVersionId: sharedVersionId, snapshotContentHash: "a".repeat(64),
        publishedVersionId: versionId, draftId: sharedDraftId, title: "Restricted runbook", versionNo: 1,
        classification: "INTERNAL", targetScopeType: "DEPARTMENT", targetReaders,
        chunks: [{ ...evidenceManifest, chunkId: "b".repeat(64), sourceBlockIds: ["mfa"], parentSectionBlockId: null }],
      }];
    }
    async function ownerHeaders() {
      return { cookie: await desktopSession(app, "owner@example.test"), origin: "http://localhost:5180" };
    }

    describe("publication scope foundation (KM2-P1)", () => {
      const organizationReaders = { mode: "ORGANIZATION" as const, departmentId: null, memberIds: [] };
      const departmentReaders = { mode: "DEPARTMENT" as const, departmentId: salesDepartmentId, memberIds: [] };
      const selectedReaders = { mode: "SELECTED_MEMBERS" as const, departmentId: null, memberIds: [otherId, ownerId] };

      it.each([
        { scope: "ORGANIZATION", readers: organizationReaders, expected: 1 },
        { scope: "ORGANIZATION", readers: departmentReaders, expected: 0 },
        { scope: "ORGANIZATION", readers: selectedReaders, expected: 0 },
        { scope: "ORGANIZATION", readers: null, expected: 0 },
        { scope: "SHARED", readers: organizationReaders, expected: 0 },
        { scope: "SHARED", readers: departmentReaders, expected: 1 },
        { scope: "SHARED", readers: selectedReaders, expected: 1 },
        { scope: "SHARED", readers: null, expected: 0 },
        { scope: "ALL_READABLE", readers: organizationReaders, expected: 1 },
        { scope: "ALL_READABLE", readers: departmentReaders, expected: 1 },
        { scope: "ALL_READABLE", readers: selectedReaders, expected: 1 },
        { scope: "ALL_READABLE", readers: null, expected: 1 },
      ])("filters $scope by approved readers $readers, not responsible department", async ({ scope, readers, expected }) => {
        await publish(readers);
        const before = structuredClone(repository.publication);
        const response = await app.inject({ method: "GET", url: `${root}/knowledge/published?scope=${scope}`, headers: await ownerHeaders() });
        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.json().items).toHaveLength(expected);
        expect(repository.publication).toEqual(before);
        expect(response.body).not.toContain(otherId);
        expect(response.body).not.toContain("sourceUri");
        if (expected) expect(response.json().items[0]).toMatchObject({ id: versionId, draftId: sharedDraftId,
          responsibleDepartmentName: "Engineering" });
        expect(askArden.lastRequest).toBeNull();
      });

      it("returns disjoint common/shared subsets from a mixed authorized corpus without rewriting metadata", async () => {
        await publish(organizationReaders);
        const base = repository.publication!;
        const common = { ...base, management: null };
        const shared = { ...base, id: missingVersionId, targetReaders: selectedReaders };
        const legacy = { ...base, id: otherGenerationId, targetReaders: null };
        const list = vi.spyOn(repository, "listPublishedKnowledge").mockResolvedValue([common, shared, legacy]);
        const headers = await ownerHeaders();
        const read = async (query: string) => (await app.inject({ method: "GET", url: `${root}/knowledge/published${query}`, headers })).json().items;
        expect((await read("?scope=ORGANIZATION")).map((item: { id: string }) => item.id)).toEqual([versionId]);
        expect((await read("?scope=SHARED")).map((item: { id: string }) => item.id)).toEqual([missingVersionId]);
        expect(await read("")).toEqual(await read("?scope=ALL_READABLE"));
        expect(await read("")).toHaveLength(3);
        expect((await read("?scope=ORGANIZATION"))[0].management).toBeNull();
        expect(list).toHaveBeenCalledWith(ownerId, organizationId);
      });

      it.each(["ALL_READABLE", "ORGANIZATION", "SHARED"])("does not let %s bypass current authorization", async scope => {
        await publish({ mode: "DEPARTMENT", departmentId: engineeringDepartmentId, memberIds: [] });
        const headers = await ownerHeaders();
        const read = () => app.inject({ method: "GET", url: `${root}/knowledge/published?scope=${scope}`, headers });
        expect((await read()).json().items).toEqual([]);
        repository.readerActors.set(ownerId, { membershipId: ownerId, organizationId,
          status: "SUSPENDED", departmentIds: [engineeringDepartmentId] });
        expect((await read()).json().items).toEqual([]);
        repository.readerActors.set(ownerId, { membershipId: ownerId, organizationId: otherOrganizationId,
          status: "ACTIVE", departmentIds: [engineeringDepartmentId] });
        expect((await read()).json().items).toEqual([]);
      });

      it.each(["PRIVATE", "organization", "", "ORGANIZATION&scope=SHARED"])("rejects invalid/duplicate scope %s", async scope => {
        const read = vi.spyOn(repository, "listPublishedKnowledge");
        const response = await app.inject({ method: "GET", url: `${root}/knowledge/published?scope=${scope}`, headers: await ownerHeaders() });
        expect(response.statusCode).toBe(400);
        expect(read).not.toHaveBeenCalled();
      });

      it("rechecks reader changes between requests instead of caching a scope grant", async () => {
        await publish(selectedReaders);
        const headers = await ownerHeaders();
        const read = async () => (await app.inject({ method: "GET", url: `${root}/knowledge/published?scope=SHARED`, headers })).json().items;
        expect(await read()).toHaveLength(1);
        repository.publication = { ...repository.publication!, targetReaders: {
          ...selectedReaders, memberIds: [otherId, activeMemberIds[0]] } };
        expect(await read()).toEqual([]);
        await publish(departmentReaders);
        expect(await read()).toHaveLength(1);
        repository.readerActors.set(ownerId, { membershipId: ownerId, organizationId,
          status: "ACTIVE", departmentIds: [engineeringDepartmentId] });
        expect(await read()).toEqual([]);
      });

      it("keeps scope requests behind sign-in and organization membership", async () => {
        const anonymous = await app.inject({ method: "GET", url: `${root}/knowledge/published?scope=ORGANIZATION` });
        expect(anonymous.statusCode).toBe(401);
        const foreign = await app.inject({ method: "GET", url: `/api/v1/organizations/${otherOrganizationId}/knowledge/published?scope=SHARED`, headers: await ownerHeaders() });
        expect(foreign.statusCode).toBe(404);
        expect(foreign.json().error.code).toBe("RESOURCE_NOT_AVAILABLE");
      });
    });

    it.each([
      { name: "a member outside the Department", readers: { mode: "DEPARTMENT" as const,
        departmentId: engineeringDepartmentId, memberIds: [] } },
      { name: "a member not in Selected Members", readers: { mode: "SELECTED_MEMBERS" as const,
        departmentId: null, memberIds: [otherId, activeMemberIds[0]] } },
    ])("hides the document from $name in list, detail and Ask Arden", async ({ readers }) => {
      await publish(readers);
      const headers = await ownerHeaders();
      const list = await app.inject({ method: "GET", url: `${root}/knowledge/published`, headers });
      expect(list.statusCode).toBe(200);
      expect(list.json().items).toEqual([]);

      const detail = await app.inject({ method: "GET", url: `${root}/knowledge/published/${versionId}`, headers });
      const missing = await app.inject({ method: "GET", url: `${root}/knowledge/published/${missingVersionId}`, headers });
      expect(detail.statusCode).toBe(404);
      expect(missing.statusCode).toBe(404);
      expect(detail.json().error.code).toBe("RESOURCE_NOT_AVAILABLE");
      expect(detail.json().error.code).toBe(missing.json().error.code);
      expect(detail.json().error.message).toBe(missing.json().error.message);
      expect(detail.body).not.toContain("Restricted runbook");

      const answer = await app.inject({ method: "POST", url: `${root}/ai/answers`, headers,
        payload: { query: "What does the runbook say?" } });
      expect(answer.statusCode).toBe(200);
      expect(answer.json()).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", citations: [] });
      expect(askArden.lastRequest).toBeNull();
    });

    it("never cites an unreadable document even if the AI service returns it", async () => {
      await publish({ mode: "DEPARTMENT", departmentId: engineeringDepartmentId, memberIds: [] });
      repository.authorizedAiSources.push({ ...repository.authorizedAiSources[0]!, generationId: otherGenerationId,
        publishedVersionId: missingVersionId, targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] } });
      const answer = await app.inject({ method: "POST", url: `${root}/ai/answers`, headers: await ownerHeaders(),
        payload: { query: "What does the runbook say?" } });
      expect(askArden.lastRequest?.allowedGenerationIds).toEqual([otherGenerationId]);
      expect(answer.statusCode).toBe(409);
      expect(answer.body).not.toContain("Restricted runbook");
    });

    it.each([
      { name: "a Department member", readers: { mode: "DEPARTMENT" as const,
        departmentId: salesDepartmentId, memberIds: [] } },
      { name: "a selected member", readers: { mode: "SELECTED_MEMBERS" as const,
        departmentId: null, memberIds: [otherId, ownerId] } },
      { name: "any active member for Organization", readers: { mode: "ORGANIZATION" as const,
        departmentId: null, memberIds: [] } },
      { name: "a legacy publication without readers", readers: null },
    ])("lets $name list, open and cite the document", async ({ readers }) => {
      await publish(readers);
      const headers = await ownerHeaders();
      const list = await app.inject({ method: "GET", url: `${root}/knowledge/published`, headers });
      expect(list.json().items).toHaveLength(1);
      expect(list.json().items[0].responsibleDepartmentName).toBe("Engineering");
      expect(JSON.stringify(list.json())).not.toContain(otherId);
      const detail = await app.inject({ method: "GET", url: `${root}/knowledge/published/${versionId}`, headers });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().body).toBe("Restricted runbook");
      expect(detail.json().responsibleDepartmentName).toBe("Engineering");
      expect(detail.json().targetReaders).toEqual(readers ? { mode: readers.mode, departmentId: readers.departmentId } : null);
      const answer = await app.inject({ method: "POST", url: `${root}/ai/answers`, headers,
        payload: { query: "What does the runbook say?" } });
      expect(answer.statusCode).toBe(200);
      expect(askArden.lastRequest?.allowedGenerationIds).toEqual([generationId]);
      expect(answer.json().citations).toHaveLength(1);
    });

    it("denies a suspended member and a member whose department changed", async () => {
      await publish({ mode: "DEPARTMENT", departmentId: salesDepartmentId, memberIds: [] });
      const headers = await ownerHeaders();
      repository.readerActors.set(ownerId, { membershipId: ownerId, organizationId, status: "ACTIVE",
        departmentIds: [engineeringDepartmentId] });
      expect((await app.inject({ method: "GET", url: `${root}/knowledge/published/${versionId}`, headers })).statusCode).toBe(404);
      repository.readerActors.set(ownerId, { membershipId: ownerId, organizationId, status: "SUSPENDED",
        departmentIds: [salesDepartmentId] });
      expect((await app.inject({ method: "GET", url: `${root}/knowledge/published/${versionId}`, headers })).statusCode).toBe(404);
    });
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

  it("lets only the author withdraw a pending submission and refuses a decided one (T5.1)", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const reviewer = await desktopSession(app, "manager@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    expect((await app.inject({ method: "POST", url: `${root}/drafts/new`,
      headers: { cookie: owner, origin: "http://localhost:5180", "idempotency-key": createKey },
      payload: { title: "Runbook", body: "First version", classification: "INTERNAL" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "PATCH", url: `${root}/drafts/${sharedDraftId}`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"1"' },
      payload: { responsibleDepartmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        targetScopeType: "DEPARTMENT", audienceIds: ["11111111-aaaa-4aaa-8aaa-111111111111"] } })).statusCode).toBe(200);
    const submitted = await app.inject({ method: "POST", url: `${root}/drafts/${sharedDraftId}/submit`,
      headers: { cookie: owner, origin: "http://localhost:5180", "if-match": '"2"',
        "idempotency-key": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" } });
    expect(submitted.statusCode).toBe(201);
    const withdrawUrl = `${root}/submissions/${submitted.json().id}/withdraw`;

    expect((await app.inject({ method: "POST", url: withdrawUrl,
      headers: { cookie: reviewer, origin: "http://localhost:5180" } })).statusCode).toBe(404);
    const withdrawn = await app.inject({ method: "POST", url: withdrawUrl,
      headers: { cookie: owner, origin: "http://localhost:5180" } });
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.json()).toMatchObject({ id: submitted.json().id, status: "WITHDRAWN" });
    expect((await app.inject({ method: "POST", url: withdrawUrl,
      headers: { cookie: owner, origin: "http://localhost:5180" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${root}/submissions/not-a-uuid/withdraw`,
      headers: { cookie: owner, origin: "http://localhost:5180" } })).statusCode).toBe(400);
  });

  describe("decision 0023 governance routes", () => {
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const as = async (email: string) => ({ cookie: await desktopSession(app, email), origin: "http://localhost:5180" });

    it("lists metadata only to an Organization Admin and opens an audited inspection with a reason", async () => {
      const owner = await as("owner@example.test");
      const stored = await storage.write("Inspected body");
      repository.governanceSource = { sourceUri: stored.sourceUri, contentHash: stored.contentHash };
      expect((await app.inject({ method: "GET", url: `${root}/governance/publications`, headers: owner })).statusCode).toBe(404);

      repository.governanceAdmin = true;
      const catalog = await app.inject({ method: "GET", url: `${root}/governance/publications`, headers: owner });
      expect(catalog.statusCode).toBe(200);
      expect(catalog.headers["cache-control"]).toBe("no-store");
      const [item] = catalog.json().items;
      expect(item).toMatchObject({ documentId: sharedDraftId, readerMode: "SELECTED_MEMBERS", openReports: 1, readable: false });
      expect(Object.keys(item)).not.toEqual(expect.arrayContaining(["readerNames"]));
      expect(JSON.stringify(item)).not.toContain("Avery");

      const open = (reason: string) => app.inject({ method: "POST", url: `${root}/governance/publications/${sharedDraftId}/inspections`,
        headers: owner, payload: { reason } });
      expect((await open("  ")).statusCode).toBe(400);
      const opened = await open("Reported salary data");
      expect(opened.statusCode).toBe(201);
      const inspection = await app.inject({ method: "GET", url: `${root}/governance/inspections/${opened.json().inspectionId}`, headers: owner });
      expect(inspection.statusCode).toBe(200);
      expect(inspection.json()).toMatchObject({ documentId: sharedDraftId, body: "Inspected body", reason: "Reported salary data",
        readers: { mode: "SELECTED_MEMBERS", names: ["Avery Reader", "Blake Reader"] } });
      const ended = await app.inject({ method: "GET", url: `${root}/governance/inspections/34343434-3434-4343-8343-343434343434`, headers: owner });
      expect(ended.statusCode).toBe(404);
      expect(ended.json().error.code).toBe("INSPECTION_ENDED");

      repository.governanceAdmin = false;
      expect((await open("Reported salary data")).statusCode).toBe(404);
    });

    it("sends an Admin who already reads the document to the Library instead of an inspection", async () => {
      const owner = await as("owner@example.test");
      repository.governanceAdmin = true;
      const stored = await storage.write("Readable");
      repository.publication = { id: versionId, draftId: sharedDraftId, title: "Readable", classification: "INTERNAL",
        responsibleDepartmentId: salesDepartmentId, responsibleDepartmentName: "Sales", contentHash: stored.contentHash,
        sourceUri: stored.sourceUri, audienceRoleIds: [], targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
        publishedAt: new Date("2026-11-01T00:00:00.000Z"), validFrom: new Date("2026-11-01T00:00:00.000Z"), validUntil: null };
      const catalog = await app.inject({ method: "GET", url: `${root}/governance/publications`, headers: owner });
      expect(catalog.json().items[0].readable).toBe(true);
      const opened = await app.inject({ method: "POST", url: `${root}/governance/publications/${sharedDraftId}/inspections`,
        headers: owner, payload: { reason: "Check" } });
      expect(opened.statusCode).toBe(409);
      expect(opened.json().error.code).toBe("ALREADY_A_READER");
    });

    it("keeps the responsible reviewer view but reserves direct withdrawal for an Admin", async () => {
      const owner = await as("owner@example.test");
      const reviewer = await as("manager@example.test");
      const stored = await storage.write("Responsible body");
      repository.governanceSource = { sourceUri: stored.sourceUri, contentHash: stored.contentHash };
      const view = `${root}/documents/${sharedDraftId}/responsible-view`;
      expect((await app.inject({ method: "GET", url: view, headers: owner })).statusCode).toBe(404);
      const seen = await app.inject({ method: "GET", url: view, headers: reviewer });
      expect(seen.statusCode).toBe(200);
      expect(seen.json()).toMatchObject({ body: "Responsible body", readers: { mode: "SELECTED_MEMBERS" } });
      expect(seen.json().readers.names).toBeUndefined();

      const withdraw = (headers: Record<string, string>, reason: string) => app.inject({ method: "POST",
        url: `${root}/documents/${sharedDraftId}/withdrawal`, headers, payload: { reason } });
      expect((await withdraw(owner, "Not mine")).statusCode).toBe(404);
      expect((await withdraw(reviewer, "Wrong figures")).statusCode).toBe(404);
      expect(repository.withdrawnDocuments).toEqual([]);
      repository.governanceAdmin = true;
      expect((await withdraw(owner, " ")).json().error.code).toBe("INVALID_REASON");
      const withdrawn = await withdraw(owner, "Wrong figures");
      expect(withdrawn.statusCode).toBe(200);
      expect(withdrawn.json()).toEqual({ status: "WITHDRAWN" });
      expect((await withdraw(owner, "Wrong figures")).statusCode).toBe(404);
    });

    it("lets a reader report a problem once, and the responsible reviewer list and dismiss it", async () => {
      const owner = await as("owner@example.test");
      const reviewer = await as("manager@example.test");
      const stored = await storage.write("Reported");
      repository.publication = { id: versionId, draftId: sharedDraftId, title: "Reported", classification: "INTERNAL",
        responsibleDepartmentId: salesDepartmentId, responsibleDepartmentName: "Sales", contentHash: stored.contentHash,
        sourceUri: stored.sourceUri, audienceRoleIds: [], targetReaders: { mode: "DEPARTMENT", departmentId: engineeringDepartmentId, memberIds: [] },
        publishedAt: new Date("2026-11-01T00:00:00.000Z"), validFrom: new Date("2026-11-01T00:00:00.000Z"), validUntil: null };
      const report = (message: string) => app.inject({ method: "POST", url: `${root}/published/${versionId}/reports`,
        headers: owner, payload: { message } });
      expect((await report("Wrong figures")).statusCode).toBe(404);

      repository.publication = { ...repository.publication, targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] } };
      expect((await report("   ")).json().error.code).toBe("INVALID_MESSAGE");
      expect((await report("Wrong figures")).statusCode).toBe(201);
      const again = await report("Still wrong");
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe("ALREADY_REPORTED");

      const listed = await app.inject({ method: "GET", url: `${root}/reports`, headers: reviewer });
      expect(listed.statusCode).toBe(200);
      const [item] = listed.json().items;
      expect(item).toMatchObject({ documentId: sharedDraftId, message: "Wrong figures", canView: true });
      const dismiss = () => app.inject({ method: "POST", url: `${root}/reports/${item.id}/dismiss`, headers: reviewer });
      expect((await dismiss()).json()).toEqual({ status: "CLOSED" });
      expect((await dismiss()).statusCode).toBe(404);
    });
  });

  it("lets only the author retry a temporarily failed publication and explains other outcomes (T6.3 retry)", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const reviewer = await desktopSession(app, "manager@example.test");
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const failed: SharedKnowledgeSubmission = { id: "abababab-abab-4aba-8aba-abababababab", draftId: sharedDraftId,
      snapshotVersionId: sharedVersionId, title: "Runbook", classification: "INTERNAL",
      responsibleDepartmentId: salesDepartmentId, targetScopeType: "ORGANIZATION", targetDepartmentId: null,
      audienceRoleIds: [], proposedTargetReaders: null, approvedTargetReaders: null, contentHash: "a".repeat(64),
      status: "APPROVED", publicationState: "FAILED", submittedAt: new Date("2026-11-10T09:00:00.000Z"),
      publishedVersionId: null, decisionComment: null, requestType: "CONTENT", requestReason: null,
      publicationFailure: "TEMPORARY", withdrawal: null };
    const url = `${root}/submissions/${failed.id}/publication-retry`;
    const post = (cookie: string, target = url) => app.inject({ method: "POST", url: target,
      headers: { cookie, origin: "http://localhost:5180" } });

    repository.sharedSubmission = { ...failed, publicationFailure: "CONTENT" };
    const content = await post(owner);
    expect(content.statusCode).toBe(409);
    expect(content.json().error.code).toBe("PUBLICATION_NOT_RETRYABLE");

    repository.sharedSubmission = failed;
    expect((await post(reviewer)).statusCode).toBe(404);
    const retried = await post(owner);
    expect(retried.statusCode).toBe(200);
    expect(retried.headers["cache-control"]).toBe("no-store");
    expect(retried.json()).toMatchObject({ id: failed.id, publicationState: "PREPARING", publicationFailure: null });
    expect((await post(owner)).statusCode).toBe(200);

    repository.sharedSubmission = { ...failed, publicationState: "ACTIVE", publicationFailure: null, withdrawal: null };
    expect((await post(owner)).json().error.code).toBe("PUBLICATION_NOT_FAILED");
    expect((await post(owner, `${root}/submissions/not-a-uuid/publication-retry`)).statusCode).toBe(400);
  });

  it("accepts reader-change and withdrawal requests only for a published document (T6.1)", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/knowledge/documents/${sharedDraftId}/change-requests`;
    const headers = { cookie: owner, origin: "http://localhost:5180", "idempotency-key": "dededede-dede-4ede-8ede-dededededede" };
    const send = (payload: object, extra: Record<string, string> = headers) => app.inject({ method: "POST", url, headers: extra, payload });

    expect((await send({ type: "WITHDRAWAL", reason: "Outdated" }, { cookie: owner, origin: "http://localhost:5180" })).statusCode).toBe(400);
    expect((await send({ type: "ARCHIVE", reason: "Outdated" })).statusCode).toBe(400);
    expect((await send({ type: "WITHDRAWAL" })).statusCode).toBe(400);
    const unpublished = await send({ type: "WITHDRAWAL", reason: "Outdated" });
    expect(unpublished.statusCode).toBe(409);
    expect(unpublished.json().error.code).toBe("DOCUMENT_NOT_PUBLISHED");

    repository.sharedSubmission = { id: "abababab-abab-4aba-8aba-abababababab", draftId: sharedDraftId,
      snapshotVersionId: sharedVersionId, title: "Runbook", classification: "INTERNAL",
      responsibleDepartmentId: salesDepartmentId, targetScopeType: "ORGANIZATION", targetDepartmentId: null,
      audienceRoleIds: [], proposedTargetReaders: null, approvedTargetReaders: null, contentHash: "a".repeat(64),
      status: "APPROVED", publicationState: "ACTIVE", submittedAt: new Date("2026-11-10T09:00:00.000Z"),
      publishedVersionId: "efefefef-efef-4efe-8efe-efefefefefef", decisionComment: null,
      requestType: "CONTENT", requestReason: null, publicationFailure: null, withdrawal: null };
    expect((await send({ type: "READER_CHANGE", reason: "Narrow it" })).statusCode).toBe(400);
    const requested = await send({ type: "WITHDRAWAL", reason: "The policy was replaced" });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toMatchObject({ status: "PENDING_REVIEW", requestType: "WITHDRAWAL",
      requestReason: "The policy was replaced" });
  });

  it("refuses to delete a department that still owns current publications (0032 D)", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/departments/${salesDepartmentId}/delete`;
    repository.departmentPublications = 3;
    const refused = await app.inject({ method: "POST", url, headers: { cookie: owner, origin: "http://localhost:5180" } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: "DEPARTMENT_OWNS_PUBLICATIONS", publicationCount: 3,
      message: "This department owns 3 published documents. Withdraw them before deleting it." });
    repository.departmentPublications = 0;
    expect((await app.inject({ method: "POST", url, headers: { cookie: owner, origin: "http://localhost:5180" } })).statusCode).toBe(200);
  });

  it("refuses a reviewer decision during the author's renewal window with a safe 409 (0032)", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    repository.authorDecisionWindow = true;
    const response = await app.inject({ method: "POST",
      url: `/api/v1/organizations/${organizationId}/knowledge/reviews/c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1/decisions`,
      headers: { cookie: owner, origin: "http://localhost:5180", "idempotency-key": "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2" },
      payload: { action: "APPROVE", expectedSnapshotVersionId: sharedVersionId, expectedContentHash: "a".repeat(64) } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("AUTHOR_DECISION_WINDOW");
    repository.authorDecisionWindow = false;
  });

  it("hides an expired publication from readers and explains an old link instead of serving it (0032 A)", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const headers = { cookie: owner, origin: "http://localhost:5180" };
    const root = `/api/v1/organizations/${organizationId}/knowledge`;
    const stored = await storage.write("Expired body");
    const publicationId = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";
    repository.publication = { id: publicationId, draftId: sharedDraftId, title: "Travel policy", classification: "INTERNAL",
      responsibleDepartmentId: salesDepartmentId, responsibleDepartmentName: "Sales", contentHash: stored.contentHash,
      sourceUri: stored.sourceUri, audienceRoleIds: [], targetReaders: { mode: "ORGANIZATION", departmentId: null, memberIds: [] },
      management: { type: "Policy & Standard", version: "1.0", expirationDate: "2026-11-01", changeNote: "" },
      publishedAt: new Date("2026-10-01T00:00:00.000Z"), validFrom: new Date("2026-10-01T00:00:00.000Z"), validUntil: null,
      expired: true, authorName: "Avery Author" };
    const listed = await app.inject({ method: "GET", url: `${root}/published`, headers });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([]);
    const opened = await app.inject({ method: "GET", url: `${root}/published/${publicationId}`, headers });
    expect(opened.statusCode).toBe(410);
    expect(opened.json().error).toMatchObject({ code: "DOCUMENT_EXPIRED", expiredOn: "2026-11-01", ownerDepartmentName: "Sales",
      message: "This document expired on Nov 1, 2026. Contact Sales." });
    expect(JSON.stringify(opened.json())).not.toContain("Expired body");
    const reported = await app.inject({ method: "POST", url: `${root}/published/${publicationId}/reports`, headers,
      payload: { message: "Out of date" } });
    expect(reported.statusCode).toBe(404);

    repository.publication = { ...repository.publication!, expired: false };
    const current = await app.inject({ method: "GET", url: `${root}/published`, headers });
    expect(current.json().items[0]).toMatchObject({ id: publicationId, authorName: "Avery Author",
      management: { expirationDate: "2026-11-01" } });
    expect((await app.inject({ method: "GET", url: `${root}/published/${publicationId}`, headers })).statusCode).toBe(200);
  });

  it("accepts a reviewed renewal request with an idempotency key and maps refusals (0032 B)", async () => {
    const owner = await desktopSession(app, "owner@example.test");
    const url = `/api/v1/organizations/${organizationId}/knowledge/documents/${sharedDraftId}/renewal`;
    const headers = { cookie: owner, origin: "http://localhost:5180", "idempotency-key": "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1" };
    const send = (payload: object, extra: Record<string, string> = headers) => app.inject({ method: "POST", url, headers: extra, payload });
    expect((await send({ expirationDate: "2027-06-30", reason: "Still valid" }, { cookie: owner, origin: "http://localhost:5180" })).statusCode).toBe(400);
    expect((await send({ expirationDate: "2027-06-30" })).statusCode).toBe(400);
    expect((await send({ expirationDate: "2027-06-30", reason: "Still valid", readers: [] })).statusCode).toBe(400);
    repository.sharedSubmission = { id: "abababab-abab-4aba-8aba-abababababab", draftId: sharedDraftId,
      snapshotVersionId: sharedVersionId, title: "Runbook", classification: "INTERNAL",
      responsibleDepartmentId: salesDepartmentId, targetScopeType: "ORGANIZATION", targetDepartmentId: null,
      audienceRoleIds: [], proposedTargetReaders: null, approvedTargetReaders: null, contentHash: "a".repeat(64),
      status: "APPROVED", publicationState: "ACTIVE", submittedAt: new Date("2026-11-10T09:00:00.000Z"),
      publishedVersionId: "efefefef-efef-4efe-8efe-efefefefefef", decisionComment: null,
      requestType: "CONTENT", requestReason: null, publicationFailure: null, withdrawal: null };
    const requested = await send({ expirationDate: "2027-06-30", reason: " Reviewed again " });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toMatchObject({ status: "PENDING_REVIEW", requestType: "RENEWAL", requestReason: "Reviewed again",
      renewal: { expirationDate: "2027-06-30", onBehalfOfAuthor: false } });
    expect(repository.renewalInputs.at(-1)).toEqual({ expirationDate: "2027-06-30", reason: " Reviewed again ",
      idempotencyKey: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1" });
    const refusals: Array<[RequestPublicationRenewalResult["kind"], number, string]> = [
      ["not-yet", 409, "RENEWAL_NOT_YET_AVAILABLE"], ["pending", 409, "RENEWAL_PENDING"],
      ["not-renewable", 409, "NOT_RENEWABLE"], ["invalid-date", 400, "INVALID_EXPIRATION_DATE"],
      ["invalid-reason", 400, "INVALID_REASON"], ["not-found", 404, "RESOURCE_NOT_AVAILABLE"]];
    for (const [kind, status, code] of refusals) {
      repository.renewalResult = kind;
      const refused = await send({ expirationDate: null, reason: "Keep it" });
      expect(refused.statusCode).toBe(status);
      expect(refused.json().error.code).toBe(code);
    }
    repository.renewalState = [{ documentId: sharedDraftId, publishedVersionId: "efefefef-efef-4efe-8efe-efefefefefef",
      title: "Runbook", responsibleDepartmentId: salesDepartmentId, expirationDate: "2026-11-30", renewalPending: false,
      authorActive: true, isAuthor: true, canRenew: true, authorName: "Avery Author", pending: null }];
    const state = await app.inject({ method: "GET", url: `/api/v1/organizations/${organizationId}/knowledge/renewals`,
      headers: { cookie: owner, origin: "http://localhost:5180" } });
    expect(state.statusCode).toBe(200);
    expect(state.json().items).toEqual(repository.renewalState);
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
  lastResetRedirectTo: string | null = null;
  resetFailure: string | null = null;
  lastUpdatedPassword: { token: string; password: string } | null = null;
  lastSignUpCredentials: SupabaseSignUp | null = null;
  rotatedSession: { accessToken: string; refreshToken: string; expiresIn: number } | null = null;
  private readonly usersByAccessToken = new Map<string, { userId: string; email: string; passwordSetupRequired: boolean }>();

  async signIn(credentials: { email: string; password: string }) {
    if (credentials.email === "unconfirmed@example.test") throw new Error("EMAIL_NOT_CONFIRMED");
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

  async signUp(credentials?: SupabaseSignUp) {
    if (credentials) this.lastSignUpCredentials = credentials;
    if (this.signUpBehavior === "already_exists") throw new Error("USER_ALREADY_EXISTS");
    if (this.signUpBehavior === "rejected") throw new Error("SIGNUP_REJECTED");
    return { tokens: null, emailVerified: false };
  }

  async resolveSession(tokens: { accessToken: string }) {
    const user = this.usersByAccessToken.get(tokens.accessToken);
    if (user && this.rotatedSession) this.usersByAccessToken.set(this.rotatedSession.accessToken, user);
    return user ? { kind: "authenticated" as const, ...user, fullName: user.userId === ownerId ? "Owner" : null,
      emailVerified: true, ...(this.rotatedSession ? { rotatedSession: this.rotatedSession } : {}) }
      : { kind: "unauthenticated" as const };
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

  async resetPasswordForEmail(email: string, redirectTo?: string) {
    if (this.resetFailure) throw new Error(this.resetFailure);
    this.lastResetEmail = email;
    this.lastResetRedirectTo = redirectTo ?? null;
  }

  async updateUserPassword(tokens: { accessToken: string }, newPassword: string) {
    if (newPassword === "rejected-password" || newPassword.length < 8) throw new Error("PASSWORD_UPDATE_REJECTED");
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

  async canAccess(actorUserId: string) {
    return this.administrators.some(item => item.userId === actorUserId && item.status === "ACTIVE");
  }

  async privateFeedback(actorUserId: string) {
    this.authorize(actorUserId);
    return [{ weekStart: "2026-11-23", good: 2, bad: 1 }];
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
  lastRequest: RetrievalRequest | null = null;
  onAnswer: (() => void) | null = null;
  sourceBlockIds = ["mfa"];

  async retrieve(request: RetrievalRequest): Promise<RetrievalResponse> {
    this.lastRequest = request;
    return { contractVersion: 2, requestId: request.requestId, standaloneQuery: request.query, retrievalMode: "HYBRID",
      evidence: [{ generationId, snapshotVersionId: sharedVersionId, snapshotContentHash: "a".repeat(64),
        chunkId: "b".repeat(64), content: evidenceText, ...evidenceManifest,
        sourceBlockIds: this.sourceBlockIds, parentSectionBlockId: null, label: "" }] };
  }
  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    this.onAnswer?.();
    return { contractVersion: 2, requestId: request.requestId, status: "ANSWERED", answer: "MFA is required by the security policy.",
      citations: [{ chunkId: "b".repeat(64), quote: evidenceText }], usedEvidence: request.evidence.map((chunk) => chunk.chunkId) };
  }
}

class MemoryRepository implements ArdenDataRepository {
  readonly conversations = new MemoryConversationStore();
  readonly audienceGroups: AudienceGroupStore = new MemoryAudienceGroupStore();
  readonly systemAdministration: SystemAdministrationStore = new MemorySystemAdministrationStore();
  readonly privateOrganization = new MemoryPrivateOrganizationStore({ organizationId, ownerId, memberIds: [otherId] });
  constructor() {
    this.privateOrganization.addNote({ id: draftId, title: "Review notes",
      content: () => ({ versionId, version: this.currentVersion, ...this.currentSource }) });
  }
  createdOrganization: { userId: string; email: string; name: string } | null = null;
  pendingInvitation: { invitationId: string; email: string; tokenHash: string; expiresAt: Date; accepted: boolean } | null = null;
  currentBody = "Private body";
  currentVersion = 2;
  currentSource: StoredContentFields = { sourceUri: "arden-private-object://dddddddd-dddd-4ddd-8ddd-dddddddddddd", mimeType: "text/plain", contentHash: "not-used-in-forged-note" };
  sharedDraft: SharedKnowledgeDraft | null = null;
  sharedVersions: KnowledgeDraftVersion[] = [];
  sharedSubmission: SharedKnowledgeSubmission | null = null;
  reviewerGrant: ReviewerGrantRecord | null = null;
  publication: PublishedKnowledge | null = null;
  authorizedAiSources: AuthorizedAiSource[] = [];
  /** TargetReaderPolicy actors. Both synthetic users belong to the same organization. */
  readerActors = new Map<string, ReaderActor>([
    [ownerId, { membershipId: ownerId, organizationId, status: "ACTIVE", departmentIds: [salesDepartmentId] }],
    [otherId, { membershipId: otherId, organizationId, status: "ACTIVE", departmentIds: [engineeringDepartmentId] }],
  ]);
  /** What the real repository would resolve for draft Target Readers validation. */
  selectionFacts: SelectionFacts = {
    organizationId,
    departments: [
      { departmentId: engineeringDepartmentId, organizationId, status: "ACTIVE" },
      { departmentId: archivedDepartmentId, organizationId, status: "ARCHIVED" },
    ],
    members: [
      ...activeMemberIds.map((membershipId, index) => ({ membershipId, organizationId, status: "ACTIVE" as const,
        accountActive: true, departmentIds: [index < 5 ? engineeringDepartmentId : salesDepartmentId] })),
      { membershipId: suspendedMemberId, organizationId, status: "SUSPENDED", accountActive: true },
    ],
  };
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

  async createOrganization(userId: string, email: string, _fullName: string | null, setup: OrganizationSetup): Promise<CreatedOrganization> {
    this.createdOrganization = { userId, email, name: setup.name };
    return {
      organizationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: setup.name,
      departmentId: setup.departmentName ? "ffffffff-ffff-4fff-8fff-ffffffffffff" : null,
      departmentName: setup.departmentName ?? null,
    };
  }

  async getOrganizationAdministration(userId: string, requestedOrganization: string): Promise<OrganizationAdminData | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    return {
      departments: [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "Product", defaultRoleId: "11111111-aaaa-4aaa-8aaa-111111111111", defaultRoleName: "Product Member" }],
      roles: [{ id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Product Member", code: "DEPT_DEFAULT_TEST", isDefault: true }],
      members: [{ id: "77777777-7777-4777-8777-777777777777", email: "owner@example.test", name: "Owner", status: "ACTIVE", departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", isOrganizationAdmin: true, roleIds: ["global-org-admin"], roleNames: ["Organization Admin"] }],
      invitations: [],
    };
  }

  async getKnowledgeOptions(userId: string, requestedOrganization: string): Promise<KnowledgeOptions | null> {
    if ((userId !== ownerId && userId !== otherId) || requestedOrganization !== organizationId) return null;
    return {
      departments: [{ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "Product" }],
      primaryDepartmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      organizationReviewerAvailable: false,
      audiences: [{ id: "11111111-aaaa-4aaa-8aaa-111111111111", name: "Product members",
        departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", kind: "DEPARTMENT_ALL" }],
    };
  }

  async createDepartment(userId: string, requestedOrganization: string, _name: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }
  async deleteDepartment(userId: string, requestedOrganization: string, _departmentId: string): Promise<DeleteDepartmentResult> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return { success: false, errorReason: "NOT_FOUND" };
    if (this.departmentPublications > 0) return { success: false, errorReason: "OWNS_PUBLICATIONS", publicationCount: this.departmentPublications };
    return { success: true, unassignedCount: 0, reassignedCount: 0 };
  }
  async changePrimaryDepartment(userId: string, requestedOrganization: string, _membershipId: string, _departmentId: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }

  async createInvitation(userId: string, requestedOrganization: string, _departmentId: string | null | undefined, email: string, tokenHash: string, expiresAt: Date): Promise<{ invitationId: string; email: string; organizationName: string; expiresAt: Date } | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
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

  async getInvitationByToken(tokenHash: string): Promise<{ invitationId: string; organizationName: string; email: string; expiresAt: Date } | null> {
    const invite = this.pendingInvitation;
    if (!invite || invite.accepted || invite.expiresAt <= new Date() || invite.tokenHash !== tokenHash) return null;
    return { invitationId: invite.invitationId, organizationName: "Arden Test Org", email: invite.email, expiresAt: invite.expiresAt };
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
    return { items: this.privateOrganization.activeNotes(), nextCursor: null };
  }

  async getDraft(userId: string, requestedOrganization: string, requestedDraft: string): Promise<PrivateDraft | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId || requestedDraft !== draftId) return null;
    if (this.privateOrganization.hidden(draftId)) return null;
    return this.note();
  }

  async getPrivateContributionSource(userId: string, requestedOrganization: string, requestedVersion: string): Promise<PrivateContributionSource | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId || requestedVersion !== versionId) return null;
    if (this.privateOrganization.hidden(draftId)) return null;
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
      targetReaders: null, versionId: sharedVersionId, sourceUri: input.copiedContent.sourceUri,
      mimeType: input.copiedContent.mimeType, contentHash: input.copiedContent.contentHash,
      currentVersion: 1, hasPendingSubmission: false, createdAt: new Date("2026-10-10T09:00:00.000Z"), updatedAt: new Date("2026-10-10T09:00:00.000Z"),
    };
    this.sharedVersions = [{ id: sharedVersionId, version: 1,
      sourceUri: input.copiedContent.sourceUri, mimeType: input.copiedContent.mimeType,
      contentHash: input.copiedContent.contentHash, createdAt: this.sharedDraft.createdAt }];
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
      teamTag: null, projectTag: null, audienceRoleIds: [], targetReaders: null, versionId: sharedVersionId,
      sourceUri: input.content.sourceUri, mimeType: input.content.mimeType, contentHash: input.content.contentHash,
      currentVersion: 1, hasPendingSubmission: false, createdAt: new Date("2026-10-10T09:00:00.000Z"), updatedAt: new Date("2026-10-10T09:00:00.000Z"),
    };
    this.sharedVersions = [{ id: sharedVersionId, version: 1,
      sourceUri: input.content.sourceUri, mimeType: input.content.mimeType,
      contentHash: input.content.contentHash, createdAt: this.sharedDraft.createdAt }];
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

  async listKnowledgeDraftVersions(userId: string, requestedOrganization: string,
    requestedDraft: string): Promise<KnowledgeDraftVersion[] | null> {
    if (!await this.getKnowledgeDraft(userId, requestedOrganization, requestedDraft)) return null;
    return [...this.sharedVersions].reverse();
  }

  async getKnowledgeDraftVersion(userId: string, requestedOrganization: string,
    requestedDraft: string, requestedVersion: string): Promise<KnowledgeDraftVersion | null> {
    if (!await this.getKnowledgeDraft(userId, requestedOrganization, requestedDraft)) return null;
    return this.sharedVersions.find((version) => version.id === requestedVersion) ?? null;
  }

  async updateKnowledgeDraft(userId: string, requestedOrganization: string, requestedDraft: string,
    expectedVersion: number, patch: SharedDraftPatch, content: StoredContentFields | null): Promise<UpdateSharedDraftResult> {
    const draft = await this.getKnowledgeDraft(userId, requestedOrganization, requestedDraft);
    if (!draft) return { kind: "not-found" };
    if (draft.currentVersion !== expectedVersion) return { kind: "conflict", currentVersion: draft.currentVersion };
    let targetReaders = draft.targetReaders;
    if (patch.targetReaders !== undefined) {
      const validation = validateSelection(patch.targetReaders, this.selectionFacts);
      if (!validation.ok) return { kind: "invalid-target-readers", field: validation.field, reason: validation.reason };
      targetReaders = validation.selection;
    }
    this.sharedDraft = {
      ...draft, title: patch.title ?? draft.title, classification: patch.classification ?? draft.classification,
      responsibleDepartmentId: patch.responsibleDepartmentId === undefined ? draft.responsibleDepartmentId : patch.responsibleDepartmentId,
      targetScopeType: patch.targetScopeType === undefined ? draft.targetScopeType : patch.targetScopeType,
      teamTag: patch.teamTag === undefined ? draft.teamTag : patch.teamTag,
      projectTag: patch.projectTag === undefined ? draft.projectTag : patch.projectTag,
      audienceRoleIds: patch.audienceRoleIds ?? draft.audienceRoleIds,
      targetReaders,
      sourceUri: content?.sourceUri ?? draft.sourceUri,
      contentHash: content?.contentHash ?? draft.contentHash,
      versionId: expectedVersion + 1 === 2
        ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      currentVersion: expectedVersion + 1,
    };
    this.sharedVersions.push({ id: this.sharedDraft.versionId, version: this.sharedDraft.currentVersion,
      sourceUri: this.sharedDraft.sourceUri, mimeType: this.sharedDraft.mimeType,
      contentHash: this.sharedDraft.contentHash, createdAt: this.sharedDraft.updatedAt });
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
      audienceRoleIds: draft.audienceRoleIds, proposedTargetReaders: draft.targetReaders, approvedTargetReaders: null,
      contentHash: draft.contentHash,
      status: "PENDING_REVIEW", submittedAt: new Date("2026-10-10T10:00:00.000Z"), publishedVersionId: null,
      publicationState: "NONE",
      decisionComment: null, requestType: "CONTENT", requestReason: null, publicationFailure: null, withdrawal: null,
    };
    this.sharedDraft = { ...draft, hasPendingSubmission: true };
    return { kind: "submitted", submission: this.sharedSubmission! };
  }

  async listKnowledgeSubmissions(userId: string, requestedOrganization: string): Promise<SharedKnowledgeSubmission[] | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    return this.sharedSubmission ? [this.sharedSubmission] : [];
  }

  async listOwnedKnowledgeSubmissionIds(userId: string, requestedOrganization: string,
    submissionIds: readonly string[]): Promise<string[] | null> {
    const submissions = await this.listKnowledgeSubmissions(userId, requestedOrganization);
    return submissions?.filter(submission => submissionIds.includes(submission.id)).map(submission => submission.id) ?? null;
  }

  async listReadableCurrentPublicationIds(userId: string, requestedOrganization: string,
    publishedVersionIds: readonly string[]): Promise<string[] | null> {
    if (!(await this.requireActiveMembership(userId, requestedOrganization))) return null;
    return this.publication && publishedVersionIds.includes(this.publication.id) ? [this.publication.id] : [];
  }

  governanceAdmin = false;
  governanceInspections = new Map<string, string>();
  publicationReports: PublicationReport[] = [];
  withdrawnDocuments: string[] = [];

  governanceSource = { sourceUri: "arden-private-object://governance", contentHash: "a".repeat(64) };

  private governanceView(): GovernanceDocumentView {
    return { documentId: sharedDraftId, publishedVersionId: "efefefef-efef-4efe-8efe-efefefefefef", title: "Runbook",
      ...this.governanceSource, mimeType: "text/plain",
      responsibleDepartmentId: salesDepartmentId, readerMode: "SELECTED_MEMBERS", readerDepartmentId: null };
  }

  async listGovernancePublications(userId: string, requestedOrganization: string): Promise<GovernancePublication[] | null> {
    if (!this.governanceAdmin || userId !== ownerId || requestedOrganization !== organizationId) return null;
    const view = this.governanceView();
    return [{ documentId: view.documentId, publishedVersionId: view.publishedVersionId, title: view.title,
      responsibleDepartmentId: view.responsibleDepartmentId, readerMode: view.readerMode, readerDepartmentId: null,
      versionLabel: "1.0", snapshotVersionNo: 1, publishedAt: new Date("2026-11-10T09:00:00.000Z"), openReports: 1 }];
  }

  async openGovernanceInspection(userId: string, requestedOrganization: string, documentId: string,
    reason: string): Promise<OpenGovernanceInspectionResult> {
    if (!reason.trim()) return { kind: "invalid-reason" };
    if (!this.governanceAdmin || userId !== ownerId || requestedOrganization !== organizationId) return { kind: "not-admin" };
    if (documentId !== sharedDraftId) return { kind: "not-found" };
    const id = "12121212-1212-4121-8121-121212121212";
    this.governanceInspections.set(id, reason.trim());
    return { kind: "opened", inspectionId: id };
  }

  async useGovernanceInspection(userId: string, requestedOrganization: string,
    inspectionId: string): Promise<GovernanceInspectionView | null> {
    const reason = this.governanceInspections.get(inspectionId);
    if (!reason || !this.governanceAdmin || userId !== ownerId || requestedOrganization !== organizationId) return null;
    return { ...this.governanceView(), readerNames: ["Avery Reader", "Blake Reader"], reason,
      expiresAt: new Date("2026-11-16T10:15:00.000Z") };
  }

  async getResponsiblePublicationView(userId: string, requestedOrganization: string,
    documentId: string): Promise<GovernanceDocumentView | null> {
    return userId === otherId && requestedOrganization === organizationId && documentId === sharedDraftId
      ? this.governanceView() : null;
  }

  async withdrawPublicationDirectly(userId: string, requestedOrganization: string, documentId: string,
    reason: string): Promise<DirectWithdrawalResult> {
    if (!reason.trim()) return { kind: "invalid-reason" };
    if (!this.governanceAdmin || userId !== ownerId || requestedOrganization !== organizationId || documentId !== sharedDraftId
      || this.withdrawnDocuments.includes(documentId)) return { kind: "not-found" };
    this.withdrawnDocuments.push(documentId);
    return { kind: "withdrawn" };
  }

  async reportPublicationProblem(userId: string, requestedOrganization: string, documentId: string,
    publishedVersionId: string, message: string): Promise<ReportPublicationResult> {
    if (requestedOrganization !== organizationId) return { kind: "not-found" };
    if (this.publicationReports.some((report) => report.documentId === documentId && report.reporterName === userId)) {
      return { kind: "duplicate" };
    }
    const id = `${String(this.publicationReports.length + 1).padStart(8, "3")}-3333-4333-8333-333333333333`;
    this.publicationReports.push({ id, documentId, publishedVersionId, title: "Runbook", message, reporterName: userId,
      createdAt: new Date("2026-11-16T09:00:00.000Z"), stillCurrent: true, canView: true });
    return { kind: "reported", reportId: id };
  }

  async listPublicationReports(userId: string, requestedOrganization: string): Promise<PublicationReport[] | null> {
    return requestedOrganization === organizationId && userId === otherId ? this.publicationReports : [];
  }

  async listClosedPublicationReports(): Promise<{ items: PublicationReport[]; nextCursor: string | null }> {
    return { items: [], nextCursor: null };
  }

  async dismissPublicationReport(userId: string, requestedOrganization: string, reportId: string): Promise<boolean> {
    const before = this.publicationReports.length;
    if (userId !== otherId || requestedOrganization !== organizationId) return false;
    this.publicationReports = this.publicationReports.filter((report) => report.id !== reportId);
    return this.publicationReports.length !== before;
  }

  async retryKnowledgePublication(userId: string, requestedOrganization: string,
    submissionId: string): Promise<RetryKnowledgePublicationResult> {
    const submission = this.sharedSubmission;
    if (userId !== ownerId || requestedOrganization !== organizationId || submission?.id !== submissionId) {
      return { kind: "not-found" };
    }
    if (submission.publicationState === "PREPARING") return { kind: "preparing", submission };
    if (submission.publicationState !== "FAILED") return { kind: "not-failed" };
    if (submission.publicationFailure !== "TEMPORARY") return { kind: "not-retryable" };
    this.sharedSubmission = { ...submission, publicationState: "PREPARING", publicationFailure: null, withdrawal: null };
    return { kind: "preparing", submission: this.sharedSubmission };
  }

  async withdrawKnowledgeSubmission(userId: string, requestedOrganization: string,
    submissionId: string): Promise<WithdrawKnowledgeSubmissionResult> {
    const submission = this.sharedSubmission;
    if (userId !== ownerId || requestedOrganization !== organizationId || submission?.id !== submissionId) {
      return { kind: "not-found" };
    }
    if (submission.status === "WITHDRAWN") return { kind: "replayed", submission };
    if (submission.status !== "PENDING_REVIEW") return { kind: "conflict" };
    this.sharedSubmission = { ...submission, status: "WITHDRAWN" };
    if (this.sharedDraft) this.sharedDraft = { ...this.sharedDraft, hasPendingSubmission: false };
    return { kind: "withdrawn", submission: this.sharedSubmission };
  }

  async requestPublicationChange(userId: string, requestedOrganization: string, documentId: string,
    input: PublicationChangeInput): Promise<RequestPublicationChangeResult> {
    if (userId !== ownerId || requestedOrganization !== organizationId || documentId !== sharedDraftId) return { kind: "not-found" };
    const submission = this.sharedSubmission;
    if (!submission || submission.publicationState !== "ACTIVE") return { kind: "not-published" };
    if (input.type === "READER_CHANGE" && !input.targetReaders) return { kind: "invalid-request", reason: "Choose the new readers." };
    this.sharedSubmission = { ...submission, id: "cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd", status: "PENDING_REVIEW",
      publicationState: "NONE", requestType: input.type, requestReason: input.reason.trim(),
      proposedTargetReaders: input.targetReaders ? { mode: input.targetReaders.mode,
        departmentId: input.targetReaders.departmentId ?? null, memberIds: input.targetReaders.memberIds ?? [] } : null };
    return { kind: "requested", submission: this.sharedSubmission };
  }

  async listReviewerGrants(userId: string, requestedOrganization: string): Promise<ReviewerGrantRecord[] | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId) return null;
    return this.reviewerGrant ? [this.reviewerGrant] : [];
  }

  async createReviewerGrant(userId: string, requestedOrganization: string, input: ReviewerGrantInput): Promise<ReviewerGrantRecord | null> {
    if (userId !== ownerId || requestedOrganization !== organizationId || input.reviewerMembershipId !== otherId) return null;
    if (this.reviewerGrant?.status === "ACTIVE" && this.reviewerGrant.scope === input.scope
      && this.reviewerGrant.departmentId === input.departmentId
      && this.reviewerGrant.teamTag === input.teamTag && this.reviewerGrant.projectTag === input.projectTag
      && this.reviewerGrant.level === (input.level ?? "STANDARD")
      && this.reviewerGrant.classifications.length === input.classifications.length
      && input.classifications.every((classification) => this.reviewerGrant!.classifications.includes(classification))) {
      throw new ReviewerGrantConflictError();
    }
    this.reviewerGrant = { ...input, level: input.level ?? "STANDARD",
      id: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc", status: "ACTIVE",
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
      classification: submission.classification, submittedAt: submission.submittedAt, approvalBlocked: false,
      versionNo: 2, requestType: submission.requestType, authorName: "Owner" }];
  }

  async listAssignedReviewsForSubmissions(userId: string, requestedOrganization: string,
    submissionIds: readonly string[]): Promise<AssignedReview[] | null> {
    const reviews = await this.listAssignedReviews(userId, requestedOrganization);
    return reviews?.filter(review => submissionIds.includes(review.submissionId)) ?? null;
  }

  decidedReviews: DecidedReview[] = [];
  async listDecidedReviews(userId: string, requestedOrganization: string): Promise<DecidedReview[] | null> {
    if (requestedOrganization !== organizationId) return null;
    return userId === otherId ? this.decidedReviews : [];
  }

  async getAssignedReview(userId: string, requestedOrganization: string, submissionId: string): Promise<ReviewDetail | null> {
    const queue = await this.listAssignedReviews(userId, requestedOrganization);
    if (!queue?.some((item) => item.submissionId === submissionId) || !this.sharedSubmission || !this.sharedDraft) return null;
    return { submission: this.sharedSubmission, sourceUri: this.sharedDraft.sourceUri,
      mimeType: this.sharedDraft.mimeType, submittedByMembershipId: ownerId,
      teamTag: this.sharedDraft.teamTag, projectTag: this.sharedDraft.projectTag,
      proposedReaders: this.sharedSubmission.proposedTargetReaders ? {
        mode: this.sharedSubmission.proposedTargetReaders.mode,
        department: this.sharedSubmission.proposedTargetReaders.departmentId
          ? { id: this.sharedSubmission.proposedTargetReaders.departmentId, name: "Engineering" } : null,
        members: this.sharedSubmission.proposedTargetReaders.memberIds.map((membershipId) => ({
          membershipId, displayName: `Member ${membershipId.slice(-3)}` })),
      } : null };
  }

  async decideReview(userId: string, requestedOrganization: string, submissionId: string, action: ReviewAction,
    expectedSnapshotVersionId: string, expectedContentHash: string, comment: string | null,
    idempotencyKey: string, _requestId?: string, approvedReaders?: TargetReadersInput): Promise<DecideReviewResult> {
    if (this.authorDecisionWindow) return { kind: "denied", reason: "AUTHOR_DECISION_WINDOW" };
    const submission = this.sharedSubmission;
    if (this.reviewRequestKey === idempotencyKey && submission && submissionId === submission.id) {
      const expected = approvedReaders === undefined ? submission.proposedTargetReaders
        : { mode: approvedReaders.mode, departmentId: approvedReaders.departmentId ?? null, memberIds: approvedReaders.memberIds ?? [] };
      const previous = submission.approvedTargetReaders;
      if ((previous === null) !== (expected === null) || (previous && expected && !sameReaders(previous, expected))) {
        return { kind: "conflict" };
      }
      return { kind: "replayed", submission };
    }
    if (userId !== otherId || requestedOrganization !== organizationId || !submission || submission.id !== submissionId
      || this.reviewerGrant?.status !== "ACTIVE") return { kind: "not-found" };
    if (submission.status !== "PENDING_REVIEW") return { kind: "conflict" };
    if (submission.snapshotVersionId !== expectedSnapshotVersionId || submission.contentHash !== expectedContentHash) {
      return { kind: "denied", reason: "STALE_SNAPSHOT" };
    }
    if (action !== "APPROVE" && approvedReaders !== undefined) return { kind: "denied", reason: "INVALID_REQUEST" };
    if (action !== "APPROVE" && !comment?.trim()) return { kind: "denied", reason: "COMMENT_REQUIRED" };
    let approvedTargetReaders: SharedKnowledgeSubmission["approvedTargetReaders"] = null;
    if (action === "APPROVE") {
      if (!submission.proposedTargetReaders) {
        if (approvedReaders !== undefined) return { kind: "denied", reason: "READERS_NOT_SUPPORTED" };
      } else {
        const resolved = resolveApprovedReaders(submission.proposedTargetReaders, approvedReaders, this.selectionFacts);
        if (!resolved.ok) {
          return resolved.reason === "INVALID_READERS"
            ? { kind: "denied", reason: resolved.reason, field: resolved.field, message: resolved.message }
            : { kind: "denied", reason: resolved.reason };
        }
        approvedTargetReaders = resolved.selection;
      }
    }
    this.reviewRequestKey = idempotencyKey;
    if (action === "APPROVE") {
      this.sharedSubmission = { ...submission, status: "APPROVED", publicationState: "PREPARING", publishedVersionId: null,
        approvedTargetReaders, decisionComment: comment?.trim() || null };
    } else this.sharedSubmission = { ...submission, status: "REJECTED", publicationState: "NONE",
      decisionComment: comment?.trim() || null };
    if (this.sharedDraft) this.sharedDraft = { ...this.sharedDraft, hasPendingSubmission: false };
    return { kind: "decided", submission: this.sharedSubmission! };
  }

  async listPublishedKnowledge(userId: string, requestedOrganization: string): Promise<PublishedKnowledge[] | null> {
    if (requestedOrganization !== organizationId) return null;
    // Same rule as the database projection: expired publications leave reader listings (decision 0032).
    return userId === ownerId && this.publication && !this.publication.expired ? [this.publication] : [];
  }

  departmentPublications = 0;
  authorDecisionWindow = false;
  renewalState: PublicationRenewalState[] = [];
  renewalResult: RequestPublicationRenewalResult["kind"] = "requested";
  renewalInputs: PublicationRenewalInput[] = [];
  reminderRuns = 0;
  async listPublicationRenewalState(userId: string, requestedOrganization: string): Promise<PublicationRenewalState[] | null> {
    if (requestedOrganization !== organizationId) return null;
    return userId === ownerId ? this.renewalState : [];
  }

  async requestPublicationRenewal(userId: string, requestedOrganization: string, documentId: string,
    input: PublicationRenewalInput): Promise<RequestPublicationRenewalResult> {
    if (userId !== ownerId || requestedOrganization !== organizationId || documentId !== sharedDraftId) return { kind: "not-found" };
    this.renewalInputs.push(input);
    if (this.renewalResult !== "requested" && this.renewalResult !== "replayed") return { kind: this.renewalResult };
    const released = this.sharedSubmission;
    if (!released) return { kind: "not-found" };
    this.sharedSubmission = { ...released, id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", status: "PENDING_REVIEW",
      publicationState: "NONE", requestType: "RENEWAL", requestReason: input.reason.trim(),
      renewal: { expirationDate: input.expirationDate, onBehalfOfAuthor: false } };
    return { kind: this.renewalResult, submission: this.sharedSubmission };
  }

  async enqueuePublicationExpiryReminders(): Promise<number> {
    this.reminderRuns += 1;
    return 0;
  }

  async getPublishedKnowledge(userId: string, requestedOrganization: string, publishedVersionId: string): Promise<PublishedKnowledge | null> {
    return userId === ownerId && requestedOrganization === organizationId && this.publication?.id === publishedVersionId
      ? this.publication : null;
  }

  async listAuthorizedAiSources(userId: string, requestedOrganization: string): Promise<AuthorizedAiSource[] | null> {
    if (requestedOrganization !== organizationId) return null;
    return userId === ownerId ? this.authorizedAiSources : [];
  }

  async getTargetReaderActor(userId: string, requestedOrganization: string): Promise<ReaderActor | null> {
    return requestedOrganization === organizationId ? this.readerActors.get(userId) ?? null : null;
  }

  async canCreateDraft(userId: string, requestedOrganization: string): Promise<boolean> { return userId === ownerId && requestedOrganization === organizationId; }

  async createDraft(_userId: string, requestedOrganization: string, write: DraftWrite, content: StoredContentFields): Promise<PrivateDraft | null> {
    if (requestedOrganization !== organizationId) return null;
    if (write.collectionId && !this.privateOrganization.isActiveCollection(write.collectionId)) return null;
    this.currentBody = write.body;
    this.currentVersion = 1;
    this.currentSource = content;
    return { ...this.note(), title: write.title, collectionId: write.collectionId ?? null };
  }

  async canUpdateDraft(userId: string, requestedOrganization: string, requestedDraft: string): Promise<boolean> {
    return userId === ownerId && requestedOrganization === organizationId && requestedDraft === draftId
      && !this.privateOrganization.hidden(draftId);
  }

  async updateDraft(_userId: string, _organization: string, _draft: string, expectedVersion: number, patch: DraftPatch, content: StoredContentFields | null): Promise<DraftUpdateResult> {
    if (this.privateOrganization.hidden(draftId)) return { kind: "not-found" };
    if (expectedVersion !== this.currentVersion) return { kind: "conflict", currentVersion: this.currentVersion };
    if (content && content.mimeType !== this.currentSource.mimeType) return { kind: "wrong-kind" };
    this.currentVersion += 1;
    // Decision 0031: an open version is overwritten; its previous content object becomes unreachable.
    let replacedSourceUri: string | null = null;
    if (patch.body !== undefined) this.currentBody = patch.body;
    if (content) {
      if (!this.sourceVersionSealed && content.sourceUri !== this.currentSource.sourceUri) replacedSourceUri = this.currentSource.sourceUri;
      this.currentSource = content;
    }
    const draft = { ...this.note(), title: patch.title ?? this.note().title };
    return { kind: "updated", draft, replacedSourceUris: replacedSourceUri ? [replacedSourceUri] : [] };
  }
  /** Set when the note's version was contributed (decision 0031). */
  sourceVersionSealed = false;

  private note(): PrivateDraft {
    return {
      id: draftId, organizationId, title: "Review notes", versionId,
      sourceUri: this.currentSource.sourceUri, mimeType: this.currentSource.mimeType,
      contentHash: this.currentSource.contentHash, currentVersion: this.currentVersion,
      createdAt: new Date("2026-10-05T09:00:00.000Z"), updatedAt: new Date("2026-10-05T09:00:00.000Z"),
      collectionId: this.privateOrganization.notes.get(draftId)?.collectionId ?? null,
      favoritedAt: this.privateOrganization.notes.get(draftId)?.favoritedAt ?? null,
      position: this.privateOrganization.notes.get(draftId)?.position ?? null,
      text: this.currentSource.text ?? null,
    };
  }
}

class FakeInvitationMailer implements InvitationMailer {
  readonly sent: InvitationEmail[] = [];
  failDelivery = false;
  async sendInvitation(message: InvitationEmail) { if (this.failDelivery) throw new Error("SMTP failure"); this.sent.push(message); }
  close() { /* No external resource in request tests. */ }
}
