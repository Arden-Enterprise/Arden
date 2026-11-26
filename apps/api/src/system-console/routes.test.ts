import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemActorResolver } from "../system-auth/routes.js";
import { SystemConsoleError, type SystemConsoleActor, type SystemConsoleQuery, type SystemConsoleStore } from "./store.js";
import { dependencyProbeUrl, registerSystemConsoleRoutes } from "./routes.js";

const signedIn: SystemActorResolver = async () => ({ adminId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222", canManageSystemAdmins: false });
const signedOut: SystemActorResolver = async (_request, reply) => {
  reply.header("Cache-Control", "no-store");
  reply.code(404).send({ error: { code: "SYSTEM_CONSOLE_UNAVAILABLE", message: "The resource is not available." } });
  return null;
};
const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

describe("System Console report routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function appFor(store: SystemConsoleStore, actor = signedIn) {
    const app = Fastify();
    registerSystemConsoleRoutes(app, store, actor, uuid, async () => ({
      auth: { status: "ok", latencyMs: 12 },
      ardenAi: { status: "unavailable", latencyMs: null },
    }));
    apps.push(app);
    return app;
  }

  it("uses the 30-day default and returns read-only aggregate reports without caching", async () => {
    const report = vi.fn(async (_actor: SystemConsoleActor, _query: SystemConsoleQuery) => ({
      calls: 3,
      usageComplete: false,
      estimatedCostMicroUsd: null,
    }));
    const app = appFor({ report });
    const response = await app.inject("/api/v1/system/reports/ai-usage");

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ calls: 3, usageComplete: false, estimatedCostMicroUsd: null });
    const [actor, query] = report.mock.calls[0]!;
    expect(actor).toMatchObject({ adminId: "11111111-1111-4111-8111-111111111111" });
    expect(query.kind).toBe("AI_USAGE");
    expect(query.to.valueOf() - query.from.valueOf()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(query.to.valueOf() - query.from.valueOf()).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("rejects invalid and overlong custom date ranges and pages above 50 without caching the error", async () => {
    const report = vi.fn(async () => ({}));
    const app = appFor({ report });
    const invalid = await app.inject("/api/v1/system/overview?from=2026-01-02T00%3A00%3A00Z&to=2026-01-01T00%3A00%3A00Z");
    const tooLong = await app.inject("/api/v1/system/overview?from=2025-01-01T00%3A00%3A00Z&to=2026-02-02T00%3A00%3A00Z");
    const oversizedPage = await app.inject("/api/v1/system/organizations?pageSize=51");

    for (const response of [invalid, tooLong, oversizedPage]) {
      expect(response.statusCode).toBe(400);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(report).not.toHaveBeenCalled();
  });

  it("authenticates before validating input so signed-out callers learn nothing about parameters", async () => {
    const report = vi.fn(async () => ({}));
    const app = appFor({ report }, signedOut);
    for (const url of ["/api/v1/system/organizations?pageSize=51", "/api/v1/system/organizations/not-a-uuid",
      "/api/v1/system/overview?unknown=1"]) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(404);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(report).not.toHaveBeenCalled();
  });

  it("answers 404 for an organization that does not exist", async () => {
    const app = appFor({ report: vi.fn(async () => { throw new SystemConsoleError("SYSTEM_CONSOLE_UNAVAILABLE"); }) });
    const response = await app.inject("/api/v1/system/organizations/33333333-3333-4333-8333-333333333333");
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("SYSTEM_CONSOLE_UNAVAILABLE");
  });

  it("serves Private Notes feedback analytics to any active System Admin as a read-only report", async () => {
    const report = vi.fn(async (_actor: SystemConsoleActor, _query: SystemConsoleQuery) => ({
      weeks: [{ weekStart: "2026-11-23", good: 2, bad: 1 }] }));
    const app = appFor({ report });
    const response = await app.inject("/api/v1/system/analytics/private-feedback");
    expect(response.statusCode).toBe(200);
    expect(report.mock.calls[0]?.[1]).toMatchObject({ kind: "PRIVATE_FEEDBACK" });
  });

  it("exposes only the health probe's status and latency fields", async () => {
    const report = vi.fn(async () => ({ database: { status: "ok" }, indexing: { pending: 1 }, notifications: { failed: 0 } }));
    const app = appFor({ report });
    const response = await app.inject("/api/v1/system/health");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      database: { status: "ok", latencyMs: expect.any(Number) }, indexing: { pending: 1 }, notifications: { failed: 0 },
      auth: { status: "ok", latencyMs: 12 }, ardenAi: { status: "unavailable", latencyMs: null },
    });
    expect(response.body).not.toContain("secret");
  });

  it("keeps a configured path prefix and refuses credentialed probe URLs", () => {
    expect(dependencyProbeUrl("https://ai.example.test/arden-ai", "/health/ready")?.href)
      .toBe("https://ai.example.test/arden-ai/health/ready");
    expect(dependencyProbeUrl("https://auth.example.test/", "/auth/v1/health")?.href)
      .toBe("https://auth.example.test/auth/v1/health");
    expect(dependencyProbeUrl("https://user:pass@ai.example.test", "/health/ready")).toBeNull();
    expect(dependencyProbeUrl("file:///etc/passwd", "/health/ready")).toBeNull();
  });
});
