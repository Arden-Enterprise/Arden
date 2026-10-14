import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { configurableRolePermissions } from "./policy.js";
import { RoleError, type CustomRoleStore, type CustomRole } from "./store.js";
import { registerCustomRoleRoutes } from "./routes.js";

const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const memberId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const assignmentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";
const path = `/api/v1/organizations/${org}`;

function testStore(): CustomRoleStore {
  let role: CustomRole = { id: roleId, name: "Readers", description: "", status: "ACTIVE", version: 1, permissions: [...configurableRolePermissions], assignments: [] };
  const authorize = (user: string, organization: string, id = roleId) => {
    if (user !== "admin" || organization !== org || id !== roleId) throw new RoleError("ROLE_UNAVAILABLE");
  };
  return {
    async list(user, organization) { authorize(user, organization); return [role]; },
    async get(user, organization, id) { authorize(user, organization, id); return role; },
    async create() { return role; },
    async update(user, organization, id, version, write) {
      authorize(user, organization, id);
      if (version !== role.version) throw new RoleError("ROLE_CONFLICT");
      role = { ...role, ...write, version: version + 1 }; return role;
    },
    async assign(user, organization, id, membershipId, scope) {
      authorize(user, organization, id);
      role = { ...role, version: role.version + 1, assignments: [{ id: assignmentId, membershipId, scope, status: "ACTIVE", validFrom: "2026-10-14T00:00:00Z", validUntil: null }] }; return role;
    },
    async revoke(user, organization, id) { authorize(user, organization, id); role = { ...role, version: role.version + 1, assignments: [] }; return role; },
    async deactivate(user, organization, id, version) { authorize(user, organization, id); if (role.version !== version) throw new RoleError("ROLE_CONFLICT"); role = { ...role, version: version + 1, status: "INACTIVE" }; return role; },
  };
}
function build() {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  registerCustomRoleRoutes(app, testStore(), async (request, reply) => {
    const user = request.headers["test-user"];
    if (typeof user !== "string") { reply.code(401).send({ error: "unauthenticated" }); return null; }
    return { userId: user };
  }, uuid);
  return app;
}
describe("custom role HTTP contracts with a synthetic store", () => {
  it("requires authentication and organization administration", async () => {
    const app = build();
    try {
      expect((await app.inject(path + "/roles")).statusCode).toBe(401);
      expect((await app.inject({ url: path + "/roles", headers: { "test-user": "member" } })).statusCode).toBe(404);
      expect((await app.inject({ url: path.replace(org, memberId) + "/roles", headers: { "test-user": "admin" } })).statusCode).toBe(404);
      const response = await app.inject({ url: path + "/permissions", headers: { "test-user": "admin" } });
      expect(response.json().items.map((item: { code: string }) => item.code)).toEqual(["PUBLISHED_CONTENT_VIEW"]);
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally { await app.close(); }
  });
  it("enforces permission allowlist, ETag and stale updates", async () => {
    const app = build();
    try {
      const url = path + "/roles/" + roleId;
      const payload = { name: "Readers", description: "", permissions: ["PUBLISHED_CONTENT_VIEW"] };
      const headers = { "test-user": "admin" };
      expect((await app.inject({ method: "PATCH", url, headers, payload })).statusCode).toBe(428);
      expect((await app.inject({ method: "PATCH", url, headers: { ...headers, "if-match": '"role-1"' }, payload: { ...payload, permissions: ["ORG_MANAGE_ROLES"] } })).statusCode).toBe(400);
      const saved = await app.inject({ method: "PATCH", url, headers: { ...headers, "if-match": '"role-1"' }, payload });
      expect(saved.statusCode).toBe(200); expect(saved.headers.etag).toBe('"role-2"');
      expect((await app.inject({ method: "PATCH", url, headers: { ...headers, "if-match": '"role-1"' }, payload })).statusCode).toBe(412);
    } finally { await app.close(); }
  });
  it("rejects inconsistent scopes, unknown fields and role IDs from other organizations", async () => {
    const app = build();
    try {
      const url = path + "/roles/" + roleId + "/assignments";
      const headers = { "test-user": "admin" };
      const payload = { membershipId: memberId, scopeType: "ORGANIZATION", departmentId: null };
      expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, departmentId: memberId } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, scopeType: "DEPARTMENT" } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url, headers, payload: { ...payload, bypass: true } })).statusCode).toBe(400);
      expect((await app.inject({ method: "POST", url: url.replace(roleId, memberId), headers, payload })).statusCode).toBe(404);
      const granted = await app.inject({ method: "POST", url, headers, payload });
      expect(granted.statusCode).toBe(201);
      expect(granted.json().assignments[0].scope).toEqual({ type: "ORGANIZATION", departmentId: null });
    } finally { await app.close(); }
  });
});
