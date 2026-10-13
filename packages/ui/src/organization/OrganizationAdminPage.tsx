import { useCallback, useEffect, useState, type FormEvent } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";
import {
  ApiError, assignOrganizationRole, changePrimaryDepartment, createDepartment, createOrganizationRole,
  createReviewerGrant, deactivateReviewerGrant, inviteOrganizationMember, listReviewerGrants,
  loadOrganizationAdministration, resendOrganizationInvitation,
  revokeOrganizationInvitation, type OrganizationAdministration, type ReviewerGrant,
} from "../shared/api-client";
import type { Platform } from "../shared/types";
import { RoleConfigurationPanel } from "./RoleConfigurationPanel";

type OrganizationAdminPageProps = { platform: Platform; organizationId: string; organizationName: string } & ContextControlProps;

export function OrganizationAdminPage({ platform, organizationId, organizationName, contextOpen, onToggleContext }: OrganizationAdminPageProps) {
  const [data, setData] = useState<OrganizationAdministration | null>(null);
  const [reviewerGrants, setReviewerGrants] = useState<ReviewerGrant[]>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [reviewDepartmentId, setReviewDepartmentId] = useState("");
  const [reviewClassifications, setReviewClassifications] = useState<Array<"INTERNAL" | "CONFIDENTIAL" | "RESTRICTED">>(["INTERNAL"]);
  const [reviewLevel, setReviewLevel] = useState<ReviewerGrant["level"]>("STANDARD");
  const [departmentName, setDepartmentName] = useState("");
  const [roleName, setRoleName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDepartmentId, setInviteDepartmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const [administration, grants] = await Promise.all([
      loadOrganizationAdministration(platform, organizationId), listReviewerGrants(platform, organizationId),
    ]);
    setData(administration);
    setReviewerGrants(grants);
    setInviteDepartmentId((current) => current || administration.departments[0]?.id || "");
    setReviewDepartmentId((current) => current || administration.departments[0]?.id || "");
    setReviewerId((current) => current || administration.members.find((member) => member.status === "ACTIVE")?.id || "");
  }, [platform, organizationId]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadOrganizationAdministration(platform, organizationId), listReviewerGrants(platform, organizationId)])
      .then(([administration, grants]) => { if (active) { setData(administration); setReviewerGrants(grants);
        setInviteDepartmentId(administration.departments[0]?.id ?? "");
        setReviewDepartmentId(administration.departments[0]?.id ?? "");
        setReviewerId(administration.members.find((member) => member.status === "ACTIVE")?.id ?? ""); } })
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
  const submitReviewerGrant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewerId || !reviewDepartmentId || reviewClassifications.length === 0) return;
    void perform(() => createReviewerGrant(platform, organizationId, {
      reviewerMembershipId: reviewerId, departmentId: reviewDepartmentId,
      classifications: reviewClassifications, level: reviewLevel,
      teamTag: null, projectTag: null, validUntil: null,
    }).then(() => undefined), "Reviewer grant created. This grants scoped review, not automatic content readership.");
  };

  return <main id="arden-main" className="workspace-page organization-live-admin" aria-labelledby="organization-live-admin-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / Administration`} previewLabel="SERVER MANAGED" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <WorkspacePageContent className="organization-access-content" header={<WorkspacePageHeader
      className="organization-access-heading" eyebrow="ORGANIZATION / GOVERNANCE" title="Members, departments & roles"
      titleId="organization-live-admin-title" description="Changes are checked and recorded by the Arden server."
      action={<button type="button" className="secondary-button" disabled={busy || loading} onClick={() => { setError(""); void reload().catch(() => setError("Organization data could not be refreshed.")); }}>Refresh</button>}
    />}>
      {loading ? <p role="status">Loading organization data…</p> : error && !data ? <p role="alert">{error}</p> : data && <>
        {error && <p className="organization-feedback" role="alert">{error}</p>}{message && <p className="organization-feedback" role="status">{message}</p>}
        <div className="organization-live-admin-grid">
          <section className="organization-surface organization-editor-stack"><h2>Departments</h2>
            <ul>{data.departments.map((department) => <li key={department.id}><strong>{department.name}</strong><span>Default: {department.defaultRoleName}</span></li>)}</ul>
            <form onSubmit={submitDepartment}><label className="organization-field"><span>Add department</span><input required maxLength={80} value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create department"}</button></form>
          </section>
          <section className="organization-surface organization-editor-stack"><h2>Custom roles</h2>
            <ul>{data.roles.map((role) => <li key={role.id}><strong>{role.name}</strong><span>{role.isDefault ? "Department default" : "Custom role"}</span></li>)}</ul>
            <form onSubmit={submitRole}><label className="organization-field"><span>Add role</span><input required maxLength={80} value={roleName} onChange={(event) => setRoleName(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create role"}</button></form>
          </section>
        </div>
        <RoleConfigurationPanel key={organizationId} members={data.members.map((member) => ({
          id: member.id, name: member.name, email: member.email, active: member.status === "ACTIVE",
        }))} initialRoles={data.roles.filter((role) => !role.isDefault && role.code !== "ORG_ADMIN").map((role) => ({
          id: role.id, name: role.name, description: "", permissions: [],
          memberIds: data.members.filter((member) => member.roleIds.includes(role.id)).map((member) => member.id),
        }))} />
        <section className="organization-surface organization-editor-stack"><h2>Invite a member</h2>
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
        <section className="organization-surface organization-editor-stack"><h2>Knowledge reviewers</h2>

          <form className="organization-live-reviewer-form" onSubmit={submitReviewerGrant}>
            <label className="organization-field"><span>Reviewer</span><select required disabled={busy} value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}>
              <option value="">Choose member</option>{data.members.filter((member) => member.status === "ACTIVE").map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
            <label className="organization-field"><span>Department scope</span><select required disabled={busy} value={reviewDepartmentId} onChange={(event) => setReviewDepartmentId(event.target.value)}>
              <option value="">Choose department</option>{data.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            <label className="organization-field"><span>Grant level</span><select disabled={busy} value={reviewLevel} onChange={(event) => setReviewLevel(event.target.value as ReviewerGrant["level"])}>
              <option value="STANDARD">Standard</option><option value="SPECIALIST">Specialist · restricted</option><option value="SENIOR">Senior · restricted</option></select></label>
            <fieldset className="organization-reviewer-classes"><legend>Classifications</legend>{(["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const).map((classification) => <label key={classification}>
              <input type="checkbox" disabled={busy} checked={reviewClassifications.includes(classification)} onChange={(event) => setReviewClassifications((current) => event.target.checked ? [...current, classification] : current.filter((value) => value !== classification))} />{classification}</label>)}</fieldset>
            <button type="submit" className="primary-button" disabled={busy || !reviewerId || !reviewDepartmentId || !reviewClassifications.length || (reviewClassifications.includes("RESTRICTED") && reviewLevel === "STANDARD")}>Grant reviewer authority</button>
          </form>
          {reviewerGrants.length === 0 ? <p>No reviewer grants yet.</p> : <ul className="organization-live-invitations">{reviewerGrants.map((grant) => <li key={grant.id}>
            <div><strong>{data.members.find((member) => member.id === grant.reviewerMembershipId)?.name ?? "Member"}</strong>
              <span>{data.departments.find((department) => department.id === grant.departmentId)?.name ?? "Department"} · {grant.classifications.join(", ")} · {grant.level.toLowerCase()} · {grant.status.toLowerCase()}</span></div>
            {grant.status === "ACTIVE" && <button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(() => deactivateReviewerGrant(platform, organizationId, grant.id), "Reviewer grant deactivated.")}>Deactivate</button>}
          </li>)}</ul>}
        </section>
        <section className="organization-surface organization-editor-stack"><h2>Invitations</h2>
          {data.invitations.length === 0 ? <p>No invitations yet.</p> : <ul className="organization-live-invitations">{data.invitations.map((invitation) => <li key={invitation.id}><div><strong>{invitation.email}</strong><span>{invitation.status.toLowerCase()} · expires {new Date(invitation.expiresAt).toLocaleDateString()}</span></div>{invitation.status === "PENDING" && <div className="organization-row-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
            const result = await resendOrganizationInvitation(platform, organizationId, invitation.id);
            return result.deliveryMode === "local-test-no-email" ? "Invitation updated locally. No email was sent." : "Invitation resent.";
          }, "Invitation resent.")}>Resend</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(() => revokeOrganizationInvitation(platform, organizationId, invitation.id), "Invitation revoked.")}>Revoke</button></div>}</li>)}</ul>}
        </section>
      </>}
    </WorkspacePageContent>
  </main>;
}
