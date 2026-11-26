import { createHmac, timingSafeEqual } from "node:crypto";

export const SYSTEM_SESSION_TTL_SECONDS = 24 * 60 * 60;
/** Clock skew tolerated between API replicas when checking a cookie's stated expiry. */
const SYSTEM_SESSION_SKEW_SECONDS = 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function systemCookieName(secure: boolean): string {
  return secure ? "__Host-arden_system_session" : "arden_system_session";
}

function deriveSystemSessionKey(signingKey: Buffer): Buffer {
  // v2: the signed subject is a server-side session id, not an administrator id.
  return createHmac("sha256", signingKey).update("arden:system-admin-session:v2").digest();
}

function signPayload(sessionId: string, expiresAt: number, signingKey: Buffer): string {
  const key = deriveSystemSessionKey(signingKey);
  return createHmac("sha256", key).update(`${sessionId}.${expiresAt}`).digest("hex");
}

export function newSystemSessionExpiry(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000) + SYSTEM_SESSION_TTL_SECONDS;
}

/**
 * The cookie only names a server-side `arden_system.admin_session` row. Sign-out,
 * revocation and expiry are decided by that row on every request.
 */
export function createSystemSessionCookie(
  sessionId: string,
  expiresAt: number,
  signingKey: Buffer,
  secure: boolean,
  nowMs = Date.now(),
): string {
  const signature = signPayload(sessionId, expiresAt, signingKey);
  const value = `${sessionId}.${expiresAt}.${signature}`;
  const maxAge = Math.max(0, expiresAt - Math.floor(nowMs / 1000));
  return `${systemCookieName(secure)}=${value}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${maxAge}`;
}

export function clearSystemSessionCookie(secure: boolean): string {
  return `${systemCookieName(secure)}=; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=0`;
}

export function readSystemSessionCookie(
  cookieHeader: string | undefined,
  signingKey: Buffer,
  secure: boolean,
  nowMs = Date.now(),
): { sessionId: string; expiresAt: number } | null {
  if (!cookieHeader || cookieHeader.length > 8192) return null;
  const prefix = `${systemCookieName(secure)}=`;
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [sessionId, expiresText, signature] = parts;
  if (!sessionId || !expiresText || !signature) return null;
  if (!UUID_PATTERN.test(sessionId) || !/^\d{10}$/.test(expiresText) || !/^[0-9a-f]{64}$/.test(signature)) {
    return null;
  }
  const expiresAt = Number(expiresText);
  const now = Math.floor(nowMs / 1000);
  if (expiresAt <= now || expiresAt > now + SYSTEM_SESSION_TTL_SECONDS + SYSTEM_SESSION_SKEW_SECONDS) return null;
  const expected = signPayload(sessionId, expiresAt, signingKey);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    return null;
  }
  return { sessionId, expiresAt };
}
