import { createHash } from "node:crypto";

/** Failed sign-in attempts allowed per email inside one window before lockout starts. */
export const signInFailureLimit = 5;
const signInWindowMs = 15 * 60 * 1000;
const signInBaseLockSeconds = 30;
const signInMaxLockSeconds = 15 * 60;
const maxBuckets = 10_000;

type ThrottleEntry = {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number;
};

export type SignInThrottleState = { retryAfterSeconds: number } | null;

/**
 * In-memory per-email sign-in throttle that locks repeated failed password attempts
 * with exponential backoff (30s up to 15 minutes) inside a 15-minute window.
 */
export class SignInThrottle {
  private readonly buckets = new Map<string, ThrottleEntry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Returns the active lockout remaining for an email, or null if not locked. */
  state(email: string): SignInThrottleState {
    const key = bucketKey(email);
    const entry = this.buckets.get(key);
    if (!entry) return null;
    const current = this.now();
    if (entry.lockedUntil > current) {
      return { retryAfterSeconds: Math.max(1, Math.ceil((entry.lockedUntil - current) / 1000)) };
    }
    if (current - entry.windowStartedAt >= signInWindowMs && entry.lockedUntil <= current) {
      this.buckets.delete(key);
    }
    return null;
  }

  /** Records a failed sign-in attempt for an email and returns any triggered lockout. */
  recordFailure(email: string): SignInThrottleState {
    const current = this.now();
    const key = bucketKey(email);
    const existing = this.buckets.get(key);
    const expired = !existing || (current - existing.windowStartedAt >= signInWindowMs && existing.lockedUntil <= current);
    const failures = expired ? 1 : existing.failures + 1;
    const windowStartedAt = expired ? current : existing.windowStartedAt;
    const lockSeconds = lockSecondsForFailures(failures);
    const lockedUntil = lockSeconds > 0 ? current + lockSeconds * 1000 : 0;

    if (!existing && this.buckets.size >= maxBuckets) {
      this.pruneExpired(current);
      if (this.buckets.size >= maxBuckets) {
        const oldestKey = this.buckets.keys().next().value;
        if (oldestKey !== undefined) this.buckets.delete(oldestKey);
      }
    }

    this.buckets.set(key, { failures, windowStartedAt, lockedUntil });
    return lockSeconds > 0 ? { retryAfterSeconds: lockSeconds } : null;
  }

  /** Clears recorded failures for an email after a successful sign-in. */
  clear(email: string): void {
    this.buckets.delete(bucketKey(email));
  }

  private pruneExpired(current: number): void {
    for (const [key, entry] of this.buckets) {
      if (current - entry.windowStartedAt >= signInWindowMs && entry.lockedUntil <= current) {
        this.buckets.delete(key);
      }
    }
  }
}

function bucketKey(email: string): string {
  return createHash("sha256").update(`arden:sign-in-throttle:${email}`, "utf8").digest("hex");
}

function lockSecondsForFailures(failures: number): number {
  if (failures < signInFailureLimit) return 0;
  return Math.min(signInMaxLockSeconds, signInBaseLockSeconds * 2 ** (failures - signInFailureLimit));
}

