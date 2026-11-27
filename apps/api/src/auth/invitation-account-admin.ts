/**
 * Server-only Supabase Auth admin capability for invitation entry (decision 0038).
 *
 * It holds the Supabase secret key and exposes exactly two operations: whether an
 * invited address already has an account, and creating a confirmed account for an
 * invited address that has none. Callers must already have validated a pending
 * invitation token; this adapter never receives the token and never logs the key.
 */
import { isUserAlreadyRegistered } from "./provider.js";

export type InvitationAccountStatus = "existing" | "new";

export type ConfirmedInvitationAccount = { email: string; password: string; fullName: string };

export interface InvitationAccountAdmin {
  /** Throws `ACCOUNT_LOOKUP_UNAVAILABLE` when the answer cannot be established. */
  accountStatus(email: string): Promise<InvitationAccountStatus>;
  /**
   * Throws `USER_ALREADY_EXISTS`, `SIGNUP_REJECTED` (password policy only), `ACCOUNT_SETUP_UNCONFIRMED`
   * (no answer, so the account may exist) or `SUPABASE_AUTH_UNAVAILABLE`.
   */
  createConfirmedAccount(account: ConfirmedInvitationAccount): Promise<void>;
}

const lookupPageSize = 100;
// The lookup blocks the invitation preview, which falls back to the combined screen on failure.
const lookupTimeoutMs = 2_000;
const createTimeoutMs = 5_000;

export class SupabaseInvitationAccountAdmin implements InvitationAccountAdmin {
  private readonly adminUsersUrl: string;

  constructor(supabaseUrl: string, private readonly secretKey: string) {
    if (!secretKey.trim()) throw new Error("SUPABASE_SECRET_KEY must not be empty");
    this.adminUsersUrl = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users`;
  }

  async accountStatus(email: string): Promise<InvitationAccountStatus> {
    // The admin filter is a substring match; only an exact address match counts. A full page
    // without a match (for example, a server that ignores the filter) cannot prove "new".
    const url = new URL(this.adminUsersUrl);
    url.searchParams.set("filter", email);
    url.searchParams.set("per_page", String(lookupPageSize));
    const response = await this.send(url, { method: "GET" }, lookupTimeoutMs).catch(() => null);
    const users = response?.ok ? await readUsers(response) : null;
    if (!users) throw new Error("ACCOUNT_LOOKUP_UNAVAILABLE");
    if (users.some((user) => user.email?.trim().toLowerCase() === email)) return "existing";
    if (users.length < lookupPageSize) return "new";
    throw new Error("ACCOUNT_LOOKUP_UNAVAILABLE");
  }

  async createConfirmedAccount(account: ConfirmedInvitationAccount): Promise<void> {
    const response = await this.send(new URL(this.adminUsersUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: account.email,
        password: account.password,
        email_confirm: true,
        user_metadata: { full_name: account.fullName },
      }),
    }, createTimeoutMs).catch(() => null);
    if (!response) throw new Error("ACCOUNT_SETUP_UNCONFIRMED");
    if (response.ok) {
      const body: unknown = await response.json().catch(() => null);
      if (!isRecord(body) || typeof body.id !== "string") throw new Error("SUPABASE_AUTH_UNAVAILABLE");
      return;
    }
    const failure = await readFailure(response);
    if (isUserAlreadyRegistered(failure)) throw new Error("USER_ALREADY_EXISTS");
    // Only a password-policy rejection is for the person to fix; other 4xx answers (a wrong key,
    // an unrouted admin path, a disabled provider) are server configuration problems.
    if (failure.code === "weak_password" || (failure.status === 422 && /password/i.test(failure.message))) {
      throw new Error("SIGNUP_REJECTED");
    }
    throw new Error("SUPABASE_AUTH_UNAVAILABLE");
  }

  private send(url: URL, init: RequestInit, timeoutMs: number): Promise<Response> {
    return fetch(url, {
      ...init,
      headers: { ...init.headers, apikey: this.secretKey, authorization: `Bearer ${this.secretKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }
}

async function readUsers(response: Response): Promise<Array<{ email?: string }> | null> {
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body) || !Array.isArray(body.users)) return null;
  return body.users.map((user) => (isRecord(user) && typeof user.email === "string" ? { email: user.email } : {}));
}

async function readFailure(response: Response): Promise<{ status: number; code: string; message: string }> {
  const body: unknown = await response.json().catch(() => null);
  if (!isRecord(body)) return { status: response.status, code: "", message: "" };
  const code = typeof body.error_code === "string" ? body.error_code : typeof body.code === "string" ? body.code : "";
  const message = [body.msg, body.message, body.error_description].find((value) => typeof value === "string");
  return { status: response.status, code, message: typeof message === "string" ? message : "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
