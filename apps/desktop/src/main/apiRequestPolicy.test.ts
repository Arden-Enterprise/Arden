import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { desktopApiResponseLimit, validateDesktopApiRequest } from "./apiRequestPolicy.ts";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sourcePrivateVersionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idempotencyKey = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const sharedDraftPath = `/api/v1/organizations/${organizationId}/knowledge/drafts`;

describe("desktop API request allowlist", () => {
  it("bounds custom-role routes and requires role-specific update preconditions", () => {
    const role = `/api/v1/organizations/${organizationId}/roles/${sourcePrivateVersionId}`;
    assert.equal(validateDesktopApiRequest({ path: role, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: role, method: "PATCH", body: "{}", ifMatch: '"role-2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: role, method: "PATCH", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: role, method: "PATCH", body: "{}", ifMatch: '"2"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `${role}/assignments`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${role}/assignments/${idempotencyKey}/revoke`, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${role}/deactivate`, method: "POST", body: "{}", ifMatch: '"role-2"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `${role}/deactivate`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${role}/deactivate`, method: "POST", body: '{"unexpected":true}', ifMatch: '"role-2"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `${role}?next=1`, method: "GET" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${role}/permissions`, method: "POST", body: "{}" }), false);
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
  });

  it("permits the bounded author, reviewer, publication and admin routes", () => {
    const item = `${sharedDraftPath}/${sourcePrivateVersionId}`;
    const review = `/api/v1/organizations/${organizationId}/knowledge/reviews/${sourcePrivateVersionId}`;
    const grant = `/api/v1/organizations/${organizationId}/knowledge/reviewer-grants`;
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/new`, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: `${item}/submit`, method: "POST", ifMatch: '"1"', idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: item, method: "PATCH", body: "{}", ifMatch: '"1"' }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/options`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/published`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${review}/decisions`, method: "POST", body: "{}", idempotencyKey }), true);
    assert.equal(validateDesktopApiRequest({ path: grant, method: "POST", body: "{}" }), true);
    assert.equal(validateDesktopApiRequest({ path: `${grant}/${sourcePrivateVersionId}/deactivate`, method: "POST" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/administration`, method: "GET" }), true);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/departments`, method: "POST", body: "{}" }), true);
  });

  it("rejects method, precondition and route confusion across knowledge endpoints", () => {
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/new`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}/submit`, method: "POST", idempotencyKey }), false);
    assert.equal(validateDesktopApiRequest({ path: `${sharedDraftPath}/${sourcePrivateVersionId}`, method: "PATCH", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/reviews/${sourcePrivateVersionId}/decisions`, method: "POST", body: "{}" }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/published/${sourcePrivateVersionId}`, method: "PATCH", body: "{}", ifMatch: '"1"' }), false);
    assert.equal(validateDesktopApiRequest({ path: `/api/v1/organizations/${organizationId}/knowledge/options?next=1`, method: "GET" }), false);
  });
});
