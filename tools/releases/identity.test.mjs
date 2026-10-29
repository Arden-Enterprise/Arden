import assert from "node:assert/strict";
import { test } from "node:test";
let identity;
try { identity = await import("./identity.mjs"); } catch (error) { if (error.code !== "ERR_MODULE_NOT_FOUND") throw error; }
const request = { op: "promote", environment: "production", commit: "a".repeat(40), tree: "b".repeat(40), run_id: "12345", attempt: 1 };
const environment = { ACTIONS_ID_TOKEN_REQUEST_URL: "https://pipelines.actions.githubusercontent.com/test?api-version=1",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-request-capability" };

test("job identity module is present", () => assert.ok(identity));
test("identity audience binds all request fields with stable canonical ordering", () => {
  assert.ok(identity);
  assert.equal(identity.requestAudience(request), "https://ardenai.tech/releases/production/promote/36997fe2d6e1b447f721278bb2b8f979b315194ae97dc8f65c926bc18b1036c4");
  assert.equal(identity.requestAudience(request), identity.requestAudience(Object.fromEntries(Object.entries(request).reverse())));
  assert.notEqual(identity.requestAudience(request), identity.requestAudience({ ...request, tree: "c".repeat(40) }));
  assert.notEqual(identity.requestAudience(request), identity.requestAudience({ ...request, op: "deploy" }));
});
test("identity retrieval uses the trusted runner endpoint and bound audience without redirects", async () => {
  assert.ok(identity);
  const token = await identity.requestIdentity(environment, request, async (url, options) => {
    assert.equal(new URL(url).searchParams.get("audience"), identity.requestAudience(request));
    assert.equal(options.headers.Authorization, "Bearer synthetic-request-capability");
    assert.equal(options.redirect, "error");
    return new Response(JSON.stringify({ value: "header.payload.signature" }));
  });
  assert.equal(token, "header.payload.signature");
});
test("missing credentials, untrusted endpoints and oversized responses fail without returning proof", async () => {
  assert.ok(identity);
  for (const patch of [{ ACTIONS_ID_TOKEN_REQUEST_TOKEN: "" }, { ACTIONS_ID_TOKEN_REQUEST_URL: "https://attacker.test/token" },
    { ACTIONS_ID_TOKEN_REQUEST_URL: "http://pipelines.actions.githubusercontent.com/test" }]) {
    await assert.rejects(() => identity.requestIdentity({ ...environment, ...patch }, request, () => assert.fail("must not fetch")));
  }
  await assert.rejects(() => identity.requestIdentity(environment, request,
    async () => new Response(JSON.stringify({ value: "a".repeat(20000) }))));
});
