import { useState } from "react";
import { WelcomePanel } from "../sign-in/WelcomePanel";
import { acceptInvitation, ApiError, currentSession, signIn, signOut as apiSignOut, signUp, type CurrentSession } from "../shared/api-client";
import type { Platform } from "../shared/types";

type InvitationLinkPageProps = {
  platform: Platform;
  token: string;
  authenticated: boolean;
  onAccepted: (session: CurrentSession) => void;
};

export function InvitationLinkPage({ platform, token, authenticated, onAccepted }: InvitationLinkPageProps) {
  const [mode, setMode] = useState<"sign-in" | "create-account">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signedIn, setSignedIn] = useState(authenticated);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await signIn(platform, email, password);
      setSignedIn(true);
      await acceptInvitation(platform, token);
      onAccepted(await currentSession(platform));
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 401
        ? "Sign-in could not be completed. Check the address and password, or create an account."
        : "This invitation could not be accepted for this signed-in account. Check which account you used and try again.");
    } finally { setBusy(false); }
  };

  const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await signUp(platform, email, password, fullName);
      setMessage("If account setup can proceed, check your email and complete verification. Then return to this invitation and sign in to accept it.");
      setMode("sign-in");
    } catch {
      setError("Account setup could not be completed. Check the password requirements or try signing in.");
    } finally { setBusy(false); }
  };

  const handleAccept = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      await acceptInvitation(platform, token);
      onAccepted(await currentSession(platform));
    } catch {
      setError("This invitation could not be accepted for this signed-in account. Check which account you used and try again.");
    } finally { setBusy(false); }
  };

  const changeAccount = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      await apiSignOut(platform);
      setSignedIn(false); setEmail(""); setPassword("");
    } catch {
      setError("This session could not be cleared. Sign out from Arden and reopen the invitation.");
    } finally { setBusy(false); }
  };

  return <main className="sign-in-page workspace-select-page">
    <WelcomePanel mode="workspace" />
    <section className="sign-in-panel" aria-labelledby="invitation-link-title">
      <div className="sign-in-card workspace-select-card">
        <span className="meta-label">ORGANIZATION INVITATION</span>
        <h2 id="invitation-link-title">Continue to Arden</h2>
        <p>Sign in or create an Arden account, then accept the invitation with the account whose verified email matches it.</p>
        {signedIn ? <>
          <p>Your session is signed in. Accepting checks the verified email on this account.</p>
          <button type="button" className="primary-button workspace-continue" disabled={busy} onClick={() => void handleAccept()}>{busy ? "Checking…" : "Accept invitation"}</button>
          <button type="button" className="text-button workspace-back" disabled={busy} onClick={() => void changeAccount()}>Use another account</button>
        </> : <>
          <div className="invitation-entry-tabs" role="group" aria-label="Account options">
            <button type="button" aria-pressed={mode === "sign-in"} onClick={() => { setMode("sign-in"); setError(""); }}>Sign in</button>
            <button type="button" aria-pressed={mode === "create-account"} onClick={() => { setMode("create-account"); setError(""); }}>Create account</button>
          </div>
          {mode === "sign-in" ? <form onSubmit={(event) => void handleSignIn(event)}>
            <label><span>Email</span><input autoComplete="email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Password</span><input autoComplete="current-password" type="password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Signing in…" : "Sign in and accept"}</button>
          </form> : <form onSubmit={(event) => void handleSignUp(event)}>
            <label><span>Your name</span><input autoComplete="name" required maxLength={200} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label><span>Email</span><input autoComplete="email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Password</span><input autoComplete="new-password" type="password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Starting account setup…" : "Create account"}</button>
          </form>}
        </>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        <small>The invitation page uses the same steps whether or not an account already exists for an email address.</small>
      </div>
    </section>
  </main>;
}
