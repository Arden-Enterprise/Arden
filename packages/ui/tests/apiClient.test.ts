import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, signIn, signOut } from "../src/shared/api-client";

const actorId = "11111111-1111-4111-8111-111111111111";
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const me = { actor: { id: actorId }, memberships: [{
  organization: { id: organizationId, name: "Synthetic Org" },
  status: "active", roleCodes: ["MEMBER"], canUsePrivateWorkspace: true,
}] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Supabase session transport", () => {
  it("uses Arden's sign-in endpoint and HttpOnly web cookies", async () => {
    vi.stubGlobal("window", { location: { origin: "https://arden.example.test" } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ token: "hidden-cookie-session" }, { status: 200, headers: { "set-cookie": "arden.session_token=hidden-cookie-session; HttpOnly" } }))
      .mockResolvedValueOnce(Response.json(me, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signIn("web", "member@example.test", "synthetic-password")).resolves.toEqual(me);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://arden.example.test/api/v1/auth/sign-in", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ email: "member@example.test", password: "synthetic-password" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://arden.example.test/api/v1/me", expect.objectContaining({ credentials: "include" }));
  });

  it("keeps desktop cookies inside the secure main-process bridge", async () => {
    const requestApi = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ token: "hidden-cookie-session" }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify(me) });
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi, clearSession: vi.fn() } });

    await expect(signIn("desktop", "member@example.test", "synthetic-password")).resolves.toEqual(me);
    expect(requestApi).toHaveBeenNthCalledWith(1, {
      path: "/api/v1/auth/sign-in", method: "POST", body: JSON.stringify({ email: "member@example.test", password: "synthetic-password" }), ifMatch: undefined,
    });
    expect(requestApi).toHaveBeenNthCalledWith(2, {
      path: "/api/v1/me", method: "GET", body: undefined, ifMatch: undefined,
    });
  });

  it("forwards update versions and clears encrypted desktop sessions after sign-out", async () => {
    const requestApi = vi.fn()
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ success: true }) })
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ success: true }) });
    const clearSession = vi.fn(async () => undefined);
    vi.stubGlobal("window", { location: { origin: "file://" }, ardenDesktop: { requestApi, clearSession } });

    await apiRequest("desktop", `/api/v1/organizations/${organizationId}/private-workspace/drafts/cccccccc-cccc-4ccc-8ccc-cccccccccccc`, {
      method: "PATCH", headers: { "If-Match": '"2"' }, body: JSON.stringify({ body: "revision" }),
    });
    await signOut("desktop");
    expect(requestApi).toHaveBeenNthCalledWith(1, expect.objectContaining({ ifMatch: '"2"', method: "PATCH" }));
    expect(requestApi).toHaveBeenNthCalledWith(2, expect.objectContaining({ path: "/api/v1/auth/sign-out", method: "POST" }));
    expect(clearSession).toHaveBeenCalledOnce();
  });
});
