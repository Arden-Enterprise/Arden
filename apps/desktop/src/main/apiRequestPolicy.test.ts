import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { desktopApiResponseLimit, validateDesktopApiRequest } from "./apiRequestPolicy.ts";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourcePrivateVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idempotencyKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sharedDraftPath = `/api/v1/organizations/${organizationId}/knowledge/drafts`;

describe("desktop API request allowlist", () => {
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
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/topics`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/topics/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"catalog-2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/topics/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"2"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `${catalog}/permissions`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "PATCH", body: JSON.stringify({ pdfBase64: "a".repeat(160_000) }), ifMatch: '"2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "PATCH", body: "a".repeat(7_100_001), ifMatch: '"2"' }), false);
  });
});
