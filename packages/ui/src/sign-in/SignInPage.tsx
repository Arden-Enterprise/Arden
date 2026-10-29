import { type FormEvent, useEffect, useRef, useState } from "react";
import type { Platform } from "../shared/types";
import {
  beginGoogleSignIn,
  signIn,
  signUp,
  requestPasswordReset,
  resetPasswordWithToken,
  ApiError,
  type CurrentSession,
} from "../shared/api-client";
import { AuthLayout } from "./AuthLayout";

export type SignInMode = "sign-in" | "register" | "forgot-password" | "reset-password";

function UnconfirmedEmailDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="organization-dialog admin-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unconfirmed-email-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <div className="organization-dialog-heading">
        <h2 id="unconfirmed-email-title">Email chưa được xác nhận</h2>
      </div>
      <p className="organization-dialog-description">
        Tài khoản với email <strong>{email}</strong> chưa được xác nhận. Vui lòng kiểm tra hộp thư đến (hoặc thư mục Spam / Junk) và nhấn vào liên kết xác nhận trước khi đăng nhập.
      </p>
      <div className="organization-dialog-actions">
        <button type="button" className="auth-primary" autoFocus onClick={onClose}>
          Đã hiểu
        </button>
      </div>
    </dialog>
  );
}

export function SignInPage({
  platform,
  onEnterPreview,
  onOpenSetup,
  onEnterAdminPreview,
  onAuthenticated,
  initialMode = "sign-in",
  recoveryTokens = null,
}: {
  platform: Platform;
  onEnterPreview: () => void;
  onOpenSetup: () => void;
  onEnterAdminPreview?: () => void;
  onAuthenticated: (session: CurrentSession) => Promise<void>;
  initialMode?: SignInMode;
  recoveryTokens?: { accessToken: string; refreshToken: string } | null;
}) {
  const [mode, setMode] = useState<SignInMode>(initialMode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [notice, setNotice] = useState<{ text: string; isSuccess?: boolean } | null>(() => {
    const status = new URLSearchParams(window.location.search).get("status");
    return status === "error" ? { text: "Sign in could not be completed." } : null;
  });
  const [busy, setBusy] = useState<"submit" | "google" | null>(null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const showPreview = new URLSearchParams(window.location.search).get("preview") === "1";

  const switchMode = (newMode: SignInMode) => {
    if (typeof window !== "undefined" && window.location.pathname === "/reset-password") {
      try { window.history.replaceState(null, "", "/"); } catch {}
    }
    setMode(newMode);
    setNotice(null);
    setPassword("");
    setConfirmPassword("");
  };

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("submit");
    setNotice(null);
    try {
      await onAuthenticated(await signIn(platform, email.trim(), password));
    } catch (error) {
      if (error instanceof ApiError && error.code === "EMAIL_NOT_CONFIRMED") {
        setUnconfirmedEmail(email.trim());
        setNotice({ text: "Email chưa được xác nhận. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản." });
      } else {
        setNotice({ text: error instanceof Error ? error.message : "Sign in could not be completed." });
      }
    } finally {
      setBusy(null);
      setPassword("");
    }
  };

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("submit");
    setNotice(null);
    try {
      await signUp(platform, email.trim(), password, fullName.trim());
      setNotice({
        text: "Account created. Check your email for confirmation if required, then sign in.",
        isSuccess: true,
      });
      setMode("sign-in");
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === "ACCOUNT_ALREADY_EXISTS" || cause.status === 409)) {
        setNotice({ text: "An account with this email address already exists. Please sign in instead." });
        setMode("sign-in");
      } else if (cause instanceof ApiError && cause.message) {
        setNotice({ text: cause.message });
      } else {
        setNotice({ text: "Account setup could not be completed. Check the password requirements or try signing in." });
      }
    } finally {
      setBusy(null);
      setPassword("");
    }
  };

  const handleForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("submit");
    setNotice(null);
    try {
      await requestPasswordReset(platform, email.trim());
      setNotice({
        text: "If an account with this email exists, a password reset link has been sent to your email.",
        isSuccess: true,
      });
    } catch (cause) {
      setNotice({
        text: cause instanceof ApiError ? cause.message : "Password reset could not be requested. Try again later.",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setNotice({ text: "Passwords do not match." });
      return;
    }
    setBusy("submit");
    setNotice(null);
    try {
      if (recoveryTokens) {
        await resetPasswordWithToken(platform, {
          accessToken: recoveryTokens.accessToken,
          refreshToken: recoveryTokens.refreshToken,
          newPassword: password,
        });
      } else {
        await resetPasswordWithToken(platform, {
          email: email.trim(),
          token: resetToken.trim(),
          newPassword: password,
        });
      }
      if (typeof window !== "undefined" && window.location.pathname === "/reset-password") {
        try { window.history.replaceState(null, "", "/"); } catch {}
      }
      setNotice({
        text: "Password updated successfully. You can now sign in with your new password.",
        isSuccess: true,
      });
      setMode("sign-in");
    } catch (cause) {
      setNotice({
        text: cause instanceof ApiError ? cause.message : "Password reset could not be completed. Check your code and try again.",
      });
    } finally {
      setBusy(null);
      setPassword("");
      setConfirmPassword("");
    }
  };

  const handleGoogle = async () => {
    setBusy("google");
    setNotice(null);
    try {
      const session = await beginGoogleSignIn(platform);
      if (session) await onAuthenticated(session);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Sign in could not be completed." });
      setBusy(null);
    }
  };

  return (
    <AuthLayout>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-main">
          {mode === "sign-in" && (
            <>
              <h1 id="auth-title">Sign in to your account</h1>
              <p className="auth-new-account">
                New to Arden? <button type="button" onClick={() => switchMode("register")}>Create an account</button>
              </p>
              {notice && (
                <div className={`auth-message ${notice.isSuccess ? "is-success" : ""}`} role="alert">
                  {notice.text}
                </div>
              )}
              <form onSubmit={handleSignIn}>
                <label>
                  <span>Email address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    placeholder="name@company.com"
                    maxLength={320}
                    required
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    maxLength={1024}
                    required
                  />
                </label>
                <button type="submit" className="auth-primary" disabled={busy !== null}>
                  {busy === "submit" ? "Signing in..." : "Sign in"}
                </button>
                <div className="auth-footer-links">
                  <button
                    type="button"
                    className="auth-text-link"
                    onClick={() => switchMode("forgot-password")}
                  >
                    Forgot password?
                  </button>
                </div>
              </form>
            </>
          )}

          {mode === "register" && (
            <>
              <h1 id="auth-title">Create your account</h1>
              <p className="auth-new-account">
                Already have an account? <button type="button" onClick={() => switchMode("sign-in")}>Sign in</button>
              </p>
              {notice && (
                <div className={`auth-message ${notice.isSuccess ? "is-success" : ""}`} role="alert">
                  {notice.text}
                </div>
              )}
              <form onSubmit={handleSignUp}>
                <label>
                  <span>Full name</span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Your name"
                    maxLength={200}
                    required
                  />
                </label>
                <label>
                  <span>Email address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="username"
                    placeholder="name@company.com"
                    maxLength={320}
                    required
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Create a secure password"
                    minLength={6}
                    maxLength={1024}
                    required
                  />
                </label>
                <button type="submit" className="auth-primary" disabled={busy !== null}>
                  {busy === "submit" ? "Creating account..." : "Create account"}
                </button>
              </form>
            </>
          )}

          {mode === "forgot-password" && (
            <>
              <h1 id="auth-title">Reset your password</h1>
              <p className="auth-new-account">
                Remember your password? <button type="button" onClick={() => switchMode("sign-in")}>Sign in</button>
              </p>
              {notice && (
                <div className={`auth-message ${notice.isSuccess ? "is-success" : ""}`} role="alert">
                  {notice.text}
                </div>
              )}
              <form onSubmit={handleForgotPassword}>
                <p className="auth-helper-text">
                  Enter your email address and we will send you instructions to reset your password.
                </p>
                <label>
                  <span>Email address</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="name@company.com"
                    maxLength={320}
                    required
                  />
                </label>
                <button type="submit" className="auth-primary" disabled={busy !== null}>
                  {busy === "submit" ? "Sending instructions..." : "Send reset instructions"}
                </button>
                <div className="auth-footer-links">
                  <button
                    type="button"
                    className="auth-text-link"
                    onClick={() => switchMode("sign-in")}
                  >
                    ← Back to sign in
                  </button>
                  <button
                    type="button"
                    className="auth-text-link"
                    onClick={() => switchMode("reset-password")}
                  >
                    Have a reset code?
                  </button>
                </div>
              </form>
            </>
          )}

          {mode === "reset-password" && (
            <>
              <h1 id="auth-title">Set a new password</h1>
              <p className="auth-new-account">
                Return to sign in? <button type="button" onClick={() => switchMode("sign-in")}>Sign in</button>
              </p>
              {notice && (
                <div className={`auth-message ${notice.isSuccess ? "is-success" : ""}`} role="alert">
                  {notice.text}
                </div>
              )}
              <form onSubmit={handleResetPassword}>
                {!recoveryTokens && (
                  <>
                    <label>
                      <span>Email address</span>
                      <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        autoComplete="email"
                        placeholder="name@company.com"
                        maxLength={320}
                        required
                      />
                    </label>
                    <label>
                      <span>Verification code or token</span>
                      <input
                        type="text"
                        value={resetToken}
                        onChange={(event) => setResetToken(event.target.value)}
                        placeholder="Enter code from email"
                        required
                      />
                    </label>
                  </>
                )}
                <label>
                  <span>New password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Enter new password (min. 6 characters)"
                    minLength={6}
                    maxLength={1024}
                    required
                  />
                </label>
                <label>
                  <span>Confirm new password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    minLength={6}
                    maxLength={1024}
                    required
                  />
                </label>
                <button type="submit" className="auth-primary" disabled={busy !== null}>
                  {busy === "submit" ? "Updating password..." : "Update password"}
                </button>
                <div className="auth-footer-links">
                  <button
                    type="button"
                    className="auth-text-link"
                    onClick={() => switchMode("sign-in")}
                  >
                    ← Back to sign in
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        <div className="auth-card-social">
          {(mode === "sign-in" || mode === "register") && (
            <>
              <div className="auth-divider"><span>OR CONTINUE WITH</span></div>
              <button
                type="button"
                className="auth-google-button"
                onClick={handleGoogle}
                disabled={busy !== null}
              >
                <i className="auth-google-mark fi fi-brands-google" aria-hidden="true" />
                {busy === "google" ? "Opening Google..." : "Continue with Google"}
              </button>
            </>
          )}
          {showPreview && (
            <details className="auth-preview-tools">
              <summary>Development preview</summary>
              <button type="button" onClick={onEnterPreview}>Member</button>
              <button type="button" onClick={onOpenSetup}>Setup</button>
              {onEnterAdminPreview && <button type="button" onClick={onEnterAdminPreview}>Admin</button>}
            </details>
          )}
        </div>
      </section>
      {unconfirmedEmail && (
        <UnconfirmedEmailDialog
          email={unconfirmedEmail}
          onClose={() => setUnconfirmedEmail(null)}
        />
      )}
    </AuthLayout>
  );
}
