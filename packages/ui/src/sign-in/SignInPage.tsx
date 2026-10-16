import { type FormEvent, useState } from "react";
import type { Platform } from "../shared/types";
import { beginGoogleSignIn, signIn, type CurrentSession } from "../shared/api-client";
import { AuthLayout } from "./AuthLayout";

const text = { title: "Sign in to your account", newcomer: "New to Arden?", googleHint: "Continue with Google", email: "Email address", emailPlaceholder: "name@company.com", password: "Password", passwordPlaceholder: "Enter your password", submit: "Sign in", submitting: "Signing in...", divider: "OR CONTINUE WITH", google: "Continue with Google", googleBusy: "Opening Google...", error: "Sign in could not be completed.", preview: "Development preview" } as const;

export function SignInPage({ platform, onEnterPreview, onOpenSetup, onEnterAdminPreview, onAuthenticated }: {
  platform: Platform;
  onEnterPreview: () => void;
  onOpenSetup: () => void;
  onEnterAdminPreview?: () => void;
  onAuthenticated: (session: CurrentSession) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(() => new URLSearchParams(window.location.search).get("status") === "error" ? text.error : null);
  const [busy, setBusy] = useState<"password" | "google" | null>(null);
  const showPreview = new URLSearchParams(window.location.search).get("preview") === "1";

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy("password"); setNotice(null);
    try { await onAuthenticated(await signIn(platform, email.trim(), password)); }
    catch (error) { setNotice(error instanceof Error ? error.message : text.error); }
    finally { setBusy(null); setPassword(""); }
  };

  const handleGoogle = async () => {
    setBusy("google"); setNotice(null);
    try {
      const session = await beginGoogleSignIn(platform);
      if (session) await onAuthenticated(session);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : text.error); setBusy(null);
    }
  };

  return (
    <AuthLayout>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-card-main">
          <h1 id="auth-title">{text.title}</h1>
          <p className="auth-new-account">{text.newcomer} <button type="button" onClick={handleGoogle}>{text.googleHint}</button></p>
          {notice && <div className="auth-message" role="alert">{notice}</div>}
          <form onSubmit={handleSignIn}>
            <label><span>{text.email}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder={text.emailPlaceholder} maxLength={320} required /></label>
            <label><span>{text.password}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder={text.passwordPlaceholder} maxLength={1024} required /></label>
            <button type="submit" className="auth-primary" disabled={busy !== null}>{busy === "password" ? text.submitting : text.submit}</button>
          </form>
        </div>
        <div className="auth-card-social">
          <div className="auth-divider"><span>{text.divider}</span></div>
          <button type="button" className="auth-google-button" onClick={handleGoogle} disabled={busy !== null}><i className="auth-google-mark fi fi-brands-google" aria-hidden="true" />{busy === "google" ? text.googleBusy : text.google}</button>
          {showPreview && <details className="auth-preview-tools"><summary>{text.preview}</summary><button type="button" onClick={onEnterPreview}>Member</button><button type="button" onClick={onOpenSetup}>Setup</button>{onEnterAdminPreview && <button type="button" onClick={onEnterAdminPreview}>Admin</button>}</details>}
        </div>
      </section>
    </AuthLayout>
  );
}
