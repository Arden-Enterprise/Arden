// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { loadCollectionPlacement, saveCollectionPlacement } from "../src/shared/api-client";

afterEach(() => { vi.unstubAllGlobals(); delete window.ardenDesktop; });
it.each([{}, { documentId: "bad", collectionId: null, revision: 0 },
  { documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", collectionId: null, revision: "1" }])("refuses malformed placement replies %j", async value => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
  await expect(loadCollectionPlacement("web", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))
    .rejects.toThrow("Invalid document placement response.");
});
it.each(["web", "desktop"] as const)("uses logical placement and exact revisions on %s", async platform => {
  const current = { documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", collectionId: null, revision: 0 };
  const saved = { ...current, revision: 1 };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(current)).mockResolvedValueOnce(Response.json(saved));
  const requestApi = vi.fn().mockResolvedValueOnce({ status: 200, body: JSON.stringify(current) })
    .mockResolvedValueOnce({ status: 200, body: JSON.stringify(saved) });
  vi.stubGlobal("fetch", fetch);
  window.ardenDesktop = { requestApi, clearSession: vi.fn(), startGoogleSignIn: vi.fn() };
  const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await expect(loadCollectionPlacement(platform, org, current.documentId)).resolves.toEqual(current);
  await expect(saveCollectionPlacement(platform, org, current, null)).resolves.toEqual(saved);
  const path = `/api/v1/organizations/${org}/knowledge/catalog/placements/${current.documentId}`;
  if (platform === "desktop") {
    expect(requestApi).toHaveBeenLastCalledWith(expect.objectContaining({ path, method: "PATCH",
      ifMatch: '"placement-0"', body: JSON.stringify({ collectionId: null }) }));
    expect(fetch).not.toHaveBeenCalled();
  } else {
    expect(fetch).toHaveBeenLastCalledWith(`${window.location.origin}${path}`, expect.objectContaining({ method: "PATCH",
      headers: expect.objectContaining({ "if-match": '"placement-0"' }), body: JSON.stringify({ collectionId: null }) }));
    expect(requestApi).not.toHaveBeenCalled();
  }
});
