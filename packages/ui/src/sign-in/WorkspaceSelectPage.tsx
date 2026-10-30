import { type FormEvent, useState } from "react";
import type { OrganizationMembership } from "../shared/api-client";
import { membershipAccessDescription, needsDepartmentAssignment } from "../shared/membershipAssignment";
import { AuthLayout } from "./AuthLayout";

export function WorkspaceSelectPage({
  organizationName,
  memberships,
  onContinue,
  onBack,
  onCreateOrganization,
  testMode = false,
}: {
  organizationName: string;
  memberships?: OrganizationMembership[];
  testMode?: boolean;
  onContinue: (organizationId?: string) => void;
  onBack: () => void;
  onCreateOrganization?: (name: string, departmentName?: string) => Promise<void>;
}) {
  const [organizationInput, setOrganizationInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const isLive = memberships !== undefined;
  const choices = memberships?.filter((item) => item.status === "active") ?? [];
  const hasNoWorkspaces = isLive && choices.length === 0;

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!onCreateOrganization) return;
    const trimmed = organizationInput.trim();
    if (!trimmed) return;
    setCreating(true);
    setCreateError("");
    try {
      await onCreateOrganization(trimmed);
    } catch (error: unknown) {
      setCreateError(error instanceof Error ? error.message : "Organization setup could not be completed.");
      setCreating(false);
    }
  };

  return (
    <AuthLayout wide>
      <section className="auth-card auth-workspace-card" aria-labelledby="workspace-select-title">
        <div className="auth-card-main">
          {hasNoWorkspaces || showCreate ? (
            <>
              <span className="auth-eyebrow">YOUR ORGANIZATION</span>
              <h1 id="workspace-select-title">Create your organization</h1>
              <p className="auth-helper-text" style={{ textAlign: "center", margin: "8px 0 20px" }}>
                {hasNoWorkspaces
                  ? "You don’t have an active workspace yet. Set up an organization to get started."
                  : "Set up a new organization workspace for your team."}
              </p>

              {createError && (
                <div className="auth-message" role="alert">
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreate}>
                <label>
                  <span>Organization name</span>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={organizationInput}
                    onChange={(event) => setOrganizationInput(event.target.value)}
                    placeholder="e.g. Acme Corporation"
                    autoFocus
                  />
                </label>
                <button type="submit" className="auth-primary" disabled={creating}>
                  {creating ? "Creating organization…" : "Create organization"}
                </button>
                <div className="auth-footer-links" style={{ justifyContent: "center" }}>
                  {showCreate && choices.length > 0 ? (
                    <button
                      type="button"
                      className="auth-text-link"
                      onClick={() => {
                        setShowCreate(false);
                        setCreateError("");
                      }}
                    >
                      ← Back to workspaces
                    </button>
                  ) : (
                    <button type="button" className="auth-text-link" onClick={onBack}>
                      {isLive ? "Sign out" : "Back to sign in"}
                    </button>
                  )}
                </div>
              </form>
            </>
          ) : (
            <>
              <span className="auth-eyebrow">{isLive ? "YOUR WORKSPACES" : "DEMO WORKSPACE"}</span>
              <h1 id="workspace-select-title">Choose your workspace</h1>
              {testMode && (
                <p
                  className="auth-helper-text"
                  role="status"
                  style={{ textAlign: "center", margin: "6px 0 12px", color: "var(--arden-accent)" }}
                >
                  Test mode · Emails disabled
                </p>
              )}

              {isLive ? (
                <>
                  <div className="workspace-choice-list">
                    {choices.map((membership) => {
                      const isAwaiting = needsDepartmentAssignment(membership);
                      return (
                        <button
                          type="button"
                          key={membership.organization.id}
                          className="workspace-choice-card"
                          onClick={() => onContinue(membership.organization.id)}
                        >
                          <div className="workspace-choice-header">
                            <strong>{membership.organization.name}</strong>
                            <span className={`workspace-status-badge ${isAwaiting ? "is-warning" : "is-active"}`}>
                              {isAwaiting ? "AWAITING ASSIGNMENT" : "AVAILABLE"}
                            </span>
                          </div>
                          <span className="workspace-choice-desc">
                            {isAwaiting
                              ? "Awaiting department assignment"
                              : membershipAccessDescription(membership)}
                          </span>
                        </button>
                      );
                    })}
                    {memberships?.filter((item) => !choices.includes(item)).map((membership) => (
                      <div key={membership.organization.id} className="workspace-choice-card is-unavailable">
                        <div className="workspace-choice-header">
                          <strong>{membership.organization.name}</strong>
                          <span className="workspace-status-badge is-muted">{membership.status.toUpperCase()}</span>
                        </div>
                        <span className="workspace-choice-desc">Access unavailable</span>
                      </div>
                    ))}
                  </div>

                  {onCreateOrganization && (
                    <button
                      type="button"
                      className="auth-google-button"
                      style={{ marginTop: "6px" }}
                      onClick={() => setShowCreate(true)}
                    >
                      + Create another organization
                    </button>
                  )}

                  <div className="auth-footer-links" style={{ justifyContent: "center", marginTop: "16px" }}>
                    <button type="button" className="auth-text-link" onClick={onBack}>
                      Sign out
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="workspace-choice-list">
                    <div className="workspace-choice-card is-selected" aria-label={`${organizationName}, selected sample workspace`}>
                      <div className="workspace-choice-header">
                        <strong>{organizationName}</strong>
                        <span className="workspace-status-badge is-active">SELECTED</span>
                      </div>
                      <span className="workspace-choice-desc">Product Engineering · Member</span>
                    </div>
                    <div className="workspace-choice-card is-unavailable">
                      <div className="workspace-choice-header">
                        <strong>Research Sandbox</strong>
                        <span className="workspace-status-badge is-muted">UNAVAILABLE</span>
                      </div>
                      <span className="workspace-choice-desc">Demo workspace</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="auth-primary"
                    style={{ marginTop: "16px" }}
                    onClick={() => onContinue()}
                  >
                    Continue to workspace
                  </button>

                  <div className="auth-footer-links" style={{ justifyContent: "center", marginTop: "16px" }}>
                    <button type="button" className="auth-text-link" onClick={onBack}>
                      Back to sign in
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </section>
    </AuthLayout>
  );
}
