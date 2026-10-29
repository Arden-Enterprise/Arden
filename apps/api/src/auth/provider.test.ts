import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const privateAuthUrl = "http://private-auth.example.test:8080";
const publicAuthUrl = "https://auth.example.test";
const publishableKey = "public-anon-key";
const callbackUrl = "https://app.example.test/api/v1/auth/google/callback";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SupabaseAuthProvider Google OAuth URL boundary", () => {
  it("blocks production Google sign-in when the public Auth origin is missing", async () => {
    const { resolveSupabaseAuthPublicUrl, SupabaseAuthProvider } = await import("./provider.js");
    expect(resolveSupabaseAuthPublicUrl(undefined, privateAuthUrl)).toBeUndefined();
    expect(resolveSupabaseAuthPublicUrl(publicAuthUrl, privateAuthUrl)).toBe(publicAuthUrl);
    expect(() => resolveSupabaseAuthPublicUrl(publicAuthUrl, undefined))
      .toThrow("SUPABASE_AUTH_PUBLIC_URL requires SUPABASE_URL");

    const fetchMock = vi.fn(async () => { throw new Error("Unexpected Auth request without a public origin"); });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new SupabaseAuthProvider(privateAuthUrl, publishableKey, undefined, {
      requirePublicAuthUrl: true,
    });
    await expect(provider.startGoogleSignIn(callbackUrl)).rejects.toThrow("SUPABASE_AUTH_PUBLIC_URL_REQUIRED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("starts Google sign-in on the public Auth host with the exact Arden callback", async () => {
    const { SupabaseAuthProvider } = await import("./provider.js");
    const provider = new SupabaseAuthProvider(privateAuthUrl, publishableKey, publicAuthUrl);

    const result = await provider.startGoogleSignIn(callbackUrl);
    const url = new URL(result.url);

    expect(result.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(url.origin).toBe(publicAuthUrl);
    expect(url.pathname).toBe("/auth/v1/authorize");
    expect(url.searchParams.get("provider")).toBe("google");
    expect(url.searchParams.get("redirect_to")).toBe(callbackUrl);
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    const codeChallenge = url.searchParams.get("code_challenge");
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(codeChallenge).toBe(createHash("sha256").update(result.verifier).digest("base64url"));
    expect(result.flowId).toMatch(/^[a-f0-9]{32}$/);
  });

  it("keeps PKCE code exchange on the private Auth gateway", async () => {
    const requestUrls: string[] = [];
    const requestBodies: unknown[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrls.push(input instanceof Request ? input.url : String(input));
      requestBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ code: "invalid_grant", msg: "Rejected test code" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });
    await vi.resetModules();
    const { SupabaseAuthProvider } = await import("./provider.js");
    const provider = new SupabaseAuthProvider(privateAuthUrl, publishableKey, publicAuthUrl);

    await expect(provider.completeGoogleSignIn("rejected-test-code", "flowid0001", "a".repeat(64)))
      .rejects.toThrow("INVALID_OAUTH_CALLBACK");

    expect(requestUrls).toEqual([`${privateAuthUrl}/auth/v1/token?grant_type=pkce`]);
    expect(requestBodies).toEqual([expect.objectContaining({
      auth_code: "rejected-test-code", code_verifier: "a".repeat(64),
    })]);
  });

  it.each([
    "http://auth.example.test",
    "https://user:pass@auth.example.test",
    "https://auth.example.test/path",
    "https://auth.example.test?query=1",
    "https://auth.example.test#fragment",
  ])("rejects an unsafe public Auth URL: %s", (url) => {
    return import("./provider.js").then(({ SupabaseAuthProvider }) => {
      expect(() => new SupabaseAuthProvider(privateAuthUrl, publishableKey, url))
        .toThrow("SUPABASE_AUTH_PUBLIC_URL");
    });
  });
});
