import { useCallback, useEffect, useState, type FormEvent } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import {
  ApiError, assignOrganizationRole, changePrimaryDepartment, createDepartment, createOrganizationRole,
  inviteOrganizationMember, loadOrganizationAdministration, resendOrganizationInvitation,
  revokeOrganizationInvitation, type OrganizationAdministration,
} from "../shared/api-client";
import type { Platform } from "../shared/types";

type OrganizationAdminPageProps = { platform: Platform; organizationId: string; organizationName: string } & ContextControlProps;

export function OrganizationAdminPage({ platform, organizationId, organizationName, contextOpen, onToggleContext }: OrganizationAdminPageProps) {
  const [data, setData] = useState<OrganizationAdministration | null>(null);
  const [departmentName, setDepartmentName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDepartmentId, setInviteDepartmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const administration = await loadOrganizationAdministration(platform, organizationId);
    setData(administration);
    setInviteDepartmentId((current) => current || administration.departments[0]?.id || "");
  }, [platform, organizationId]);

  useEffect(() => {
    let active = true;
    void loadOrganizationAdministration(platform, organizationId)
      .then((administration) => { if (active) { setData(administration); setInviteDepartmentId(administration.departments[0]?.id ?? ""); } })
      .catch(() => { if (active) setError("Organization administration is unavailable for this account."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [platform, organizationId]);

  const perform = async (action: () => Promise<string | void>, successMessage: string) => {
    setBusy(true); setError(""); setMessage("");
    try { const actionMessage = await action(); await reload(); setMessage(actionMessage ?? successMessage); }
    catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The change could not be saved. Refresh and try again.");
      try { await reload(); } catch { /* Keep the action error visible; the Refresh button remains available. */ }
    }
    finally { setBusy(false); }
  };

  const submitDepartment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const name = departmentName.trim(); if (!name) return;
    void perform(async () => { await createDepartment(platform, organizationId, name); setDepartmentName(""); }, "Department created with its default role.");
  };
  const submitRole = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const name = roleName.trim(); if (!name) return;
    void perform(async () => { await createOrganizationRole(platform, organizationId, name); setRoleName(""); }, "Role created. It can now be assigned to members.");
  };
  const submitInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void perform(async () => {
      const result = await inviteOrganizationMember(platform, organizationId, inviteDepartmentId, inviteEmail.trim());
      setInviteEmail("");
      return result.deliveryMode === "local-test-no-email"
        ? "Invitation saved in the local test database. No email was sent."
        : "Invitation email sent.";
    }, "Invitation email sent.");
  };

  return <main id="arden-main" className="workspace-page organization-live-admin" aria-labelledby="organization-live-admin-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / Administration`} previewLabel="SERVER MANAGED" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <div className="workspace-content organization-access-content">
      <div className="page-title-row organization-access-heading"><div><span className="meta-label">ORGANIZATION / GOVERNANCE</span><h1 id="organization-live-admin-title">Members, departments & roles</h1><p>Changes are checked and recorded by the Arden server.</p></div><button type="button" className="secondary-button" disabled={busy || loading} onClick={() => { setError(""); void reload().catch(() => setError("Organization data could not be refreshed.")); }}>Refresh</button></div>
      {loading ? <p role="status">Loading organization data…</p> : error && !data ? <p role="alert">{error}</p> : data && <>
        {error && <p className="organization-feedback" role="alert">{error}</p>}{message && <p className="organization-feedback" role="status">{message}</p>}
        <div className="organization-live-admin-grid">
          <section className="organization-surface organization-editor-stack"><h2>Departments</h2><p>Members have one primary department and receive its default role.</p>
            <ul>{data.departments.map((department) => <li key={department.id}><strong>{department.name}</strong><span>Default: {department.defaultRoleName}</span></li>)}</ul>
            <form onSubmit={submitDepartment}><label className="organization-field"><span>Add department</span><input required maxLength={80} value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create department"}</button></form>
          </section>
          <section className="organization-surface organization-editor-stack"><h2>Custom roles</h2><p>Custom roles define audience tags for published knowledge.</p>
            <ul>{data.roles.map((role) => <li key={role.id}><strong>{role.name}</strong><span>{role.isDefault ? "Department default" : "Custom role"}</span></li>)}</ul>
            <form onSubmit={submitRole}><label className="organization-field"><span>Add role</span><input required maxLength={80} value={roleName} onChange={(event) => setRoleName(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create role"}</button></form>
          </section>
        </div>
        <section className="organization-surface organization-editor-stack"><h2>Invite a member</h2><p>The recipient signs in or creates an account. Acceptance requires a verified matching email.</p>
          {data.departments.length ? <form className="organization-live-invite-form" onSubmit={submitInvite}>
            <label className="organization-field"><span>Email</span><input type="email" required maxLength={320} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
            <label className="organization-field"><span>Primary department</span><select required value={inviteDepartmentId} onChange={(event) => setInviteDepartmentId(event.target.value)}>{data.departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button>
          </form> : <p role="status">Create a department before inviting members.</p>}
        </section>
        <section className="organization-surface organization-editor-stack"><h2>Members ({data.members.length})</h2>
          <div className="organization-live-members">{data.members.map((member) => <article key={member.id}>
            <div><strong>{member.name}</strong><span>{member.email} · {member.status.toLowerCase()}</span><small>Roles: {member.roleNames.join(", ") || "None"}</small></div>
            <label className="organization-field"><span>Primary department</span><select disabled={busy || !data.departments.length} value={member.departmentId ?? ""} onChange={(event) => void perform(() => changePrimaryDepartment(platform, organizationId, member.id, event.target.value), "Primary department updated.")}>
              {data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select></label>
            <label className="organization-field"><span>Assign custom role</span><select disabled={busy} defaultValue="" onChange={(event) => {
              const roleId = event.target.value; if (!roleId) return;
              void perform(() => assignOrganizationRole(platform, organizationId, member.id, roleId), "Role assigned."); event.target.value = "";
            }}><option value="">Choose a role</option>{data.roles.filter((role) => !role.isDefault && !member.roleIds.includes(role.id)).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          </article>)}</div>
        </section>
        <section className="organization-surface organization-editor-stack"><h2>Invitations</h2>
          {data.invitations.length === 0 ? <p>No invitations yet.</p> : <ul className="organization-live-invitations">{data.invitations.map((invitation) => <li key={invitation.id}><div><strong>{invitation.email}</strong><span>{invitation.status.toLowerCase()} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</span></div>{invitation.status === "PENDING" && <div className="organization-row-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
            const result = await resendOrganizationInvitation(platform, organizationId, invitation.id);
            return result.deliveryMode === "local-test-no-email" ? "Invitation updated locally. No email was sent." : "Invitation resent.";
          }, "Invitation resent.")}>Resend</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(() => revokeOrganizationInvitation(platform, organizationId, invitation.id), "Invitation revoked.")}>Revoke</button></div>}</li>)}</ul>}
        </section>
      </>}
    </div>
  </main>;
}
