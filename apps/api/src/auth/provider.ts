import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SupabaseCredentials = { email: string; password: string };
export type SupabaseSignUp = { email: string; password: string; fullName: string };
export type AuthSessionTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};
export type GoogleOAuthStart = { url: string; flowId: string; verifier: string };
export type GoogleOAuthResult = {
  userId: string;
  email: string;
  fullName: string | null;
  tokens: AuthSessionTokens;
  passwordSetupRequired: boolean;
};
export type SessionResolution =
  | { kind: "authenticated"; userId: string; email: string; fullName: string | null; emailVerified: boolean; passwordSetupRequired: boolean; rotatedSession?: AuthSessionTokens }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" };

export interface AuthProvider {
  signIn(credentials: SupabaseCredentials): Promise<{ userId: string; email: string; fullName: string | null; tokens: AuthSessionTokens }>;
  signUp(credentials: SupabaseSignUp): Promise<{ tokens: AuthSessionTokens | null; emailVerified: boolean }>;
  resolveSession(tokens: AuthSessionTokens): Promise<SessionResolution>;
  signOut(tokens: AuthSessionTokens): Promise<void>;
  startGoogleSignIn?(redirectTo: string): Promise<GoogleOAuthStart>;
  completeGoogleSignIn?(code: string, flowId: string, verifier: string): Promise<GoogleOAuthResult>;
  setInitialPassword?(tokens: AuthSessionTokens, password: string): Promise<void>;
  resetPasswordForEmail?(email: string, redirectTo?: string): Promise<void>;
  verifyOtp?(params: { email: string; token: string; type: "recovery" | "email" }): Promise<{ tokens: AuthSessionTokens }>;
  updateUserPassword?(tokens: AuthSessionTokens, newPassword: string): Promise<void>;
  verifyLink?(searchParams: string): Promise<string | null>;
}

export class SupabaseAuthProvider implements AuthProvider {
  constructor(
    url: string,
    publishableKey: string,
    publicAuthUrl?: string,
    options: { requirePublicAuthUrl?: boolean } = {},
  ) {
    this.url = url;
    this.publicAuthUrlConfigured = publicAuthUrl !== undefined;
    this.publicAuthUrl = publicAuthUrl === undefined ? url : validateSupabaseAuthPublicUrl(publicAuthUrl);
    this.requirePublicAuthUrl = options.requirePublicAuthUrl ?? false;
    this.publishableKey = publishableKey;
  }

  private readonly url: string;
  private readonly publicAuthUrlConfigured: boolean;
  private readonly publicAuthUrl: string;
  private readonly requirePublicAuthUrl: boolean;
  private readonly publishableKey: string;

  private createAuthClient(): SupabaseClient {
    return createClient(this.url, this.publishableKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
  }

  private createPkceClient(storage: MapStorage, url = this.url): SupabaseClient {
    return createClient(url, this.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        flowType: "pkce",
        storage,
        storageKey: "arden-google-pkce",
      },
    });
  }

  async signIn(credentials: SupabaseCredentials): Promise<{ userId: string; email: string; fullName: string | null; tokens: AuthSessionTokens }> {
    const { data, error } = await this.createAuthClient().auth.signInWithPassword(credentials);
    if (error) {
      if (isEmailNotConfirmed(error)) throw new Error("EMAIL_NOT_CONFIRMED");
      throw new Error(isClientAuthFailure(error) ? "INVALID_CREDENTIALS" : "SUPABASE_AUTH_UNAVAILABLE");
    }
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
    if (error) {
      if (isUserAlreadyRegistered(error)) throw new Error("USER_ALREADY_EXISTS");
      throw new Error(isClientAuthFailure(error) ? "SIGNUP_REJECTED" : "SUPABASE_AUTH_UNAVAILABLE");
    }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error("USER_ALREADY_EXISTS");
    }
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
          passwordSetupRequired: passwordSetupRequired(current.data.user),
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
        emailVerified: Boolean(verified.data.user.email_confirmed_at),
        passwordSetupRequired: passwordSetupRequired(verified.data.user), rotatedSession,
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

  async startGoogleSignIn(redirectTo: string): Promise<GoogleOAuthStart> {
    if (this.requirePublicAuthUrl && !this.publicAuthUrlConfigured) {
      throw new Error("SUPABASE_AUTH_PUBLIC_URL_REQUIRED");
    }
    const storage = new MapStorage();
    const { data, error } = await this.createPkceClient(storage, this.publicAuthUrl).auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url || !data.flowId) throw new Error("SUPABASE_AUTH_UNAVAILABLE");
    const verifier = storage.findVerifier(data.flowId);
    if (!verifier) throw new Error("INVALID_AUTH_RESPONSE");
    return { url: data.url, flowId: data.flowId, verifier };
  }

  async completeGoogleSignIn(code: string, flowId: string, verifier: string): Promise<GoogleOAuthResult> {
    const storage = new MapStorage();
    storage.setVerifier(flowId, verifier);
    const { data, error } = await this.createPkceClient(storage).auth.exchangeCodeForSession(code, { flowId });
    if (error) throw new Error(isClientAuthFailure(error) ? "INVALID_OAUTH_CALLBACK" : "SUPABASE_AUTH_UNAVAILABLE");
    if (!data.user || !data.session || !userIdPattern.test(data.user.id)) throw new Error("INVALID_AUTH_RESPONSE");
    const tokens = toTokens(data.session);
    if (!tokens) throw new Error("INVALID_AUTH_RESPONSE");
    return {
      userId: data.user.id,
      email: normalizeEmail(data.user.email),
      fullName: profileName(data.user.user_metadata),
      tokens,
      passwordSetupRequired: passwordSetupRequired(data.user),
    };
  }

  async setInitialPassword(tokens: AuthSessionTokens, password: string): Promise<void> {
    const auth = this.createAuthClient().auth;
    const session = await auth.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
    if (session.error || !session.data.user) throw new Error(isClientAuthFailure(session.error ?? {}) ? "UNAUTHENTICATED" : "SUPABASE_AUTH_UNAVAILABLE");
    if (!passwordSetupRequired(session.data.user)) throw new Error("PASSWORD_ALREADY_INITIALIZED");
    const { error } = await auth.updateUser({
      password,
      data: { ...session.data.user.user_metadata, arden_password_initialized: true },
    });
    if (error) throw new Error(isClientAuthFailure(error) ? "PASSWORD_REJECTED" : "SUPABASE_AUTH_UNAVAILABLE");
  }

  async resetPasswordForEmail(email: string, redirectTo?: string): Promise<void> {
    const { error } = await this.createAuthClient().auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || undefined,
    });
    if (error && !isClientAuthFailure(error)) throw new Error("SUPABASE_AUTH_UNAVAILABLE");
    if (error) throw new Error("RESET_REQUEST_REJECTED");
  }

  async verifyOtp(params: { email: string; token: string; type: "recovery" | "email" }): Promise<{ tokens: AuthSessionTokens }> {
    const { data, error } = await this.createAuthClient().auth.verifyOtp({
      email: params.email,
      token: params.token,
      type: params.type,
    });
    if (error) throw new Error(isClientAuthFailure(error) ? "INVALID_OTP" : "SUPABASE_AUTH_UNAVAILABLE");
    if (!data.session) throw new Error("INVALID_AUTH_RESPONSE");
    const tokens = toTokens(data.session);
    if (!tokens) throw new Error("INVALID_AUTH_RESPONSE");
    return { tokens };
  }

  async updateUserPassword(tokens: AuthSessionTokens, newPassword: string): Promise<void> {
    const auth = this.createAuthClient().auth;
    const { error: sessionError } = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (sessionError) throw new Error(isClientAuthFailure(sessionError) ? "INVALID_SESSION" : "SUPABASE_AUTH_UNAVAILABLE");
    const { error } = await auth.updateUser({ password: newPassword });
    if (error) throw new Error(isClientAuthFailure(error) ? "PASSWORD_UPDATE_REJECTED" : "SUPABASE_AUTH_UNAVAILABLE");
  }

  async verifyLink(searchParams: string): Promise<string | null> {
    const target = new URL(`/auth/v1/verify?${searchParams}`, this.url);
    const response = await fetch(target.toString(), {
      headers: { apikey: this.publishableKey },
      redirect: "manual",
    });
    return response.headers.get("location");
  }
}

export function resolveSupabaseAuthPublicUrl(
  publicUrl: string | undefined,
  privateUrl: string | undefined,
): string | undefined {
  if (publicUrl === undefined || publicUrl === "") {
    return undefined;
  }
  if (!privateUrl) throw new Error("SUPABASE_AUTH_PUBLIC_URL requires SUPABASE_URL");
  return validateSupabaseAuthPublicUrl(publicUrl);
}

function validateSupabaseAuthPublicUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("SUPABASE_AUTH_PUBLIC_URL must be an exact HTTPS origin without credentials, path, query, or fragment");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== value || parsed.pathname !== "/" ||
    parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("SUPABASE_AUTH_PUBLIC_URL must be an exact HTTPS origin without credentials, path, query, or fragment");
  }
  return parsed.origin;
}

class MapStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
  findVerifier(flowId: string): string | null {
    const stored = this.values.get(`arden-google-pkce-flow-${flowId}-code-verifier`) ??
      [...this.values.entries()].find(([key]) => key.endsWith(`-flow-${flowId}-code-verifier`))?.[1];
    if (!stored) return null;
    try {
      const verifier: unknown = JSON.parse(stored);
      return typeof verifier === "string" ? verifier : null;
    } catch {
      return null;
    }
  }
  setVerifier(flowId: string, verifier: string): void {
    this.values.set(`arden-google-pkce-flow-${flowId}-code-verifier`, JSON.stringify(verifier));
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

function isUserAlreadyRegistered(error: { code?: string; message?: string }): boolean {
  if (error.code === "user_already_exists") return true;
  if (typeof error.message === "string" && /user already (registered|exists)|already registered/i.test(error.message)) return true;
  return false;
}

function isEmailNotConfirmed(error: { code?: string; message?: string }): boolean {
  if (error.code === "email_not_confirmed") return true;
  if (typeof error.message === "string" && /email not confirmed/i.test(error.message)) return true;
  return false;
}

function normalizeEmail(email: string | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function profileName(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null || !("full_name" in metadata)) return null;
  const value = metadata.full_name;
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
}

function passwordSetupRequired(user: User): boolean {
  if (user.user_metadata?.arden_password_initialized === true) return false;
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers.filter((provider): provider is string => typeof provider === "string")
    : [];
  return providers.includes("google") && !providers.includes("email");
}
