import { type FormEvent, useState } from "react";
import { accountPasswordMaximumLength, accountPasswordMaximumLengthMessage } from "@arden/domain";
import type { Platform } from "../shared/types";
import { ApiError, systemSignIn, type SystemAdminSession } from "../shared/api-client";
import { AuthLayout } from "../sign-in/AuthLayout";
import { VisiblePasswordField } from "../sign-in/VisiblePasswordField";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SystemSignInPage({
  platform,
  needsInitialSetup,
  noticeMessage,
  onAuthenticated,
  onOpenSetup,
  onBackToMemberSignIn,
}: {
  platform: Platform;
  needsInitialSetup: boolean;
  noticeMessage?: string | null;
  onAuthenticated: (session: SystemAdminSession) => void;
  onOpenSetup: () => void;
  onBackToMemberSignIn: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    setEmail(normalizedEmail);
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    if (password.length > accountPasswordMaximumLength) {
      setError(accountPasswordMaximumLengthMessage);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const session = await systemSignIn(platform, normalizedEmail, password);
      setPassword("");
      onAuthenticated(session);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.message ? cause.message : "Sign in could not be completed.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <section className="auth-card" aria-labelledby="system-signin-title">
        <div className="auth-card-main">
          <span className="auth-eyebrow">ARDEN SYSTEM CONSOLE</span>
          <h1 id="system-signin-title">System Admin sign in</h1>
          <p className="auth-helper-text" style={{ margin: "6px 0 18px" }}>
            Sign in with a dedicated System Admin account. Organization member accounts cannot open the System Console.
          </p>

          {noticeMessage && !error && (
            <div className="auth-message is-success" role="status">
              {noticeMessage}
            </div>
          )}

          {error && (
            <div className="auth-message" role="alert">
              {error}
            </div>
          )}

          {needsInitialSetup && (
            <div className="auth-message" role="status">
              No System Admin has been initialized yet.{" "}
              <button type="button" className="auth-text-link" onClick={onOpenSetup}>
                Run first-time setup
              </button>
            </div>
          )}

          <form noValidate onSubmit={handleSubmit}>
            <label>
              <span>System Admin email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                onBlur={(event) => setEmail(event.target.value.trim())}
                autoComplete="username"
                placeholder="sysadmin@example.com"
                maxLength={320}
                required
              />
            </label>
            <VisiblePasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              placeholder="Enter your password"
            />
            <button type="submit" className="auth-primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in to System Console"}
            </button>
            <div className="auth-footer-links">
              <button type="button" className="auth-text-link" onClick={onBackToMemberSignIn}>
                ← Back to member sign in
              </button>
            </div>
          </form>
        </div>
      </section>
    </AuthLayout>
  );
}
