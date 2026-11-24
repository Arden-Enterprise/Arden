import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { desktopApiResponseLimit, desktopApiTimeout, validateDesktopApiRequest } from "./apiRequestPolicy.ts";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourcePrivateVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idempotencyKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sharedDraftPath = `/api/v1/organizations/${organizationId}/knowledge/drafts`;

describe("desktop API request allowlist", () => {
  it("allows only versioned placement reads and mutations", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/catalog/placements/${sourcePrivateVersionId}`;
    assert.equal(validateDesktopApiRequest({ path, method: "GET" }), true);
    const request = { path, method: "PATCH", body: JSON.stringify({ collectionId: null }), ifMatch: '"placement-0"' };
    assert.equal(validateDesktopApiRequest(request), true);
    assert.equal(validateDesktopApiRequest({ ...request, ifMatch: '"placement-123"' }), true);
    for (const extra of [{ ifMatch: undefined }, { ifMatch: '"catalog-1"' }, { ifMatch: '"placement-01"' },
      { ifMatch: '"placement-9007199254740992"' }, { method: "POST" }, { path: `${path}?all=true` }, { idempotencyKey }]) {
      assert.equal(validateDesktopApiRequest({ ...request, ...extra }), false);
    }
  });
  it("preserves bounded non-reader deadlines while keeping reader deadlines main-owned", () => {
    const session = { path: "/api/v1/me", method: "GET" as const, timeoutMs: 15_000 };
    assert.equal(validateDesktopApiRequest(session), true);
    assert.equal(desktopApiTimeout(session), 15_000);
    assert.equal(validateDesktopApiRequest({ ...session, timeoutMs: 60_001 }), false);
    const reader = `/api/v1/organizations/${organizationId}/knowledge/published/${sourcePrivateVersionId}`;
    assert.equal(validateDesktopApiRequest({ path: `${reader}/questions`, method: "POST",
      body: JSON.stringify({ requestId: idempotencyKey, query: "What is required?" }), timeoutMs: 15_000 }), false);
    assert.equal(validateDesktopApiRequest({ path: `${reader}/summary/access`, method: "GET", timeoutMs: 15_000 }), false);
  });
  it("permits only the stateless exact-document question request", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/published/${sourcePrivateVersionId}/questions`;
    const request = { path, method: "POST" as const, body: JSON.stringify({ requestId: idempotencyKey, query: "Who may read?" }) };
    assert.equal(validateDesktopApiRequest(request), true);
    assert.equal(desktopApiTimeout(request), 240_000);
    for (const extra of [{ history: [] }, { generationId: sourcePrivateVersionId }, { text: "injected" }]) {
      assert.equal(validateDesktopApiRequest({ ...request, body: JSON.stringify({ requestId: idempotencyKey, query: "q", ...extra }) }), false);
    }
    for (const query of ["", " ", "x".repeat(4_001)]) assert.equal(validateDesktopApiRequest({ ...request,
      body: JSON.stringify({ requestId: idempotencyKey, query }) }), false);
    for (const change of [{ method: "GET" }, { path: `${path}?all=1` }, { body: "{}" }, { timeoutMs: 999_999 },
      { ifMatch: '"1"' }, { idempotencyKey }]) assert.equal(validateDesktopApiRequest({ ...request, ...change }), false);
  });
  it("permits only exact Summary generation/access shapes with main-owned deadlines", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/published/${sourcePrivateVersionId}/summary`;
    const request = { path, method: "POST" as const, body: JSON.stringify({ requestId: idempotencyKey }) };
    assert.equal(validateDesktopApiRequest(request), true);
    assert.equal(desktopApiTimeout(request), 300_000);
    assert.equal(desktopApiResponseLimit(request), 1024 * 1024);
    assert.equal(validateDesktopApiRequest({ path: `${path}/access`, method: "GET" }), true);
    assert.equal(desktopApiTimeout({ path: `${path}/access`, method: "GET" }), 30_000);
    for (const body of [undefined, "{}", "null", "[]", "bad", JSON.stringify({ requestId: "bad" }),
      JSON.stringify({ requestId: idempotencyKey, prompt: "bypass" })]) assert.equal(validateDesktopApiRequest({ ...request, body }), false);
    for (const suffix of ["?prompt=x", "/other", "#fragment"]) assert.equal(validateDesktopApiRequest({ ...request, path: `${path}${suffix}` }), false);
    assert.equal(validateDesktopApiRequest({ ...request, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ ...request, method: "PATCH" }), false);
    assert.equal(validateDesktopApiRequest({ ...request, ifMatch: '"1"' }), false);
    assert.equal(validateDesktopApiRequest({ ...request, idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ ...request, timeoutMs: 3_600_000 }), false);
    assert.equal(validateDesktopApiRequest({ path: `${path}/access`, method: "GET", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${path}/access?all=1`, method: "GET" }), false);
    assert.equal(desktopApiTimeout({ path: "/api/v1/me", method: "GET" }), undefined);
  });
  it("allows questions for one saved private note revision without a scope override", () => {
    const path = `/api/v1/organizations/${organizationId}/private-workspace/drafts/${sourcePrivateVersionId}/questions`;
    const payload = { requestId: idempotencyKey, query: "Summarize this note", expectedVersion: 2 };
    const request = { path, method: "POST" as const, body: JSON.stringify(payload) };
    assert.equal(validateDesktopApiRequest(request), true);
    assert.equal(desktopApiTimeout(request), 240_000);
    for (const expectedVersion of [undefined, "2", 0, -1, 1.5, 2_147_483_648]) {
      assert.equal(validateDesktopApiRequest({ ...request, body: JSON.stringify({ ...payload, expectedVersion }) }), false);
    }
    for (const change of [{ path: `${path}?scope=all` }, { method: "GET" }, { timeoutMs: 45_000 },
      { body: JSON.stringify({ ...payload, source: "company" }) }]) {
      assert.equal(validateDesktopApiRequest({ ...request, ...change }), false);
    }
  });
  it("allows only exact bodyless private conversation reads", () => {
    const list = `/api/v1/organizations/${organizationId}/ai/conversations`;
    for (const path of [list, `${list}/${sourcePrivateVersionId}`]) {
      assert.equal(validateDesktopApiRequest({ path, method: "GET" }), true);
      assert.equal(validateDesktopApiRequest({ path, method: "POST" }), false);
      assert.equal(validateDesktopApiRequest({ path, method: "GET", body: "{}" }), false);
      assert.equal(validateDesktopApiRequest({ path: `${path}?owner=all`, method: "GET" }), false);
      assert.equal(validateDesktopApiRequest({ path, method: "GET", ifMatch: '"1"' }), false);
    }
    assert.equal(validateDesktopApiRequest({ path: `${list}/not-a-uuid`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${list}/${sourcePrivateVersionId}/turns`, method: "GET" }), false);
  });
  it("permits only the scoped bodyless submission withdrawal action", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/submissions/${sourcePrivateVersionId}/withdraw`;
    assert.equal(validateDesktopApiRequest({ path, method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "PATCH" }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", ifMatch: '"2"' }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: `${path}?scope=all`, method: "POST" }), false);
    assert.equal(validateDesktopApiRequest({ path: path.replace("/submissions/", "/reviews/"), method: "POST" }), false);
  });
  it("permits decision 0023 governance reads and reasoned actions only in their exact shapes", () => {
    const knowledge = `/api/v1/organizations/${organizationId}/knowledge`;
    const id = sourcePrivateVersionId;
    const body = JSON.stringify({ reason: "Reported" });
    for (const path of [`${knowledge}/governance/publications`, `${knowledge}/governance/inspections/${id}`,
      `${knowledge}/documents/${id}/responsible-view`, `${knowledge}/reports`]) {
      assert.equal(validateDesktopApiRequest({ path, method: "GET" }), true, path);
      assert.equal(validateDesktopApiRequest({ path, method: "POST", body }), false, path);
      assert.equal(validateDesktopApiRequest({ path: `${path}?all=1`, method: "GET" }), false, path);
    }
    for (const path of [`${knowledge}/governance/publications/${id}/inspections`, `${knowledge}/documents/${id}/withdrawal`,
      `${knowledge}/published/${id}/reports`]) {
      assert.equal(validateDesktopApiRequest({ path, method: "POST", body }), true, path);
      assert.equal(validateDesktopApiRequest({ path, method: "POST" }), false, path);
      assert.equal(validateDesktopApiRequest({ path, method: "POST", body, idempotencyKey }), false, path);
      assert.equal(validateDesktopApiRequest({ path, method: "GET" }), false, path);
    }
    const dismiss = `${knowledge}/reports/${id}/dismiss`;
    assert.equal(validateDesktopApiRequest({ path: dismiss, method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path: dismiss, method: "POST", body }), false);
    assert.equal(validateDesktopApiRequest({ path: `${knowledge}/governance/inspections/not-a-uuid`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${knowledge}/documents/${id}/withdrawal`, method: "POST", body, ifMatch: '"1"' }), false);
  });
  it("permits only the scoped bodyless publication retry action", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/submissions/${sourcePrivateVersionId}/publication-retry`;
    assert.equal(validateDesktopApiRequest({ path, method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: path.replace("publication-retry", "retry"), method: "POST" }), false);
    assert.equal(validateDesktopApiRequest({ path: path.replace(sourcePrivateVersionId, "not-a-uuid"), method: "POST" }), false);
  });
  it("permits an author's change request only with a body and an idempotency key", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/documents/${sourcePrivateVersionId}/change-requests`;
    const body = JSON.stringify({ type: "WITHDRAWAL", reason: "Outdated" });
    assert.equal(validateDesktopApiRequest({ path, method: "POST", body, idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", body }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "POST", body, idempotencyKey, ifMatch: '"1"' }), false);
    assert.equal(validateDesktopApiRequest({ path, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${path}?type=all`, method: "POST", body, idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: path.replace(sourcePrivateVersionId, "not-a-uuid"), method: "POST", body, idempotencyKey }), false);
  });
  it("bounds audience-group routes and requires group-specific update preconditions", () => {
    const group = `/api/v1/organizations/${organizationId}/audience-groups/${sourcePrivateVersionId}`;
    assert.equal(validateDesktopApiRequest({ path: group, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: group, method: "PATCH", body: "{}", ifMatch: '"audience-group-2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: group, method: "PATCH", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: group, method: "PATCH", body: "{}", ifMatch: '"role-2"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `${group}/members`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${group}/members/${idempotencyKey}/remove`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${group}/deactivate`, method: "POST", body: "{}", ifMatch: '"audience-group-2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `${group}/deactivate`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${group}/deactivate`, method: "POST", body: '{"unexpected":true}', ifMatch: '"audience-group-2"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `${group}?next=1`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${group}/permissions`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/roles/${sourcePrivateVersionId}`, method: "GET" }), false);
  });
  it("permits a bounded shared-draft create with its idempotency key", () => {
    assert.equal(validateDesktopApiRequest({
      path: sharedDraftPath,
      method: "POST",
      body: JSON.stringify({ sourcePrivateVersionId, classification: "INTERNAL" }),
      idempotencyKey,
    }), true);
  });

  it("allows only a bounded PDF upload route to carry a larger request", () => {
    const pdf = `${sharedDraftPath}/pdf`;
    const body = "x".repeat(200_000);
    assert.equal(validateDesktopApiRequest({ path: pdf, method: "POST", body, idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: pdf, method: "POST", body }), false);
    assert.equal(validateDesktopApiRequest({ path: pdf, method: "GET", body, idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: pdf, method: "POST", body: "x".repeat(7_100_001), idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/new`, method: "POST", body, idempotencyKey }), false);
    assert.equal(desktopApiResponseLimit({ path: pdf, method: "POST", body, idempotencyKey }), 7_100_000);
    assert.equal(desktopApiResponseLimit({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "GET" }), 7_100_000);
    assert.equal(desktopApiResponseLimit({ path: `${sharedDraftPath}/${sourcePrivateVersionId}/versions/${idempotencyKey}`, method: "GET" }), 7_100_000);
    assert.equal(desktopApiResponseLimit({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"1"' }), 7_100_000);
    assert.equal(desktopApiResponseLimit({ path: `${sharedDraftPath}/new`, method: "POST", body: "{}", idempotencyKey }), 1024 * 1024);
  });

  it("rejects missing, malformed, or misrouted idempotency keys", () => {
    const request = { path: sharedDraftPath, method: "POST", body: "{}", idempotencyKey };
    assert.equal(validateDesktopApiRequest({ ...request, idempotencyKey: undefined }), false);
    assert.equal(validateDesktopApiRequest({ ...request, idempotencyKey: "not-a-uuid" }), false);
    assert.equal(validateDesktopApiRequest({ ...request, path: "/api/v1/me", method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ ...request, ifMatch: '"1"' }), false);
    assert.equal(validateDesktopApiRequest({ ...request, path: `${sharedDraftPath}?unexpected=1` }), false);
    assert.equal(validateDesktopApiRequest({ ...request, path: "https://other.invalid/api/v1/me" }), false);
  });

  it("allows exactly the decision 0029 and F03-ARR private-notes organization routes and methods", () => {
    const base = `/api/v1/organizations/${organizationId}/private-workspace`;
    const id = sourcePrivateVersionId;
    const allowed = [
      { path: `${base}/collections`, method: "GET" },
      { path: `${base}/collections`, method: "POST", body: JSON.stringify({ title: "Projects", parentId: null }) },
      { path: `${base}/collections/${id}`, method: "PATCH", body: JSON.stringify({ parentId: id }) },
      { path: `${base}/drafts/${id}/collection`, method: "PUT", body: JSON.stringify({ collectionId: null }) },
      { path: `${base}/drafts/${id}/collection`, method: "PUT", body: JSON.stringify({ collectionId: id, index: 2 }) },
      { path: `${base}/drafts/${id}/archive`, method: "PUT", body: JSON.stringify({ archived: true }) },
      { path: `${base}/archive`, method: "GET" },
      { path: `${base}/drafts/${id}/favorite`, method: "PUT", body: JSON.stringify({ favorite: true }) },
      { path: `${base}/collections/${id}/favorite`, method: "PUT", body: JSON.stringify({ favorite: false }) },
      { path: `${base}/drafts/${id}/duplicate`, method: "POST" },
      { path: `${base}/collections/${id}/duplicate`, method: "POST", body: "{}" },
      { path: `${base}/drafts/${id}/trash`, method: "POST" },
      { path: `${base}/collections/${id}/trash`, method: "POST" },
      { path: `${base}/trash`, method: "GET" },
      { path: `${base}/trash/${id}/restore`, method: "POST" },
      { path: `${base}/trash/${id}/purge`, method: "POST", body: "{}" },
    ];
    for (const request of allowed) assert.equal(validateDesktopApiRequest(request), true, `${request.method} ${request.path}`);
    for (const request of allowed) {
      assert.equal(validateDesktopApiRequest({ ...request, method: "DELETE" }), false);
      assert.equal(validateDesktopApiRequest({ ...request, ifMatch: '"1"' }), false);
      assert.equal(validateDesktopApiRequest({ ...request, idempotencyKey }), false);
      assert.equal(validateDesktopApiRequest({ ...request, path: `${request.path}?x=1` }), false);
    }
    const denied = [
      { path: `${base}/collections`, method: "PUT", body: "{}" },
      { path: `${base}/collections/${id}`, method: "GET" },
      { path: `${base}/collections/${id}`, method: "PUT", body: "{}" },
      { path: `${base}/drafts/${id}`, method: "PUT", body: "{}" },
      { path: `${base}/drafts/${id}/favorite`, method: "PUT" },
      { path: `${base}/drafts/${id}/favorite`, method: "POST", body: "{}" },
      { path: `${base}/drafts/${id}/trash`, method: "POST", body: JSON.stringify({ forever: true }) },
      { path: `${base}/drafts/${id}/purge`, method: "POST" },
      { path: `${base}/trash/${id}`, method: "GET" },
      { path: `${base}/trash/${id}/restore`, method: "GET" },
      { path: `${base}/trash/not-a-uuid/purge`, method: "POST" },
      { path: `${base}/trash`, method: "POST" },
      { path: `${base}/drafts/${id}/archive`, method: "PUT" },
      { path: `${base}/drafts/${id}/archive`, method: "POST", body: "{}" },
      { path: `${base}/archive`, method: "POST", body: "{}" },
      { path: `${base}/archive/${id}`, method: "GET" },
      { path: `${base}/collections/${id}/archive`, method: "PUT", body: JSON.stringify({ archived: true }) },
    ];
    for (const request of denied) assert.equal(validateDesktopApiRequest(request), false, `${request.method} ${request.path}`);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/me", method: "PUT", body: "{}" }), false);
  });

  it("retains existing private-draft and session requests without broadening routes", () => {
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/me", method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/private-workspace/drafts?limit=100`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/private-workspace/drafts/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"1"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/private-workspace/drafts`, method: "POST", body: "{}", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/auth/password", method: "POST", body: JSON.stringify({ password: "synthetic-password" }) }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/auth/password", method: "GET" }), false);
    const changePassword = { path: "/api/v1/auth/change-password", method: "POST", body: "{}" };
    assert.equal(validateDesktopApiRequest(changePassword), true);
    assert.equal(validateDesktopApiRequest({ ...changePassword, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ ...changePassword, body: undefined }), false);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/invitations/4e-SL2tSdcYWMhj7HFTDKIcw5Vks-ygUeOY8JfkuZGg", method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/invitations/4e-SL2tSdcYWMhj7HFTDKIcw5Vks-ygUeOY8JfkuZGg", method: "POST" }), false);
  });

  it("permits the bounded author, reviewer, publication and admin routes", () => {
    const item = `${sharedDraftPath}/${sourcePrivateVersionId}`;
    assert.equal(validateDesktopApiRequest({ path: `${item}/versions`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${item}/versions/${idempotencyKey}`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${item}/versions/${idempotencyKey}`, method: "POST" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${item}/versions/${idempotencyKey}?download=1`, method: "GET" }), false);
    const review = `/api/v1/organizations/${organizationId}/knowledge/reviews/${sourcePrivateVersionId}`;
    const grant = `/api/v1/organizations/${organizationId}/knowledge/reviewer-grants`;
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/new`, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: `${item}/submit`, method: "POST", ifMatch: '"1"', idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: item, method: "PATCH", body: "{}", ifMatch: '"1"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/options`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/published`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/ai/answers`, method: "POST", body: JSON.stringify({ query: "MFA" }) }), true);
    assert.equal(validateDesktopApiRequest({ path: `${review}/decisions`, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: grant, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${grant}/${sourcePrivateVersionId}/deactivate`, method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/administration`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/departments`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/departments/${sourcePrivateVersionId}/delete`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/departments/${sourcePrivateVersionId}/delete`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/administrators", method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/administrators", method: "POST", body: JSON.stringify({ userId: sourcePrivateVersionId }) }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/system/administrators/${sourcePrivateVersionId}/revoke`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/system/administrators/${sourcePrivateVersionId}/revoke`, method: "GET" }), false);
  });

  it("allows only a single explicit publication scope on the published list", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/published`;
    for (const scope of ["ALL_READABLE", "ORGANIZATION", "SHARED"]) {
      assert.equal(validateDesktopApiRequest({ path: `${path}?scope=${scope}`, method: "GET" }), true);
    }
    for (const query of ["scope=PRIVATE", "scope=", "scope=ORGANIZATION&scope=SHARED", "scope=SHARED&admin=true", "scope=organization"]) {
      assert.equal(validateDesktopApiRequest({ path: `${path}?${query}`, method: "GET" }), false);
    }
    assert.equal(validateDesktopApiRequest({ path: `${path}/${sourcePrivateVersionId}?scope=SHARED`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}?scope=SHARED`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${path}?scope=SHARED`, method: "POST", body: "{}" }), false);
  });

  it("rejects method, precondition and route confusion across knowledge endpoints", () => {
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/new`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}/submit`, method: "POST", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "PATCH", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/reviews/${sourcePrivateVersionId}/decisions`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/published/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"1"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/ai/answers`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/options?next=1`, method: "GET" }), false);
  });

  it("allows catalog and PDF replacement only with the intended method, query and version", () => {
    const catalog = `/api/v1/organizations/${organizationId}/knowledge/catalog`;
    assert.equal(validateDesktopApiRequest({ path: catalog, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/readers?q=Name&ids=${sourcePrivateVersionId}`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/readers?redirect=elsewhere`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/collections`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/collections/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"catalog-2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/collections/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"2"' }), false);
    // Decision 0025: Topic routes no longer exist.
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/topics`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/permissions`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "PATCH", body: JSON.stringify({ pdfBase64: "a".repeat(160_000) }), ifMatch: '"2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "PATCH", body: "a".repeat(7_100_001), ifMatch: '"2"' }), false);
  });

  it("permits notification inbox actions without exposing the Realtime credential route to renderer IPC", () => {
    const notifications = `/api/v1/organizations/${organizationId}/notifications`;
    assert.equal(validateDesktopApiRequest({ path: notifications, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}?cursor=eyJpZCI6MX0&unreadOnly=true&limit=25`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}?unreadOnly=false`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}?cursor=bad%20cursor`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}?limit=51`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}?cursor=abc&cursor=def`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}?unexpected=1`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}/${sourcePrivateVersionId}/read`, method: "PATCH" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}/read-all`, method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}/read-all`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${notifications}/realtime-credential`, method: "GET" }), false);
  });

  it("allows maintenance reads and commands only on the exact routes", () => {
    const cases = `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases`;
    assert.equal(validateDesktopApiRequest({ path: `${cases}?scope=mine`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}?scope=queue`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}?scope=all`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: cases, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: cases, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/history`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/versions`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/versions/${sourcePrivateVersionId}`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/versions/${sourcePrivateVersionId}`, method: "POST" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/reviewers`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/links`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/analysis`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/links?count=1`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/reviewers?scope=all`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/claim`, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/publication-link`, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/publication-link`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/compare`, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: `${cases}/${sourcePrivateVersionId}/decisions`, method: "GET" }), false);
    const reports = `/api/v1/organizations/${organizationId}/knowledge/reports`;
    assert.equal(validateDesktopApiRequest({ path: reports, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${reports}?disposition=closed`, method: "GET" }), true);
    const cursor = "44444444-4444-4444-8444-444444444444";
    assert.equal(validateDesktopApiRequest({ path: `${reports}?disposition=closed&cursor=${cursor}`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${reports}?disposition=closed&cursor=invalid`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${reports}?cursor=${cursor}`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${reports}?disposition=open`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/maintenance/imports`, method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/maintenance/imports`, method: "POST", body: "{}" }), false);
  });
});
