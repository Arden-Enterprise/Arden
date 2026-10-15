import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";
import {
  ApiError, changePrimaryDepartment, createDepartment, createReviewerGrant, deactivateReviewerGrant,
  inviteOrganizationMember, listReviewerGrants, loadOrganizationAdministration,
  resendOrganizationInvitation, revokeOrganizationInvitation,
  type OrganizationAdministration, type ReviewerGrant,
} from "../shared/api-client";
import type { Platform } from "../shared/types";
import { ServerRoleConfigurationPanel } from "./ServerRoleConfigurationPanel";

type Props = { platform: Platform; organizationId: string; organizationName: string; onDirtyChange?: (dirty: boolean) => void } & ContextControlProps;
type AdminTab = "members" | "departments" | "roles" | "invitations" | "reviewers";
type Member = OrganizationAdministration["members"][number];
type Confirmation = { title: string; description: string; action: string; run: () => Promise<void> };
const classifications = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
const tabNames: Record<AdminTab, string> = {
  members: "Members", departments: "Departments", roles: "Roles", invitations: "Invitations", reviewers: "Reviewer authority",
};
function memberStatusLabel(status: string): string {
  return status === "ACTIVE" ? "Active" : status === "INVITED" ? "Awaiting assignment" : "Inactive";
}
function memberStatusClass(status: string): string {
  return status === "ACTIVE" ? "active" : status === "INVITED" ? "pending" : "inactive";
}

function ConfirmAction({ confirmation, busy, onClose, onConfirm }: {
  confirmation: Confirmation; busy: boolean; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={dialog} className="organization-dialog admin-confirm" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id={titleId}>{confirmation.title}</h2><p>{confirmation.description}</p>
    <div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="admin-danger-button" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmation.action}</button></div>
  </dialog>;
}

function MemberDrawer({ member, departmentName, grants, departments, busy, feedback, feedbackError, onClose, onDepartmentChange, onGrant }: {
  member: Member; departmentName: (id: string | null) => string; grants: ReviewerGrant[];
  departments: OrganizationAdministration["departments"]; busy: boolean; feedback: string; feedbackError: string; onClose: () => void;
  onDepartmentChange: (id: string) => void; onGrant: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={dialog} className="admin-member-drawer" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><div><span className="meta-label">MEMBER DETAILS</span><h2 id={titleId}>{member.name}</h2><p>{member.email}</p></div>
      <button type="button" className="secondary-button" onClick={onClose} aria-label="Close member details">Close</button></header>
    <span className={`admin-status status-${memberStatusClass(member.status)}`}>{memberStatusLabel(member.status)}</span>
    {feedbackError && <p className="admin-feedback is-error" role="alert">{feedbackError}</p>}
    {feedback && <p className="admin-feedback" role="status">{feedback}</p>}
    <section><h3>Departments</h3><label className="organization-field"><span>Primary department</span><select value={member.departmentId ?? ""} disabled={busy}
      onChange={(event) => onDepartmentChange(event.target.value)}>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {(member.departmentIds ?? []).filter((id) => id !== member.departmentId).length > 0 && <p>Also in {(member.departmentIds ?? []).filter((id) => id !== member.departmentId).map(departmentName).join(", ")}</p>}</section>
    <section><h3>Roles</h3><p>{member.roleNames.join(", ") || "No roles assigned"}</p><small>Manage custom role assignments from the Roles tab.</small></section>
    <section><h3>Reviewer authority</h3>{grants.length ? <ul>{grants.map((grant) => <li key={grant.id}><strong>{departmentName(grant.departmentId)}</strong>
      <span>{grant.classifications.join(", ")} · {grant.level.toLowerCase()} · {grant.status.toLowerCase()}</span></li>)}</ul> : <p>No reviewer authority.</p>}
      <button type="button" className="primary-button" onClick={onGrant} disabled={member.status !== "ACTIVE"}>Grant reviewer authority</button>
      <small>Review authority does not grant reading access.</small></section>
  </dialog>;
}

export function OrganizationAdminPage({ platform, organizationId, organizationName, contextOpen, onToggleContext, onDirtyChange }: Props) {
  const [data, setData] = useState<OrganizationAdministration | null>(null);
  const [reviewerGrants, setReviewerGrants] = useState<ReviewerGrant[]>([]);
  const [tab, setTab] = useState<AdminTab>("members");
  const [roleDirty, setRoleDirty] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [memberStatus, setMemberStatus] = useState("ALL");
  const [memberDepartment, setMemberDepartment] = useState("ALL");
  const [reviewerId, setReviewerId] = useState("");
  const [reviewDepartmentId, setReviewDepartmentId] = useState("");
  const [reviewClassifications, setReviewClassifications] = useState<Array<(typeof classifications)[number]>>(["INTERNAL"]);
  const [reviewLevel, setReviewLevel] = useState<ReviewerGrant["level"]>("STANDARD");
  const [teamTag, setTeamTag] = useState("");
  const [projectTag, setProjectTag] = useState("");
  const [grantFilter, setGrantFilter] = useState<"ACTIVE" | "INACTIVE">("ACTIVE");
  const [departmentNameInput, setDepartmentNameInput] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDepartmentId, setInviteDepartmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const reportRoleDirty = useCallback((dirty: boolean) => {
    setRoleDirty(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);

  const reload = useCallback(async () => {
    const [administration, grants] = await Promise.all([
      loadOrganizationAdministration(platform, organizationId), listReviewerGrants(platform, organizationId),
    ]);
    setData(administration); setReviewerGrants(grants);
    setInviteDepartmentId((current) => current || administration.departments[0]?.id || "");
    setReviewDepartmentId((current) => current || administration.departments[0]?.id || "");
    setReviewerId((current) => current || administration.members.find((member) => member.status === "ACTIVE")?.id || "");
  }, [platform, organizationId]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadOrganizationAdministration(platform, organizationId), listReviewerGrants(platform, organizationId)])
      .then(([administration, grants]) => { if (!active) return;
        setData(administration); setReviewerGrants(grants);
        setInviteDepartmentId(administration.departments[0]?.id ?? "");
        setReviewDepartmentId(administration.departments[0]?.id ?? "");
        setReviewerId(administration.members.find((member) => member.status === "ACTIVE")?.id ?? "");
      }).catch(() => { if (active) setError("Organization administration is unavailable for this account."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [platform, organizationId]);

  const perform = async (action: () => Promise<string | void>, successMessage: string) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const actionMessage = await action();
      try { await reload(); } catch { setError("Change saved, but the list could not refresh. Use Refresh to load the latest data."); }
      setMessage(actionMessage ?? successMessage);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "The change could not be saved. Refresh and try again."); }
    finally { setBusy(false); }
  };
  const selectTab = (next: AdminTab) => {
    if (tab === "roles" && next !== "roles" && roleDirty) { setError("Save or reset role changes before leaving Roles."); return; }
    setError(""); setMessage(""); setTab(next);
    document.querySelector(".organization-live-admin .workspace-scroll-region")?.scrollTo(0, 0);
  };
  const departmentName = (id: string | null) => data?.departments.find((item) => item.id === id)?.name ?? "Unassigned";
  const selectedMember = data?.members.find((member) => member.id === selectedMemberId);
  const matchingMembers = data?.members.filter((member) => {
    const query = memberQuery.trim().toLowerCase();
    return (!query || `${member.name} ${member.email}`.toLowerCase().includes(query))
      && (memberStatus === "ALL" || (memberStatus === "INACTIVE" ? member.status === "SUSPENDED" || member.status === "LEFT" : member.status === memberStatus))
      && (memberDepartment === "ALL" || (member.departmentIds ?? [member.departmentId]).includes(memberDepartment));
  }) ?? [];
  const canGrant = Boolean(reviewerId && reviewDepartmentId && reviewClassifications.length
    && !(reviewClassifications.includes("RESTRICTED") && reviewLevel === "STANDARD"));
  const submitDepartment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const name = departmentNameInput.trim(); if (!name) return;
    void perform(async () => { await createDepartment(platform, organizationId, name); setDepartmentNameInput(""); }, "Department created with its default role.");
  };
  const submitInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void perform(async () => {
      const result = await inviteOrganizationMember(platform, organizationId, inviteDepartmentId, inviteEmail.trim());
      setInviteEmail("");
      return result.deliveryMode === "local-test-no-email" ? "Invitation saved locally. No email was sent." : "Invitation email sent.";
    }, "Invitation email sent.");
  };
  const submitReviewerGrant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!canGrant) return;
    void perform(async () => {
      await createReviewerGrant(platform, organizationId, {
        reviewerMembershipId: reviewerId, departmentId: reviewDepartmentId,
        classifications: reviewClassifications, level: reviewLevel,
        teamTag: teamTag.trim() || null, projectTag: projectTag.trim() || null, validUntil: null,
      }); setTeamTag(""); setProjectTag("");
    }, "Reviewer authority granted. This grants scoped review, not reading access.");
  };
  const confirmAction = () => {
    if (!confirmation) return;
    void perform(confirmation.run, `${confirmation.action} completed.`).finally(() => setConfirmation(null));
  };
  const tabCount: Record<AdminTab, number> = {
    members: data?.members.length ?? 0, departments: data?.departments.length ?? 0,
    roles: data?.roles.length ?? 0, invitations: data?.invitations.length ?? 0,
    reviewers: reviewerGrants.filter((grant) => grant.status === "ACTIVE").length,
  };

  return <main id="arden-main" className="workspace-page organization-live-admin" aria-labelledby="organization-live-admin-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / Administration / ${tabNames[tab]}`} previewLabel="SERVER MANAGED" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <WorkspacePageContent className="organization-access-content" header={<div className="admin-page-header">
      <WorkspacePageHeader className="organization-access-heading" eyebrow="ORGANIZATION / GOVERNANCE" title="Administration"
        description={`Manage who belongs to ${organizationName}, how they are grouped, and who may review knowledge.`}
        titleId="organization-live-admin-title" action={tab === "members" ? <button type="button" className="primary-button" onClick={() => selectTab("invitations")}>Invite member</button>
          : tab === "reviewers" ? <button type="button" className="primary-button" onClick={() => document.getElementById("admin-grant-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Grant authority</button>
            : <button type="button" className="secondary-button" disabled={busy || loading} onClick={() => { setError(""); void reload().catch(() => setError("Organization data could not be refreshed.")); }}>Refresh</button>} />
      <div className="admin-tabs" role="tablist" aria-label="Administration sections">{(Object.keys(tabNames) as AdminTab[]).map((name) => <button key={name}
        type="button" role="tab" aria-selected={tab === name} className={tab === name ? "is-active" : ""}
        onClick={() => selectTab(name)}>{tabNames[name]} <span>{tabCount[name]}</span></button>)}</div>
    </div>}>
      {loading ? <p role="status" className="admin-loading">Loading organization data…</p> : error && !data ? <div className="organization-notice is-danger" role="alert"><strong>{error}</strong><button type="button" className="secondary-button" onClick={() => { setLoading(true); setError(""); void reload().catch(() => setError("Organization data could not be refreshed.")).finally(() => setLoading(false)); }}>Try again</button></div> : data && <>
        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}{message && <p className="admin-feedback" role="status">{message}</p>}
        {tab === "members" && <section role="tabpanel" aria-label="Members" className="admin-section">
          <div className="admin-filters"><label className="admin-search"><span className="sr-only">Search members</span><input type="search" placeholder="Search name or email" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} /></label>
            <label><span className="sr-only">Filter membership status</span><select value={memberStatus} onChange={(event) => setMemberStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INVITED">Awaiting assignment</option><option value="INACTIVE">Inactive</option></select></label>
            <label><span className="sr-only">Filter department</span><select value={memberDepartment} onChange={(event) => setMemberDepartment(event.target.value)}><option value="ALL">All departments</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <span>{matchingMembers.length} members</span></div>
          {matchingMembers.length ? <div className="admin-table-wrap"><table className="admin-members-table"><thead><tr><th>Member</th><th>Membership</th><th>Department</th><th>Roles</th><th>Reviewer authority</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{matchingMembers.map((member) => {
            const grants = reviewerGrants.filter((grant) => grant.reviewerMembershipId === member.id && grant.status === "ACTIVE");
            return <tr key={member.id}><td data-label="Member"><strong>{member.name}</strong><small>{member.email}</small></td>
              <td data-label="Membership"><span className={`admin-status status-${memberStatusClass(member.status)}`}>{memberStatusLabel(member.status)}</span></td>
              <td data-label="Department">{departmentName(member.departmentId)}<small>Primary{(member.departmentIds ?? []).filter((id) => id !== member.departmentId).length ? ` · also ${(member.departmentIds ?? []).filter((id) => id !== member.departmentId).map(departmentName).join(", ")}` : ""}</small></td>
              <td data-label="Roles">{member.roleNames.join(", ") || "No roles assigned"}</td>
              <td data-label="Reviewer authority">{grants.length ? <>{grants.map((grant) => departmentName(grant.departmentId)).join(", ")}<small>Up to {grants.some((grant) => grant.classifications.includes("RESTRICTED")) ? "Restricted" : grants.some((grant) => grant.classifications.includes("CONFIDENTIAL")) ? "Confidential" : "Internal"}</small></> : "None"}</td>
              <td><button type="button" className="secondary-button" onClick={() => setSelectedMemberId(member.id)} aria-label={`Manage ${member.name}`}>Manage</button></td></tr>;
          })}</tbody></table></div> : <div className="organization-empty-state"><h3>{data.members.length ? "No matching members" : "No members yet"}</h3><p>{data.members.length ? "Try a different search or clear the filters." : "Invite a member to start building your organization."}</p><button type="button" className="secondary-button" onClick={() => { setMemberQuery(""); setMemberStatus("ALL"); setMemberDepartment("ALL"); }}>{data.members.length ? "Clear filters" : "Reset"}</button></div>}
        </section>}
        {tab === "departments" && <section role="tabpanel" aria-label="Departments" className="admin-section admin-narrow">
          <div className="admin-section-heading"><div><h2>Departments</h2><p>Every department has a default role for its members.</p></div></div>
          <form className="admin-inline-form" onSubmit={submitDepartment}><label className="organization-field"><span>Department name <small>Required</small></span><input required maxLength={80} value={departmentNameInput} disabled={busy} onChange={(event) => setDepartmentNameInput(event.target.value)} /></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create department"}</button></form>
          {data.departments.length ? <ul className="admin-simple-list">{data.departments.map((department) => <li key={department.id}><strong>{department.name}</strong><span>{data.members.filter((member) => (member.departmentIds ?? [member.departmentId]).includes(department.id)).length} members · Default role: {department.defaultRoleName}</span></li>)}</ul> : <div className="organization-empty-state"><h3>No departments yet</h3><p>Create a department before inviting members.</p></div>}
        </section>}
        <div hidden={tab !== "roles"} role="tabpanel" aria-label="Roles" className="admin-section admin-roles"><ServerRoleConfigurationPanel platform={platform} organizationId={organizationId} members={data.members} departments={data.departments}
          onDirtyChange={reportRoleDirty} /></div>
        {tab === "invitations" && <section role="tabpanel" aria-label="Invitations" className="admin-section">
          <div className="admin-section-heading"><div><h2>Invitations</h2><p>Invite someone by email. They appear as a member after accepting the invitation.</p></div></div>
          {data.departments.length ? <form className="admin-inline-form" onSubmit={submitInvite}>
            <label className="organization-field"><span>Email <small>Required</small></span><input type="email" required maxLength={320} value={inviteEmail} disabled={busy} onChange={(event) => setInviteEmail(event.target.value)} /></label>
            <label className="organization-field"><span>Primary department <small>Required</small></span><select required value={inviteDepartmentId} disabled={busy} onChange={(event) => setInviteDepartmentId(event.target.value)}>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button></form>
            : <div className="organization-notice"><strong>Create a department first</strong><span>Invitations need a primary department.</span><button type="button" className="secondary-button" onClick={() => selectTab("departments")}>Go to Departments</button></div>}
          {data.invitations.length ? <ul className="admin-simple-list admin-invitations">{data.invitations.map((invitation) => {
            const expired = invitation.status === "PENDING" && new Date(invitation.expiresAt).getTime() < Date.now();
            return <li key={invitation.id}><div><strong>{invitation.email}</strong><span>{departmentName(invitation.departmentId)} · {expired ? "Expired" : invitation.status.toLowerCase()}{invitation.status === "PENDING" && !expired ? ` · expires ${new Date(invitation.expiresAt).toLocaleDateString()}` : ""}</span></div>
            {invitation.status === "PENDING" && <div className="organization-row-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
              const result = await resendOrganizationInvitation(platform, organizationId, invitation.id);
              return result.deliveryMode === "local-test-no-email" ? "Invitation updated locally. No email was sent." : "Invitation resent.";
            }, "Invitation resent.")}>Resend</button><button type="button" className="admin-text-danger" disabled={busy} onClick={() => setConfirmation({
              title: `Revoke invitation to ${invitation.email}?`, description: "This invitation link will no longer work.", action: "Revoke invitation",
              run: () => revokeOrganizationInvitation(platform, organizationId, invitation.id),
            })}>Revoke…</button></div>}</li>;
          })}</ul> : <div className="organization-empty-state"><h3>No invitations yet</h3><p>Send an invitation to add your first member.</p></div>}
        </section>}
        {tab === "reviewers" && <section role="tabpanel" aria-label="Reviewer authority" className="admin-section">
          <div className="admin-scope-explainer"><div><strong>Department</strong><span>The reviewer receives submissions owned by this department.</span></div><div><strong>Classification</strong><span>Restricted requires Specialist or Senior level.</span></div><div><strong>Team and project (optional)</strong><span>Narrow the grant within the department.</span></div></div>
          <p className="admin-helper">Authority covers review only. It does not grant reading access, and a reviewer cannot decide their own submission.</p>
          <div className="admin-reviewer-layout"><div><div className="admin-section-heading"><h2>Granted authority</h2><div className="admin-segmented"><button type="button" className={grantFilter === "ACTIVE" ? "is-active" : ""} onClick={() => setGrantFilter("ACTIVE")}>Active {reviewerGrants.filter((item) => item.status === "ACTIVE").length}</button><button type="button" className={grantFilter === "INACTIVE" ? "is-active" : ""} onClick={() => setGrantFilter("INACTIVE")}>Inactive {reviewerGrants.filter((item) => item.status === "INACTIVE").length}</button></div></div>
            {reviewerGrants.filter((grant) => grant.status === grantFilter).length ? <ul className="admin-grant-list">{reviewerGrants.filter((grant) => grant.status === grantFilter).map((grant) => <li key={grant.id}><div><strong>{data.members.find((member) => member.id === grant.reviewerMembershipId)?.name ?? "Member"}</strong><small>{data.members.find((member) => member.id === grant.reviewerMembershipId)?.email}</small></div><div><strong>{departmentName(grant.departmentId)}</strong><small>{grant.teamTag ? `Team: ${grant.teamTag}` : "All teams"} · {grant.projectTag ? `Project: ${grant.projectTag}` : "all projects"}</small></div><div className="admin-class-tags">{grant.classifications.map((item) => <span key={item}>{item}</span>)}</div><div><strong>{grant.level === "STANDARD" ? "Standard" : grant.level === "SPECIALIST" ? "Specialist" : "Senior"}</strong><small>Since {new Date(grant.validFrom).toLocaleDateString()}</small></div>{grant.status === "ACTIVE" && <button type="button" className="admin-text-danger" disabled={busy} onClick={() => setConfirmation({
                title: `Deactivate ${data.members.find((member) => member.id === grant.reviewerMembershipId)?.name ?? "this member"}'s reviewer authority?`, description: "This grant will stop authorizing review decisions. Existing decisions remain recorded.", action: "Deactivate authority", run: () => deactivateReviewerGrant(platform, organizationId, grant.id),
              })}>Deactivate…</button>}</li>)}</ul> : <div className="organization-empty-state"><h3>No {grantFilter.toLowerCase()} reviewer grants</h3><p>Use the form to grant scoped review authority to an active member.</p></div>}</div>
            <form id="admin-grant-form" className="admin-grant-form organization-surface" onSubmit={submitReviewerGrant}><div className="admin-section-heading"><h2>Grant reviewer authority</h2><small>* Required</small></div>
              <label className="organization-field"><span>Reviewer *</span><select required disabled={busy} value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}><option value="">Choose an active member</option>{data.members.filter((member) => member.status === "ACTIVE").map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select><small>Only active members can review.</small></label>
              <label className="organization-field"><span>Department *</span><select required disabled={busy} value={reviewDepartmentId} onChange={(event) => setReviewDepartmentId(event.target.value)}><option value="">Choose department</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small>Submissions owned by this department.</small></label>
              <fieldset className="organization-reviewer-classes"><legend>Classifications *</legend>{classifications.map((item) => <label key={item}><input type="checkbox" disabled={busy} checked={reviewClassifications.includes(item)} onChange={(event) => setReviewClassifications((current) => event.target.checked ? [...current, item] : current.filter((value) => value !== item))} />{item}</label>)}</fieldset>
              <label className="organization-field"><span>Grant level *</span><select disabled={busy} value={reviewLevel} onChange={(event) => setReviewLevel(event.target.value as ReviewerGrant["level"])}><option value="STANDARD">Standard</option><option value="SPECIALIST">Specialist · restricted</option><option value="SENIOR">Senior · restricted</option></select></label>
              <label className="organization-field"><span>Team tag <small>Optional</small></span><input maxLength={100} disabled={busy} value={teamTag} onChange={(event) => setTeamTag(event.target.value)} /></label>
              <label className="organization-field"><span>Project tag <small>Optional</small></span><input maxLength={100} disabled={busy} value={projectTag} onChange={(event) => setProjectTag(event.target.value)} /></label>
              <p className="admin-helper">Scope: {departmentName(reviewDepartmentId)} · {teamTag.trim() || "all teams"} · {projectTag.trim() || "all projects"}</p>
              {reviewClassifications.includes("RESTRICTED") && reviewLevel === "STANDARD" && <p role="alert" className="admin-feedback is-error">Choose Specialist or Senior for Restricted knowledge.</p>}
              <button type="submit" className="primary-button" disabled={busy || !canGrant}>{busy ? "Granting…" : "Grant reviewer authority"}</button>
            </form></div>
        </section>}
      </>}
    </WorkspacePageContent>
    {selectedMember && <MemberDrawer member={selectedMember} departmentName={departmentName} departments={data?.departments ?? []} feedback={message} feedbackError={error}
      grants={reviewerGrants.filter((grant) => grant.reviewerMembershipId === selectedMember.id)} busy={busy}
      onClose={() => setSelectedMemberId(null)} onDepartmentChange={(id) => void perform(() => changePrimaryDepartment(platform, organizationId, selectedMember.id, id), "Primary department updated.")}
      onGrant={() => { setReviewerId(selectedMember.id); setSelectedMemberId(null); selectTab("reviewers"); }} />}
    {confirmation && <ConfirmAction confirmation={confirmation} busy={busy} onClose={() => setConfirmation(null)} onConfirm={confirmAction} />}
  </main>;
}
