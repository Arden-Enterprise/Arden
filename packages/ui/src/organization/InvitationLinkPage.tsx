import { useEffect, useState } from "react";
import { WelcomePanel } from "../sign-in/WelcomePanel";
import { acceptInvitation, ApiError, currentSession, signIn, signOut as apiSignOut, signUp, type CurrentSession } from "../shared/api-client";
import type { Platform } from "../shared/types";

type InvitationLinkPageProps = {
  platform: Platform;
  token: string;
  authenticated?: boolean;
  session?: CurrentSession | null;
  onSessionChange?: (session: CurrentSession | null) => void;
  onAccepted: (session: CurrentSession) => void;
};

export function InvitationLinkPage({ platform, token, authenticated = false, session = null, onSessionChange, onAccepted }: InvitationLinkPageProps) {
  const [mode, setMode] = useState<"sign-in" | "create-account">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signedIn, setSignedIn] = useState(authenticated || Boolean(session));
  const [currentAccountEmail, setCurrentAccountEmail] = useState<string | null>(session?.actor?.email ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (session) {
      setSignedIn(true);
      if (session.actor?.email) setCurrentAccountEmail(session.actor.email);
    }
  }, [session]);

  useEffect(() => {
    if (signedIn && !currentAccountEmail) {
      void currentSession(platform).then((resolved) => {
        if (resolved?.actor?.email) setCurrentAccountEmail(resolved.actor.email);
        onSessionChange?.(resolved);
      }).catch(() => undefined);
    }
  }, [platform, signedIn, currentAccountEmail, onSessionChange]);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const signedInSession = await signIn(platform, email, password);
      onSessionChange?.(signedInSession);
      setSignedIn(true);
      if (signedInSession.actor?.email) setCurrentAccountEmail(signedInSession.actor.email);
      await acceptInvitation(platform, token);
      const updatedSession = await currentSession(platform);
      onAccepted(updatedSession);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        setError("Sign-in could not be completed. Check the address and password, or create an account.");
      } else if (cause instanceof ApiError && cause.status === 404) {
        setError(`Signed in as ${email}, but this account does not match the invitation, or the invitation has expired.`);
      } else if (cause instanceof ApiError && cause.status >= 500) {
        setError("The server encountered an error while processing the invitation. Please try again later.");
      } else {
        setError("This invitation could not be accepted for this signed-in account. Check which account you used and try again.");
      }
    } finally { setBusy(false); }
  };

  const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await signUp(platform, email, password, fullName);
      setMessage("If account setup can proceed, check your email to complete verification. Then return to this invitation and sign in to accept it.");
      setMode("sign-in");
    } catch {
      setError("Account setup could not be completed. Check the password requirements or try signing in.");
    } finally { setBusy(false); }
  };

  const handleAccept = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      await acceptInvitation(platform, token);
      const updatedSession = await currentSession(platform);
      onAccepted(updatedSession);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setError(currentAccountEmail
          ? `This invitation cannot be accepted with ${currentAccountEmail}. It was sent to a different email address or has expired. Please sign out and use the invited email account.`
          : "This invitation could not be accepted for this signed-in account. It may belong to a different email address, or have already been accepted.");
      } else if (cause instanceof ApiError && cause.status >= 500) {
        setError("The server encountered an error while accepting the invitation. Please try again later.");
      } else if (cause instanceof ApiError && cause.status === 0) {
        setError(cause.message || "Arden could not reach its server. Check your connection and try again.");
      } else {
        setError("This invitation could not be accepted for this signed-in account. Check which account you used and try again.");
      }
    } finally { setBusy(false); }
  };

  const changeAccount = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      await apiSignOut(platform);
      onSessionChange?.(null);
      setSignedIn(false);
      setCurrentAccountEmail(null);
      setEmail("");
      setPassword("");
      setMessage("Signed out. Please sign in or create an account with the invited email address.");
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
          <div className="organization-notice is-info">
            <strong>Signed-in account</strong>
            <span>{currentAccountEmail ? `You are currently signed in as ${currentAccountEmail}.` : "Your session is signed in."} Accepting joins the organization with this account.</span>
          </div>
          <button type="button" className="primary-button workspace-continue" disabled={busy} onClick={() => void handleAccept()}>
            {busy ? "Accepting invitation…" : "Accept invitation"}
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void changeAccount()}>
            Sign out and use another account
          </button>
          {session && session.memberships.length > 0 && (
            <button type="button" className="text-button workspace-back" disabled={busy} onClick={() => onAccepted(session)}>
              Continue to existing workspace
            </button>
          )}
        </> : <>
          <div className="invitation-entry-tabs" role="group" aria-label="Account options">
            <button type="button" aria-pressed={mode === "sign-in"} onClick={() => { setMode("sign-in"); setError(""); }}>Sign in</button>
            <button type="button" aria-pressed={mode === "create-account"} onClick={() => { setMode("create-account"); setError(""); }}>Create account</button>
          </div>
          {mode === "sign-in" ? <form onSubmit={(event) => void handleSignIn(event)}>
            <label><span>Email</span><input autoComplete="email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Password</span><input autoComplete="current-password" type="password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Signing in and accepting…" : "Sign in and accept"}</button>
          </form> : <form onSubmit={(event) => void handleSignUp(event)}>
            <label><span>Your name</span><input autoComplete="name" required maxLength={200} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label><span>Email</span><input autoComplete="email" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Password</span><input autoComplete="new-password" type="password" required maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button type="submit" className="primary-button" disabled={busy}>{busy ? "Starting account setup…" : "Create account"}</button>
          </form>}
        </>}
        {message && <div className="organization-notice is-success" role="status"><strong>Notice</strong><span>{message}</span></div>}
        {error && <div className="sign-in-message" role="alert"><strong>Action required</strong><span>{error}</span></div>}
        <small>The invitation page uses the same steps whether or not an account already exists for an email address.</small>
      </div>
    </section>
  </main>;
}
