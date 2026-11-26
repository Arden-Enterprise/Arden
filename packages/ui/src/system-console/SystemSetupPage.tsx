import { type FormEvent, useState } from "react";
import {
  accountPasswordMaximumLength,
  accountPasswordMaximumLengthMessage,
  meetsAccountPasswordRequirements,
} from "@arden/domain";
import type { Platform } from "../shared/types";
import { ApiError, completeSystemSetup, type SystemAdminSession } from "../shared/api-client";
import { AuthLayout } from "../sign-in/AuthLayout";
import { NewPasswordField, accountPasswordRequirementMessage } from "../sign-in/NewPasswordField";
import { VisiblePasswordField } from "../sign-in/VisiblePasswordField";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SystemSetupPage({
  platform,
  hasOrganizations,
  onCompleted,
  onOpenSystemSignIn,
  onBackToMemberSignIn,
}: {
  platform: Platform;
  hasOrganizations: boolean;
  onCompleted: (session: SystemAdminSession) => void;
  onOpenSystemSignIn: () => void;
  onBackToMemberSignIn?: () => void;
}) {
  const [setupToken, setSetupToken] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedToken = setupToken.trim();
    const trimmedName = fullName.trim();
    const normalizedEmail = email.trim();
    setEmail(normalizedEmail);

    if (!trimmedToken) {
      setError("Enter the one-time setup token from ARDEN_SYSTEM_SETUP_TOKEN or the API startup logs.");
      return;
    }
    if (!trimmedName) {
      setError("Enter your name.");
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length > accountPasswordMaximumLength) {
      setError(accountPasswordMaximumLengthMessage);
      return;
    }
    if (!meetsAccountPasswordRequirements(password)) {
      setError(accountPasswordRequirementMessage);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const session = await completeSystemSetup(platform, {
        setupToken: trimmedToken,
        email: normalizedEmail,
        fullName: trimmedName,
        password,
      });
      setSetupToken("");
      setPassword("");
      setConfirmPassword("");
      onCompleted(session);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "SYSTEM_SETUP_ALREADY_COMPLETED") {
        setAlreadyCompleted(true);
        setError("Initial System Admin setup has already been completed. Sign in with your System Admin account.");
      } else if (cause instanceof ApiError && cause.message) {
        setError(cause.message);
      } else {
        setError("Initial System Admin setup could not be completed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout wide>
      <section className="auth-card auth-workspace-card" aria-labelledby="system-setup-title">
        <div className="auth-card-main">
          <span className="auth-eyebrow">FIRST-TIME INSTALLATION SETUP</span>
          <h1 id="system-setup-title">Create the first System Admin</h1>
          <p className="auth-helper-text" style={{ textAlign: "center", margin: "8px 0 20px" }}>
            This dedicated account is stored separately from organization members and manages read-only System Console monitoring. Setup closes permanently once completed.
          </p>

          {error && (
            <div className="auth-message" role="alert">
              {error}
            </div>
          )}

          {alreadyCompleted ? (
            <div style={{ display: "grid", gap: "12px" }}>
              <button type="button" className="auth-primary" onClick={onOpenSystemSignIn}>
                Go to System Console sign in
              </button>
              {onBackToMemberSignIn && (
                <div className="auth-footer-links" style={{ justifyContent: "center" }}>
                  <button type="button" className="auth-text-link" onClick={onBackToMemberSignIn}>
                    ← Back to member sign in
                  </button>
                </div>
              )}
            </div>
          ) : (
            <form noValidate onSubmit={handleSubmit}>
              <VisiblePasswordField
                label="One-time setup token"
                value={setupToken}
                onChange={setSetupToken}
                autoComplete="off"
                placeholder="From ARDEN_SYSTEM_SETUP_TOKEN or API startup logs"
              />
              <label>
                <span>Full name</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="System Operator"
                  maxLength={200}
                  required
                />
              </label>
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
              <NewPasswordField value={password} onChange={setPassword} />
              <VisiblePasswordField
                label="Confirm password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                placeholder="Re-enter your password"
              />
              <button type="submit" className="auth-primary" disabled={busy}>
                {busy ? "Creating System Admin…" : "Create System Admin"}
              </button>
              <div className="auth-footer-links" style={{ justifyContent: "center" }}>
                <button type="button" className="auth-text-link" onClick={onOpenSystemSignIn}>
                  Already configured? System Console sign in
                </button>
                {hasOrganizations && onBackToMemberSignIn && (
                  <button type="button" className="auth-text-link" onClick={onBackToMemberSignIn}>
                    ← Back to member sign in
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </section>
    </AuthLayout>
  );
}
