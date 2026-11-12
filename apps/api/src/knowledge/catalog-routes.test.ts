import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogError, type KnowledgeCatalogStore } from "./catalog-store.js";
import { registerKnowledgeCatalogRoutes } from "./catalog-routes.js";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const input = { name: "Engineering", description: "", status: "ACTIVE" };
const entry = { ...input, id, version: 1, status: "ACTIVE" as const };
const applications: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(applications.map(app => app.close())); applications.length = 0; });
function setup(authenticated = true, available = true) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } }); applications.push(app);
  const store: KnowledgeCatalogStore = { list: vi.fn().mockResolvedValue({ canManage: true, topics: [], collections: [] }),
    readers: vi.fn().mockResolvedValue([{ id, name: "Reader" }]), write: vi.fn().mockResolvedValue(entry) };
  registerKnowledgeCatalogRoutes(app, available ? store : undefined, async (_request, reply) => {
    if (!authenticated) { reply.code(401).send({ error: { code: "UNAUTHENTICATED" } }); return null; }
    return { userId: "actor" };
  }, "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
  return { app, store, path: `/api/v1/organizations/${org}/knowledge/catalog` };
}
describe("knowledge catalog HTTP contract", () => {
  it("requires authentication and fails safely when the service is absent", async () => {
    const unauthenticated = setup(false); expect((await unauthenticated.app.inject(unauthenticated.path)).statusCode).toBe(401);
    const unavailable = setup(true, false); expect((await unavailable.app.inject(unavailable.path)).statusCode).toBe(503);
  });
  it("keeps responses private and requires a version for edits", async () => {
    const { app, path, store } = setup();
    const list = await app.inject(path); expect(list.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ method: "POST", url: `${path}/topics`, payload: input })).statusCode).toBe(201);
    expect((await app.inject({ method: "PATCH", url: `${path}/topics/${id}`, payload: input })).statusCode).toBe(428);
    expect((await app.inject({ method: "PATCH", url: `${path}/topics/${id}`, headers: { "if-match": '"catalog-1"' }, payload: input })).statusCode).toBe(200);
    expect(store.write).toHaveBeenLastCalledWith("actor", org, "topics", id, 1, input, expect.any(String));
  });
  it.each([["UNAVAILABLE", 404], ["INVALID", 400], ["CONFLICT", 412], ["DUPLICATE", 409]] as const)("maps %s without internal details", async (code, status) => {
    const { app, path, store } = setup(); vi.mocked(store.write).mockRejectedValue(new CatalogError(code));
    const result = await app.inject({ method: "POST", url: `${path}/topics`, payload: input });
    expect(result.statusCode).toBe(status); expect(result.body).not.toMatch(/stack|SELECT|postgres/);
  });
  it("rejects unsupported keys, kinds and oversized/invalid member requests", async () => {
    const { app, path, store } = setup();
    expect((await app.inject({ method: "POST", url: `${path}/roles`, payload: input })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: `${path}/topics`, payload: { ...input, permission: "read-all" } })).statusCode).toBe(400);
    expect((await app.inject(`${path}/readers?ids=abc`)).statusCode).toBe(400);
    expect((await app.inject(`${path}/readers?q=Re&ids=${id}`)).statusCode).toBe(200);
    expect(store.readers).toHaveBeenCalledWith("actor", org, "Re", [id]);
  });
});
