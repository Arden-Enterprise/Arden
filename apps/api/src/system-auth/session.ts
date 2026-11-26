import { createHmac, timingSafeEqual } from "node:crypto";

const SYSTEM_SESSION_TTL_SECONDS = 24 * 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function systemCookieName(secure: boolean): string {
  return secure ? "__Host-arden_system_session" : "arden_system_session";
}

function deriveSystemSessionKey(signingKey: Buffer): Buffer {
  return createHmac("sha256", signingKey).update("arden:system-admin-session:v1").digest();
}

function signPayload(adminId: string, expiresAt: number, signingKey: Buffer): string {
  const key = deriveSystemSessionKey(signingKey);
  return createHmac("sha256", key).update(`${adminId}.${expiresAt}`).digest("hex");
}

export function newSystemSessionExpiry(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000) + SYSTEM_SESSION_TTL_SECONDS;
}

export function createSystemSessionCookie(
  adminId: string,
  expiresAt: number,
  signingKey: Buffer,
  secure: boolean,
): string {
  const signature = signPayload(adminId, expiresAt, signingKey);
  const value = `${adminId}.${expiresAt}.${signature}`;
  const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
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
): { adminId: string; expiresAt: number } | null {
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
  const [adminId, expiresText, signature] = parts;
  if (!adminId || !expiresText || !signature) return null;
  if (!UUID_PATTERN.test(adminId) || !/^\d{10}$/.test(expiresText) || !/^[0-9a-f]{64}$/.test(signature)) {
    return null;
  }
  const expiresAt = Number(expiresText);
  if (expiresAt <= Math.floor(nowMs / 1000)) return null;
  const expected = signPayload(adminId, expiresAt, signingKey);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    return null;
  }
  return { adminId, expiresAt };
}
