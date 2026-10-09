import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthProvider, AuthSessionTokens, SessionResolution, SupabaseSignUp } from "./provider.js";

export type LocalTestAccount = {
  userId: string;
  email: string;
  fullName: string;
  password: string;
};

type LocalSession = {
  account: LocalTestAccount;
  refreshToken: string;
  expiresAt: number;
};

export class LocalFlow1TestAuthProvider implements AuthProvider {
  private readonly accountsByEmail: Map<string, LocalTestAccount>;
  private readonly sessionsByAccessToken = new Map<string, LocalSession>();

  constructor(accounts: LocalTestAccount[], private readonly sessionLifetimeSeconds = 60 * 60) {
    this.accountsByEmail = new Map(accounts.map((account) => [account.email, account]));
  }

  async signIn(credentials: { email: string; password: string }): Promise<{ userId: string; email: string; fullName: string; tokens: AuthSessionTokens }> {
    const account = this.accountsByEmail.get(credentials.email.trim().toLowerCase());
    if (!account || !sameSecret(account.password, credentials.password)) throw new Error("INVALID_CREDENTIALS");
    for (const [token, session] of this.sessionsByAccessToken) {
      if (session.expiresAt <= Date.now()) this.sessionsByAccessToken.delete(token);
    }
    if (this.sessionsByAccessToken.size >= 1000) throw new Error("AUTH_UNAVAILABLE");

    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    this.sessionsByAccessToken.set(accessToken, {
      account,
      refreshToken,
      expiresAt: Date.now() + this.sessionLifetimeSeconds * 1000,
    });
    return {
      userId: account.userId,
      email: account.email,
      fullName: account.fullName,
      tokens: { accessToken, refreshToken, expiresIn: this.sessionLifetimeSeconds },
    };
  }

  async signUp(_credentials: SupabaseSignUp): Promise<{ tokens: null; emailVerified: false }> {
    throw new Error("SIGNUP_REJECTED");
  }

  async resolveSession(tokens: AuthSessionTokens): Promise<SessionResolution> {
    const session = this.sessionsByAccessToken.get(tokens.accessToken);
    if (!session || session.expiresAt <= Date.now() || !sameSecret(session.refreshToken, tokens.refreshToken)) {
      if (session?.expiresAt && session.expiresAt <= Date.now()) this.sessionsByAccessToken.delete(tokens.accessToken);
      return { kind: "unauthenticated" };
    }
    return {
      kind: "authenticated",
      userId: session.account.userId,
      email: session.account.email,
      fullName: session.account.fullName,
      emailVerified: true,
    };
  }

  async signOut(tokens: AuthSessionTokens): Promise<void> {
    const session = this.sessionsByAccessToken.get(tokens.accessToken);
    if (session && sameSecret(session.refreshToken, tokens.refreshToken)) this.sessionsByAccessToken.delete(tokens.accessToken);
  }
}

export function parseLocalTestAccounts(value: string | undefined): LocalTestAccount[] {
  if (!value) throw new Error("ARDEN_LOCAL_TEST_USERS is required when local Mainflow 1 test mode is enabled");
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new Error("ARDEN_LOCAL_TEST_USERS must be valid JSON"); }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 10) {
    throw new Error("ARDEN_LOCAL_TEST_USERS must contain between 1 and 10 synthetic accounts");
  }

  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  return parsed.map((candidate, index) => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error(`Local test account ${index + 1} must be an object`);
    }
    const account = candidate as Record<string, unknown>;
    if (Object.keys(account).sort().join(",") !== "email,fullName,password,userId" ||
      typeof account.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(account.userId) ||
      typeof account.email !== "string" || typeof account.fullName !== "string" || typeof account.password !== "string") {
      throw new Error(`Local test account ${index + 1} has an invalid shape`);
    }
    const email = account.email.trim().toLowerCase();
    if (!/^[^\s@]+@example\.test$/.test(email) || account.fullName.trim().length < 1 || account.fullName.length > 200 ||
      account.password.length < 16 || account.password.length > 1024 || account.password.includes("\u0000")) {
      throw new Error(`Local test account ${index + 1} must use an @example.test email, a name, and a 16-character test password`);
    }
    if (seenIds.has(account.userId) || seenEmails.has(email)) throw new Error("Local test account IDs and emails must be unique");
    seenIds.add(account.userId);
    seenEmails.add(email);
    return { userId: account.userId, email, fullName: account.fullName.trim(), password: account.password };
  });
}

export function assertLocalFlow1TestTarget(databaseUrl: string, apiHost: string, nodeEnvironment: string | undefined, supabaseConfigured: boolean): void {
  if (nodeEnvironment === "production") throw new Error("Local Mainflow 1 test mode is forbidden in production");
  if (supabaseConfigured) throw new Error("Do not enable local Mainflow 1 test mode while Supabase is configured");
  if (!isLoopbackHost(apiHost)) throw new Error("Local Mainflow 1 test mode requires ARDEN_API_HOST to be a loopback address");

  let database: URL;
  try { database = new URL(databaseUrl); }
  catch { throw new Error("Local Mainflow 1 test mode requires a valid local DATABASE_URL"); }
  const databaseName = decodeURIComponent(database.pathname.slice(1));
  if ((database.protocol !== "postgres:" && database.protocol !== "postgresql:") ||
    !isLoopbackHost(database.hostname) || !/^arden_test_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("Local Mainflow 1 test mode only permits a loopback PostgreSQL database named arden_test_*");
  }
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function sameSecret(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
