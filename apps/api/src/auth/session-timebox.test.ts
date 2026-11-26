import { describe, expect, it } from "vitest";
import { newSessionExpiry, readSessionExpiry, sealSession, sessionLifetimeSeconds,
  sessionSigningKey } from "./session-timebox.js";

const key = Buffer.alloc(32, 7);
const tokens = { accessToken: "access", refreshToken: "refresh", expiresIn: 3600 };
const now = Date.UTC(2026, 10, 13, 8);

describe("24-hour Arden session timebox", () => {
  it("requires a stable valid signing key in production", () => {
    expect(() => sessionSigningKey(undefined, true)).toThrow("ARDEN_SESSION_SIGNING_KEY is required");
    expect(() => sessionSigningKey("not-a-key", false)).toThrow("64 hexadecimal characters");
    expect(sessionSigningKey(key.toString("hex"), true)).toEqual(key);
  });

  it("accepts a token-bound seal before the absolute deadline and rejects it at 24 hours", () => {
    const expiresAt = newSessionExpiry(now);
    expect(expiresAt).toBe(now / 1000 + sessionLifetimeSeconds);
    const seal = sealSession(tokens, expiresAt, key);
    expect(readSessionExpiry(seal, tokens, key, now + sessionLifetimeSeconds * 1000 - 1000)).toBe(expiresAt);
    expect(readSessionExpiry(seal, tokens, key, now + sessionLifetimeSeconds * 1000)).toBeNull();
    expect(readSessionExpiry(seal, tokens, key, now + sessionLifetimeSeconds * 1000 + 1000)).toBeNull();
  });

  it("rejects missing, edited, or replayed seals after token rotation", () => {
    const expiresAt = newSessionExpiry(now);
    const seal = sealSession(tokens, expiresAt, key);
    expect(readSessionExpiry(undefined, tokens, key, now)).toBeNull();
    expect(readSessionExpiry(seal.replace(`.${expiresAt}.`, `.${expiresAt - 100}.`), tokens, key, now)).toBeNull();
    expect(readSessionExpiry(seal, { ...tokens, refreshToken: "rotated" }, key, now)).toBeNull();
    expect(readSessionExpiry(seal, tokens, Buffer.alloc(32, 8), now)).toBeNull();
  });
});
