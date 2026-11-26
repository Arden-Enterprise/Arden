import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP-recommended scrypt cost for interactive logins; stored hashes keep their own parameters.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
// Large enough to verify the strongest accepted stored parameters (N=65536, r=8 needs 64 MiB).
const SCRYPT_MAXMEM = 96 * 1024 * 1024;
const DUMMY_SALT = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");

function deriveScrypt(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: SCRYPT_MAXMEM }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashSystemAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveScrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifySystemAdminPassword(password: string, storedHash: string | null): Promise<boolean> {
  if (!storedHash) {
    // Perform equivalent scrypt work to avoid timing differences on unknown emails.
    await deriveScrypt(password, DUMMY_SALT, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN);
    return false;
  }
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    await deriveScrypt(password, DUMMY_SALT, SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN);
    return false;
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4] ?? "";
  const hashHex = parts[5] ?? "";
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)
    || n < 1024 || n > 65536 || r < 1 || r > 16 || p < 1 || p > 4
    || !/^[0-9a-f]{32,128}$/.test(saltHex) || !/^[0-9a-f]{64,256}$/.test(hashHex)) {
    return false;
  }
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await deriveScrypt(password, salt, n, r, p, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Bounds concurrent scrypt work so a burst of sign-in attempts cannot exhaust the libuv
 * thread pool shared with file and DNS work. A caller that cannot get a slot is told to retry.
 */
export class PasswordWorkLimiter {
  private active = 0;
  constructor(private readonly capacity = 4) {}

  async run<T>(work: () => Promise<T>): Promise<{ value: T } | null> {
    if (this.active >= this.capacity) return null;
    this.active++;
    try { return { value: await work() }; }
    finally { this.active--; }
  }
}

export function verifySetupToken(provided: string, expected: string): boolean {
  const normalizedProvided = provided.trim();
  const normalizedExpected = expected.trim();
  if (!normalizedProvided || !normalizedExpected) return false;
  const providedDigest = createHash("sha256").update(normalizedProvided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(normalizedExpected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
