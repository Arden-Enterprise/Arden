import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import type { ArdenDataRepository } from "../db/repository.js";
import type { PrivateContentStorage } from "../private-notes/content-storage.js";
import type { MaintenancePort } from "./case-service.js";
import { MaintenanceError } from "./contracts.js";

const org = "11111111-1111-4111-8111-111111111111";
const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function appFor(port: MaintenancePort) {
  const repository = { maintenance: port } as ArdenDataRepository;
  return buildApp({
    checkDatabase: async () => undefined,
    auth: null,
    authTrustedOrigins: ["http://localhost"],
    secureCookies: false,
    repository,
    storage: {} as PrivateContentStorage,
    testActor: { userId, email: "reader@example.test", fullName: "Reader", emailVerified: true },
  });
}

describe("maintenance routes", () => {
  it("replays one case and refuses a denied report without a body leak", async () => {
    const createdBody = {
      kind: "reporter" as const, caseId: "55555555-5555-4555-8555-555555555555", documentId: "doc",
      publishedVersionId: "ver", title: "Guide", description: "Wrong", reporterStatus: "Submitted" as const,
      reporterExplanation: null, revision: 1,
    };
    const port: MaintenancePort = { transaction: (async () => createdBody) as MaintenancePort["transaction"] };
    const app = appFor(port);
    const path = `/api/v1/organizations/${org}/knowledge/maintenance/cases`;
    const headers = { "idempotency-key": "66666666-6666-4666-8666-666666666666", origin: "http://localhost" };
    const body = { origin: "READER_REPORT", documentId: "77777777-7777-4777-8777-777777777777",
      publishedVersionId: "88888888-8888-4888-8888-888888888888", description: "Wrong step" };
    const created = await app.inject({ method: "POST", url: path, headers, payload: body });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ caseId: "55555555-5555-4555-8555-555555555555" });
    expect(created.headers["cache-control"]).toBe("no-store");
    const deniedPort: MaintenancePort = {
      transaction: async () => { throw new MaintenanceError("DENIED"); },
    };
    const denied = await appFor(deniedPort).inject({ method: "POST", url: path, headers, payload: body });
    expect(denied.statusCode).toBe(404);
    expect(denied.json()).toEqual({ error: { code: "MAINTENANCE_UNAVAILABLE", message: "That case is unavailable." } });
    await app.close();
  });

  it("returns an empty own-report list", async () => {
    const app = appFor({ transaction: (async () => []) as MaintenancePort["transaction"] });
    const listed = await app.inject({ method: "GET", url: `/api/v1/organizations/${org}/knowledge/maintenance/cases?scope=mine` });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual([]);
    await app.close();
  });
});
