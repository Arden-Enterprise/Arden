import { useEffect, useRef, useState } from "react";
import { AuthLayout } from "../sign-in/AuthLayout";
import {
  acceptInvitation,
  ApiError,
  currentSession,
  getInvitationPreview,
  signIn,
  signOut as apiSignOut,
  signUp,
  type CurrentSession,
  type InvitationPreview,
} from "../shared/api-client";
import type { Platform } from "../shared/types";
import { invitationFeedback } from "./invitationFeedback";

type InvitationLinkPageProps = {
  platform: Platform;
  token: string;
  authenticated?: boolean;
  session?: CurrentSession | null;
  onSessionChange?: (session: CurrentSession | null) => void;
  onAccepted: (session: CurrentSession) => void;
};

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
        <h2 id="unconfirmed-email-title">Verify your email</h2>
      </div>
      <p className="organization-dialog-description">
        Check <strong>{email}</strong> for a verification link.
      </p>
      <div className="organization-dialog-actions">
        <button type="button" className="auth-primary" autoFocus onClick={onClose}>
          OK
        </button>
      </div>
    </dialog>
  );
}

export function InvitationLinkPage({ platform, token, authenticated = false, session = null, onSessionChange, onAccepted }: InvitationLinkPageProps) {
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null);
  const [loadingInvitation, setLoadingInvitation] = useState(true);
  const [invitationInvalid, setInvitationInvalid] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "create-account">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signedIn, setSignedIn] = useState(authenticated || Boolean(session));
  const [currentAccountEmail, setCurrentAccountEmail] = useState<string | null>(session?.actor?.email ?? null);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingInvitation(true);
    getInvitationPreview(platform, token)
      .then((preview) => {
        if (!active) return;
        setInvitation(preview);
        setEmail(preview.email);
        setLoadingInvitation(false);
      })
      .catch(() => {
        if (!active) return;
        setInvitationInvalid(true);
        setLoadingInvitation(false);
      });
    return () => { active = false; };
  }, [platform, token]);

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
    if (invitation && email.trim().toLowerCase() !== invitation.email.toLowerCase()) {
      setError(`Use ${invitation.email}.`);
      setBusy(false);
      return;
    }
    try {
      const signedInSession = await signIn(platform, email.trim(), password);
      onSessionChange?.(signedInSession);
      setSignedIn(true);
      if (signedInSession.actor?.email) setCurrentAccountEmail(signedInSession.actor.email);
      await acceptInvitation(platform, token);
      const updatedSession = await currentSession(platform);
      onAccepted(updatedSession);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "EMAIL_NOT_CONFIRMED") {
        setUnconfirmedEmail(email.trim());
        setError("Check your email to verify your account.");
      } else if (cause instanceof ApiError && cause.status === 401) {
        setError("Couldn’t sign in.");
      } else if (cause instanceof ApiError && cause.status === 404) {
        setError(`Invitation unavailable for ${email}.`);
      } else if (cause instanceof ApiError && cause.status >= 500) {
        setError("Couldn’t accept invitation.");
      } else if (cause instanceof ApiError && cause.status === 0) {
        setError("Couldn’t confirm invitation acceptance.");
      } else {
        setError("Invitation unavailable for this account.");
      }
    } finally { setBusy(false); }
  };

  const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    if (invitation && email.trim().toLowerCase() !== invitation.email.toLowerCase()) {
      setError(`Use ${invitation.email}.`);
      setBusy(false);
      return;
    }
    try {
      await signUp(platform, email.trim(), password, fullName.trim());
      setMessage("Check your email to continue.");
      setMode("sign-in");
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === "ACCOUNT_ALREADY_EXISTS" || cause.status === 409)) {
        setError("Account already exists. Sign in.");
        setMode("sign-in");
      } else if (cause instanceof ApiError && cause.message) {
        setError(cause.message);
      } else {
        setError("Couldn’t create account.");
      }
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
          ? `Invitation unavailable for ${currentAccountEmail}.`
          : "Invitation unavailable for this account.");
      } else if (cause instanceof ApiError && cause.status >= 500) {
        setError("Couldn’t accept invitation.");
      } else if (cause instanceof ApiError && cause.status === 0) {
        setError("Couldn’t confirm invitation acceptance.");
      } else {
        setError("Invitation unavailable for this account.");
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
      setEmail(invitation?.email ?? "");
      setPassword("");
      setMessage("Sign in with the invited email.");
    } catch {
      setError("Couldn’t sign out.");
    } finally { setBusy(false); }
  };

  if (loadingInvitation) {
    return (
      <AuthLayout>
        <section className="auth-card" aria-busy="true">
          <div className="auth-card-main" style={{ textAlign: "center", padding: "40px 20px" }}>
            <p style={{ color: "var(--arden-text-secondary)", fontSize: "14px" }}>Checking invitation details…</p>
          </div>
        </section>
      </AuthLayout>
    );
  }

  if (invitationInvalid) {
    return (
      <AuthLayout>
        <section className="auth-card" aria-labelledby="invalid-invite-title">
          <div className="auth-card-main" style={{ textAlign: "center" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
              <span className="welcome-status" style={{ color: "#f0b0a5", borderColor: "rgba(233, 151, 138, .34)" }}>
                INVALID INVITATION
              </span>
            </div>
            <h1 id="invalid-invite-title" style={{ marginTop: "12px", marginBottom: "16px" }}>
              Invitation link unavailable
            </h1>
            <p style={{ color: "var(--arden-text-secondary)", fontSize: "13px", lineHeight: "1.6", marginBottom: "24px" }}>
              This invitation link is invalid, has expired, or has already been accepted. Please contact your organization administrator to request a new invitation.
            </p>
            <button
              type="button"
              className="auth-primary"
              onClick={() => { window.location.assign("/"); }}
            >
              Return to sign in
            </button>
          </div>
        </section>
      </AuthLayout>
    );
  }

  const isAccountMismatch = Boolean(currentAccountEmail && invitation && currentAccountEmail.toLowerCase() !== invitation.email.toLowerCase());
  const feedback = invitationFeedback(error, message);

  return (
    <AuthLayout>
      <section className="auth-card" aria-labelledby="invitation-link-title">
        <div className="auth-card-main">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <span className="welcome-status">ORGANIZATION INVITATION</span>
          </div>
          <h1 id="invitation-link-title" style={{ marginTop: "16px", marginBottom: "6px" }}>
            {signedIn ? "Accept your invitation" : (invitation ? `Join ${invitation.organizationName}` : "Join your organization")}
          </h1>
          {invitation && (
            <p style={{ margin: "0 0 16px", textAlign: "center", fontSize: "12px", color: "var(--arden-text-secondary)" }}>
              Invitation for <strong style={{ color: "var(--arden-warm)" }}>{invitation.email}</strong>
            </p>
          )}
          {feedback && (
            <div className={feedback.className} role={feedback.role}>
              {feedback.text}
            </div>
          )}

          {signedIn ? (
            <>
              {isAccountMismatch ? (
                <>
                  <div className="auth-message" role="alert" style={{ marginBottom: "20px" }}>
                    You are signed in as <strong>{currentAccountEmail}</strong>, but this invitation was sent to <strong>{invitation?.email}</strong>.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <button
                      type="button"
                      className="auth-primary"
                      disabled={busy}
                      onClick={() => void changeAccount()}
                    >
                      Sign out and use {invitation?.email}
                    </button>
                    {session && session.memberships.length > 0 && (
                      <button
                        type="button"
                        className="auth-text-link"
                        disabled={busy}
                        onClick={() => onAccepted(session)}
                      >
                        ← Continue to existing workspace
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="auth-message is-success" role="status" style={{ marginBottom: "20px" }}>
                    You are signed in as <strong>{currentAccountEmail ?? invitation?.email ?? "your account"}</strong>.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    <button
                      type="button"
                      className="auth-primary"
                      disabled={busy}
                      onClick={() => void handleAccept()}
                    >
                      {busy ? "Accepting invitation…" : "Accept invitation"}
                    </button>
                    <button
                      type="button"
                      className="auth-text-link"
                      disabled={busy}
                      onClick={() => void changeAccount()}
                    >
                      Sign out and use another account
                    </button>
                    {session && session.memberships.length > 0 && (
                      <button
                        type="button"
                        className="auth-text-link"
                        disabled={busy}
                        onClick={() => onAccepted(session)}
                      >
                        ← Continue to existing workspace
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <p className="auth-new-account">
                {mode === "sign-in" ? (
                  <>
                    Need an account?{" "}
                    <button type="button" onClick={() => { setMode("create-account"); setError(""); setMessage(""); }}>
                      Create account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button type="button" onClick={() => { setMode("sign-in"); setError(""); setMessage(""); }}>
                      Sign in
                    </button>
                  </>
                )}
              </p>

              {mode === "sign-in" ? (
                <form onSubmit={(event) => void handleSignIn(event)}>
                  <label>
                    <span>Email address</span>
                    <input
                      autoComplete="email"
                      type="email"
                      required
                      maxLength={320}
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                    {invitation && email.trim() && email.trim().toLowerCase() !== invitation.email.toLowerCase() && (
                      <span style={{ color: "#f0b0a5", fontSize: "11px", marginTop: "4px" }}>
                        Email does not match invited address ({invitation.email})
                      </span>
                    )}
                  </label>
                  <label>
                    <span>Password</span>
                    <input
                      autoComplete="current-password"
                      type="password"
                      required
                      maxLength={1024}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="auth-primary" disabled={busy}>
                    {busy ? "Signing in and accepting…" : "Sign in and accept invitation"}
                  </button>
                </form>
              ) : (
                <form onSubmit={(event) => void handleSignUp(event)}>
                  <label>
                    <span>Full name</span>
                    <input
                      autoComplete="name"
                      type="text"
                      required
                      maxLength={200}
                      placeholder="Your full name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Email address</span>
                    <input
                      autoComplete="email"
                      type="email"
                      required
                      maxLength={320}
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                    {invitation && email.trim() && email.trim().toLowerCase() !== invitation.email.toLowerCase() && (
                      <span style={{ color: "#f0b0a5", fontSize: "11px", marginTop: "4px" }}>
                        Email does not match invited address ({invitation.email})
                      </span>
                    )}
                  </label>
                  <label>
                    <span>Password</span>
                    <input
                      autoComplete="new-password"
                      type="password"
                      required
                      minLength={6}
                      maxLength={1024}
                      placeholder="Create a secure password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="auth-primary" disabled={busy}>
                    {busy ? "Creating account…" : "Create account and accept"}
                  </button>
                </form>
              )}
            </>
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
