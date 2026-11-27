import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseInvitationAccountAdmin } from "./invitation-account-admin.js";

const authUrl = "http://private-auth.example.test:8080/";
const secretKey = "synthetic-secret-key";

type Call = { url: URL; init: RequestInit };

function stubFetch(responder: (call: Call) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: URL | string, init: RequestInit = {}) => {
    const call = { url: new URL(String(input)), init };
    calls.push(call);
    return responder(call);
  });
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SupabaseInvitationAccountAdmin", () => {
  it("reports an existing account only on an exact address match and sends the key in headers only", async () => {
    const calls = stubFetch(() => json({ users: [{ email: "xnew.member@example.test" }, { email: "New.Member@example.test" }] }));
    const admin = new SupabaseInvitationAccountAdmin(authUrl, secretKey);
    await expect(admin.accountStatus("new.member@example.test")).resolves.toBe("existing");
    const [call] = calls;
    expect(call?.url.pathname).toBe("/auth/v1/admin/users");
    expect(call?.url.searchParams.get("filter")).toBe("new.member@example.test");
    expect(call?.url.search).not.toContain(secretKey);
    expect(call?.init.headers).toMatchObject({ apikey: secretKey, authorization: `Bearer ${secretKey}` });
  });

  it("reports a new address when only near matches exist", async () => {
    stubFetch(() => json({ users: [{ email: "anew.member@example.test" }] }));
    const admin = new SupabaseInvitationAccountAdmin(authUrl, secretKey);
    await expect(admin.accountStatus("new.member@example.test")).resolves.toBe("new");
  });

  it("fails closed in one request when a full page has no exact match", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({ email: `person${index}@example.test` }));
    const calls = stubFetch(() => json({ users: page }));
    const admin = new SupabaseInvitationAccountAdmin(authUrl, secretKey);
    await expect(admin.accountStatus("new.member@example.test")).rejects.toThrow("ACCOUNT_LOOKUP_UNAVAILABLE");
    expect(calls).toHaveLength(1);
  });

  it("fails closed on provider errors, malformed bodies and network failures", async () => {
    const admin = new SupabaseInvitationAccountAdmin(authUrl, secretKey);
    stubFetch(() => json({ msg: "forbidden" }, 403));
    await expect(admin.accountStatus("new.member@example.test")).rejects.toThrow("ACCOUNT_LOOKUP_UNAVAILABLE");
    stubFetch(() => json({ unexpected: true }));
    await expect(admin.accountStatus("new.member@example.test")).rejects.toThrow("ACCOUNT_LOOKUP_UNAVAILABLE");
    stubFetch(() => { throw new TypeError("network down"); });
    await expect(admin.accountStatus("new.member@example.test")).rejects.toThrow("ACCOUNT_LOOKUP_UNAVAILABLE");
  });

  it("creates a confirmed account with the invited address and name", async () => {
    const calls = stubFetch(() => json({ id: "22222222-2222-4222-8222-222222222222" }));
    const admin = new SupabaseInvitationAccountAdmin(authUrl, secretKey);
    await admin.createConfirmedAccount({ email: "new.member@example.test", password: "Synthetic-password1", fullName: "New Member" });
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      email: "new.member@example.test", password: "Synthetic-password1", email_confirm: true,
      user_metadata: { full_name: "New Member" },
    });
  });

  it("classifies create failures", async () => {
    const admin = new SupabaseInvitationAccountAdmin(authUrl, secretKey);
    const account = { email: "new.member@example.test", password: "Synthetic-password1", fullName: "New Member" };
    stubFetch(() => json({ code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" }, 422));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("USER_ALREADY_EXISTS");
    stubFetch(() => json({ msg: "User already registered" }, 422));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("USER_ALREADY_EXISTS");
    stubFetch(() => json({ code: 422, error_code: "weak_password", msg: "Password is too weak" }, 422));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("SIGNUP_REJECTED");
    stubFetch(() => json({ msg: "Password should be at least 12 characters" }, 422));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("SIGNUP_REJECTED");
    stubFetch(() => json({ msg: "Not found" }, 404));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("SUPABASE_AUTH_UNAVAILABLE");
    stubFetch(() => json({ code: 422, error_code: "email_address_invalid", msg: "Email address is invalid" }, 422));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("SUPABASE_AUTH_UNAVAILABLE");
    stubFetch(() => { throw new DOMException("timed out", "TimeoutError"); });
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("ACCOUNT_SETUP_UNCONFIRMED");
    stubFetch(() => json({ msg: "invalid key" }, 401));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("SUPABASE_AUTH_UNAVAILABLE");
    stubFetch(() => json({ msg: "down" }, 503));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("SUPABASE_AUTH_UNAVAILABLE");
    stubFetch(() => json({ unexpected: true }));
    await expect(admin.createConfirmedAccount(account)).rejects.toThrow("SUPABASE_AUTH_UNAVAILABLE");
  });

  it("rejects an empty secret key at startup", () => {
    expect(() => new SupabaseInvitationAccountAdmin(authUrl, "  ")).toThrow("SUPABASE_SECRET_KEY");
  });
});
