import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { desktopApiResponseLimit, desktopApiTimeout, validateDesktopApiRequest } from "./apiRequestPolicy.ts";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourcePrivateVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idempotencyKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sharedDraftPath = `/api/v1/organizations/${organizationId}/knowledge/drafts`;

describe("desktop API request allowlist", () => {
  it("permits reviewer AI only with a snapshot identity and a main-owned timeout", () => {
    const path = `/api/v1/organizations/${organizationId}/knowledge/reviews/${sourcePrivateVersionId}/ai-review`;
    const input = { snapshotVersionId: sourcePrivateVersionId, snapshotContentHash: "a".repeat(64) };
    const request = { path, method: "POST" as const, body: JSON.stringify(input) };
    assert.equal(validateDesktopApiRequest(request), true);
    assert.equal(desktopApiTimeout(request), 85_000);
    assert.equal(validateDesktopApiRequest({ ...request, path: `${path}?scope=all` }), false);
    assert.equal(validateDesktopApiRequest({ ...request, timeoutMs: 60_000 }), false);
    assert.equal(validateDesktopApiRequest({ ...request, body: JSON.stringify({ ...input, content: "draft" }) }), false);
  });
  it("allows only a bounded writing action body with a Core-owned deadline", () => {
    const path = `/api/v1/organizations/${organizationId}/ai/writing-actions`;
    const payload = { requestId: idempotencyKey, action: "IMPROVE", scope: "SELECTION", text: "A sentence." };
    const request = { path, method: "POST" as const, body: JSON.stringify(payload) };
    assert.equal(validateDesktopApiRequest(request), true);
    assert.equal(desktopApiTimeout(request), 90_000);
    for (const body of ["{}", JSON.stringify({ ...payload, text: " " }), JSON.stringify({ ...payload, text: "x".repeat(12_001) }),
      JSON.stringify({ ...payload, scope: "ALL" }), JSON.stringify({ ...payload, source: "private-note" })]) {
      assert.equal(validateDesktopApiRequest({ ...request, body }), false);
    }
    for (const change of [{ method: "GET" }, { path: `${path}?all=1` }, { timeoutMs: 60_000 }, { idempotencyKey }]) {
      assert.equal(validateDesktopApiRequest({ ...request, ...change }), false);
    }
  });
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
    assert.equal(desktopApiResponseLimit({ path: list, method: "GET" }), 1024 * 1024);
  });
  it("allows paginated conversation detail queries and raises only conversation detail response limit to 2 MiB", () => {
    const list = `/api/v1/organizations/${organizationId}/ai/conversations`;
    const detail = `${list}/${sourcePrivateVersionId}`;
    for (const path of [
      detail,
      `${detail}?limit=1`,
      `${detail}?limit=20`,
      `${detail}?limit=50`,
      `${detail}?beforeSequence=1`,
      `${detail}?beforeSequence=2147483647`,
      `${detail}?limit=20&beforeSequence=40`,
    ]) {
      assert.equal(validateDesktopApiRequest({ path, method: "GET" }), true, path);
      assert.equal(desktopApiResponseLimit({ path, method: "GET" }), 2 * 1024 * 1024, path);
    }
    for (const path of [
      `${list}?limit=20`,
      `${list}?beforeSequence=10`,
      `${detail}?limit=0`,
      `${detail}?limit=51`,
      `${detail}?limit=01`,
      `${detail}?limit=-5`,
      `${detail}?limit=abc`,
      `${detail}?limit=20&limit=10`,
      `${detail}?beforeSequence=0`,
      `${detail}?beforeSequence=-1`,
      `${detail}?beforeSequence=01`,
      `${detail}?beforeSequence=1.5`,
      `${detail}?beforeSequence=2147483648`,
      `${detail}?beforeSequence=10&beforeSequence=20`,
      `${detail}?limit=20&owner=all`,
    ]) {
      assert.equal(validateDesktopApiRequest({ path, method: "GET" }), false, path);
    }
    assert.equal(desktopApiResponseLimit({ path: list, method: "GET" }), 1024 * 1024);
    assert.equal(desktopApiResponseLimit({
      path: `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases/${sourcePrivateVersionId}/versions`,
      method: "GET",
    }), 1024 * 1024);
    assert.equal(desktopApiResponseLimit({
      path: `/api/v1/organizations/${organizationId}/knowledge/maintenance/cases/${sourcePrivateVersionId}/versions/${idempotencyKey}`,
      method: "GET",
    }), 7_100_000);
    assert.equal(desktopApiResponseLimit({ path: "/api/v1/me", method: "GET" }), 1024 * 1024);
  });
  it("validates POST /ai/answers strictly with optional scopeFilter and a main-owned 120s deadline", () => {
    const path = `/api/v1/organizations/${organizationId}/ai/answers`;
    const makeUuid = (index: number) => `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, "0")}`;
    const fiftyUuids = Array.from({ length: 50 }, (_, index) => makeUuid(index + 1));
    const minimal = { path, method: "POST" as const, body: JSON.stringify({ query: "What is our MFA policy?" }) };
    const full = {
      path,
      method: "POST" as const,
      body: JSON.stringify({
        query: "Compare these documents",
        conversationId: sourcePrivateVersionId,
        requestId: idempotencyKey,
        expectedRevision: 0,
        scopeFilter: { documentIds: fiftyUuids },
      }),
    };
    assert.equal(validateDesktopApiRequest(minimal), true);
    assert.equal(validateDesktopApiRequest(full), true);
    assert.equal(validateDesktopApiRequest({
      path,
      method: "POST",
      body: JSON.stringify({ query: "😀".repeat(4_000), expectedRevision: 1_000_000, scopeFilter: { documentIds: [makeUuid(1)] } }),
    }), true);
    assert.equal(desktopApiTimeout(minimal), 120_000);
    assert.equal(desktopApiTimeout({ ...minimal, timeoutMs: 15_000 }), 120_000);
    assert.equal(desktopApiResponseLimit(minimal), 1024 * 1024);

    const paddedExact = JSON.stringify({ query: "ok" });
    assert.equal(validateDesktopApiRequest({
      path,
      method: "POST",
      body: `${" ".repeat(32_768 - Buffer.byteLength(paddedExact, "utf8"))}${paddedExact}`,
    }), true);
    assert.equal(validateDesktopApiRequest({
      path,
      method: "POST",
      body: `${" ".repeat(32_769 - Buffer.byteLength(paddedExact, "utf8"))}${paddedExact}`,
    }), false);

    const invalidBodies = [
      undefined,
      "",
      "not-json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ query: "" }),
      JSON.stringify({ query: "   \n\t  " }),
      JSON.stringify({ query: 123 }),
      JSON.stringify({ query: "x".repeat(4_001) }),
      JSON.stringify({ query: "😀".repeat(4_001) }),
      JSON.stringify({ query: "ok", extra: true }),
      '{"query":"ok","__proto__":{"polluted":true}}',
      JSON.stringify({ query: "ok", conversationId: "not-a-uuid" }),
      JSON.stringify({ query: "ok", conversationId: null }),
      JSON.stringify({ query: "ok", requestId: "not-a-uuid" }),
      JSON.stringify({ query: "ok", expectedRevision: -1 }),
      JSON.stringify({ query: "ok", expectedRevision: 1_000_001 }),
      JSON.stringify({ query: "ok", expectedRevision: 1.5 }),
      JSON.stringify({ query: "ok", expectedRevision: "0" }),
      JSON.stringify({ query: "ok", scopeFilter: null }),
      JSON.stringify({ query: "ok", scopeFilter: [] }),
      JSON.stringify({ query: "ok", scopeFilter: {} }),
      JSON.stringify({ query: "ok", scopeFilter: { documentIds: [] } }),
      JSON.stringify({ query: "ok", scopeFilter: { documentIds: [makeUuid(1), makeUuid(1)] } }),
      JSON.stringify({ query: "ok", scopeFilter: { documentIds: [...fiftyUuids, makeUuid(51)] } }),
      JSON.stringify({ query: "ok", scopeFilter: { documentIds: ["not-a-uuid"] } }),
      JSON.stringify({ query: "ok", scopeFilter: { documentIds: [makeUuid(1)], extra: true } }),
      `{"query":"ok","scopeFilter":{"documentIds":["${makeUuid(1)}"],"__proto__":{}}}`,
    ];
    for (const body of invalidBodies) {
      assert.equal(validateDesktopApiRequest({ path, method: "POST", body }), false, `body=${String(body).slice(0, 80)}`);
    }
    for (const change of [
      { method: "GET" as const },
      { path: `${path}?scope=all` },
      { ifMatch: '"1"' },
      { idempotencyKey },
      { timeoutMs: 30_000 },
    ]) {
      assert.equal(validateDesktopApiRequest({ ...minimal, ...change }), false);
    }
  });
  it("allows only exact renewal list and document renewal request shapes", () => {
    const renewalsPath = `/api/v1/organizations/${organizationId}/knowledge/renewals`;
    const renewalRequestPath = `/api/v1/organizations/${organizationId}/knowledge/documents/${sourcePrivateVersionId}/renewal`;
    const validDatedBody = JSON.stringify({ expirationDate: "2027-06-30", reason: "Verified current for FY27" });
    const validIndefiniteBody = JSON.stringify({ expirationDate: null, reason: "Evergreen standard" });

    assert.equal(validateDesktopApiRequest({ path: renewalsPath, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${renewalsPath}?documentId=${sourcePrivateVersionId}`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${renewalsPath}?documentId=not-a-uuid`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${renewalsPath}?documentId=${sourcePrivateVersionId}&documentId=${sourcePrivateVersionId}`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${renewalsPath}?documentId=${sourcePrivateVersionId}&all=1`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: renewalsPath, method: "POST", body: "{}", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: renewalsPath, method: "GET", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: renewalsPath, method: "GET", ifMatch: '"1"' }), false);
    assert.equal(validateDesktopApiRequest({ path: renewalsPath, method: "GET", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: `${renewalsPath}?all=1`, method: "GET" }), false);

    assert.equal(validateDesktopApiRequest({ path: renewalRequestPath, method: "POST", body: validDatedBody, idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: renewalRequestPath, method: "POST", body: validIndefiniteBody, idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: renewalRequestPath, method: "POST", body: validDatedBody }), false);
    assert.equal(validateDesktopApiRequest({ path: renewalRequestPath, method: "POST", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: renewalRequestPath, method: "POST", body: validDatedBody, idempotencyKey, ifMatch: '"1"' }), false);
    assert.equal(validateDesktopApiRequest({ path: renewalRequestPath, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${renewalRequestPath}?force=1`, method: "POST", body: validDatedBody, idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({
      path: renewalRequestPath.replace(sourcePrivateVersionId, "not-a-uuid"),
      method: "POST",
      body: validDatedBody,
      idempotencyKey,
    }), false);
    for (const badBody of [
      "{}",
      JSON.stringify({ expirationDate: "2027-06-30" }),
      JSON.stringify({ reason: "Missing date field" }),
      JSON.stringify({ expirationDate: "2027-06-30", reason: "" }),
      JSON.stringify({ expirationDate: "2027-06-30", reason: "x".repeat(4_001) }),
      JSON.stringify({ expirationDate: "2027-06-30T00:00:00Z", reason: "Too long date" }),
      JSON.stringify({ expirationDate: "2027-06-30", reason: "Ok", extra: true }),
    ]) {
      assert.equal(validateDesktopApiRequest({ path: renewalRequestPath, method: "POST", body: badBody, idempotencyKey }), false, badBody);
    }
  });
  it("allows an exact Company turn feedback update", () => {
    const path = `/api/v1/organizations/${organizationId}/ai/conversations/${sourcePrivateVersionId}/turns/${idempotencyKey}/feedback`;
    for (const feedback of ["GOOD", "BAD", null]) {
      assert.equal(validateDesktopApiRequest({ path, method: "PUT", body: JSON.stringify({ feedback }) }), true);
    }
    const request = { path, method: "PUT", body: '{"feedback":"GOOD"}' };
    for (const change of [{ method: "POST" }, { path: `${path}?all=1` }, { body: '{"feedback":true}' },
      { body: '{"feedback":"BAD","answer":"sensitive text"}' }, { ifMatch: '"1"' }]) {
      assert.equal(validateDesktopApiRequest({ ...request, ...change }), false);
    }
  });
  it("limits private feedback and analytics to their exact IPC shapes", () => {
    const path = `/api/v1/organizations/${organizationId}/ai/private-feedback`;
    const token = `${idempotencyKey}.1795500000000.${"A".repeat(43)}`;
    const request = { path, method: "PUT", body: JSON.stringify({ token, feedback: "GOOD" }) };
    assert.equal(validateDesktopApiRequest(request), true);
    for (const change of [{ path: `${path}?all=1` }, { method: "POST" },
      { body: JSON.stringify({ token, feedback: "BAD", documentId: sourcePrivateVersionId }) }]) {
      assert.equal(validateDesktopApiRequest({ ...request, ...change }), false);
    }
    const analytics = { path: "/api/v1/system/analytics/private-feedback", method: "GET" };
    assert.equal(validateDesktopApiRequest(analytics), true);
    // The Console sends its date range; only the shared report query keys are accepted.
    assert.equal(validateDesktopApiRequest({ ...analytics, path: `${analytics.path}?from=2026-11-01T00%3A00%3A00Z&to=2026-11-27T00%3A00%3A00Z` }), true);
    assert.equal(validateDesktopApiRequest({ ...analytics, path: `${analytics.path}?all=1` }), false);
    assert.equal(validateDesktopApiRequest({ ...analytics, method: "POST", body: "{}" }), false);
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
  it("rejects the removed reader group routes (decision 0039)", () => {
    const groups = `/api/v1/organizations/${organizationId}/audience-groups`;
    const group = `${groups}/${sourcePrivateVersionId}`;
    const refused = [
      { path: groups, method: "GET" },
      { path: groups, method: "POST", body: "{}" },
      { path: group, method: "GET" },
      { path: group, method: "PATCH", body: "{}", ifMatch: '"audience-group-2"' },
      { path: `${group}/members`, method: "POST", body: "{}" },
      { path: `${group}/members/${idempotencyKey}/remove`, method: "POST", body: "{}" },
      { path: `${group}/deactivate`, method: "POST", body: "{}", ifMatch: '"audience-group-2"' },
    ];
    for (const request of refused) assert.equal(validateDesktopApiRequest(request), false, `${request.method} ${request.path}`);
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

  it("allows exactly the decision 0034 direct-share routes", () => {
    const organization = `/api/v1/organizations/${organizationId}`;
    const id = sourcePrivateVersionId;
    const shares = `${organization}/private-workspace/drafts/${id}/shares`;
    const allowed = [
      { path: shares, method: "GET" },
      { path: shares, method: "POST", body: JSON.stringify({ recipientMembershipIds: [id] }) },
      { path: `${shares}/${id}/revoke`, method: "POST" },
      { path: `${shares}/revoke-all`, method: "POST" },
      { path: `${organization}/shared-with-me`, method: "GET" },
      { path: `${organization}/shared-with-me/${id}`, method: "GET" },
      { path: `${organization}/shared-with-me/${id}/pdf`, method: "GET" },
      { path: `${organization}/direct-sharing`, method: "GET" },
      { path: `${organization}/direct-sharing`, method: "PUT", body: JSON.stringify({ enabled: true, recipientLimit: 10 }) },
    ];
    for (const request of allowed) assert.equal(validateDesktopApiRequest(request), true, `${request.method} ${request.path}`);
    assert.equal(desktopApiResponseLimit({ path: `${organization}/shared-with-me/${id}/pdf`, method: "GET" }), 7_100_000);
    const refused = [
      { path: `${shares}/revoke-all`, method: "POST", body: "{}" },
      { path: `${organization}/shared-with-me/${id}`, method: "PATCH", body: "{}", ifMatch: '"1"' },
      { path: `${organization}/shared-with-me?all=1`, method: "GET" },
      { path: `${organization}/direct-sharing`, method: "POST", body: "{}" },
      { path: shares, method: "PUT", body: "{}" },
    ];
    for (const request of refused) assert.equal(validateDesktopApiRequest(request), false, `${request.method} ${request.path}`);
  });

  it("allows exactly the decision 0034 private PDF routes and their size limits", () => {
    const base = `/api/v1/organizations/${organizationId}/private-workspace/drafts`;
    const id = sourcePrivateVersionId;
    const upload = JSON.stringify({ title: "Minutes", pdfBase64: "a".repeat(6_900_000), text: "" });
    assert.equal(validateDesktopApiRequest({ path: `${base}/pdf`, method: "POST", body: upload }), true);
    assert.equal(validateDesktopApiRequest({ path: `${base}/${id}/pdf`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${base}/${id}/pdf`, method: "PUT", body: upload, ifMatch: '"2"' }), true);
    assert.equal(desktopApiResponseLimit({ path: `${base}/${id}/pdf`, method: "GET" }), 7_100_000);
    // Replacing needs the version it was based on; no other method, query or oversized body is accepted.
    assert.equal(validateDesktopApiRequest({ path: `${base}/${id}/pdf`, method: "PUT", body: upload }), false);
    assert.equal(validateDesktopApiRequest({ path: `${base}/${id}/pdf`, method: "PATCH", body: upload, ifMatch: '"2"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `${base}/pdf?x=1`, method: "POST", body: upload }), false);
    assert.equal(validateDesktopApiRequest({ path: `${base}/pdf`, method: "POST", body: "a".repeat(7_200_000) }), false);
    assert.equal(validateDesktopApiRequest({ path: `${base}/${id}`, method: "PATCH", body: upload, ifMatch: '"2"' }), false);
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
    const invitationAccount = { path: "/api/v1/invitations/4e-SL2tSdcYWMhj7HFTDKIcw5Vks-ygUeOY8JfkuZGg/account", method: "POST",
      body: JSON.stringify({ fullName: "Synthetic Member", password: "Synthetic-password1" }) };
    assert.equal(validateDesktopApiRequest(invitationAccount), true);
    assert.equal(validateDesktopApiRequest({ ...invitationAccount, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ ...invitationAccount, body: undefined }), false);
    assert.equal(validateDesktopApiRequest({ ...invitationAccount, path: "/api/v1/invitations/short/account" }), false);
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
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/administrators", method: "POST", body: JSON.stringify({ email: "monitor@example.test", fullName: "Monitor", password: "StrongPassword!1" }) }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/system/administrators/${sourcePrivateVersionId}/revoke`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/system/administrators/${sourcePrivateVersionId}/revoke`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/system/administrators/${sourcePrivateVersionId}`, method: "PATCH", body: JSON.stringify({ canManageSystemAdmins: true }) }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/reports/ai-usage?from=2026-01-01&to=2026-01-31", method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/health?secret=1", method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/setup/status", method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/setup/status?all=1", method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/setup", method: "POST", body: JSON.stringify({ setupToken: "tok", email: "a@b.c", fullName: "Op", password: "Password!1" }) }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/setup", method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/auth/me", method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/auth/sign-in", method: "POST", body: JSON.stringify({ email: "a@b.c", password: "Password!1" }) }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/auth/sign-out", method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path: "/api/v1/system/auth/sign-out", method: "POST", body: "{}" }), false);
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

  it("allows GET /knowledge/graph only with strictly validated query parameters and 1 MiB response budget", () => {
    const graph = `/api/v1/organizations/${organizationId}/knowledge/graph`;
    const deptId = "44444444-4444-4444-8444-444444444444";
    const colId = "55555555-5555-4555-8555-555555555555";
    const focusId = "66666666-6666-4666-8666-666666666666";

    const validPaths = [
      graph,
      `${graph}?view=accountability`,
      `${graph}?view=collections`,
      `${graph}?q=MFA%20Policy`,
      `${graph}?q=${encodeURIComponent("😀".repeat(120))}`,
      `${graph}?ownerDepartmentId=${deptId}`,
      `${graph}?typeCode=POLICY_AND_STANDARD`,
      `${graph}?typeCode=PROCEDURE`,
      `${graph}?typeCode=GUIDE`,
      `${graph}?typeCode=REFERENCE`,
      `${graph}?typeCode=LESSONS_LEARNED`,
      `${graph}?typeCode=UNCATEGORIZED`,
      `${graph}?collectionId=${colId}`,
      `${graph}?collectionId=UNASSIGNED`,
      `${graph}?readerScope=ORGANIZATION`,
      `${graph}?readerScope=DEPARTMENT`,
      `${graph}?readerScope=SELECTED_MEMBERS`,
      `${graph}?readerScope=LEGACY_AUDIENCE`,
      `${graph}?validity=CURRENT`,
      `${graph}?validity=EXPIRING_SOON`,
      `${graph}?validity=EXPIRED`,
      `${graph}?includeLinks=true`,
      `${graph}?includeLinks=false`,
      `${graph}?relationshipTypes=REFERENCES`,
      `${graph}?relationshipTypes=REFERENCES,RELATED,SUPERSEDES`,
      `${graph}?monitor=true&onlyOpenCases=true&onlyUnassignedOrg=false&includeExpired=true`,
      `${graph}?focusDocumentId=${focusId}`,
      `${graph}?limit=1`,
      `${graph}?limit=500`,
      `${graph}?view=collections&q=handbook&ownerDepartmentId=${deptId}&typeCode=POLICY_AND_STANDARD&collectionId=UNASSIGNED&readerScope=ORGANIZATION&validity=EXPIRING_SOON&includeLinks=true&relationshipTypes=REFERENCES,SUPERSEDES&monitor=true&onlyOpenCases=false&onlyUnassignedOrg=true&includeExpired=false&focusDocumentId=${focusId}&limit=250`,
    ];
    for (const path of validPaths) {
      assert.equal(validateDesktopApiRequest({ path, method: "GET" }), true, path);
    }
    assert.equal(validateDesktopApiRequest({ path: graph, method: "GET", timeoutMs: 15_000 }), true);
    assert.equal(desktopApiResponseLimit({ path: graph, method: "GET" }), 1024 * 1024);

    const invalidRequests = [
      { path: graph, method: "POST" as const, body: "{}" },
      { path: graph, method: "PATCH" as const, body: "{}" },
      { path: graph, method: "PUT" as const, body: "{}" },
      { path: graph, method: "GET" as const, body: "{}" },
      { path: graph, method: "GET" as const, ifMatch: '"1"' },
      { path: graph, method: "GET" as const, idempotencyKey },
      { path: `/api/v1/organizations/not-a-uuid/knowledge/graph`, method: "GET" as const },
      { path: `${graph}#section`, method: "GET" as const },
      { path: `${graph}?unknown=1`, method: "GET" as const },
      { path: `${graph}?view=accountability&view=collections`, method: "GET" as const },
      { path: `${graph}?view=tree`, method: "GET" as const },
      { path: `${graph}?q=${"a".repeat(121)}`, method: "GET" as const },
      { path: `${graph}?q=${encodeURIComponent("😀".repeat(121))}`, method: "GET" as const },
      { path: `${graph}?ownerDepartmentId=not-a-uuid`, method: "GET" as const },
      { path: `${graph}?typeCode=Policy%20%26%20Standard`, method: "GET" as const },
      { path: `${graph}?typeCode=OTHER`, method: "GET" as const },
      { path: `${graph}?collectionId=not-a-uuid`, method: "GET" as const },
      { path: `${graph}?collectionId=ALL`, method: "GET" as const },
      { path: `${graph}?readerScope=PRIVATE`, method: "GET" as const },
      { path: `${graph}?validity=PAST`, method: "GET" as const },
      { path: `${graph}?includeLinks=1`, method: "GET" as const },
      { path: `${graph}?includeLinks=yes`, method: "GET" as const },
      { path: `${graph}?relationshipTypes=`, method: "GET" as const },
      { path: `${graph}?relationshipTypes=UNKNOWN`, method: "GET" as const },
      { path: `${graph}?relationshipTypes=REFERENCES,REFERENCES`, method: "GET" as const },
      { path: `${graph}?relationshipTypes=REFERENCES,`, method: "GET" as const },
      { path: `${graph}?relationshipTypes=,RELATED`, method: "GET" as const },
      { path: `${graph}?monitor=1`, method: "GET" as const },
      { path: `${graph}?onlyOpenCases=yes`, method: "GET" as const },
      { path: `${graph}?onlyUnassignedOrg=0`, method: "GET" as const },
      { path: `${graph}?includeExpired=2`, method: "GET" as const },
      { path: `${graph}?focusDocumentId=not-a-uuid`, method: "GET" as const },
      { path: `${graph}?limit=0`, method: "GET" as const },
      { path: `${graph}?limit=01`, method: "GET" as const },
      { path: `${graph}?limit=501`, method: "GET" as const },
      { path: `${graph}?limit=-1`, method: "GET" as const },
      { path: `${graph}?limit=1.5`, method: "GET" as const },
      { path: `${graph}?limit=abc`, method: "GET" as const },
      { path: `${graph}?limit=10&limit=20`, method: "GET" as const },
    ];
    for (const req of invalidRequests) {
      assert.equal(validateDesktopApiRequest(req), false, `${req.method} ${req.path}`);
    }
  });

  it("allows governed document relationship create and remove POST routes only with UUID idempotencyKey and strict bodies", () => {
    const docId = sourcePrivateVersionId;
    const targetDocumentId = "44444444-4444-4444-8444-444444444444";
    const relationshipId = "55555555-5555-4555-8555-555555555555";
    const createPath = `/api/v1/organizations/${organizationId}/knowledge/documents/${docId}/relationships`;
    const removePath = `${createPath}/${relationshipId}/remove`;

    for (const relationshipType of ["REFERENCES", "RELATED", "SUPERSEDES"]) {
      const req = {
        path: createPath,
        method: "POST" as const,
        body: JSON.stringify({ targetDocumentId, relationshipType }),
        idempotencyKey,
      };
      assert.equal(validateDesktopApiRequest(req), true, relationshipType);
      assert.equal(desktopApiResponseLimit(req), 1024 * 1024);
    }

    const validRemove = {
      path: removePath,
      method: "POST" as const,
      body: "{}",
      idempotencyKey,
    };
    assert.equal(validateDesktopApiRequest(validRemove), true);
    assert.equal(desktopApiResponseLimit(validRemove), 1024 * 1024);

    const invalidCreate = [
      { path: createPath, method: "GET" as const, idempotencyKey },
      { path: createPath, method: "PATCH" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED" }), idempotencyKey },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED" }) },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED" }), idempotencyKey: "not-a-uuid" },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED" }), idempotencyKey, ifMatch: '"1"' },
      { path: `${createPath}?force=1`, method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED" }), idempotencyKey },
      { path: `${createPath}#hash`, method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED" }), idempotencyKey },
      { path: createPath.replace(docId, "not-a-uuid"), method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED" }), idempotencyKey },
      { path: createPath, method: "POST" as const, idempotencyKey },
      { path: createPath, method: "POST" as const, body: "{}", idempotencyKey },
      { path: createPath, method: "POST" as const, body: "null", idempotencyKey },
      { path: createPath, method: "POST" as const, body: "[]", idempotencyKey },
      { path: createPath, method: "POST" as const, body: "not-json", idempotencyKey },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ targetDocumentId }), idempotencyKey },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ relationshipType: "RELATED" }), idempotencyKey },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ targetDocumentId: "not-a-uuid", relationshipType: "RELATED" }), idempotencyKey },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "PARENT" }), idempotencyKey },
      { path: createPath, method: "POST" as const, body: JSON.stringify({ targetDocumentId, relationshipType: "RELATED", extra: true }), idempotencyKey },
      { path: createPath, method: "POST" as const, body: `{"targetDocumentId":"${targetDocumentId}","relationshipType":"RELATED","__proto__":{}}`, idempotencyKey },
    ];
    for (const req of invalidCreate) {
      assert.equal(validateDesktopApiRequest(req), false, `create invalid: ${JSON.stringify(req)}`);
    }

    const invalidRemove = [
      { path: removePath, method: "GET" as const, idempotencyKey },
      { path: removePath, method: "POST" as const, body: "{}" },
      { path: removePath, method: "POST" as const, body: "{}", idempotencyKey: "bad" },
      { path: removePath, method: "POST" as const, body: "{}", idempotencyKey, ifMatch: '"1"' },
      { path: `${removePath}?force=1`, method: "POST" as const, body: "{}", idempotencyKey },
      { path: removePath.replace(relationshipId, "not-a-uuid"), method: "POST" as const, body: "{}", idempotencyKey },
      { path: removePath, method: "POST" as const, idempotencyKey },
      { path: removePath, method: "POST" as const, body: "", idempotencyKey },
      { path: removePath, method: "POST" as const, body: "[]", idempotencyKey },
      { path: removePath, method: "POST" as const, body: "null", idempotencyKey },
      { path: removePath, method: "POST" as const, body: JSON.stringify({ force: true }), idempotencyKey },
      { path: removePath, method: "POST" as const, body: '{"__proto__":{}}', idempotencyKey },
    ];
    for (const req of invalidRemove) {
      assert.equal(validateDesktopApiRequest(req), false, `remove invalid: ${JSON.stringify(req)}`);
    }
  });
});
