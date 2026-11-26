import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectShareStore, OwnerShares, SharedItem } from "./direct-share-store.js";
import { registerDirectShareRoutes } from "./direct-share-routes.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const uuidPattern = "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

/** Decision 0034 (spec F03-SHR) request handling; RLS itself is covered by the real-PostgreSQL case. */
function harness(store: Partial<DirectShareStore>) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  apps.push(app);
  const read = vi.fn(async () => "Shared words");
  const readPdf = vi.fn(async () => Buffer.from("%PDF-1.4\n%%EOF\n"));
  registerDirectShareRoutes(app, {
    store: store as DirectShareStore,
    storage: { read, readPdf, write: vi.fn(), writePdf: vi.fn(), remove: vi.fn() },
    requestActor: async () => ({ userId: "u1" }), uuidPattern,
  });
  return { app, read, readPdf };
}

const organizationId = randomUUID();
const draftId = randomUUID();
const shares: OwnerShares = { settings: { enabled: true, recipientLimit: 10 }, recipients: [{
  shareId: randomUUID(), membershipId: randomUUID(), name: "Lan", email: "lan@example.test", active: true, sharedAt: new Date(0) }] };
const item = (mimeType: string): SharedItem => ({ id: draftId, title: "Plan", kind: mimeType === "application/pdf" ? "pdf" : "note",
  ownerName: "Khoi", sharedAt: new Date(0), updatedAt: new Date(0), version: 3, sourceUri: "arden-private-object://x",
  mimeType, contentHash: "a".repeat(64) });

describe("direct share routes", () => {
  it("maps share outcomes to explicit responses and never caches them", async () => {
    const outcomes = [{ kind: "not-found" }, { kind: "disabled" }, { kind: "invalid-recipients" }, { kind: "limit", limit: 3 },
      { kind: "shared", shares, added: 1 }, { kind: "shared", shares, added: 0 }] as const;
    const share = vi.fn();
    for (const outcome of outcomes) share.mockResolvedValueOnce(outcome);
    const { app } = harness({ share });
    const post = () => app.inject({ method: "POST", url: `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}/shares`,
      payload: { recipientMembershipIds: [randomUUID()] } });
    const results = [];
    for (let index = 0; index < outcomes.length; index++) results.push(await post());
    expect(results.map((result) => result.statusCode)).toEqual([404, 409, 400, 409, 201, 200]);
    expect(results.map((result) => result.json().error?.code)).toEqual(
      ["RESOURCE_NOT_AVAILABLE", "DIRECT_SHARING_DISABLED", "INVALID_RECIPIENTS", "DIRECT_SHARE_LIMIT", undefined, undefined]);
    expect(results[3]!.json().error.message).toBe("This item can be shared with up to 3 people. Contribute a copy to reach more people.");
    expect(results[4]!.headers["cache-control"]).toBe("no-store");
    expect(results[4]!.json()).toMatchObject({ enabled: true, recipientLimit: 10, recipients: [{ name: "Lan", active: true }] });
  });

  it("rejects malformed recipient lists before reaching the store", async () => {
    const share = vi.fn();
    const { app } = harness({ share });
    const url = `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}/shares`;
    for (const payload of [{ recipientMembershipIds: [] }, { recipientMembershipIds: ["not-a-uuid"] },
      { recipientMembershipIds: Array.from({ length: 101 }, () => randomUUID()) }, { recipientMembershipIds: [randomUUID()], department: "x" }]) {
      expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(400);
    }
    expect(share).not.toHaveBeenCalled();
  });

  it("revokes one share or all of them, and hides items the caller does not own", async () => {
    const revoke = vi.fn(async (_user: string, _org: string, _draft: string, shareId: string | null) => shareId === "missing" ? null : shares);
    const { app } = harness({ revoke });
    const base = `/api/v1/organizations/${organizationId}/private-workspace/drafts/${draftId}/shares`;
    const shareId = randomUUID();
    expect((await app.inject({ method: "POST", url: `${base}/${shareId}/revoke` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${base}/revoke-all` })).statusCode).toBe(200);
    expect(revoke.mock.calls.map((call) => call[3])).toEqual([shareId, null]);
  });

  it("gives a recipient the current text, or the PDF file, labelled as not reviewed", async () => {
    const getSharedItem = vi.fn().mockResolvedValueOnce(item("text/plain")).mockResolvedValueOnce(item("text/plain"))
      .mockResolvedValueOnce(item("application/pdf")).mockResolvedValueOnce(null);
    const { app, read, readPdf } = harness({ getSharedItem });
    const base = `/api/v1/organizations/${organizationId}/shared-with-me/${draftId}`;
    const text = await app.inject({ method: "GET", url: base });
    expect(text.json()).toMatchObject({ title: "Plan", kind: "note", ownerName: "Khoi", body: "Shared words", reviewed: false, version: 3 });
    expect(read).toHaveBeenCalledWith("arden-private-object://x", "a".repeat(64));
    expect((await app.inject({ method: "GET", url: `${base}/pdf` })).statusCode).toBe(404);
    const pdf = await app.inject({ method: "GET", url: `${base}/pdf` });
    expect(pdf.json().pdfBase64).toBe(Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64"));
    expect(readPdf).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: "GET", url: base })).statusCode).toBe(404);
  });

  it("lets every member read the organization setting and only an Organization Admin change it", async () => {
    const updateSettings = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ enabled: false, recipientLimit: 5 });
    const settings = vi.fn(async () => ({ enabled: true, recipientLimit: 10 }));
    const { app } = harness({ settings, updateSettings });
    const url = `/api/v1/organizations/${organizationId}/direct-sharing`;
    expect((await app.inject({ method: "GET", url })).json()).toEqual({ enabled: true, recipientLimit: 10 });
    expect((await app.inject({ method: "PUT", url, payload: { enabled: false, recipientLimit: 5 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url, payload: { enabled: false, recipientLimit: 5 } })).json()).toEqual({ enabled: false, recipientLimit: 5 });
    expect((await app.inject({ method: "PUT", url, payload: { enabled: true, recipientLimit: 101 } })).statusCode).toBe(400);
  });
});
