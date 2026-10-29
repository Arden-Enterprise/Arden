import { useState } from "react";
import { Icon } from "../shared/Icon";
import { IslandEntryLayout } from "../shared/IslandEntryLayout";
import { invitationStatus, transitionOrganization } from "./organizationWorkflow";
import type { OrganizationPreview } from "./previewModel";

type InvitationScenario = "current" | "expired" | "revoked" | "used";

export function InvitationAcceptPage({ organization, invitationId, onChange, onBack, onContinue }: {
  organization: OrganizationPreview;
  invitationId: string;
  onChange: (organization: OrganizationPreview) => void;
  onBack: () => void;
  onContinue: (memberId: string) => void;
}) {
  const [identity, setIdentity] = useState<"signed-out" | "invited" | "different">("signed-out");
  const [scenario, setScenario] = useState<InvitationScenario>("current");
  const [error, setError] = useState("");
  const [createdMemberId, setCreatedMemberId] = useState<string | null>(null);
  const invitation = organization.invitations?.find((item) => item.id === invitationId);
  const status = invitation ? invitationStatus(invitation, Date.now()) : "missing";
  const visibleStatus = scenario === "current" ? status : scenario === "used" ? "accepted" : scenario;
  const acceptedMemberId = createdMemberId ?? invitation?.memberId;
  const accept = () => {
    if (!invitation || scenario !== "current") return;
    if (identity === "signed-out") { setError("Choose the invited demo identity before accepting."); return; }
    const result = transitionOrganization(organization, { type: "accept", invitationId, email: identity === "invited" ? invitation.email : "other.member@example.invalid", memberId: crypto.randomUUID() }, Date.now());
    if (result.error) { setError(result.error); return; }
    onChange(result.organization); setCreatedMemberId(result.memberId ?? null); setError("");
  };
  const titles: Record<string, string> = {
    pending: "You're invited to join", expired: "This invitation has expired", revoked: "This invitation was revoked", accepted: acceptedMemberId && scenario === "current" ? "You're part of the organization" : "This invitation has already been used", missing: "Invitation unavailable",
  };
  const steps = [
    { label: "Accept your invitation", state: visibleStatus === "accepted" ? "is-complete" : "is-current" },
    { label: "Administrator assigns access", state: visibleStatus === "accepted" ? "is-current" : "" },
    { label: "Enter your workspace", state: "" },
  ];
  return <IslandEntryLayout titleId="invitation-title" eyebrow="JOIN THE ORGANIZATION" badge="INVITATION PREVIEW"
    title={<>{titles[visibleStatus]}{visibleStatus === "pending" && <> {organization.name}</>}</>}
    actions={<button type="button" className="secondary-button" onClick={onBack}>Back to administration</button>}>
    <ol className="island-entry-steps" aria-label="Joining progress">{steps.map((step, index) => <li key={step.label} className={step.state}
      aria-current={step.state === "is-current" ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{step.label}</li>)}</ol>
    <section className="island island-panel island-entry-card" aria-label={organization.name}>
      <span className="meta-label">{organization.name.toUpperCase()}</span>
      {visibleStatus === "pending" && invitation ? <>
        <h2>Review your invitation</h2>
        <dl className="island-kv">
          <dt>Invited member</dt><dd>{invitation.name}</dd>
          <dt>Work email</dt><dd>{invitation.email}</dd>
          <dt>Expires</dt><dd>{new Date(invitation.expiresAt).toLocaleDateString()}</dd>
          <dt>Department & role</dt><dd>Assigned after acceptance</dd>
        </dl>
        <p className="island-note" role="note"><Icon name="people" size={14} /><span><strong>{identity === "signed-out" ? "Sign-in is required in the live flow" : identity === "invited" ? "Invited demo account selected" : "Different demo account selected"}.</strong>{" "}
          {identity === "signed-out" ? "Use the account provisioned by your organization. This preview uses a demo identity and does not sign you in." : identity === "invited" ? invitation.email : "other.member@example.invalid"}</span></p>
        <label className="island-field"><span>Demo identity — no real authentication</span><select value={identity} onChange={(event) => { const value = event.target.value; if (value === "signed-out" || value === "invited" || value === "different") setIdentity(value); setError(""); }}>
          <option value="signed-out">No demo identity selected</option><option value="invited">Invited account · {invitation.email}</option><option value="different">Different account · test rejection</option></select></label>
        {error && <p className="island-note is-danger" role="alert"><Icon name="warning" size={14} /><span>{error}</span></p>}
        <button type="button" className="primary-button" onClick={accept}>Accept preview invitation<Icon name="arrow" size={14} /></button>
      </> : visibleStatus === "accepted" && acceptedMemberId && scenario === "current" ? <>
        <span className="island-tile island-entry-state is-success" aria-hidden="true"><Icon name="check" size={22} /></span>
        <h2>Membership created</h2>
        <p className="island-note" role="note"><Icon name="lock" size={14} /><span><strong>Waiting for access assignment.</strong> Membership alone does not open the workspace.</span></p>
        <div className="island-entry-actions-stack">
          <button type="button" className="primary-button" onClick={() => onContinue(acceptedMemberId)}>Check my preview access<Icon name="arrow" size={14} /></button>
          <button type="button" className="secondary-button" onClick={onBack}>Return to admin and assign access</button>
        </div>
      </> : <>
        <span className="island-tile island-entry-state" aria-hidden="true"><Icon name="lock" size={22} /></span>
        <h2>{visibleStatus === "expired" ? "Request a renewed invitation" : visibleStatus === "revoked" ? "Acceptance is no longer available" : visibleStatus === "accepted" ? "Use your existing membership" : "Check with your administrator"}</h2>
        <button type="button" className="secondary-button" onClick={onBack}>Back to administration</button>
      </>}
      <details className="island-entry-details"><summary>Preview invitation states</summary>
        <label className="island-field"><span>Scenario — changes only this view</span><select value={scenario} onChange={(event) => { const value = event.target.value; if (value === "current" || value === "expired" || value === "revoked" || value === "used") setScenario(value); setError(""); }}>
          <option value="current">Current invitation</option><option value="expired">Expired invitation</option><option value="revoked">Revoked invitation</option><option value="used">Already accepted</option></select></label>
      </details>
    </section>
  </IslandEntryLayout>;
}
