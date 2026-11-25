import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
import { registerWritingRoutes } from "./routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

function harness(enabled = true) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  apps.push(app);
  const userId = randomUUID(), organizationId = randomUUID();
  const membershipId = randomUUID();
  const membership = vi.fn(async (actor: string, org: string) =>
    actor === userId && org === organizationId ? { membershipId, userId, organizationId } : null);
  const writing = vi.fn(async (request: unknown): Promise<unknown> => {
    const input = request as Record<string, unknown>;
    return {
      contractVersion: 1, requestId: input.requestId, action: input.action,
      status: "CHANGED", text: "Better text.", sourceQuote: "",
    };
  });
  registerWritingRoutes(app, { requireActiveMembership: membership }, { writing },
    async request => ({ userId: request.headers["x-other-user"] ? randomUUID() : userId }),
    "^[0-9a-f-]{36}$", new Set(enabled ? [organizationId] : []));
  const path = `/api/v1/organizations/${organizationId}/ai/writing-actions`;
  const payload = { requestId: randomUUID(), action: "IMPROVE", scope: "SELECTION", text: "Original text." };
  const run = (options = {}) => app.inject({ method: "POST", url: path, payload, ...options });
  return { run, path, payload, membership, writing, organizationId };
}

it("requires membership and organization opt-in before sending text to AI", async () => {
  const h = harness();
  expect((await h.run({ headers: { "x-other-user": "1" } })).statusCode).toBe(404);
  expect((await h.run({ url: h.path.replace(h.organizationId, randomUUID()) })).statusCode).toBe(404);
  expect(h.writing).not.toHaveBeenCalled();
  const disabled = harness(false);
  expect((await disabled.run()).json()).toMatchObject({ error: { code: "WRITING_AI_DISABLED" } });
  expect(disabled.writing).not.toHaveBeenCalled();
});

it("forwards a bounded selection and returns a validated suggestion without editing data", async () => {
  const h = harness();
  const response = await h.run();
  expect(response.statusCode).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(h.writing).toHaveBeenCalledWith({ contractVersion: 1, ...h.payload });
  expect(response.json()).toMatchObject({ status: "CHANGED", text: "Better text." });
  expect(h.membership).toHaveBeenCalledTimes(2);
});

it("rejects extra fields, invalid scope and oversized content before inference", async () => {
  const h = harness();
  for (const payload of [
    { ...h.payload, source: "all-notes" },
    { ...h.payload, scope: "ORGANIZATION" },
    { ...h.payload, text: "x".repeat(12_001) },
    { ...h.payload, text: "   " },
  ]) expect((await h.run({ payload })).statusCode).toBe(400);
  expect((await h.run({ url: `${h.path}?all=true` })).statusCode).toBe(400);
  expect(h.writing).not.toHaveBeenCalled();
});

it("withholds AI output if access changes during generation or the response is invalid", async () => {
  const h = harness();
  h.writing.mockImplementationOnce(async request => {
    h.membership.mockResolvedValueOnce(null);
    const input = request as Record<string, unknown>;
    return { contractVersion: 1, requestId: input.requestId, action: input.action,
      status: "CHANGED", text: "Private output", sourceQuote: "" };
  });
  expect((await h.run()).json()).toMatchObject({ error: { code: "ACCESS_CHANGED" } });
  const invalid = harness();
  invalid.writing.mockResolvedValueOnce({ contractVersion: 1, requestId: invalid.payload.requestId,
    action: "IMPROVE", status: ["CHANGED"], text: "See https://attacker.example", sourceQuote: "" });
  expect((await invalid.run({ payload: { ...invalid.payload, text: "See https://trusted.example" } })).json())
    .toMatchObject({ error: { code: "WRITING_UNAVAILABLE" } });
});

it("requires an exact page quote for Explain", async () => {
  const h = harness();
  h.writing.mockResolvedValueOnce({ contractVersion: 1, requestId: h.payload.requestId, action: "EXPLAIN",
    status: "EXPLAINED", text: "A simple explanation.", sourceQuote: "Invented quote" });
  expect((await h.run({ payload: { ...h.payload, action: "EXPLAIN", scope: "PAGE" } })).statusCode).toBe(503);
});

it("rejects a reformat that changes words or an improve that changes protected inline content", async () => {
  const reformatted = harness();
  reformatted.writing.mockResolvedValueOnce({ contractVersion: 1, requestId: reformatted.payload.requestId,
    action: "REFORMAT", status: "CHANGED", text: "Different words.", sourceQuote: "" });
  expect((await reformatted.run({ payload: { ...reformatted.payload, action: "REFORMAT" } })).statusCode).toBe(503);

  const protectedLink = harness();
  protectedLink.writing.mockResolvedValueOnce({ contractVersion: 1, requestId: protectedLink.payload.requestId,
    action: "IMPROVE", status: "CHANGED", text: "See [new](https://other.example).", sourceQuote: "" });
  expect((await protectedLink.run({ payload: { ...protectedLink.payload,
    text: "See [original](https://example.test)." } })).statusCode).toBe(503);
});
