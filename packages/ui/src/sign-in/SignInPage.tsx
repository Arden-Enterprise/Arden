import { type FormEvent, useState } from "react";
import type { Platform } from "../shared/types";
import { WelcomePanel } from "./WelcomePanel";
import { entryAssets } from "./entryAssets";
import { signIn, signUp, type CurrentSession } from "../shared/api-client";

type AuthNotice = {
  kind: "error" | "success";
  title: string;
  text: string;
};

export function SignInPage({
  platform,
  onEnterPreview,
  onOpenSetup,
  onEnterAdminPreview,
  onAuthenticated,
}: {
  platform: Platform;
  onEnterPreview: () => void;
  onOpenSetup: () => void;
  onEnterAdminPreview?: () => void;
  onAuthenticated: (session: CurrentSession) => Promise<void>;
}) {
  const [mode, setMode] = useState<"sign-in" | "register">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await onAuthenticated(await signIn(platform, email.trim(), password));
    } catch (error) {
      setNotice({
        kind: "error",
        title: "Sign in could not be completed",
        text: error instanceof Error ? error.message : "Sign in could not be completed.",
      });
    } finally {
      setBusy(false);
      setPassword("");
    }
  };

  const handleSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setNotice({
        kind: "error",
        title: "Passwords do not match",
        text: "Please make sure your password and confirmation password match.",
      });
      return;
    }
    if (password.length < 6) {
      setNotice({
        kind: "error",
        title: "Password is too short",
        text: "Password must be at least 6 characters long.",
      });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await signUp(platform, email.trim(), password, fullName.trim());
      try {
        const session = await signIn(platform, email.trim(), password);
        await onAuthenticated(session);
        return;
      } catch {
        setNotice({
          kind: "success",
          title: "Account setup initiated",
          text: "Account created. If email verification is enabled, check your inbox; otherwise you can sign in right now.",
        });
        setMode("sign-in");
        setPassword("");
        setConfirmPassword("");
      }
    } catch (error) {
      setNotice({
        kind: "error",
        title: "Account setup could not be completed",
        text: error instanceof Error ? error.message : "Account setup could not be completed.",
      });
    } finally {
      setBusy(false);
      setPassword("");
      setConfirmPassword("");
    }
  };

  const switchMode = (nextMode: "sign-in" | "register") => {
    setMode(nextMode);
    setNotice(null);
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <main className="sign-in-page">
      <WelcomePanel />

      <section className="sign-in-panel" aria-label={mode === "sign-in" ? "Sign in" : "Create account"}>
        <div className="sign-in-card">
          <span className="meta-label">{mode === "sign-in" ? "YOUR WORKSPACE" : "GET STARTED"}</span>
          <h2>{mode === "sign-in" ? "Sign in to Arden" : "Create an Arden account"}</h2>
          <p>
            {mode === "sign-in"
              ? "Use your organization account. Arden only returns knowledge you are permitted to access."
              : "Register with your work email to get started. Arden keeps your private thoughts safe while connecting your team."}
          </p>

          <div className="sign-in-entry-tabs" role="group" aria-label="Account options">
            <button
              type="button"
              aria-pressed={mode === "sign-in"}
              onClick={() => switchMode("sign-in")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "register"}
              onClick={() => switchMode("register")}
            >
              Create account
            </button>
          </div>

          {notice && (
            <div
              className={`sign-in-message ${notice.kind === "success" ? "is-success" : ""}`}
              role={notice.kind === "success" ? "status" : "alert"}
            >
              <strong>{notice.title}</strong>
              <span>{notice.text}</span>
            </div>
          )}

          {mode === "sign-in" ? (
            <form onSubmit={handleSignIn}>
              <label>
                <span>Organization email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setNotice(null);
                  }}
                  autoComplete="username"
                  placeholder="name@company.com"
                  aria-describedby="sign-in-email-help"
                  required
                />
                <small id="sign-in-email-help">Use the email linked to your organization.</small>
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setNotice(null);
                  }}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-describedby="sign-in-password-help"
                  required
                />
                <small id="sign-in-password-help">Use the password provided for your organization account.</small>
              </label>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignUp}>
              <label>
                <span>Full name</span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value);
                    setNotice(null);
                  }}
                  autoComplete="name"
                  placeholder="Jane Doe"
                  maxLength={200}
                  aria-describedby="sign-up-name-help"
                  required
                />
                <small id="sign-up-name-help">Your display name in your organization workspace.</small>
              </label>
              <label>
                <span>Organization email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setNotice(null);
                  }}
                  autoComplete="email"
                  placeholder="name@company.com"
                  maxLength={320}
                  aria-describedby="sign-up-email-help"
                  required
                />
                <small id="sign-up-email-help">Use your work or organization email.</small>
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setNotice(null);
                  }}
                  autoComplete="new-password"
                  placeholder="Enter a secure password"
                  maxLength={1024}
                  aria-describedby="sign-up-password-help"
                  required
                />
                <small id="sign-up-password-help">Must be at least 6 characters.</small>
              </label>
              <label>
                <span>Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setNotice(null);
                  }}
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                  maxLength={1024}
                  aria-describedby="sign-up-confirm-help"
                  required
                />
                <small id="sign-up-confirm-help">Re-enter your password to confirm.</small>
              </label>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? "Creating account…" : "Create account"}
              </button>
            </form>
          )}

          <div className="sign-in-mode-toggle">
            {mode === "sign-in" ? (
              <>
                Don&apos;t have an account?{" "}
                <button type="button" onClick={() => switchMode("register")}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => switchMode("sign-in")}>
                  Sign in
                </button>
              </>
            )}
          </div>

          <div className="sign-in-assurance">
            <img src={entryAssets.lockForm} alt="" width={16} height={16} />
            <span>Private by default · No external writes</span>
          </div>
          <p className="sign-in-account-help">
            {mode === "sign-in"
              ? "Accounts are provided by your organization administrator."
              : "Once verified, your account can be invited or assigned to your organization."}
          </p>

          <div className="sign-in-preview-divider">
            <span>FRONTEND REVIEW</span>
          </div>
          <button type="button" className="secondary-button preview-button" onClick={onEnterPreview}>
            Open member preview
          </button>
          <div className="sign-in-preview-links">
            <button type="button" onClick={onOpenSetup}>Preview first-run setup</button>
            {onEnterAdminPreview && <button type="button" onClick={onEnterAdminPreview}>Open admin preview</button>}
          </div>
          <p className="preview-disclaimer">
            Preview routes use synthetic data. They do not authenticate, persist changes or grant access.
          </p>
        </div>
        <span className="platform-label">
          {platform === "desktop" ? "WINDOWS DESKTOP" : "WEB"} · UI FOUNDATION
        </span>
      </section>
    </main>
  );
}
