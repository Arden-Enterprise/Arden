import { type FormEvent, useState } from "react";
import type { Platform } from "../shared/types";
import { WelcomePanel } from "./WelcomePanel";
import { entryAssets } from "./entryAssets";

export function SignInPage({
  platform,
  onEnterPreview,
  onOpenSetup,
  onEnterAdminPreview,
}: {
  platform: Platform;
  onEnterPreview: () => void;
  onOpenSetup: () => void;
  onEnterAdminPreview?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(
      "Sign-in is not available in this preview. Open the member preview below to explore Arden with sample data.",
    );
  };

  return (
    <main className="sign-in-page">
      <WelcomePanel />

      <section className="sign-in-panel" aria-label="Sign in">
        <div className="sign-in-card">
          <span className="meta-label">YOUR WORKSPACE</span>
          <h2>Sign in to Arden</h2>
          <p>Use your organization account. Arden only returns knowledge you are permitted to access.</p>

          {message && (
            <div className="sign-in-message" role="alert">
              <strong>Sign-in is unavailable in this preview</strong>
              <span>{message}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <label>
              <span>Organization email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setMessage("");
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
                  setMessage("");
                }}
                autoComplete="current-password"
                placeholder="Enter your password"
                aria-describedby="sign-in-password-help"
                required
              />
              <small id="sign-in-password-help">Use the password provided for your organization account.</small>
            </label>
            <button type="submit" className="primary-button">
              {message ? "Try again" : "Sign in"}
            </button>
          </form>

          <div className="sign-in-assurance">
            <img src={entryAssets.lockForm} alt="" width={16} height={16} />
            <span>Private by default · No external writes</span>
          </div>
          <p className="sign-in-account-help">Accounts are provided by your organization administrator.</p>

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
