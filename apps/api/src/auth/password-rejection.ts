import { passwordIssue, passwordMessages } from "@arden/domain";

export class PasswordRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordRejectedError";
  }
}

type PasswordProviderFailure = {
  message?: string;
  code?: string;
  reasons?: readonly string[];
};

export function passwordProviderMessage(error: PasswordProviderFailure, password: string): string {
  const message = error.message ?? "";
  const reasons = error.reasons ?? [];
  if (error.code === "same_password" || /different from the old password/i.test(message)) {
    return passwordMessages.reused;
  }
  if (reasons.includes("pwned") || /pwned|data breach|leaked password|easy to guess/i.test(message)) {
    return passwordMessages.breach;
  }
  const local = passwordIssue(password);
  if (local) return local;
  if (reasons.includes("length")) return passwordMessages.length;
  return passwordMessages.unusable;
}

export function isPasswordProviderFailure(error: PasswordProviderFailure): boolean {
  if (error.code === "same_password" || error.code === "weak_password") return true;
  if ((error.reasons ?? []).length > 0) return true;
  return /password/i.test(error.message ?? "");
}
