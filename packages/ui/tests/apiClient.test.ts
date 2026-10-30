import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, beginGoogleSignIn, createKnowledgeDraft, createNewKnowledgeDraft, createPdfKnowledgeDraft, currentSession,
  decideKnowledgeReview, deleteDepartment, getInvitationPreview, saveKnowledgeDraft, setAccountPassword, signIn, signOut, signUp,
  submitKnowledgeDraft } from "../src/shared/api-client";

const actorId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourceVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idempotencyKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const createdDraft = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", organizationId,
  title: "Review notes", body: "Exact private text", classification: "CONFIDENTIAL", status: "ACTIVE",
  currentVersion: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", version: 1, mimeType: "text/plain", contentHash: "a".repeat(64) },
};
const me = { actor: { id: actorId }, account: { passwordSetupRequired: false }, memberships: [{
  organization: { id: organizationId, name: "Synthetic Org" },
  status: "active", roleCodes: ["MEMBER"], canUsePrivateWorkspace: true,
}] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Supabase session transport", () => {
  it("keeps a lost write response uncertain, without claiming the write failed", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network closed")));
    await expect(apiRequest("web", "/api/v1/example", { method: "POST", body: "{}" }))
      .rejects.toThrow("Couldn’t confirm this action.");
    await expect(apiRequest("web", "/api/v1/example"))
      .rejects.toThrow("Connection unavailable.");
  });

  it("shows readable document errors while retaining the machine code", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: {
      code: "INVALID_DOCUMENT", message: "Semantic Document violates schema version 1.",
    } }, { status: 400 })));
    await expect(apiRequest("web", "/api/v1/example")).rejects.toMatchObject({
      status: 400, code: "INVALID_DOCUMENT", message: "Unsupported document format.",
    });
  });

  it("uses Arden's sign-in endpoint and HttpOnly web cookies", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: "hidden-cookie-session" }, { status: 200, headers: { "set-cookie": "arden.session_token=hidden-cookie-session; HttpOnly" } }))
      .mockResolvedValueOnce(Response.json(me, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signIn("web", "member@example.test", "synthetic-password")).resolves.toEqual(me);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://arden.example.test/api/v1/auth/sign-in", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ email: "member@example.test", password: "synthetic-password" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://arden.example.test/api/v1/me", expect.objectContaining({ credentials: "include" }));
  });

  it("normalizes sessions from an older remote API without account setup state", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const legacySession = { actor: me.actor, memberships: me.memberships };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(legacySession, { status: 200 })));

    await expect(currentSession("web")).resolves.toEqual({
      ...legacySession,
      account: { passwordSetupRequired: false },
    });
  });

  it("submits registration through the sign-up endpoint on web", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ status: "check_email" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signUp("web", "new@example.test", "secure-password", "Jane Doe")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("https://arden.example.test/api/v1/auth/sign-up", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ email: "new@example.test", password: "secure-password", fullName: "Jane Doe" }),
    }));
  });

  it("fetches invitation preview with encoded token", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const preview = { organizationName: "Cheval", email: "guest@example.test", expiresAt: "2026-11-03T08:00:00Z" };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(preview, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getInvitationPreview("web", "4e-SL2tSdcYWMhj7HFTDKIcw5Vks-ygUeOY8JfkuZGg")).resolves.toEqual(preview);
    expect(fetchMock).toHaveBeenCalledWith("https://arden.example.test/api/v1/invitations/4e-SL2tSdcYWMhj7HFTDKIcw5Vks-ygUeOY8JfkuZGg", expect.objectContaining({
      credentials: "include",
    }));
  });

  it("deletes empty department through API client", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ departmentId: "ffffffff-ffff-4fff-8fff-ffffffffffff", status: "archived" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteDepartment("web", organizationId, "ffffffff-ffff-4fff-8fff-ffffffffffff")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`https://arden.example.test/api/v1/organizations/${organizationId}/departments/ffffffff-ffff-4fff-8fff-ffffffffffff/delete`, expect.objectContaining({
      method: "POST",
      body: "{}",
    }));
  });

  it("submits registration through the desktop bridge", async () => {
    const requestApi = vi.fn().mockResolvedValueOnce({ status: 202, body: JSON.stringify({ status: "check_email" }) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi } });

    await expect(signUp("desktop", "new@example.test", "secure-password", "Jane Doe")).resolves.toBeUndefined();
    expect(requestApi).toHaveBeenCalledWith({
      path: "/api/v1/auth/sign-up", method: "POST", body: JSON.stringify({ email: "new@example.test", password: "secure-password", fullName: "Jane Doe" }), ifMatch: undefined,
    });
  });

  it("keeps desktop cookies inside the secure main-process bridge", async () => {
    const requestApi = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ token: "hidden-cookie-session" }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify(me) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi, clearSession: vi.fn() } });

    await expect(signIn("desktop", "member@example.test", "synthetic-password")).resolves.toEqual(me);
    expect(requestApi).toHaveBeenNthCalledWith(1, {
      path: "/api/v1/auth/sign-in", method: "POST", body: JSON.stringify({ email: "member@example.test", password: "synthetic-password" }), ifMatch: undefined,
    });
    expect(requestApi).toHaveBeenNthCalledWith(2, {
      path: "/api/v1/me", method: "GET", body: undefined, ifMatch: undefined,
    });
  });

  it("finishes desktop Google sign-in through the isolated main-process window", async () => {
    const startGoogleSignIn = vi.fn(async () => undefined);
    const requestApi = vi.fn().mockResolvedValueOnce({ status: 200, body: JSON.stringify(me) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi, startGoogleSignIn } });
    await expect(beginGoogleSignIn("desktop")).resolves.toEqual(me);
    expect(startGoogleSignIn).toHaveBeenCalledOnce();
    expect(requestApi).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/me", method: "GET" }));
  });

  it("creates the initial Arden password and refreshes the account state", async () => {
    const requestApi = vi.fn()
      .mockResolvedValueOnce({ status: 204, body: "" })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify(me) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi } });
    await expect(setAccountPassword("desktop", "new-password")).resolves.toEqual(me);
    expect(requestApi).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: "/api/v1/auth/password", method: "POST", body: JSON.stringify({ password: "new-password" }),
    }));
  });

  it("forwards update versions and clears encrypted desktop sessions after sign-out", async () => {
    const requestApi = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ success: true }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ success: true }) });
    const clearSession = vi.fn(async () => undefined);
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi, clearSession } });

    await apiRequest("desktop", `/api/v1/organizations/${organizationId}/private-workspace/drafts/cccccccc-cccc-4ccc-8ccc-cccccccccccc`, {
      method: "PATCH", headers: { "If-Match": '"2"' }, body: JSON.stringify({ body: "revision" }),
    });
    await signOut("desktop");
    expect(requestApi).toHaveBeenNthCalledWith(1, expect.objectContaining({ ifMatch: '"2"', method: "PATCH" }));
    expect(requestApi).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: "/api/v1/auth/sign-out", method: "POST" }));
    expect(clearSession).toHaveBeenCalledOnce();
  });
});

describe("shared knowledge draft transport", () => {
  it("copies an exact private version through the authenticated web API", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(createdDraft, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createKnowledgeDraft("web", organizationId, sourceVersionId, "CONFIDENTIAL", idempotencyKey)).resolves.toEqual({
      id: createdDraft.id, organizationId, title: createdDraft.title, body: createdDraft.body,
      classification: "CONFIDENTIAL", version: 1,
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://arden.example.test/api/v1/organizations/${organizationId}/knowledge/drafts`);
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("idempotency-key")).toBe(idempotencyKey);
    expect(JSON.parse(init.body as string)).toEqual({ sourcePrivateVersionId: sourceVersionId, classification: "CONFIDENTIAL" });
  });

  it("omits the classification when none is chosen and accepts the server default (decision 0013)", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...createdDraft, classification: "INTERNAL" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createKnowledgeDraft("web", organizationId, sourceVersionId, undefined, idempotencyKey))
      .resolves.toMatchObject({ id: createdDraft.id, classification: "INTERNAL" });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ sourcePrivateVersionId: sourceVersionId });
  });

  it("passes the idempotency key through the narrow desktop bridge", async () => {
    const requestApi = vi.fn().mockResolvedValueOnce({ status: 200, body: JSON.stringify(createdDraft) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi } });

    await expect(createKnowledgeDraft("desktop", organizationId, sourceVersionId, "CONFIDENTIAL", idempotencyKey)).resolves.toMatchObject({ id: createdDraft.id });
    expect(requestApi).toHaveBeenCalledWith({
      path: `/api/v1/organizations/${organizationId}/knowledge/drafts`, method: "POST",
      body: JSON.stringify({ sourcePrivateVersionId: sourceVersionId, classification: "CONFIDENTIAL" }),
      ifMatch: undefined, idempotencyKey,
    });
  });

  it("does not treat an invalid or denied server response as a saved draft", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...createdDraft, organizationId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ error: { code: "RESOURCE_NOT_AVAILABLE", message: "Not available." } }, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createKnowledgeDraft("web", organizationId, sourceVersionId, "CONFIDENTIAL", idempotencyKey)).rejects.toThrow("Couldn’t confirm draft creation.");
    await expect(createKnowledgeDraft("web", organizationId, sourceVersionId, "CONFIDENTIAL", idempotencyKey)).rejects.toThrow("Not available.");
  });

  it("treats a lost response as uncertain, not as a confirmed failed create", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("connection closed")));

    await expect(createKnowledgeDraft("web", organizationId, sourceVersionId, "CONFIDENTIAL", idempotencyKey))
      .rejects.toThrow("Couldn’t confirm draft creation.");
  });
});

describe("governed knowledge transport", () => {
  it("encodes a selected local PDF through the desktop bridge", async () => {
    const requestApi = vi.fn().mockResolvedValue({ status: 201, body: JSON.stringify({ ...createdDraft,
      body: "", currentVersion: { ...createdDraft.currentVersion, mimeType: "application/pdf" } }) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi } });
    const file = new File(["%PDF-1.4\n%%EOF"], "original.pdf", { type: "application/pdf" });
    await createPdfKnowledgeDraft("desktop", organizationId,
      { title: "Original", file, classification: "INTERNAL" }, idempotencyKey);
    const sent = requestApi.mock.calls[0][0] as { path: string; body: string; idempotencyKey: string };
    expect(sent.path).toBe(`/api/v1/organizations/${organizationId}/knowledge/drafts/pdf`);
    expect(sent.idempotencyKey).toBe(idempotencyKey);
    expect(Buffer.from(JSON.parse(sent.body).pdfBase64, "base64").toString()).toBe("%PDF-1.4\n%%EOF");
    await expect(createPdfKnowledgeDraft("desktop", organizationId,
      { title: "Wrong", file: new File(["text"], "wrong.txt"), classification: "INTERNAL" }, idempotencyKey))
      .rejects.toThrow("Choose a PDF");
  });

  it("sends draft preconditions and idempotency through the desktop bridge", async () => {
    const requestApi = vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify(createdDraft) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi } });
    await createNewKnowledgeDraft("desktop", organizationId,
      { title: "Runbook", body: "Steps", classification: "INTERNAL" }, idempotencyKey);
    await saveKnowledgeDraft("desktop", organizationId, createdDraft.id, 2, { body: "Revised" });
    await submitKnowledgeDraft("desktop", organizationId, createdDraft.id, 3, idempotencyKey);
    expect(requestApi).toHaveBeenNthCalledWith(1, expect.objectContaining({
      path: `/api/v1/organizations/${organizationId}/knowledge/drafts/new`,
      method: "POST", idempotencyKey,
    }));
    expect(requestApi).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: `/api/v1/organizations/${organizationId}/knowledge/drafts/${createdDraft.id}`,
      method: "PATCH", ifMatch: '"2"',
    }));
    expect(requestApi).toHaveBeenNthCalledWith(3, expect.objectContaining({
      path: `/api/v1/organizations/${organizationId}/knowledge/drafts/${createdDraft.id}/submit`,
      method: "POST", ifMatch: '"3"', idempotencyKey,
    }));
  });

  it("binds a decision to the exact submitted snapshot and hash", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: "APPROVED" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await decideKnowledgeReview("web", organizationId, {
      id: sourceVersionId, draftId: createdDraft.id, snapshotVersionId: createdDraft.currentVersion.id,
      title: "Runbook", classification: "INTERNAL", responsibleDepartmentId: sourceVersionId,
      targetScopeType: "DEPARTMENT", targetDepartmentId: sourceVersionId, audienceIds: [],
      contentHash: createdDraft.currentVersion.contentHash, status: "PENDING_REVIEW",
      submittedAt: "2026-10-12T00:00:00.000Z", publishedVersionId: null, body: "Steps", mimeType: "text/plain",
      submittedByMembershipId: actorId, teamTag: null, projectTag: null,
    }, "APPROVE", null, idempotencyKey);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://arden.example.test/api/v1/organizations/${organizationId}/knowledge/reviews/${sourceVersionId}/decisions`);
    expect(new Headers(init.headers).get("idempotency-key")).toBe(idempotencyKey);
    expect(JSON.parse(init.body as string)).toEqual({ action: "APPROVE",
      expectedSnapshotVersionId: createdDraft.currentVersion.id,
      expectedContentHash: createdDraft.currentVersion.contentHash, comment: null });
  });
});
