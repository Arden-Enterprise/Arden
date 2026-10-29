import { useState } from "react";
import type { OrganizationMembership } from "../shared/api-client";
import { Icon } from "../shared/Icon";
import { IslandEntryLayout } from "../shared/IslandEntryLayout";
import { initialsOf } from "../app/AppSidebar";

export function WorkspaceSelectPage({ organizationName, memberships, onContinue, onBack, onCreateOrganization, testMode = false }: {
  organizationName: string;
  memberships?: OrganizationMembership[];
  testMode?: boolean;
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
  const unavailable = memberships?.filter((item) => !choices.includes(item)) ?? [];
  // Someone without a workspace sees the create form open; otherwise it stays one click away.
  const [createOpen, setCreateOpen] = useState(isLive && choices.length === 0);

  return <IslandEntryLayout titleId="workspace-select-title" eyebrow="YOUR ORGANIZATION" title="Choose your workspace"
    description="Your private notes stay yours in every workspace. Only authorized knowledge is shared."
    badge={testMode ? "LOCAL TEST SESSION" : isLive ? undefined : "SAMPLE DATA"}
    actions={<button type="button" className="secondary-button" onClick={onBack}>{isLive ? "Sign out" : "Back to sign in"}</button>}>
    {testMode && <p className="island-note" role="status"><Icon name="warning" size={14} />
      <span>Kiet Local test session · no login · changes are saved to the development database; invitation emails are not sent.</span></p>}

    {isLive ? <section className="island island-entry-list" aria-labelledby="workspace-list-title">
      <div className="island-section-label"><span id="workspace-list-title">WORKSPACES</span><span>{choices.length} available</span></div>
      {choices.map((membership) => <button type="button" key={membership.organization.id} className="island-entry-row" onClick={() => onContinue(membership.organization.id)}>
        <span className="island-tile island-entry-initials" aria-hidden="true">{initialsOf(membership.organization.name)}</span>
        <span className="island-entry-row-copy"><strong>{membership.organization.name}</strong>
          <small>{membership.roleCodes.length ? membership.roleCodes.join(", ") : "Active membership"} · Private workspace access</small></span>
        <span className="island-chip has-dot tone-success">Available</span>
        <Icon name="chevron" size={14} />
      </button>)}
      {unavailable.map((membership) => <div key={membership.organization.id} className="island-entry-row is-unavailable">
        <span className="island-tile island-entry-initials" aria-hidden="true">{initialsOf(membership.organization.name)}</span>
        <span className="island-entry-row-copy"><strong>{membership.organization.name}</strong>
          <small>{membership.status === "active" ? "This membership has no private workspace permission." : "An active membership is required."}</small></span>
        <span className="island-chip">{membership.status === "active" ? "No workspace access" : membership.status.charAt(0).toUpperCase() + membership.status.slice(1)}</span>
      </div>)}
      {choices.length === 0 && <p className="island-entry-empty" role="status">You do not have an active organization workspace yet. Create an organization below, or ask an administrator to invite you.</p>}
    </section> : <section className="island island-entry-list" aria-labelledby="workspace-list-title">
      <div className="island-section-label"><span id="workspace-list-title">SAMPLE WORKSPACES</span><span>Session only</span></div>
      <div className="island-entry-row is-selected" aria-current="true" aria-label={`${organizationName}, selected sample workspace`}>
        <span className="island-tile island-entry-initials" aria-hidden="true">{initialsOf(organizationName)}</span>
        <span className="island-entry-row-copy"><strong>{organizationName}</strong><small>Product Engineering · Member</small></span>
        <span className="island-chip has-dot tone-accent">Selected</span>
      </div>
      <div className="island-entry-row is-unavailable">
        <span className="island-tile island-entry-initials" aria-hidden="true">RS</span>
        <span className="island-entry-row-copy"><strong>Research Sandbox</strong><small>This sample workspace is not connected.</small></span>
        <span className="island-chip">Not connected</span>
      </div>
      <div className="island-entry-footer"><button type="button" className="primary-button" onClick={() => onContinue()}>Continue to workspace<Icon name="arrow" size={14} /></button></div>
    </section>}

    {onCreateOrganization && <section className="island island-panel island-entry-create" aria-labelledby="create-organization-title">
      <button type="button" className="island-entry-disclosure" aria-expanded={createOpen} aria-controls="create-organization-form" onClick={() => setCreateOpen((open) => !open)}>
        <span className="island-tile" aria-hidden="true"><Icon name="plus" size={16} /></span>
        <span className="island-entry-row-copy"><strong id="create-organization-title">Create an organization</strong>
          <small>You become its first Organization Admin.</small></span>
        <Icon name="chevron" size={14} />
      </button>
      <form id="create-organization-form" className="island-entry-form" hidden={!createOpen} onSubmit={(event) => {
        event.preventDefault();
        setCreating(true); setCreateError("");
        void onCreateOrganization(organizationInput.trim(), departmentInput.trim())
          .catch((error: unknown) => setCreateError(error instanceof Error ? error.message : "Organization setup could not be completed."))
          .finally(() => setCreating(false));
      }}>
        <label className="island-field"><span>Organization name</span><input required maxLength={120} value={organizationInput} disabled={creating} onChange={(event) => setOrganizationInput(event.target.value)} /></label>
        <label className="island-field"><span>Your primary department</span><input required maxLength={80} value={departmentInput} disabled={creating} onChange={(event) => setDepartmentInput(event.target.value)} />
          <small>It owns and reviews the drafts you share.</small></label>
        {createError && <p className="island-note is-danger" role="alert"><Icon name="warning" size={14} /><span>{createError}</span></p>}
        <button type="submit" className="primary-button" disabled={creating}>{creating ? "Creating…" : "Create organization"}</button>
      </form>
    </section>}
  </IslandEntryLayout>;
}
