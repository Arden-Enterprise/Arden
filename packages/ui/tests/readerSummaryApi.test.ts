// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkReaderSummaryAccess, generateReaderSummary } from "../src/shared/reader-summary-api";
import { parsePublicReaderSummary, parseReaderSummaryAccess } from "../src/shared/reader-summary-contracts";
import { deferred, readerContext, readerId, readerSummaryFixture } from "./readerSummary.test-support";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); delete window.ardenDesktop; });
describe("reader Summary client boundary", () => {
  it.each(["web", "desktop"] as const)("uses the same strict scoped identity-only requests on %s", async platform => {
    const payload = readerSummaryFixture(readerId(4));
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(payload)).mockResolvedValueOnce(Response.json({
      documentId: readerContext.documentId, versionId: readerContext.versionId, contentHash: readerContext.contentHash }));
    vi.stubGlobal("fetch", fetch);
    const requestApi = vi.fn().mockResolvedValueOnce({ status: 200, body: JSON.stringify(payload) }).mockResolvedValueOnce({
      status: 200, body: JSON.stringify({ documentId: readerContext.documentId, versionId: readerContext.versionId, contentHash: readerContext.contentHash }) });
    window.ardenDesktop = { requestApi, clearSession: vi.fn(), startGoogleSignIn: vi.fn() };
    const signal = new AbortController().signal;
    expect(await generateReaderSummary(platform, readerContext, readerId(4), signal)).toEqual(payload);
    await checkReaderSummaryAccess(platform, readerContext, signal);
    const path = `/api/v1/organizations/${readerContext.organizationId}/knowledge/published/${readerContext.versionId}/summary`;
    if (platform === "desktop") {
      expect(requestApi.mock.calls[0][0]).toEqual({ path, method: "POST", body: JSON.stringify({ requestId: readerId(4) }), ifMatch: undefined });
      expect(requestApi.mock.calls[1][0].path).toBe(`${path}/access`); expect(fetch).not.toHaveBeenCalled();
    } else {
      expect(fetch.mock.calls[0][0]).toBe(`${window.location.origin}${path}`);
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ requestId: readerId(4) });
      expect(fetch.mock.calls[0][1].credentials).toBe("include"); expect(requestApi).not.toHaveBeenCalled();
    }
  });
  it.each(["document", "version", "request", "kind-array", "extra", "quote-length", "range", "page", "foreign-citation", "empty"])("rejects %s response", mode => {
    const value = readerSummaryFixture(readerId(4));
    if (mode === "document") value.documentId = readerId(9);
    if (mode === "version") value.versionId = readerId(9);
    if (mode === "request") value.requestId = readerId(9);
    if (mode === "quote-length") value.points[0].citations[0].excerpt = "x".repeat(1_201);
    if (mode === "range") value.points[0].citations[0].endOffset++;
    if (mode === "page") value.points[0].citations[0].page = 0;
    if (mode === "foreign-citation") value.points[0].citations[0].versionId = readerId(9);
    if (mode === "empty") value.points = [];
    const payload = mode === "extra" ? { ...value, rawSource: "hidden" } : mode === "kind-array"
      ? { ...value, points: [{ ...value.points[0], kind: ["KEY_POINT"] }] } : value;
    expect(() => parsePublicReaderSummary(payload, readerContext, readerId(4))).toThrow();
  });
  it("rejects hash/version substitution on revalidation and malformed client paths before transport", async () => {
    expect(() => parseReaderSummaryAccess({ ...readerContext }, readerContext)).toThrow(); // extra org key
    expect(() => parseReaderSummaryAccess({ documentId: readerContext.documentId, versionId: readerContext.versionId, contentHash: "b".repeat(64) }, readerContext)).toThrow();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(generateReaderSummary("web", { ...readerContext, versionId: "../../escape" }, readerId(4), new AbortController().signal)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("dismisses a native wait without claiming to cancel its underlying request, and cleans the deadline", async () => {
    vi.useFakeTimers(); const pending = deferred<{ status: number; body: string }>(), controller = new AbortController();
    window.ardenDesktop = { requestApi: vi.fn(() => pending.promise), clearSession: vi.fn(), startGoogleSignIn: vi.fn() };
    const response = generateReaderSummary("desktop", readerContext, readerId(4), controller.signal);
    controller.abort(); await expect(response).rejects.toThrow("stopped");
    pending.resolve({ status: 200, body: JSON.stringify(readerSummaryFixture(readerId(4))) });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds a native Summary wait even when IPC never settles", async () => {
    vi.useFakeTimers(); window.ardenDesktop = { requestApi: vi.fn(() => new Promise<never>(() => {})), clearSession: vi.fn(), startGoogleSignIn: vi.fn() };
    const response = generateReaderSummary("desktop", readerContext, readerId(4), new AbortController().signal);
    const checked = expect(response).rejects.toThrow("stopped");
    await vi.advanceTimersByTimeAsync(300_000); await checked; expect(vi.getTimerCount()).toBe(0);
  });
});
