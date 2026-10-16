import { type FormEvent, useState } from "react";
import { setAccountPassword, type CurrentSession } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { AuthLayout } from "./AuthLayout";

const text = { title: "Create your Arden password", eyebrow: "GOOGLE ACCOUNT VERIFIED", password: "New password", confirm: "Confirm password", placeholder: "At least 8 characters", action: "Create password", busy: "Creating password...", mismatch: "Passwords do not match.", short: "Password must contain at least 8 characters.", error: "Password could not be created." } as const;

export function SetPasswordPage({ platform, email, onComplete }: { platform: Platform; email?: string; onComplete: (session: CurrentSession) => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length < 8) return setNotice(text.short);
    if (password !== confirmation) return setNotice(text.mismatch);
    setBusy(true); setNotice(null);
    try { await onComplete(await setAccountPassword(platform, password)); }
    catch (error) { setNotice(error instanceof Error ? error.message : text.error); setBusy(false); }
  };
  return (
    <AuthLayout>
      <section className="auth-card auth-password-card" aria-labelledby="password-title">
        <div className="auth-card-main">
          <span className="auth-eyebrow">{text.eyebrow}</span>
          <h1 id="password-title">{text.title}</h1>
          {email && <span className="auth-account-email">{email}</span>}
          {notice && <div className="auth-message" role="alert">{notice}</div>}
          <form onSubmit={submit}>
            <label><span>{text.password}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={text.placeholder} minLength={8} maxLength={1024} required /></label>
            <label><span>{text.confirm}</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" placeholder={text.placeholder} minLength={8} maxLength={1024} required /></label>
            <button type="submit" className="auth-primary" disabled={busy}>{busy ? text.busy : text.action}</button>
          </form>
        </div>
      </section>
    </AuthLayout>
  );
}
