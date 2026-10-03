import { type FormEvent, useState } from "react";
import { Icon } from "../shared/Icon";
import type { Platform } from "../shared/types";

export function SignInPage({
  platform,
  onEnterPreview,
  onOpenSetup,
}: {
  platform: Platform;
  onEnterPreview: () => void;
  onOpenSetup: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(
      "Sign-in is not connected yet. The identity API is owned by ARD-13; no session was created.",
    );
  };

  return (
    <main className="sign-in-page">
      <section className="sign-in-intro" aria-labelledby="sign-in-title">
        <div className="sign-in-brand">
          <span aria-hidden="true" />
          ARDEN
        </div>
        <div>
          <span className="meta-label">PRIVATE ORGANIZATIONAL KNOWLEDGE</span>
          <h1 id="sign-in-title">Knowledge with a clear boundary.</h1>
          <p>
            Arden keeps company, department and personal knowledge distinct so people can work
            with the context they are actually allowed to use.
          </p>
        </div>
        <div className="sign-in-boundary">
          <Icon name="lock" size={18} />
          <div>
            <strong>No public registration</strong>
            <span>Accounts are provisioned by an organization administrator.</span>
          </div>
        </div>
      </section>

      <section className="sign-in-panel" aria-label="Sign in">
        <div className="sign-in-card">
          <span className="meta-label">ESTABLISHED WORKSPACE</span>
          <h2>Sign in to Arden</h2>
          <p>Use the account assigned by your organization.</p>

          <form onSubmit={handleSubmit}>
            <label>
              <span>Work email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setMessage("");
                }}
                autoComplete="username"
                placeholder="you@company.com"
                required
              />
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
                required
              />
            </label>
            <button type="submit" className="primary-button">
              Sign in <Icon name="arrow" size={15} />
            </button>
          </form>

          {message && (
            <div className="sign-in-message" role="alert">
              {message}
            </div>
          )}

          <div className="sign-in-preview-divider">
            <span>FRONTEND REVIEW</span>
          </div>
          <button type="button" className="secondary-button preview-button" onClick={onEnterPreview}>
            Open member preview
          </button>
          <button type="button" className="secondary-button preview-button" onClick={onOpenSetup}>
            Preview first-run organization setup
          </button>
          <p className="preview-disclaimer">
            Both preview routes use synthetic data. They do not authenticate, persist changes or grant access.
          </p>
        </div>
        <span className="platform-label">
          {platform === "desktop" ? "WINDOWS DESKTOP" : "WEB"} · UI FOUNDATION
        </span>
      </section>
    </main>
  );
}
