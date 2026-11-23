import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemConsoleStore } from "./store.js";
import { registerSystemConsoleRoutes } from "./routes.js";

const actor = async () => ({ userId: "11111111-1111-4111-8111-111111111111" });
const uuid = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

describe("System Console report routes", () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  function appFor(store: SystemConsoleStore) {
    const app = Fastify();
    registerSystemConsoleRoutes(app, store, actor, uuid, async () => ({
      auth: { status: "ok", latencyMs: 12 },
      ardenAi: { status: "unavailable", latencyMs: null },
    }));
    apps.push(app);
    return app;
  }

  it("uses the 30-day default and returns read-only aggregate reports without caching", async () => {
    const report = vi.fn(async (_userId: string, _query: { kind: string; from: Date; to: Date }) => ({
      calls: 3,
      usageComplete: false,
      estimatedCostMicroUsd: null,
    }));
    const app = appFor({ canAccess: vi.fn(async () => true), report } as unknown as SystemConsoleStore);
    const response = await app.inject("/api/v1/system/reports/ai-usage");

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ calls: 3, usageComplete: false, estimatedCostMicroUsd: null });
    const query = report.mock.calls[0]?.[1];
    expect(query?.kind).toBe("AI_USAGE");
    expect(query?.to.valueOf() - query?.from.valueOf()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(query?.to.valueOf() - query?.from.valueOf()).toBeLessThan(31 * 24 * 60 * 60 * 1000);
  });

  it("rejects invalid and overlong custom date ranges and pages above 50", async () => {
    const report = vi.fn(async () => ({}));
    const app = appFor({ canAccess: vi.fn(async () => true), report } as unknown as SystemConsoleStore);
    const invalid = await app.inject("/api/v1/system/overview?from=2026-01-02T00%3A00%3A00Z&to=2026-01-01T00%3A00%3A00Z");
    const tooLong = await app.inject("/api/v1/system/overview?from=2025-01-01T00%3A00%3A00Z&to=2026-02-02T00%3A00%3A00Z");
    const oversizedPage = await app.inject("/api/v1/system/organizations?pageSize=51");

    expect(invalid.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
    expect(oversizedPage.statusCode).toBe(400);
    expect(report).not.toHaveBeenCalled();
  });

  it("exposes only the health probe's status and latency fields", async () => {
    const report = vi.fn(async () => ({ database: { status: "ok" }, indexing: { pending: 1 }, notifications: { failed: 0 } }));
    const app = appFor({ canAccess: vi.fn(async () => true), report } as unknown as SystemConsoleStore);
    const response = await app.inject("/api/v1/system/health");

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      database: { status: "ok", latencyMs: expect.any(Number) }, indexing: { pending: 1 }, notifications: { failed: 0 },
      auth: { status: "ok", latencyMs: 12 }, ardenAi: { status: "unavailable", latencyMs: null },
    });
    expect(response.body).not.toContain("secret");
  });
});
