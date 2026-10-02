import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("health routes", () => {
  it("reports liveness", async () => {
    const app = buildApp(async () => undefined);
    const response = await app.inject("/api/health/live");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("reports unavailable when PostgreSQL cannot be reached", async () => {
    const app = buildApp(async () => {
      throw new Error("database unavailable");
    });
    const response = await app.inject("/api/health/ready");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable" });
    await app.close();
  });
});
