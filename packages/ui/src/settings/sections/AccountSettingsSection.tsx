import { type FormEvent, useState } from "react";
import { setAccountPassword, updateAccountPassword } from "../../shared/api-client";
import { initialsOf } from "../../app/AppSidebar";
import { Icon } from "../../shared/Icon";
import type { SettingsSectionProps } from "../types";

export function AccountSettingsSection({
  platform,
  session,
  organization,
  organizationName = organization?.name,
  memberName = "Member",
  memberRole = "Member",
  memberDepartment,
  onRefreshSession,
  onSignOut,
}: SettingsSectionProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const email = session?.actor.email ?? "sample@example.com";
  const isPreview = !session;
  const passwordSetupRequired = session?.account.passwordSetupRequired === true;

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!passwordSetupRequired && !currentPassword) {
      setError("Enter your current password.");
      return;
    }

    setBusy(true);
    try {
      if (passwordSetupRequired) {
        await setAccountPassword(platform, newPassword);
        setSuccess("Password has been set successfully.");
        await onRefreshSession?.();
      } else {
        await updateAccountPassword(platform, currentPassword, newPassword);
        setSuccess("Password updated successfully.");
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section settings-account-section">
      <div className="settings-section-header">
        <h2>Account Settings</h2>
        <p>Manage your profile, credentials, and active session details.</p>
      </div>

      {/* User Profile Card */}
      <section className="settings-card" aria-labelledby="settings-profile-heading">
        <h3 id="settings-profile-heading" className="settings-card-title">Profile Information</h3>
        <div className="settings-profile-summary">
          <div className="settings-avatar" aria-hidden="true">
            {initialsOf(memberName || email)}
          </div>
          <div className="settings-profile-details">
            <div className="settings-profile-name">
              <strong>{memberName}</strong>
              <span className="island-chip settings-role-chip">{memberRole}</span>
            </div>
            <div className="settings-profile-meta">
              <span className="settings-meta-item">
                <Icon name="review" size={14} />
                <span>{email}</span>
              </span>
              {memberDepartment && (
                <span className="settings-meta-item">
                  <Icon name="work" size={14} />
                  <span>{memberDepartment}</span>
                </span>
              )}
              {organizationName && (
                <span className="settings-meta-item">
                  <Icon name="organization" size={14} />
                  <span>{organizationName}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Security & Password Card */}
      <section className="settings-card" aria-labelledby="settings-security-heading">
        <h3 id="settings-security-heading" className="settings-card-title">Security & Password</h3>

        {isPreview ? (
          <div className="settings-banner settings-banner-info">
            <Icon name="warning" size={16} />
            <div>
              <strong>Sample Preview Session</strong>
              <p>Password updates and credential management are available when connected to an authenticated organization workspace.</p>
            </div>
          </div>
        ) : (
          <>
            {passwordSetupRequired ? (
              <div className="settings-banner settings-banner-notice">
                <Icon name="shield" size={16} />
                <div>
                  <strong>Password Setup Required</strong>
                  <p>You currently sign in via a third-party account or invite link. Create a password to enable direct email & password sign-in.</p>
                </div>
              </div>
            ) : (
              <p className="settings-card-description">
                Change your account password. Choose a strong password with at least 8 characters.
              </p>
            )}

            {error && (
              <div className="settings-banner settings-banner-error" role="alert">
                <Icon name="warning" size={16} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="settings-banner settings-banner-success" role="status">
                <Icon name="check" size={16} />
                <span>{success}</span>
              </div>
            )}

            <form className="settings-form" onSubmit={handlePasswordSubmit}>
              {!passwordSetupRequired && (
                <label className="organization-field">
                  <span>Current password</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => { setCurrentPassword(event.target.value); setError(null); }}
                    autoComplete="current-password"
                    maxLength={1024}
                    required
                    disabled={busy}
                  />
                </label>
              )}
              <label className="organization-field">
                <span>{passwordSetupRequired ? "Create password" : "New password"}</span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  minLength={8}
                  maxLength={1024}
                  required
                  disabled={busy}
                />
              </label>

              <label className="organization-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  minLength={8}
                  maxLength={1024}
                  required
                  disabled={busy}
                />
              </label>

              <div className="settings-form-actions">
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy || !newPassword || !confirmPassword}
                >
                  {busy ? "Saving..." : passwordSetupRequired ? "Set password" : "Update password"}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {/* Session & Environment Card */}
      <section className="settings-card" aria-labelledby="settings-session-heading">
        <h3 id="settings-session-heading" className="settings-card-title">Session & Environment</h3>
        <dl className="settings-details-list">
          <div>
            <dt>Client Platform</dt>
            <dd>{platform === "desktop" ? "Windows Desktop App" : "Web Browser"}</dd>
          </div>
          <div>
            <dt>Session State</dt>
            <dd>{session ? "Authenticated" : "Sample Preview"}</dd>
          </div>
          {session?.testMode && (
            <div>
              <dt>Environment</dt>
              <dd className="settings-tag-test">Local Test Mode (kiet-local)</dd>
            </div>
          )}
          {session?.actor.id && (
            <div>
              <dt>Account ID</dt>
              <dd className="settings-monospace">{session.actor.id}</dd>
            </div>
          )}
        </dl>

        {onSignOut && (
          <div className="settings-card-footer">
            <button
              type="button"
              className="secondary-button is-danger"
              onClick={onSignOut}
            >
              <Icon name="logout" size={16} />
              <span>{session ? "Log out" : "Exit preview"}</span>
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

