// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { listPublishedKnowledge } from "../src/shared/api-client";
import { publicationScopes } from "@arden/domain";

afterEach(() => { vi.unstubAllGlobals(); delete window.ardenDesktop; });

describe("publication scope client", () => {
  it.each(["web", "desktop"] as const)("preserves default compatibility and explicit scopes on %s", async platform => {
    const fetch = vi.fn().mockImplementation(async () => Response.json({ items: [] }));
    const requestApi = vi.fn().mockResolvedValue({ status: 200, body: JSON.stringify({ items: [] }) });
    vi.stubGlobal("fetch", fetch);
    window.ardenDesktop = { requestApi, clearSession: vi.fn(), startGoogleSignIn: vi.fn() };
    const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const base = `/api/v1/organizations/${organizationId}/knowledge/published`;
    await expect(listPublishedKnowledge(platform, organizationId)).resolves.toEqual([]);
    for (const scope of publicationScopes) {
      await expect(listPublishedKnowledge(platform, organizationId, scope)).resolves.toEqual([]);
    }
    const paths = [base, ...publicationScopes.map(scope => `${base}?scope=${scope}`)];
    if (platform === "desktop") {
      expect(requestApi.mock.calls.map(([input]) => input.path)).toEqual(paths);
      expect(requestApi.mock.calls.every(([input]) => input.method === "GET" && input.body === undefined)).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    } else {
      expect(fetch.mock.calls.map(([path]) => path)).toEqual(paths.map(path => `${window.location.origin}${path}`));
      expect(fetch.mock.calls.every(([, input]) => input.credentials === "include")).toBe(true);
      expect(requestApi).not.toHaveBeenCalled();
    }
  });
});
