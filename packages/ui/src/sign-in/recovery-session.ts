export const recoveryTokenStorageKey = "arden.recovery-tokens";
const maximumAgeMs = 10 * 60 * 1000;

export type RecoveryTokens = { accessToken: string; refreshToken: string };

/**
 * Reads recovery tokens kept for this tab after the address bar is cleaned.
 * Entries older than the ten-minute recovery proof are discarded.
 */
export function readRecoveryTokens(): RecoveryTokens | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(recoveryTokenStorageKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      sessionStorage.removeItem(recoveryTokenStorageKey);
      return null;
    }
    const record = parsed as { accessToken?: unknown; refreshToken?: unknown; storedAt?: unknown };
    if (typeof record.accessToken !== "string" || typeof record.refreshToken !== "string" || typeof record.storedAt !== "number") {
      sessionStorage.removeItem(recoveryTokenStorageKey);
      return null;
    }
    if (Date.now() - record.storedAt > maximumAgeMs) {
      sessionStorage.removeItem(recoveryTokenStorageKey);
      return null;
    }
    return { accessToken: record.accessToken, refreshToken: record.refreshToken };
  } catch {
    return null;
  }
}

export function storeRecoveryTokens(tokens: RecoveryTokens): void {
  try {
    sessionStorage.setItem(recoveryTokenStorageKey, JSON.stringify({ ...tokens, storedAt: Date.now() }));
  } catch {
    // The reset form can still use the tokens held in memory for this page load.
  }
}

export function clearRecoveryTokens(): void {
  try {
    sessionStorage.removeItem(recoveryTokenStorageKey);
  } catch {
    // Ignore storage that is unavailable in this environment.
  }
}
