import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthSessionTokens } from "./provider.js";

export const sessionLifetimeSeconds = 24 * 60 * 60;

export function sessionSigningKey(value: string | undefined, production: boolean): Buffer {
  if (!value) {
    if (production) throw new Error("ARDEN_SESSION_SIGNING_KEY is required in production");
    return randomBytes(32);
  }
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("ARDEN_SESSION_SIGNING_KEY must be 32 random bytes encoded as 64 hexadecimal characters");
  }
  return Buffer.from(value, "hex");
}

function signature(tokens: AuthSessionTokens, expiresAt: number, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(JSON.stringify(["v1", expiresAt, tokens.accessToken, tokens.refreshToken]))
    .digest();
}

export function newSessionExpiry(now = Date.now()): number {
  return Math.floor(now / 1000) + sessionLifetimeSeconds;
}

export function sealSession(tokens: AuthSessionTokens, expiresAt: number, key: Buffer): string {
  return `v1.${expiresAt}.${signature(tokens, expiresAt, key).toString("hex")}`;
}

export function readSessionExpiry(value: string | undefined, tokens: AuthSessionTokens,
  key: Buffer, now = Date.now()): number | null {
  const match = /^v1\.(\d{10})\.([a-f0-9]{64})$/.exec(value ?? "");
  if (!match) return null;
  const expiresAt = Number(match[1]);
  const currentSecond = Math.floor(now / 1000);
  if (expiresAt <= currentSecond || expiresAt > currentSecond + sessionLifetimeSeconds) return null;
  const supplied = Buffer.from(match[2], "hex");
  return timingSafeEqual(supplied, signature(tokens, expiresAt, key)) ? expiresAt : null;
}
