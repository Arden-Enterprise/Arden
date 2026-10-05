import { WelcomePanel } from "./WelcomePanel";
import { entryAssets } from "./entryAssets";
import type { OrganizationMembership } from "../shared/api-client";
import { useState } from "react";

export function WorkspaceSelectPage({ organizationName, memberships, onContinue, onBack, onCreateOrganization }: {
  organizationName: string;
  memberships?: OrganizationMembership[];
  onContinue: (organizationId?: string) => void;
  onBack: () => void;
  onCreateOrganization?: (name: string, departmentName: string) => Promise<void>;
}) {
  const [organizationInput, setOrganizationInput] = useState("");
  const [departmentInput, setDepartmentInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const isLive = memberships !== undefined;
  const choices = memberships?.filter((item) => item.status === "active" && item.canUsePrivateWorkspace) ?? [];
  return (
    <main className="sign-in-page workspace-select-page">
      <WelcomePanel mode="workspace" />
      <section className="sign-in-panel" aria-labelledby="workspace-select-title">
        <div className="sign-in-card workspace-select-card">
          <span className="meta-label">01 / YOUR ORGANIZATION</span>
          <h2 id="workspace-select-title">Choose your workspace</h2>
          <p>Your selection establishes organization context. It does not grant access by itself.</p>
          {isLive ? <div className="workspace-memberships">
            {choices.map((membership) => <button type="button" key={membership.organization.id} className="workspace-membership" onClick={() => onContinue(membership.organization.id)}>
              <span className="workspace-membership-heading"><img src={entryAssets.selectedWorkspace} alt="" width={26} height={26} /><strong>{membership.organization.name}</strong><span className="workspace-membership-status">AVAILABLE</span></span>
              <span>{membership.roleCodes.length ? membership.roleCodes.join(", ") : "Active membership"} · Private workspace access</span>
            </button>)}
            {memberships.filter((item) => !choices.includes(item)).map((membership) => <div key={membership.organization.id} className="workspace-membership is-unavailable">
              <span className="workspace-membership-heading"><img src={entryAssets.unavailableWorkspace} alt="" width={26} height={26} /><strong>{membership.organization.name}</strong><span className="workspace-membership-status">{membership.status.toUpperCase()}</span></span>
              <span>{membership.status === "active" ? "This membership has no private workspace permission." : "An active membership is required."}</span>
            </div>)}
            {choices.length === 0 && <p role="status">You do not have an active organization workspace yet. You can create an organization or ask an administrator for membership.</p>}
            {onCreateOrganization && <form className="organization-create-form" onSubmit={(event) => {
              event.preventDefault();
              setCreating(true); setCreateError("");
              void onCreateOrganization(organizationInput.trim(), departmentInput.trim())
                .catch((error: unknown) => setCreateError(error instanceof Error ? error.message : "Organization setup could not be completed."))
                .finally(() => setCreating(false));
            }}>
              <h3>Create an organization</h3>
              <label><span>Organization name</span><input required maxLength={120} value={organizationInput} onChange={(event) => setOrganizationInput(event.target.value)} /></label>
              <label><span>Your primary department</span><input required maxLength={80} value={departmentInput} onChange={(event) => setDepartmentInput(event.target.value)} /></label>
              {createError && <p role="alert">{createError}</p>}
              <button type="submit" className="primary-button" disabled={creating}>{creating ? "Creating…" : "Create organization"}</button>
              <small>You will become its Org Admin and receive the primary department’s default role.</small>
            </form>}
          </div> : <div className="workspace-memberships">
            <div className="workspace-membership is-selected" aria-label={`${organizationName}, selected sample workspace`}>
              <div className="workspace-membership-heading">
                <img src={entryAssets.selectedWorkspace} alt="" width={26} height={26} />
                <h3>{organizationName}</h3>
                <span className="workspace-membership-status">
                  <img src={entryAssets.statusAmber} alt="" width={7} height={7} />SELECTED
                </span>
              </div>
              <p>Product Engineering · Employee</p>
            </div>
            <button type="button" className="workspace-membership is-unavailable" disabled>
              <span className="workspace-membership-heading">
                <img src={entryAssets.unavailableWorkspace} alt="" width={26} height={26} />
                <strong>Research Sandbox</strong>
                <span className="workspace-membership-status">
                  <img src={entryAssets.statusMuted} alt="" width={7} height={7} />NOT CONNECTED
                </span>
              </span>
              <span>This sample workspace is not connected.</span>
            </button>
          </div>}
          {!isLive && <><button type="button" className="primary-button workspace-continue" onClick={() => onContinue()}>Continue to workspace</button>
          <p className="workspace-preview-identity">Sample member · Lan Nguyen · Employee</p>
          <p className="preview-disclaimer">Member preview uses sample data. Workspace selection does not sign you in or grant organization access.</p></>}
          <button type="button" className="text-button workspace-back" onClick={onBack}>{isLive ? "Sign out" : "Back to sign in"}</button>
        </div>
      </section>
    </main>
  );
}
