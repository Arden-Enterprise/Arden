import { useState, type FormEvent } from "react";
import { OrganizationDialog } from "./OrganizationDialog";
import { invitationStatus, transitionOrganization } from "./organizationWorkflow";
import type { OrganizationPreview } from "./previewModel";

export function InviteMemberDialog({ organization, onChange, onClose }: {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const close = () => { if (!created && (name.trim() || email.trim())) setDiscarding(true); else onClose(); };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = transitionOrganization(organization, { type: "invite", id: crypto.randomUUID(), name, email }, Date.now());
    if (result.error) { setError(result.error); return; }
    onChange(result.organization); setCreated(true);
  };
  return <OrganizationDialog title={discarding ? "Discard invitation draft?" : created ? "Invitation ready to preview" : "Invite a member"} description={discarding ? "This invitation has not been created." : created ? "The invitation exists in this session. No email has been sent." : "Invite someone to join the organization. Their primary department and role are assigned after they accept."} onClose={close}>
    {discarding ? <div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className="primary-button" onClick={onClose}>Discard changes</button></div> : created ? <div className="organization-form">
      <div className="organization-notice is-success"><strong>{name.trim()}</strong><span>{email.trim().toLowerCase()} · Pending acceptance</span></div>
      <p className="organization-helper">Open Invitations → Preview invitation to follow the receiving member's journey.</p>
      <div className="organization-dialog-actions"><button className="primary-button" type="button" autoFocus onClick={onClose}>View invitations</button></div>
    </div> : <form className="organization-form" onSubmit={submit}>
      <label className="organization-field"><span>Member name</span><input value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError(""); }} placeholder="e.g. An Le" autoFocus required /></label>
      <label className="organization-field"><span>Work email</span><input type="email" value={email} maxLength={200} onChange={(event) => { setEmail(event.target.value); setError(""); }} placeholder="name@company.example" required /></label>
      <div className="organization-notice"><strong>Accept first. Assign access next.</strong><span>Accepting creates an organization membership that waits for an administrator's department and role assignment.</span></div>
      {error && <p className="organization-form-error" role="alert">{error}</p>}
      <div className="organization-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="submit" className="primary-button">Create preview invitation</button></div>
    </form>}
  </OrganizationDialog>;
}

export function InvitationsPanel({ organization, onChange, onPreviewInvitation, onInvite }: {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
  onPreviewInvitation?: (id: string) => void;
  onInvite: () => void;
}) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const invitations = organization.invitations ?? [];
  const update = (type: "resend" | "revoke", invitationId: string) => {
    const result = transitionOrganization(organization, { type, invitationId }, Date.now());
    if (result.error) { setError(result.error); return; }
    onChange(result.organization); setError(""); setRevoking(null);
    setMessage(type === "resend" ? "Preview invitation renewed for seven days. No email was sent." : "Preview invitation revoked. It can no longer be accepted.");
  };
  const target = invitations.find((invitation) => invitation.id === revoking);
  return <section className="organization-editor-stack">
    <div className="organization-section-heading"><div><span className="meta-label">MEMBERSHIP STARTS HERE</span><h2>Invitations</h2><p>Track acceptance before assigning a primary department and role.</p></div><button type="button" className="primary-button" onClick={onInvite}>Invite member</button></div>
    {message && <p className="organization-feedback" role="status">{message}</p>}
    {error && <p className="organization-form-error" role="alert">{error}</p>}
    {!invitations.length ? <div className="organization-empty-state"><span className="organization-state-number">01</span><h3>No invitations yet</h3><p>Invite a member to start the acceptance and access-assignment workflow.</p><button type="button" className="secondary-button" onClick={onInvite}>Invite your first member</button></div> : <div className="organization-invitation-list">
      {invitations.map((invitation) => {
        const status = invitationStatus(invitation, Date.now());
        return <article className="organization-invitation-row" key={invitation.id}>
          <div className="member-identity"><strong>{invitation.name}</strong><span>{invitation.email}</span></div>
          <div className="organization-invitation-status"><span className={`organization-status status-${status}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span><small>{status === "pending" || status === "expired" ? `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}` : status === "accepted" ? "Membership created" : "Acceptance disabled"}</small></div>
          <div className="organization-row-actions">
            {onPreviewInvitation && <button type="button" className="secondary-button" onClick={() => onPreviewInvitation(invitation.id)}>Preview invitation</button>}
            {invitation.status === "pending" && <><button type="button" className="organization-text-button" onClick={() => update("resend", invitation.id)}>Renew / resend preview</button><button type="button" className="organization-text-button is-danger" onClick={() => setRevoking(invitation.id)}>Revoke</button></>}
          </div>
        </article>;
      })}
    </div>}
    <div className="organization-notice is-info"><strong>Session preview</strong><span>Invitations and membership changes are synthetic. Refreshing or leaving the preview clears them.</span></div>
    {target && <OrganizationDialog title="Revoke this invitation?" description={`${target.name} (${target.email}) will no longer be able to accept this preview invitation.`} onClose={() => setRevoking(null)}><div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setRevoking(null)}>Keep invitation</button><button type="button" className="primary-button" onClick={() => update("revoke", target.id)}>Revoke invitation</button></div></OrganizationDialog>}
  </section>;
}
