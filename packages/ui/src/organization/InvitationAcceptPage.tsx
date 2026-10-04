import { useState } from "react";
import { Icon } from "../shared/Icon";
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
  return <main id="arden-main" className="organization-flow-page" aria-labelledby="invitation-title" tabIndex={-1}>
    <header className="organization-flow-topbar"><div className="organization-flow-brand"><Icon name="knowledge" size={24} /><strong>ARDEN</strong></div><span className="organization-preview-badge">INVITATION PREVIEW</span><button type="button" className="secondary-button" onClick={onBack}>Back to administration</button></header>
    <div className="organization-flow-layout"><section className="organization-flow-story"><span className="meta-label organization-jade">01 / JOIN THE ORGANIZATION</span><h1 id="invitation-title">{titles[visibleStatus]}{visibleStatus === "pending" && <span>{organization.name}.</span>}</h1><p>A clear place for your work, your department and the knowledge you're allowed to use.</p><ol className="organization-flow-steps"><li className={visibleStatus === "accepted" ? "is-complete" : "is-current"}><span>01</span><div><strong>Accept your invitation</strong><small>Confirm the invited account.</small></div></li><li className={visibleStatus === "accepted" ? "is-current" : ""}><span>02</span><div><strong>Administrator assigns access</strong><small>One primary department and a scoped role.</small></div></li><li><span>03</span><div><strong>Enter your workspace</strong><small>Access is checked before knowledge opens.</small></div></li></ol><div className="organization-notice is-success"><strong>Your private notes stay yours</strong><span>Joining a department or receiving a role does not reveal your private notes to colleagues or administrators.</span></div></section>
      <section className="organization-flow-card"><span className="meta-label organization-amber">{organization.name.toUpperCase()}</span>
        {visibleStatus === "pending" && invitation ? <><h2>Review your invitation</h2><dl className="organization-invitation-detail"><div><dt>Invited member</dt><dd>{invitation.name}</dd></div><div><dt>Work email</dt><dd>{invitation.email}</dd></div><div><dt>Expires</dt><dd>{new Date(invitation.expiresAt).toLocaleDateString()}</dd></div><div><dt>Department & role</dt><dd>Assigned after acceptance</dd></div></dl><div className="organization-notice is-info"><strong>{identity === "signed-out" ? "Sign-in is required in the live flow" : identity === "invited" ? "Invited demo account selected" : "Different demo account selected"}</strong><span>{identity === "signed-out" ? "Use the account provisioned by your organization. This preview uses a demo identity and does not sign you in." : identity === "invited" ? invitation.email : "other.member@example.invalid"}</span></div><label className="organization-field"><span>Demo identity — no real authentication</span><select value={identity} onChange={(event) => { const value = event.target.value; if (value === "signed-out" || value === "invited" || value === "different") setIdentity(value); setError(""); }}><option value="signed-out">No demo identity selected</option><option value="invited">Invited account · {invitation.email}</option><option value="different">Different account · test rejection</option></select></label>{error && <p className="organization-form-error" role="alert">{error}</p>}<button type="button" className="primary-button organization-full-button" onClick={accept}>Accept preview invitation<Icon name="arrow" size={16} /></button><p className="organization-helper">Accepting creates a synthetic membership. Workspace access waits for an administrator's assignment.</p></> : visibleStatus === "accepted" && acceptedMemberId && scenario === "current" ? <><div className="organization-state-icon is-success"><Icon name="check" size={28} /></div><h2>Membership created</h2><p className="organization-helper">Your invitation has been accepted. An administrator can now assign your primary department and system role.</p><div className="organization-notice"><strong>Waiting for access assignment</strong><span>Membership alone does not open the workspace.</span></div><button type="button" className="primary-button organization-full-button" onClick={() => onContinue(acceptedMemberId)}>Check my preview access<Icon name="arrow" size={16} /></button><button type="button" className="secondary-button organization-full-button" onClick={onBack}>Return to admin and assign access</button></> : <><div className="organization-state-icon"><Icon name="lock" size={28} /></div><h2>{visibleStatus === "expired" ? "Request a renewed invitation" : visibleStatus === "revoked" ? "Acceptance is no longer available" : visibleStatus === "accepted" ? "Use your existing membership" : "Check with your administrator"}</h2><p className="organization-helper">{visibleStatus === "expired" ? "An administrator can renew this invitation from the Invitations list. An expired invitation cannot create a membership." : visibleStatus === "revoked" ? "The administrator has withdrawn this invitation. It cannot create or change a membership." : visibleStatus === "accepted" ? "An invitation can be accepted once. Signing in again must use the membership already created." : "This invitation is unavailable. No membership or access has been created."}</p><button type="button" className="secondary-button organization-full-button" onClick={onBack}>Back to administration</button></>}
        <details className="organization-scenario-controls"><summary>Preview invitation states</summary><label className="organization-field"><span>Scenario — changes only this view</span><select value={scenario} onChange={(event) => { const value = event.target.value; if (value === "current" || value === "expired" || value === "revoked" || value === "used") setScenario(value); setError(""); }}><option value="current">Current invitation</option><option value="expired">Expired invitation</option><option value="revoked">Revoked invitation</option><option value="used">Already accepted</option></select></label></details>
        <p className="organization-preview-caption">Synthetic data · Session only · No email sent</p>
      </section></div>
  </main>;
}
