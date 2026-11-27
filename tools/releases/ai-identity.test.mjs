import assert from "node:assert/strict";
import { test } from "node:test";
import { requestAiAudience, requestAiIdentity } from "./ai-identity.mjs";
import { requestAudience as coreAudience } from "./identity.mjs";

test("AI identity audience uses distinct /releases-ai/ namespace and canonical field order", () => {
  const a = { op: "promote", environment: "production", commit: "a".repeat(40), ai_tree: "b".repeat(40), run_id: "7", attempt: 1 };
  const b = { attempt: 1, run_id: "7", ai_tree: "b".repeat(40), commit: "a".repeat(40), environment: "production", op: "promote" };
  const audA = requestAiAudience(a);
  assert.equal(audA, requestAiAudience(b));
  assert.ok(audA.startsWith("https://ardenai.tech/releases-ai/production/promote/"));
  assert.notEqual(audA, coreAudience(a));
});

test("requestAiIdentity uses trusted runner endpoint with bound audience and no redirects", async () => {
  let seenUrl;
  let seenOptions;
  const token = await requestAiIdentity(
    {
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com/id?existing=1",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "runner-oidc-token",
    },
    { op: "deploy", environment: "staging", manifest: { commit: "a".repeat(40) } },
    async (url, options) => {
      seenUrl = url;
      seenOptions = options;
      return new Response(JSON.stringify({ value: "aaa.bbb.ccc" }), { status: 200 });
    },
  );
  assert.equal(token, "aaa.bbb.ccc");
  assert.equal(seenOptions.redirect, "error");
  assert.ok(seenUrl.searchParams.get("audience").startsWith("https://ardenai.tech/releases-ai/staging/deploy/"));
});

test("requestAiIdentity rejects untrusted endpoints, missing creds, and oversized payloads", async () => {
  const req = { op: "promote", environment: "production" };
  await assert.rejects(() => requestAiIdentity({
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://evil.example.test/id",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "tok",
  }, req));
  await assert.rejects(() => requestAiIdentity({
    ACTIONS_ID_TOKEN_REQUEST_URL: "http://token.actions.githubusercontent.com/id",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "tok",
  }, req));
  await assert.rejects(() => requestAiIdentity({
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://token.actions.githubusercontent.com/id",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "tok",
  }, req, async () => new Response("x".repeat(20000), { status: 200 })));
});
