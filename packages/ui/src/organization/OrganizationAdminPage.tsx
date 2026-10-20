import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";
import { ActionToast } from "../shared/ActionToast";
import {
  ApiError, changePrimaryDepartment, createDepartment, createReviewerGrant, deactivateReviewerGrant,
  inviteOrganizationMember, listReviewerGrants, loadAudienceGroups, loadOrganizationAdministration,
  removeAudienceGroupMember, resendOrganizationInvitation, revokeOrganizationInvitation,
  type OrganizationAdministration, type ReviewerGrant,
} from "../shared/api-client";
import type { Platform } from "../shared/types";
import type { AudienceGroupRecord } from "../shared/audience-group-contracts";
import { ServerAudienceGroupPanel } from "./ServerAudienceGroupPanel";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";

type Props = { platform: Platform; organizationId: string; organizationName: string; onDirtyChange?: (dirty: boolean) => void } & ContextControlProps;
type AdminTab = "members" | "departments" | "audiences" | "invitations" | "reviewers";
type Member = OrganizationAdministration["members"][number];
type Confirmation = { title: string; description: string; action: string; run: () => Promise<void> };
const classifications = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
const tabNames: Record<AdminTab, string> = {
  members: "Members", departments: "Departments", audiences: "Audiences", invitations: "Invitations", reviewers: "Reviewer authority",
};
function memberStatusLabel(status: string): string {
  return status === "ACTIVE" ? "Active" : status === "INVITED" ? "Awaiting assignment" : "Inactive";
}
function memberStatusClass(status: string): string {
  return status === "ACTIVE" ? "active" : status === "INVITED" ? "pending" : "inactive";
}

function ConfirmAction({ confirmation, busy, error, onClose, onConfirm }: {
  confirmation: Confirmation; busy: boolean; error: string; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={dialog} className="organization-dialog admin-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id={titleId}>{confirmation.title}</h2><p>{confirmation.description}</p>{error && <p className="admin-feedback is-error" role="alert">{error}</p>}
    <div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="admin-danger-button" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : confirmation.action}</button></div>
  </dialog>;
}

function MemberDrawer({ member, departmentName, grants, departments, organizationRoles, audienceGroups, groupsLoading, busy, feedback, feedbackError, onClose, onDepartmentChange, onGrant, onManageAudiences, onRemoveFromAudience }: {
  member: Member; departmentName: (id: string | null) => string; grants: ReviewerGrant[];
  departments: OrganizationAdministration["departments"]; organizationRoles: OrganizationAdministration["roles"];
  audienceGroups: AudienceGroupRecord[]; groupsLoading: boolean; busy: boolean; feedback: string; feedbackError: string; onClose: () => void;
  onDepartmentChange: (id: string) => void; onGrant: () => void; onManageAudiences: () => void;
  onRemoveFromAudience: (group: AudienceGroupRecord, groupMembershipId: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal();
    return () => { dialog.current?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return <dialog ref={dialog} className="admin-member-drawer" aria-modal="true" aria-labelledby={titleId}
    onClick={(event) => { const bounds = dialog.current?.getBoundingClientRect();
      if (event.target === dialog.current && bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) onClose(); }}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><div className="admin-member-identity"><span className="sidebar-avatar" aria-hidden="true">{member.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><div><span className="meta-label">MEMBER DETAILS</span><h2 id={titleId}>{member.name}</h2><p>{member.email}</p></div></div>
      <button type="button" className="secondary-button" onClick={onClose} aria-label="Close member details">Close</button></header>
    <span className={`admin-status status-${memberStatusClass(member.status)}`}>{memberStatusLabel(member.status)}</span>
    {feedbackError && <p className="admin-feedback is-error" role="alert">{feedbackError}</p>}
    {feedback && <p className="admin-feedback" role="status">{feedback}</p>}
    <section><h3>Departments</h3><label className="organization-field"><span>Primary department</span><select value={member.departmentId ?? ""} disabled={busy}
      onChange={(event) => onDepartmentChange(event.target.value)}>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <small aria-live="polite">{busy ? "Saving…" : feedback === "Primary department updated." ? "Saved. Primary department updated." : "Changes save immediately."}</small>
      {(member.departmentIds ?? []).filter((id) => id !== member.departmentId).length > 0 && <p>Also in {(member.departmentIds ?? []).filter((id) => id !== member.departmentId).map(departmentName).join(", ")}</p>}</section>
    <section><h3>Organization access</h3><ul>
      <li><strong>Member</strong><small>Active organization membership</small></li>
      {member.roleIds.map((id, index) => {
        const role = organizationRoles.find(item => item.id === id);
        return role?.code === "ORG_ADMIN" ? <li key={id}><strong>Organization Admin</strong><small>Protected administration capability</small></li>
          : role?.isDefault ? null : <li key={id}><strong>{role?.name ?? member.roleNames[index] ?? "Protected capability"}</strong></li>;
      })}</ul></section>
    <section><h3>Audience groups</h3>{groupsLoading ? <p>Loading audience groups…</p> : (() => {
      const memberships = audienceGroups.flatMap(group => group.members
        .filter(groupMember => groupMember.membershipId === member.id && groupMember.status === "ACTIVE")
        .map(groupMember => ({ group, groupMember })));
      return memberships.length ? <ul>{memberships.map(({ group, groupMember }) => <li key={groupMember.id}><strong>{group.name}</strong>
        <span className="admin-member-role-assignment"><small>May read publications targeted to this group</small><button type="button" className="admin-text-danger" disabled={busy} onClick={() => onRemoveFromAudience(group, groupMember.id)}>Remove…</button></span></li>)}</ul>
        : <p>No custom audience groups.</p>;
    })()}<button type="button" className="secondary-button" onClick={onManageAudiences}>Manage audiences</button></section>
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
  const [audienceDirty, setAudienceDirty] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberAudienceGroups, setMemberAudienceGroups] = useState<AudienceGroupRecord[]>([]);
  const [memberGroupsLoading, setMemberGroupsLoading] = useState(false);
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
  const [inviteError, setInviteError] = useState("");
  const [departmentError, setDepartmentError] = useState("");
  const [grantSubmitted, setGrantSubmitted] = useState(false);
  const [lastCreatedGrantId, setLastCreatedGrantId] = useState<string | null>(null);
  const [audienceCreateSignal, setAudienceCreateSignal] = useState(0);
  const [pendingTab, setPendingTab] = useState<AdminTab | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const reportAudienceDirty = useCallback((dirty: boolean) => {
    setAudienceDirty(dirty);
    onDirtyChange?.(dirty);
  }, [onDirtyChange]);

  const reload = useCallback(async () => {
    const [administration, grants] = await Promise.all([
      loadOrganizationAdministration(platform, organizationId), listReviewerGrants(platform, organizationId),
    ]);
    setData(administration); setReviewerGrants(grants);
    setInviteDepartmentId((current) => current || administration.departments[0]?.id || "");
  }, [platform, organizationId]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadOrganizationAdministration(platform, organizationId), listReviewerGrants(platform, organizationId)])
      .then(([administration, grants]) => { if (!active) return;
        setData(administration); setReviewerGrants(grants);
        setInviteDepartmentId(administration.departments[0]?.id ?? "");
      }).catch(() => { if (active) setError("Organization administration is unavailable for this account."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [platform, organizationId]);

  useEffect(() => {
    if (!selectedMemberId) return;
    let active = true;
    setMemberAudienceGroups([]); setMemberGroupsLoading(true);
    void loadAudienceGroups(platform, organizationId).then((groups) => { if (active) setMemberAudienceGroups(groups); })
      .catch(() => { if (active) setError("Audience group memberships could not be loaded. Try reopening this member."); })
      .finally(() => { if (active) setMemberGroupsLoading(false); });
    return () => { active = false; };
  }, [platform, organizationId, selectedMemberId]);

  const perform = async (action: () => Promise<string | void>, successMessage: string) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const actionMessage = await action();
      try { await reload(); } catch { setError("Change saved, but the list could not refresh. Use Refresh to load the latest data."); }
      setMessage(actionMessage ?? successMessage);
      return true;
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : "The change could not be saved. Refresh and try again."); return false; }
    finally { setBusy(false); }
  };
  const selectTab = (next: AdminTab) => {
    if (tab === "audiences" && next !== "audiences" && audienceDirty) { setPendingTab(next); return; }
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
    event.preventDefault(); const name = departmentNameInput.trim();
    if (!name) { setDepartmentError("Enter a department name."); document.getElementById("admin-department-name")?.focus(); return; }
    if (data?.departments.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setDepartmentError("A department with this name already exists."); document.getElementById("admin-department-name")?.focus(); return;
    }
    setDepartmentError("");
    void perform(async () => { await createDepartment(platform, organizationId, name); setDepartmentNameInput(""); }, "Department created with its managed audience.");
  };
  const submitInvite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    const lowered = email.toLocaleLowerCase();
    const validation = !email ? "Enter an email address."
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "Enter a valid email, like name@company.com."
        : data?.members.some((item) => item.email.toLocaleLowerCase() === lowered) ? "This person is already a member."
          : data?.invitations.some((item) => item.email.toLocaleLowerCase() === lowered && item.status === "PENDING" && new Date(item.expiresAt).getTime() > Date.now()) ? "An invitation to this address is already pending." : "";
    if (validation) { setInviteError(validation); document.getElementById("admin-invite-email")?.focus(); return; }
    setInviteError(""); setInviteSuccess("");
    void perform(async () => {
      const result = await inviteOrganizationMember(platform, organizationId, inviteDepartmentId, email);
      setInviteEmail("");
      const success = result.deliveryMode === "local-test-no-email" ? `Invitation for ${email} saved locally. No email was sent.` : `Invitation email sent to ${email}.`;
      setInviteSuccess(success);
      return success;
    }, "Invitation email sent.");
  };
  const submitReviewerGrant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setGrantSubmitted(true);
    if (!canGrant) { document.querySelector<HTMLElement>(!reviewerId ? "#admin-reviewer-select" : !reviewDepartmentId ? "#admin-review-department" : "#admin-grant-classes")?.focus(); return; }
    void perform(async () => {
      const created = await createReviewerGrant(platform, organizationId, {
        reviewerMembershipId: reviewerId, departmentId: reviewDepartmentId,
        classifications: reviewClassifications, level: reviewLevel,
        teamTag: teamTag.trim() || null, projectTag: projectTag.trim() || null, validUntil: null,
      }); setLastCreatedGrantId(created.id); setTeamTag(""); setProjectTag(""); setGrantFilter("ACTIVE"); setGrantSubmitted(false);
    }, `Reviewer authority granted to ${data?.members.find((item) => item.id === reviewerId)?.name ?? "member"}. This grants scoped review, not reading access.`);
  };
  const confirmAction = () => {
    if (!confirmation) return;
    void perform(confirmation.run, `${confirmation.action} completed.`).then((succeeded) => { if (succeeded) setConfirmation(null); });
  };
  const tabCount: Record<AdminTab, number> = {
    members: data?.members.length ?? 0, departments: data?.departments.length ?? 0,
    audiences: memberAudienceGroups.length,
    invitations: data?.invitations.filter((item) => item.status === "PENDING" && new Date(item.expiresAt).getTime() > Date.now()).length ?? 0,
    reviewers: reviewerGrants.filter((grant) => grant.status === "ACTIVE").length,
  };
  const focusTabForm = (targetTab: AdminTab, selector: string) => {
    selectTab(targetTab);
    if (targetTab === tab || !(tab === "audiences" && audienceDirty)) window.setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), 0);
  };
  const overlappingGrant = reviewerGrants.some((grant) => grant.status === "ACTIVE" && grant.reviewerMembershipId === reviewerId
    && grant.departmentId === reviewDepartmentId && grant.classifications.some((item) => reviewClassifications.includes(item)));
  const reviewerName = data?.members.find((item) => item.id === reviewerId)?.name;
  const scopePreview = canGrant ? `${reviewerName} will review ${reviewClassifications.join(" and ")} submissions owned by ${departmentName(reviewDepartmentId)}${teamTag.trim() || projectTag.trim()
    ? `, for ${teamTag.trim() ? `team “${teamTag.trim()}”` : "all teams"} in ${projectTag.trim() ? `project “${projectTag.trim()}”` : "all projects"}.`
    : ", across all teams and projects."}` : "Choose a reviewer, a department and at least one classification to preview the scope.";

  return <main id="arden-main" className="workspace-page organization-live-admin" aria-labelledby="organization-live-admin-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / Administration / ${tabNames[tab]}`} previewLabel="SERVER MANAGED" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <WorkspacePageContent className="organization-access-content" header={<div className="admin-page-header">
      <WorkspacePageHeader className="organization-access-heading" eyebrow="ORGANIZATION / GOVERNANCE" title="Administration"
        description={`Manage who belongs to ${organizationName}, how they are grouped, and who may review knowledge.`}
        titleId="organization-live-admin-title" action={<button type="button" className="primary-button" disabled={busy || loading}
          onClick={() => {
            if (tab === "members" || tab === "invitations") focusTabForm("invitations", "#admin-invite-email");
            else if (tab === "departments") focusTabForm("departments", "#admin-department-name");
            else if (tab === "audiences") setAudienceCreateSignal((value) => value + 1);
            else focusTabForm("reviewers", "#admin-reviewer-select");
          }}>+ {tab === "departments" ? "Add department" : tab === "audiences" ? "Create audience group" : tab === "reviewers" ? "Grant authority" : "Invite member"}</button>} />
      <div className="admin-tabs" role="tablist" aria-label="Administration sections">{(Object.keys(tabNames) as AdminTab[]).map((name) => <button key={name}
        type="button" role="tab" aria-selected={tab === name} className={tab === name ? "is-active" : ""}
        onClick={() => selectTab(name)}>{tabNames[name]} <span>{tabCount[name]}</span></button>)}</div>
    </div>}>
      {loading ? <div role="status" className="admin-loading"><span className="sr-only">Loading organization data…</span>{[0, 1, 2].map((index) => <div key={index} className="admin-skeleton-row" aria-hidden="true"><span /><div><span /><span /></div></div>)}</div> : error && !data ? <div className="organization-notice is-danger" role="alert"><strong>Organization data couldn't be loaded.</strong><span>The Arden server didn't respond. Check your connection, then try again.</span><button type="button" className="secondary-button" onClick={() => { setLoading(true); setError(""); void reload().catch(() => setError("Organization data could not be refreshed.")).finally(() => setLoading(false)); }}>Try again</button></div> : data && <>
        {error && <p className="admin-feedback is-error" role="alert">{error}</p>}
        {tab === "members" && <section role="tabpanel" aria-label="Members" className="admin-section">
          <div className="admin-filters"><label className="admin-search"><span className="sr-only">Search members</span><input type="search" placeholder="Search name or email" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} /></label>
            <label><span className="sr-only">Filter membership status</span><select value={memberStatus} onChange={(event) => setMemberStatus(event.target.value)}><option value="ALL">All statuses</option><option value="ACTIVE">Active</option><option value="INVITED">Awaiting assignment</option><option value="INACTIVE">Inactive</option></select></label>
            <label><span className="sr-only">Filter department</span><select value={memberDepartment} onChange={(event) => setMemberDepartment(event.target.value)}><option value="ALL">All departments</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <span aria-live="polite">{matchingMembers.length} of {data.members.length} members</span></div>
          {matchingMembers.length ? <div className="admin-table-wrap"><table className="admin-members-table"><thead><tr><th>Member</th><th>Membership</th><th>Department</th><th>System capability</th><th>Reviewer authority</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{matchingMembers.map((member) => {
            const grants = reviewerGrants.filter((grant) => grant.reviewerMembershipId === member.id && grant.status === "ACTIVE");
            return <tr key={member.id} className={selectedMemberId === member.id ? "is-selected" : ""}><td data-label="Member"><button type="button" className="admin-member-open" onClick={() => setSelectedMemberId(member.id)} aria-label={`Open details for ${member.name}`}><span className="sidebar-avatar" aria-hidden="true">{member.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{member.name}</strong><small>{member.email}</small></span></button></td>
              <td data-label="Membership"><span className={`admin-status status-${memberStatusClass(member.status)}`}>{memberStatusLabel(member.status)}</span></td>
              <td data-label="Department">{departmentName(member.departmentId)}<small>Primary{(member.departmentIds ?? []).filter((id) => id !== member.departmentId).length ? ` · also ${(member.departmentIds ?? []).filter((id) => id !== member.departmentId).map(departmentName).join(", ")}` : ""}</small></td>
              <td data-label="System capability">{data.roles.some(role => role.code === "ORG_ADMIN" && member.roleIds.includes(role.id)) ? "Organization Admin" : "Member"}</td>
              <td data-label="Reviewer authority">{grants.length ? <>{grants.map((grant) => departmentName(grant.departmentId)).join(", ")}<small>Up to {grants.some((grant) => grant.classifications.includes("RESTRICTED")) ? "Restricted" : grants.some((grant) => grant.classifications.includes("CONFIDENTIAL")) ? "Confidential" : "Internal"}</small></> : "None"}</td>
              <td><button type="button" className="secondary-button" onClick={() => setSelectedMemberId(member.id)} aria-label={`Manage ${member.name}`}>Manage</button></td></tr>;
          })}</tbody></table></div> : <div className="organization-empty-state"><h3>{data.members.length ? "No matching members" : "No members yet"}</h3><p>{data.members.length ? "Try a different search or clear the filters." : "Invite a member to start building your organization."}</p><button type="button" className="secondary-button" onClick={() => { setMemberQuery(""); setMemberStatus("ALL"); setMemberDepartment("ALL"); }}>{data.members.length ? "Clear filters" : "Reset"}</button></div>}
        </section>}
        {tab === "departments" && <section role="tabpanel" aria-label="Departments" className="admin-section admin-narrow">
          <div className="admin-section-heading"><div><h2>Departments</h2><p>Every department has a managed audience containing its active members.</p></div></div>
          <form className="admin-inline-form" noValidate onSubmit={submitDepartment}><label className="organization-field"><span>New department *</span><input id="admin-department-name" maxLength={80} placeholder="Customer Success" value={departmentNameInput} disabled={busy} aria-invalid={Boolean(departmentError)} aria-describedby="admin-department-help" onChange={(event) => { setDepartmentNameInput(event.target.value); setDepartmentError(""); }} /><small id="admin-department-help" className={departmentError ? "field-error" : ""}>{departmentError || "Arden also creates a managed department audience."}</small></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create department"}</button></form>
          {data.departments.length ? <div className="admin-table-wrap"><table className="admin-departments-table"><thead><tr><th>Department</th><th>Managed audience</th><th>Members</th></tr></thead><tbody>{data.departments.map((department) => <tr key={department.id}><td>{department.name}</td><td>{department.name} members</td><td>{data.members.filter((member) => (member.departmentIds ?? [member.departmentId]).includes(department.id)).length} members · {data.members.filter((member) => member.departmentId === department.id).length} primary</td></tr>)}</tbody></table></div> : <div className="organization-empty-state"><h3>No departments yet</h3><p>Create one before inviting members. Every member needs a primary department.</p></div>}
        </section>}
        {tab === "audiences" && <div role="tabpanel" aria-label="Audiences" className="admin-section admin-roles"><ServerAudienceGroupPanel platform={platform} organizationId={organizationId} members={data.members}
          onDirtyChange={reportAudienceDirty} onGroupsChanged={() => void reload().catch(() => setError("Audiences changed, but organization data could not refresh."))} createSignal={audienceCreateSignal} /></div>}
        {tab === "invitations" && <section role="tabpanel" aria-label="Invitations" className="admin-section">
          <div className="admin-section-heading"><div><h2>Invitations</h2><p>Invite someone by email. They appear as a member after accepting the invitation.</p></div></div>
          {data.departments.length ? <form className="admin-inline-form" noValidate onSubmit={submitInvite}>
            <label className="organization-field"><span>Work email *</span><input id="admin-invite-email" type="email" maxLength={320} placeholder="name@company.com" value={inviteEmail} disabled={busy} aria-invalid={Boolean(inviteError)} aria-describedby="admin-invite-help" onChange={(event) => { setInviteEmail(event.target.value); setInviteError(""); setInviteSuccess(""); }} /><small id="admin-invite-help" className={inviteError ? "field-error" : ""}>{inviteError || `They’ll receive a link to join ${organizationName}.`}</small></label>
            <label className="organization-field"><span>Primary department <small>Required</small></span><select required value={inviteDepartmentId} disabled={busy} onChange={(event) => setInviteDepartmentId(event.target.value)}>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button></form>
            : <div className="organization-notice"><strong>Create a department first</strong><span>Invitations need a primary department.</span><button type="button" className="secondary-button" onClick={() => selectTab("departments")}>Go to Departments</button></div>}
          {inviteSuccess && <p className="admin-inline-success" role="status">✓ {inviteSuccess}</p>}
          {data.invitations.length ? <ul className="admin-simple-list admin-invitations">{[...data.invitations].sort((left, right) => {
            const rank = (item: typeof left) => item.status === "PENDING" ? new Date(item.expiresAt).getTime() > Date.now() ? 0 : 1 : item.status === "EXPIRED" ? 1 : item.status === "ACCEPTED" ? 2 : 3;
            return rank(left) - rank(right);
          }).map((invitation) => {
            const expired = invitation.status === "PENDING" && new Date(invitation.expiresAt).getTime() < Date.now();
            return <li key={invitation.id}><div><strong>{invitation.email}</strong><span>{departmentName(invitation.departmentId)} · <span className={`admin-status status-${expired ? "inactive" : invitation.status === "PENDING" ? "info" : invitation.status === "ACCEPTED" ? "active" : "inactive"}`}>{expired ? "Expired" : invitation.status[0] + invitation.status.slice(1).toLowerCase()}</span> · {invitation.status === "PENDING" || invitation.status === "EXPIRED" ? `${expired || invitation.status === "EXPIRED" ? "Expired" : "Expires"} ${new Date(invitation.expiresAt).toLocaleDateString()}` : "—"}</span></div>
            {invitation.status === "PENDING" && !expired && <div className="organization-row-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
              const result = await resendOrganizationInvitation(platform, organizationId, invitation.id);
              return result.deliveryMode === "local-test-no-email" ? `Invitation for ${invitation.email} updated locally. No email was sent.` : `Invitation resent to ${invitation.email}.`;
            }, `Invitation resent to ${invitation.email}.`)}>Resend</button><button type="button" className="admin-text-danger" disabled={busy} onClick={() => setConfirmation({
              title: `Revoke invitation to ${invitation.email}?`, description: "This invitation link will no longer work.", action: "Revoke invitation",
              run: () => revokeOrganizationInvitation(platform, organizationId, invitation.id),
            })}>Revoke…</button></div>}</li>;
          })}</ul> : <div className="organization-empty-state"><h3>No invitations yet</h3><p>Send an invitation to add your first member.</p></div>}
        </section>}
        {tab === "reviewers" && <section role="tabpanel" aria-label="Reviewer authority" className="admin-section">
          <div className="admin-scope-explainer"><div><strong>Department</strong><span>The reviewer receives submissions owned by this department.</span></div><div><strong>Classification</strong><span>Restricted requires Specialist or Senior level.</span></div><div><strong>Team and project (optional)</strong><span>Narrow the grant within the department.</span></div></div>
          <p className="admin-helper">Authority covers review only. It does not grant reading access, and a reviewer cannot decide their own submission.</p>
          <div className="admin-reviewer-layout"><div><div className="admin-section-heading"><h2>Granted authority</h2><div className="admin-segmented"><button type="button" aria-pressed={grantFilter === "ACTIVE"} className={grantFilter === "ACTIVE" ? "is-active" : ""} onClick={() => setGrantFilter("ACTIVE")}>Active {reviewerGrants.filter((item) => item.status === "ACTIVE").length}</button><button type="button" aria-pressed={grantFilter === "INACTIVE"} className={grantFilter === "INACTIVE" ? "is-active" : ""} onClick={() => setGrantFilter("INACTIVE")}>Inactive {reviewerGrants.filter((item) => item.status === "INACTIVE").length}</button></div></div>
            {reviewerGrants.filter((grant) => grant.status === grantFilter).length ? <ul className="admin-grant-list">{reviewerGrants.filter((grant) => grant.status === grantFilter).map((grant) => <li key={grant.id} className={lastCreatedGrantId === grant.id ? "is-new" : ""}><div><strong>{data.members.find((member) => member.id === grant.reviewerMembershipId)?.name ?? "Member"} {lastCreatedGrantId === grant.id && <span className="admin-new-tag">New</span>}</strong><small>{data.members.find((member) => member.id === grant.reviewerMembershipId)?.email}</small></div><div><strong>{departmentName(grant.departmentId)}</strong><small>{grant.teamTag ? `Team: ${grant.teamTag}` : "All teams"} · {grant.projectTag ? `Project: ${grant.projectTag}` : "all projects"}</small></div><div className="admin-class-tags">{grant.classifications.map((item) => <span key={item}>{item}</span>)}</div><div><strong>{grant.level === "STANDARD" ? "Standard" : grant.level === "SPECIALIST" ? "Specialist" : "Senior"}</strong><small>Since {new Date(grant.validFrom).toLocaleDateString()}</small></div>{grant.status === "ACTIVE" && <button type="button" className="admin-text-danger" disabled={busy} onClick={() => setConfirmation({
                title: `Deactivate ${data.members.find((member) => member.id === grant.reviewerMembershipId)?.name ?? "this member"}'s reviewer authority?`, description: "This grant will stop authorizing review decisions. Existing decisions remain recorded.", action: "Deactivate authority", run: () => deactivateReviewerGrant(platform, organizationId, grant.id),
              })}>Deactivate…</button>}</li>)}</ul> : <div className="organization-empty-state"><h3>No {grantFilter.toLowerCase()} reviewer grants</h3><p>Use the form to grant scoped review authority to an active member.</p></div>}</div>
            <form id="admin-grant-form" className="admin-grant-form organization-surface" onSubmit={submitReviewerGrant}><div className="admin-section-heading"><h2>Grant reviewer authority</h2><small>* Required</small></div>
              <label className="organization-field"><span>Reviewer *</span><select id="admin-reviewer-select" disabled={busy} value={reviewerId} aria-invalid={grantSubmitted && !reviewerId} aria-describedby="admin-reviewer-help" onChange={(event) => setReviewerId(event.target.value)}><option value="">Choose an active member</option>{data.members.filter((member) => member.status === "ACTIVE").map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select><small id="admin-reviewer-help" className={grantSubmitted && !reviewerId ? "field-error" : ""}>{grantSubmitted && !reviewerId ? "Choose a reviewer." : "Only active members can review."}</small></label>
              <label className="organization-field"><span>Department *</span><select id="admin-review-department" disabled={busy} value={reviewDepartmentId} aria-invalid={grantSubmitted && !reviewDepartmentId} aria-describedby="admin-review-department-help" onChange={(event) => setReviewDepartmentId(event.target.value)}><option value="">Choose department</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small id="admin-review-department-help" className={grantSubmitted && !reviewDepartmentId ? "field-error" : ""}>{grantSubmitted && !reviewDepartmentId ? "Choose a department." : "Submissions owned by this department."}</small></label>
              <fieldset id="admin-grant-classes" tabIndex={-1} className="organization-reviewer-classes" aria-invalid={grantSubmitted && !reviewClassifications.length}><legend>Classifications *</legend>{classifications.map((item) => <label key={item} className={reviewClassifications.includes(item) ? "is-selected" : ""}><input type="checkbox" disabled={busy} checked={reviewClassifications.includes(item)} onChange={(event) => setReviewClassifications((current) => event.target.checked ? [...current, item] : current.filter((value) => value !== item))} /><span><strong>{item}</strong><small>{item === "INTERNAL" ? "Everyday internal knowledge." : item === "CONFIDENTIAL" ? "Limited to named audiences." : "Highest sensitivity. Needs Specialist or Senior level."}</small></span></label>)}{grantSubmitted && !reviewClassifications.length && <small className="field-error">Select at least one classification.</small>}</fieldset>
              <fieldset className="admin-level-options"><legend>Grant level *</legend>{(["STANDARD", "SPECIALIST", "SENIOR"] as const).map((level) => <label key={level} className={reviewLevel === level ? "is-selected" : ""}><input type="radio" name="review-level" checked={reviewLevel === level} disabled={busy} onChange={() => setReviewLevel(level)} /><strong>{level === "STANDARD" ? "Standard" : level === "SPECIALIST" ? "Specialist" : "Senior"}</strong><small>{level === "STANDARD" ? "Internal and Confidential" : "Adds Restricted"}</small></label>)}</fieldset>
              <label className="organization-field"><span>Team tag <small>Optional</small></span><input maxLength={100} disabled={busy} value={teamTag} onChange={(event) => setTeamTag(event.target.value)} /></label>
              <label className="organization-field"><span>Project tag <small>Optional</small></span><input maxLength={100} disabled={busy} value={projectTag} onChange={(event) => setProjectTag(event.target.value)} /></label>
              <p className="admin-scope-preview" aria-live="polite">{scopePreview}</p>
              {overlappingGrant && <p className="admin-feedback is-warning">This reviewer already has an active grant overlapping this department and classification.</p>}
              {reviewClassifications.includes("RESTRICTED") && reviewLevel === "STANDARD" && <p role="alert" className="admin-feedback is-error">Choose Specialist or Senior for Restricted knowledge.</p>}
              <div className="admin-grant-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Granting…" : "Grant authority"}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { setReviewerId(""); setReviewDepartmentId(""); setReviewClassifications([]); setReviewLevel("STANDARD"); setTeamTag(""); setProjectTag(""); setGrantSubmitted(false); }}>Reset</button></div>
            </form></div>
        </section>}
      </>}
    </WorkspacePageContent>
    {selectedMember && <MemberDrawer member={selectedMember} departmentName={departmentName} departments={data?.departments ?? []} organizationRoles={data?.roles ?? []}
      audienceGroups={memberAudienceGroups} groupsLoading={memberGroupsLoading} feedback={message} feedbackError={error}
      grants={reviewerGrants.filter((grant) => grant.reviewerMembershipId === selectedMember.id && grant.status === "ACTIVE")} busy={busy}
      onClose={() => setSelectedMemberId(null)} onDepartmentChange={(id) => void perform(() => changePrimaryDepartment(platform, organizationId, selectedMember.id, id), "Primary department updated.")}
      onManageAudiences={() => { setSelectedMemberId(null); selectTab("audiences"); }}
      onRemoveFromAudience={(group, groupMembershipId) => setConfirmation({
        title: `Remove ${selectedMember.name} from ${group.name}?`, description: "This member will lose access granted by this audience group on their next request.", action: "Remove member",
        run: async () => { const updated = await removeAudienceGroupMember(platform, organizationId, group.id, groupMembershipId); setMemberAudienceGroups((current) => current.map((item) => item.id === updated.id ? updated : item)); },
      })}
      onGrant={() => { setReviewerId(selectedMember.id); setReviewDepartmentId(selectedMember.departmentId ?? ""); setSelectedMemberId(null); focusTabForm("reviewers", "#admin-reviewer-select"); }} />}
    {confirmation && <ConfirmAction confirmation={confirmation} busy={busy} error={error} onClose={() => setConfirmation(null)} onConfirm={confirmAction} />}
    {pendingTab && <KnowledgeDialog confirmation title="Discard unsaved audience changes?" onClose={() => setPendingTab(null)}>
      <p>Changes to this audience group have not been saved. Discard them and open {tabNames[pendingTab]}?</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setPendingTab(null)}>Keep editing</button>
        <button type="button" className="admin-danger-button" onClick={() => { setTab(pendingTab); setPendingTab(null); }}>Discard changes</button></div>
    </KnowledgeDialog>}
    <ActionToast message={message} onDismiss={() => setMessage("")} />
  </main>;
}
