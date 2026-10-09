import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupabaseCredentials = { email: string; password: string };
export type SupabaseSignUp = { email: string; password: string; fullName: string };
export type AuthSessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};
export type SessionResolution =
  | { kind: "authenticated"; userId: string; email: string; fullName: string | null; emailVerified: boolean; rotatedSession?: AuthSessionTokens }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" };

export interface AuthProvider {
  signIn(credentials: SupabaseCredentials): Promise<{ userId: string; email: string; fullName: string | null; tokens: AuthSessionTokens }>;
  signUp(credentials: SupabaseSignUp): Promise<{ tokens: AuthSessionTokens | null; emailVerified: boolean }>;
  resolveSession(tokens: AuthSessionTokens): Promise<SessionResolution>;
  signOut(tokens: AuthSessionTokens): Promise<void>;
}

export class SupabaseAuthProvider implements AuthProvider {
  constructor(url: string, publishableKey: string) {
    this.url = url;
    this.publishableKey = publishableKey;
  }

  private readonly url: string;
  private readonly publishableKey: string;

  private createAuthClient(): SupabaseClient {
    return createClient(this.url, this.publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
  }

  async signIn(credentials: SupabaseCredentials): Promise<{ userId: string; email: string; fullName: string | null; tokens: AuthSessionTokens }> {
    const { data, error } = await this.createAuthClient().auth.signInWithPassword(credentials);
    if (error) throw new Error(isClientAuthFailure(error) ? "INVALID_CREDENTIALS" : "SUPABASE_AUTH_UNAVAILABLE");
    if (!data.user || !data.session) throw new Error("SUPABASE_AUTH_UNAVAILABLE");
    const tokens = toTokens(data.session);
    if (!tokens || !userIdPattern.test(data.user.id)) throw new Error("INVALID_AUTH_RESPONSE");
    return { userId: data.user.id, email: normalizeEmail(data.user.email), fullName: profileName(data.user.user_metadata), tokens };
  }

  async signUp(credentials: SupabaseSignUp): Promise<{ tokens: AuthSessionTokens | null; emailVerified: boolean }> {
    const { data, error } = await this.createAuthClient().auth.signUp({
      email: credentials.email,
      password: credentials.password,
      options: { data: { full_name: credentials.fullName } },
    });
    if (error) throw new Error(isClientAuthFailure(error) ? "SIGNUP_REJECTED" : "SUPABASE_AUTH_UNAVAILABLE");
    if (!data.user) throw new Error("SUPABASE_AUTH_UNAVAILABLE");
    const emailVerified = Boolean(data.user.email_confirmed_at);
    const tokens = data.session ? toTokens(data.session) : null;
    if (data.session && !tokens) throw new Error("INVALID_AUTH_RESPONSE");
    return { tokens: emailVerified ? tokens : null, emailVerified };
  }

  async resolveSession(tokens: AuthSessionTokens): Promise<SessionResolution> {
    try {
      const auth = this.createAuthClient().auth;
      const current = await auth.getUser(tokens.accessToken);
      if (!current.error && current.data.user && userIdPattern.test(current.data.user.id)) {
        return {
          kind: "authenticated", userId: current.data.user.id,
          email: normalizeEmail(current.data.user.email), fullName: profileName(current.data.user.user_metadata),
          emailVerified: Boolean(current.data.user.email_confirmed_at),
        };
      }
      if (current.error && !isClientAuthFailure(current.error)) return { kind: "unavailable" };
      if (!isExpiredJwt(tokens.accessToken)) return { kind: "unauthenticated" };

      const refreshed = await auth.refreshSession({ refresh_token: tokens.refreshToken });
      if (refreshed.error) return isClientAuthFailure(refreshed.error)
        ? { kind: "unauthenticated" }
        : { kind: "unavailable" };
      if (!refreshed.data.session || !refreshed.data.user) return { kind: "unauthenticated" };

      const verified = await auth.getUser(refreshed.data.session.access_token);
      if (verified.error) return isClientAuthFailure(verified.error)
        ? { kind: "unauthenticated" }
        : { kind: "unavailable" };
      if (!verified.data.user || !userIdPattern.test(verified.data.user.id)) return { kind: "unauthenticated" };
      const rotatedSession = toTokens(refreshed.data.session);
      if (!rotatedSession) return { kind: "unavailable" };
      return {
        kind: "authenticated", userId: verified.data.user.id,
        email: normalizeEmail(verified.data.user.email), fullName: profileName(verified.data.user.user_metadata),
        emailVerified: Boolean(verified.data.user.email_confirmed_at), rotatedSession,
      };
    } catch {
      return { kind: "unavailable" };
    }
  }

  async signOut(tokens: AuthSessionTokens): Promise<void> {
    const auth = this.createAuthClient().auth;
    const { error: sessionError } = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (sessionError && !isClientAuthFailure(sessionError)) throw new Error("SUPABASE_AUTH_UNAVAILABLE");
    if (sessionError) return;
    const { error } = await auth.signOut({ scope: "local" });
    if (error && !isClientAuthFailure(error)) throw new Error("SUPABASE_AUTH_UNAVAILABLE");
  }
}

function toTokens(session: Session): AuthSessionTokens | null {
  if (!session.access_token || !session.refresh_token || !Number.isFinite(session.expires_in) || session.expires_in <= 0) return null;
  return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresIn: session.expires_in };
}

function isExpiredJwt(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded !== "object" || decoded === null || !("exp" in decoded) ||
      typeof decoded.exp !== "number" || decoded.exp * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
}

function isClientAuthFailure(error: { status?: number }): boolean {
  return typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 429;
}

function normalizeEmail(email: string | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function profileName(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || !("full_name" in metadata)) return null;
  const value = metadata.full_name;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}
