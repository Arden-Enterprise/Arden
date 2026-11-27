import { useEffect, useState } from "react";
import { accountPasswordMaximumLength, accountPasswordMaximumLengthMessage, meetsAccountPasswordRequirements } from "@arden/domain";
import { AuthLayout } from "../sign-in/AuthLayout";
import { NewPasswordField, accountPasswordRequirementMessage } from "../sign-in/NewPasswordField";
import { UnconfirmedEmailDialog } from "../sign-in/UnconfirmedEmailDialog";
import { VisiblePasswordField } from "../sign-in/VisiblePasswordField";
import {
  acceptInvitation,
  ApiError,
  createInvitationAccount,
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

/**
 * Renders the organization invitation acceptance and account registration page.
 */
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
  // Decision 0038: when the server reports whether the invited address has an account, show only that form.
  const routed = Boolean(invitation?.accountStatus);

  useEffect(() => {
    let active = true;
    setLoadingInvitation(true);
    getInvitationPreview(platform, token)
      .then((preview) => {
        if (!active) return;
        setInvitation(preview);
        setEmail(preview.email);
        setMode(preview.accountStatus === "new" ? "create-account" : "sign-in");
        setLoadingInvitation(false);
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 404) {
          setInvitationInvalid(true);
        } else {
          setError("Couldn’t load invitation details. Please check your connection and try again.");
        }
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
    setEmail(email.trim());
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      setBusy(false);
      return;
    }
    if (invitation && email.trim().toLowerCase() !== invitation.email.toLowerCase()) {
      setError(`Use ${invitation.email}.`);
      setBusy(false);
      return;
    }
    if (!password) {
      setError("Enter your password.");
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

  const createRoutedAccount = async () => {
    let accepted: boolean;
    try {
      accepted = (await createInvitationAccount(platform, token, fullName.trim(), password)).accepted;
    } catch (cause) {
      showRoutedAccountError(cause);
      return;
    }
    // The account exists and this browser is signed in from here on, even if loading the session fails.
    setPassword("");
    setSignedIn(true);
    try {
      const updatedSession = await currentSession(platform);
      onSessionChange?.(updatedSession);
      if (updatedSession.actor?.email) setCurrentAccountEmail(updatedSession.actor.email);
      if (accepted) onAccepted(updatedSession);
      else setMessage("Your account is ready. Accept the invitation to continue.");
    } catch {
      setMessage(accepted
        ? "Your account is ready and you joined the organization. Reload to open your workspace."
        : "Your account is ready. Accept the invitation to continue.");
    }
  };

  const showRoutedAccountError = (cause: unknown) => {
    if (cause instanceof ApiError && cause.code === "ACCOUNT_ALREADY_EXISTS") {
      setError("An account already exists for this email. Sign in to accept the invitation.");
      setMode("sign-in");
      setPassword("");
    } else if (cause instanceof ApiError && cause.code === "ACCOUNT_CREATED_SIGN_IN_REQUIRED") {
      setMessage("Your account was created. Sign in to accept the invitation.");
      setMode("sign-in");
      setPassword("");
    } else if (cause instanceof ApiError && cause.code === "ACCOUNT_SETUP_UNAVAILABLE") {
      setError("Your password meets the listed requirements, but account setup could not be completed. Try a different password.");
    } else if (cause instanceof ApiError && cause.code === "ACCOUNT_SETUP_UNCONFIRMED") {
      setError("Couldn’t confirm account setup. Try again; if your account was created, you’ll be asked to sign in.");
    } else if (cause instanceof ApiError && cause.status === 404) {
      setInvitationInvalid(true);
    } else if (cause instanceof ApiError && cause.status !== 0 && cause.status < 500 && cause.message) {
      setError(cause.message);
    } else {
      setError("Couldn’t create account. Please try again.");
    }
  };

  const handleSignUp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    setEmail(email.trim());
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      setBusy(false);
      return;
    }
    if (invitation && email.trim().toLowerCase() !== invitation.email.toLowerCase()) {
      setError(`Use ${invitation.email}.`);
      setBusy(false);
      return;
    }
    if (!fullName.trim()) {
      setError("Enter your name.");
      setBusy(false);
      return;
    }
    if (password.length > accountPasswordMaximumLength) {
      setError(accountPasswordMaximumLengthMessage);
      setBusy(false);
      return;
    }
    if (!meetsAccountPasswordRequirements(password)) {
      setError(accountPasswordRequirementMessage);
      setBusy(false);
      return;
    }
    if (routed) {
      // The email checks above pass unchanged: a routed form keeps the invited address.
      await createRoutedAccount();
      setBusy(false);
      return;
    }
    try {
      const redirectTo = typeof window !== "undefined" && window.location
        ? `${window.location.origin}/invite/${encodeURIComponent(token)}`
        : undefined;
      await signUp(platform, email.trim(), password, fullName.trim(), redirectTo);
      setMessage("If email confirmation is required, check your inbox. Otherwise, sign in to accept the invitation.");
      setMode("sign-in");
      setPassword("");
    } catch (cause) {
      if (cause instanceof ApiError && (cause.code === "ACCOUNT_ALREADY_EXISTS" || cause.status === 409)) {
        setError("Account already exists. Sign in.");
        setMode("sign-in");
        setPassword("");
      } else if (cause instanceof ApiError && cause.code === "ACCOUNT_SETUP_UNAVAILABLE") {
        setError("Your password meets the listed requirements, but account setup could not be completed. Try a different password or sign in.");
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
                {routed ? (
                  mode === "sign-in" ? "Sign in to your Arden account to accept" : "Create your Arden account to accept"
                ) : mode === "sign-in" ? (
                  <>
                    Need an account?{" "}
                    <button type="button" onClick={() => { setMode("create-account"); setPassword(""); setError(""); setMessage(""); }}>
                      Create account
                    </button>
                  </>
                ) : (
                  <>
                    Already have an account?{" "}
                    <button type="button" onClick={() => { setMode("sign-in"); setPassword(""); setError(""); setMessage(""); }}>
                      Sign in
                    </button>
                  </>
                )}
              </p>

              {mode === "sign-in" ? (
                <form noValidate onSubmit={(event) => void handleSignIn(event)}>
                  <label>
                    <span>Email address</span>
                    <input
                      autoComplete="email"
                      type="email"
                      required
                      readOnly={routed}
                      maxLength={320}
                      placeholder="name@company.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      onBlur={(event) => setEmail(event.target.value.trim())}
                    />
                    {invitation && email.trim() && email.trim().toLowerCase() !== invitation.email.toLowerCase() && (
                      <span style={{ color: "#f0b0a5", fontSize: "11px", marginTop: "4px" }}>
                        Email does not match invited address ({invitation.email})
                      </span>
                    )}
                  </label>
                  <VisiblePasswordField label="Password" value={password} onChange={setPassword}
                    autoComplete="current-password" placeholder="Enter your password" />
                  <button type="submit" className="auth-primary" disabled={busy}>
                    {busy ? "Signing in and accepting…" : "Sign in and accept invitation"}
                  </button>
                </form>
              ) : (
                <form noValidate onSubmit={(event) => void handleSignUp(event)}>
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
                  {!routed && (
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
                      onBlur={(event) => setEmail(event.target.value.trim())}
                    />
                    {invitation && email.trim() && email.trim().toLowerCase() !== invitation.email.toLowerCase() && (
                      <span style={{ color: "#f0b0a5", fontSize: "11px", marginTop: "4px" }}>
                        Email does not match invited address ({invitation.email})
                      </span>
                    )}
                  </label>
                  )}
                  <NewPasswordField value={password} onChange={setPassword} />
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
