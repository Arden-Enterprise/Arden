import { useCallback, useEffect, useState, type FormEvent } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";
import { ActionToast } from "../shared/ActionToast";
import { IslandConfirm } from "../shared/IslandConfirm";
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
import { Icon } from "../shared/Icon";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import { countInvitations, invitationFilters, invitationState, visibleInvitations, type InvitationFilter, type InvitationState } from "./invitationStatus";
import { DepartmentDetailIsland, grantLevelLabel, grantValidity, MemberDetailIsland, memberInitials, memberStatus as describeMemberStatus } from "./AdminDetailIslands";

type Props = { platform: Platform; organizationId: string; organizationName: string; onDirtyChange?: (dirty: boolean) => void } & ContextControlProps;
type AdminTab = "members" | "departments" | "audiences" | "invitations" | "reviewers";
type Confirmation = { title: string; description: string; action: string; run: () => Promise<void> };
const classifications = ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
const tabNames: Record<AdminTab, string> = {
  members: "Members", departments: "Departments", audiences: "Audiences", invitations: "Invitations", reviewers: "Reviewer access",
};
const tabDescriptions: Record<AdminTab, (organizationName: string) => string> = {
  // Kept to one line so the tab bar below never moves between tabs.
  members: (name) => `People in ${name}, their department and access.`,
  departments: () => "Each member has one primary department with its own managed audience.",
  audiences: () => "Who can read a publication. Audiences grant no other rights.",
  invitations: () => "People join after they sign in with the invited email and accept.",
  reviewers: () => "Scoped review per department and classification. Final approval publishes.",
};
const invitationTone: Record<InvitationState, string> = { PENDING: "tone-info", ACCEPTED: "tone-success", EXPIRED: "", REVOKED: "" };
const classificationTone: Record<(typeof classifications)[number], string> = { INTERNAL: "tone-strong", CONFIDENTIAL: "tone-info", RESTRICTED: "tone-danger" };
function titleCase(value: string): string { return value[0] + value.slice(1).toLowerCase(); }

export function OrganizationAdminPage({ platform, organizationId, organizationName, contextOpen, onToggleContext, onDirtyChange }: Props) {
  const [data, setData] = useState<OrganizationAdministration | null>(null);
  const [reviewerGrants, setReviewerGrants] = useState<ReviewerGrant[]>([]);
  const [tab, setTab] = useState<AdminTab>("members");
  const [audienceDirty, setAudienceDirty] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(null);
  const [invitationFilter, setInvitationFilter] = useState<InvitationFilter>("ALL");
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

  const isOrgAdmin = (member: { roleIds: string[] }) => Boolean(data?.roles.some((role) => role.code === "ORG_ADMIN" && member.roleIds.includes(role.id)));
  const now = Date.now();
  const invitationCounts = countInvitations(data?.invitations ?? [], now);
  const shownInvitations = visibleInvitations(data?.invitations ?? [], invitationFilter, now);
  const selectedDepartment = data?.departments.find((item) => item.id === selectedDepartmentId);
  const headerAction = tab === "members" ? <button type="button" className="primary-button" disabled={busy || loading} onClick={() => focusTabForm("invitations", "#admin-invite-email")}><Icon name="plus" size={14} />Invite member</button>
    : tab === "departments" ? <button type="button" className="primary-button" disabled={busy || loading} onClick={() => focusTabForm("departments", "#admin-department-name")}><Icon name="plus" size={14} />New department</button>
      : tab === "audiences" ? <button type="button" className="primary-button" disabled={busy || loading} onClick={() => setAudienceCreateSignal((value) => value + 1)}><Icon name="plus" size={14} />New audience group</button>
        : undefined;

  return <main id="arden-main" className="workspace-page organization-live-admin" aria-labelledby="organization-live-admin-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organizationName} / Administration / ${tabNames[tab]}`} previewLabel="SERVER MANAGED" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <WorkspacePageContent className="organization-access-content" header={<div className="admin-page-header">
      <WorkspacePageHeader className="organization-access-heading" eyebrow="MANAGE ORGANIZATION" title={tabNames[tab]}
        description={tabDescriptions[tab](organizationName)} titleId="organization-live-admin-title" action={headerAction} />
      <div className="island-seg admin-tabs" role="tablist" aria-label="Administration sections">{(Object.keys(tabNames) as AdminTab[]).map((name) => <button key={name}
        type="button" role="tab" aria-selected={tab === name} onClick={() => selectTab(name)}>{tabNames[name]}
        {name !== "audiences" && <span className="island-badge">{tabCount[name]}</span>}</button>)}</div>
    </div>}>
      {loading ? <div role="status" className="admin-loading island"><span className="sr-only">Loading organization data…</span>{[0, 1, 2].map((index) => <div key={index} className="admin-skeleton-row" aria-hidden="true"><span /><div><span /><span /></div></div>)}</div> : error && !data ? <div className="organization-notice is-danger" role="alert"><strong>Organization data couldn't be loaded.</strong><span>The Arden server didn't respond. Check your connection, then try again.</span><button type="button" className="secondary-button" onClick={() => { setLoading(true); setError(""); void reload().catch(() => setError("Organization data could not be refreshed.")).finally(() => setLoading(false)); }}>Try again</button></div> : data && <>
        {error && !selectedMember && <p className="admin-feedback is-error" role="alert">{error}</p>}
        {tab === "members" && <div role="tabpanel" aria-label="Members" className="admin-tabpanel">
          <div className="admin-filters">
            <label className="workspace-search admin-search"><Icon name="search" size={15} /><span className="sr-only">Search members</span><input type="search" placeholder="Filter by name or email" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} /></label>
            <label className="island-filter"><span className="sr-only">Filter department</span><select value={memberDepartment} onChange={(event) => setMemberDepartment(event.target.value)}><option value="ALL">Department: All</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="island-filter"><span className="sr-only">Filter membership status</span><select value={memberStatus} onChange={(event) => setMemberStatus(event.target.value)}><option value="ALL">Status: Any</option><option value="ACTIVE">Active</option><option value="INVITED">Awaiting assignment</option><option value="INACTIVE">Inactive</option></select></label>
          </div>
          <div className="island-split">
          <div className="island-main">
            {matchingMembers.length ? <IslandTable label="Members" minWidth={700} columns="minmax(200px, 1.7fr) minmax(110px, .9fr) minmax(180px, 1.2fr) minmax(120px, .8fr) 84px"
              headers={["MEMBER", "DEPARTMENT", "ACCESS", "STATUS", <span className="sr-only">Actions</span>]}
              footer={<span aria-live="polite">Showing {matchingMembers.length} of {data.members.length} members</span>}>
              {matchingMembers.map((member) => {
                const grants = reviewerGrants.filter((grant) => grant.reviewerMembershipId === member.id && grant.status === "ACTIVE");
                const status = describeMemberStatus(member.status);
                const otherDepartments = (member.departmentIds ?? []).filter((id) => id !== member.departmentId);
                return <IslandRow key={member.id} selected={selectedMemberId === member.id}>
                  <IslandCell className="island-row-cell is-name"><button type="button" className="island-row-name" onClick={() => setSelectedMemberId(member.id)} aria-label={`Open details for ${member.name}`}>
                    <span className="island-avatar" aria-hidden="true">{memberInitials(member.name)}</span><span><strong>{member.name}</strong><small>{member.email}</small></span></button></IslandCell>
                  <IslandCell><span>{departmentName(member.departmentId)}</span>{otherDepartments.length > 0 && <small>also {otherDepartments.map(departmentName).join(", ")}</small>}</IslandCell>
                  <IslandCell className="island-row-cell is-chips"><span className="island-chip tone-strong">{isOrgAdmin(member) ? "Org Admin" : "Member"}</span>
                    {grants.length > 0 && <span className="island-chip" title={`Reviewer grant: ${grants.map((grant) => `${departmentName(grant.departmentId)} · ${grantLevelLabel(grant.level)}`).join(", ")}`}><Icon name="shield" size={12} />Reviewer</span>}</IslandCell>
                  <IslandCell><span className={`island-chip has-dot ${status.tone}`}>{status.label}</span></IslandCell>
                  <IslandCell className="island-row-actions"><button type="button" className="secondary-button" onClick={() => setSelectedMemberId(member.id)} aria-label={`Manage ${member.name}`}>Manage</button></IslandCell>
                </IslandRow>;
              })}
            </IslandTable> : <div className="island island-empty"><h3>{data.members.length ? "No matching members" : "No members yet"}</h3><p>{data.members.length ? "Try a different search or clear the filters." : "Invite a member to start building your organization."}</p><button type="button" className="secondary-button" onClick={() => { setMemberQuery(""); setMemberStatus("ALL"); setMemberDepartment("ALL"); }}>{data.members.length ? "Clear filters" : "Reset"}</button></div>}
          </div>
          {selectedMember && <MemberDetailIsland key={selectedMember.id} member={selectedMember} organizationName={organizationName} isAdmin={isOrgAdmin(selectedMember)}
            departmentName={departmentName} departments={data.departments} audienceGroups={memberAudienceGroups} groupsLoading={memberGroupsLoading}
            feedback={message} feedbackError={error} busy={busy}
            grants={reviewerGrants.filter((grant) => grant.reviewerMembershipId === selectedMember.id && grant.status === "ACTIVE")}
            onClose={() => setSelectedMemberId(null)} onDepartmentChange={(id) => void perform(() => changePrimaryDepartment(platform, organizationId, selectedMember.id, id), "Primary department updated.")}
            onManageAudiences={() => { setSelectedMemberId(null); selectTab("audiences"); }}
            onRemoveFromAudience={(group, groupMembershipId) => setConfirmation({
              title: `Remove ${selectedMember.name} from ${group.name}?`, description: "This member will lose access granted by this audience group on their next request.", action: "Remove member",
              run: async () => { const updated = await removeAudienceGroupMember(platform, organizationId, group.id, groupMembershipId); setMemberAudienceGroups((current) => current.map((item) => item.id === updated.id ? updated : item)); },
            })}
            onGrant={() => { setReviewerId(selectedMember.id); setReviewDepartmentId(selectedMember.departmentId ?? ""); setSelectedMemberId(null); focusTabForm("reviewers", "#admin-reviewer-select"); }} />}
          </div>
        </div>}
        {tab === "departments" && <div role="tabpanel" aria-label="Departments" className="island-split">
          <div className="island-main">
            <form className="island admin-inline-form" noValidate onSubmit={submitDepartment}><label className="organization-field"><span>New department</span><input id="admin-department-name" maxLength={80} placeholder="Customer Success" value={departmentNameInput} disabled={busy} aria-invalid={Boolean(departmentError)} aria-describedby="admin-department-help" onChange={(event) => { setDepartmentNameInput(event.target.value); setDepartmentError(""); }} /><small id="admin-department-help" className={departmentError ? "field-error" : ""}>{departmentError || "Arden also creates its managed “Everyone in …” audience."}</small></label><button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Create department"}</button></form>
            {data.departments.length ? <IslandTable label="Departments" minWidth={560} columns="minmax(220px, 1.6fr) 120px 120px 110px"
              headers={["DEPARTMENT", "MEMBERS", "PRIMARY", "REVIEWERS"]}>
              {data.departments.map((department) => <IslandRow key={department.id} selected={selectedDepartmentId === department.id}>
                <IslandCell className="island-row-cell is-name"><button type="button" className="island-row-name" onClick={() => setSelectedDepartmentId(department.id)} aria-label={`Open ${department.name}`}>
                  <span><strong>{department.name}</strong><small>Everyone in {department.name}</small></span></button></IslandCell>
                <IslandCell className="island-row-cell is-number">{data.members.filter((member) => (member.departmentIds ?? [member.departmentId]).includes(department.id)).length}</IslandCell>
                <IslandCell className="island-row-cell is-number">{data.members.filter((member) => member.departmentId === department.id).length}</IslandCell>
                <IslandCell className="island-row-cell is-number">{new Set(reviewerGrants.filter((grant) => grant.status === "ACTIVE" && grant.departmentId === department.id).map((grant) => grant.reviewerMembershipId)).size}</IslandCell>
              </IslandRow>)}
            </IslandTable> : <div className="island island-empty"><h3>No departments yet</h3><p>Create one before inviting members. Every member needs a primary department.</p></div>}
          </div>
          {selectedDepartment && <DepartmentDetailIsland key={selectedDepartment.id} department={selectedDepartment} members={data.members} grants={reviewerGrants}
            onClose={() => setSelectedDepartmentId(null)} onViewMembers={() => { setMemberDepartment(selectedDepartment.id); setSelectedDepartmentId(null); selectTab("members"); }} />}
        </div>}
        {tab === "audiences" && <div role="tabpanel" aria-label="Audiences" className="admin-roles"><ServerAudienceGroupPanel platform={platform} organizationId={organizationId} organizationName={organizationName}
          members={data.members} departments={data.departments}
          onDirtyChange={reportAudienceDirty} onGroupsChanged={() => void reload().catch(() => setError("Audiences changed, but organization data could not refresh."))} createSignal={audienceCreateSignal} /></div>}
        {tab === "invitations" && <div role="tabpanel" aria-label="Invitations" className="admin-tabpanel">
          <div className="island-seg is-filter" role="group" aria-label="Filter by status">{invitationFilters.map((filter) => <button key={filter} type="button"
            aria-pressed={invitationFilter === filter} onClick={() => setInvitationFilter(filter)}>{filter === "ALL" ? "All" : titleCase(filter)}<span className="island-badge">{invitationCounts[filter]}</span></button>)}</div>
          <div className="island-split">
          <div className="island-main">
            {shownInvitations.length ? <IslandTable label="Invitations" minWidth={680} columns="minmax(200px, 1.7fr) minmax(96px, .8fr) 108px 128px 104px"
              headers={["EMAIL", "DEPARTMENT", "EXPIRES", "STATUS", <span className="sr-only">Actions</span>]}>
              {shownInvitations.map((invitation) => {
                const state = invitationState(invitation, now);
                return <IslandRow key={invitation.id}>
                  <IslandCell className="island-row-cell is-name"><strong className="island-row-title" title={invitation.email}>{invitation.email}</strong><small>Member</small></IslandCell>
                  <IslandCell>{departmentName(invitation.departmentId)}</IslandCell>
                  <IslandCell className="island-row-cell is-number">{state === "PENDING" || state === "EXPIRED" ? new Date(invitation.expiresAt).toLocaleDateString() : "—"}</IslandCell>
                  <IslandCell><span className={`island-chip has-dot ${invitationTone[state]}`}>{titleCase(state)}</span></IslandCell>
                  <IslandCell className="island-row-actions">{state === "PENDING" ? <><button type="button" className="secondary-button" disabled={busy} onClick={() => void perform(async () => {
                    const result = await resendOrganizationInvitation(platform, organizationId, invitation.id);
                    return result.deliveryMode === "local-test-no-email" ? `Invitation for ${invitation.email} updated locally. No email was sent.` : `Invitation resent to ${invitation.email}.`;
                  }, `Invitation resent to ${invitation.email}.`)}>Resend</button><button type="button" className="island-icon-button is-danger" disabled={busy} title="Revoke"
                    aria-label={`Revoke invitation for ${invitation.email}`} onClick={() => setConfirmation({
                    title: `Revoke invitation to ${invitation.email}?`, description: "This invitation link will no longer work.", action: "Revoke",
                    run: () => revokeOrganizationInvitation(platform, organizationId, invitation.id),
                  })}><Icon name="close" size={14} /></button></> : <span className="island-action-slot" aria-hidden="true" />}</IslandCell>
                </IslandRow>;
              })}
            </IslandTable> : <div className="island island-empty"><h3>{data.invitations.length ? "No invitations with this status" : "No invitations yet"}</h3><p>{data.invitations.length ? "Choose another status." : "Send an invitation to add your first member."}</p></div>}
          </div>
          <aside className="island island-panel island-side admin-form-island" aria-labelledby="admin-invite-title">
            <h2 id="admin-invite-title">Invite people</h2>
            {data.departments.length ? <form className="admin-side-form" noValidate onSubmit={submitInvite}>
              <label className="organization-field"><span>Work email</span><input id="admin-invite-email" type="email" maxLength={320} placeholder="name@company.com" value={inviteEmail} disabled={busy} aria-invalid={Boolean(inviteError)} aria-describedby="admin-invite-help" onChange={(event) => { setInviteEmail(event.target.value); setInviteError(""); setInviteSuccess(""); }} /><small id="admin-invite-help" className={inviteError ? "field-error" : ""}>{inviteError || `They’ll receive a link to join ${organizationName}.`}</small></label>
              <label className="organization-field"><span>Primary department</span><select required value={inviteDepartmentId} disabled={busy} onChange={(event) => setInviteDepartmentId(event.target.value)}>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</button>
              {inviteSuccess && <p className="admin-inline-success" role="status">{inviteSuccess}</p>}
            </form> : <div className="island-box"><strong>Create a department first</strong><p>Invitations need a primary department.</p><button type="button" className="secondary-button" onClick={() => selectTab("departments")}>Go to Departments</button></div>}
            <p className="island-meta">Each link is single-use and expires. New members join as Members; access changes happen after they accept.</p>
          </aside>
          </div>
        </div>}
        {tab === "reviewers" && <div role="tabpanel" aria-label="Reviewer access" className="admin-tabpanel">
          <div className="island-seg is-filter" role="group" aria-label="Filter grants">{(["ACTIVE", "INACTIVE"] as const).map((filter) => <button key={filter} type="button"
            aria-pressed={grantFilter === filter} onClick={() => setGrantFilter(filter)}>{titleCase(filter)}<span className="island-badge">{reviewerGrants.filter((item) => item.status === filter).length}</span></button>)}</div>
          <div className="island-split">
          <div className="island-main">
            {reviewerGrants.filter((grant) => grant.status === grantFilter).length ? <IslandTable label="Reviewer grants" minWidth={680} columns="minmax(180px, 1.4fr) minmax(96px, .8fr) minmax(180px, 1.3fr) 124px 84px"
              headers={["REVIEWER", "DEPARTMENT", "CLASSIFICATIONS", "STATUS", <span className="sr-only">Actions</span>]}>
              {reviewerGrants.filter((grant) => grant.status === grantFilter).map((grant) => {
                const reviewer = data.members.find((member) => member.id === grant.reviewerMembershipId);
                const tags = grant.teamTag || grant.projectTag ? [grant.teamTag && `Team: ${grant.teamTag}`, grant.projectTag && `Project: ${grant.projectTag}`].filter(Boolean).join(" · ") : "All teams and projects";
                return <IslandRow key={grant.id} selected={lastCreatedGrantId === grant.id} className={grant.status === "INACTIVE" ? "is-muted" : ""}>
                  <IslandCell className="island-row-cell is-name"><span className="island-row-name is-static"><span className="island-avatar is-small" aria-hidden="true">{memberInitials(reviewer?.name ?? "Member")}</span>
                    <span><strong>{reviewer?.name ?? "Member"}{lastCreatedGrantId === grant.id && <span className="admin-new-tag"> New</span>}</strong><small title={tags}>{grantLevelLabel(grant.level)} · {tags}</small></span></span></IslandCell>
                  <IslandCell>{departmentName(grant.departmentId)}</IslandCell>
                  <IslandCell className="island-row-cell is-chips">{grant.classifications.map((item) => <span key={item} className={`island-chip ${classificationTone[item]}`}>{item === "RESTRICTED" && <Icon name="lock" size={11} />}{item}</span>)}</IslandCell>
                  <IslandCell className="island-row-cell is-status"><span className={`island-chip has-dot${grant.status === "ACTIVE" ? " tone-success" : ""}`}>{titleCase(grant.status)}</span><small>{grantValidity(grant)}</small></IslandCell>
                  <IslandCell className="island-row-actions">{grant.status === "ACTIVE" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => setConfirmation({
                    title: `Deactivate ${reviewer?.name ?? "this member"}'s reviewer authority?`, description: "This grant will stop authorizing review decisions. Existing decisions remain recorded.", action: "Revoke", run: () => deactivateReviewerGrant(platform, organizationId, grant.id),
                  })}>Revoke</button> : <span className="island-action-slot" aria-hidden="true" />}</IslandCell>
                </IslandRow>;
              })}
            </IslandTable> : <div className="island island-empty"><h3>No {grantFilter.toLowerCase()} reviewer grants</h3><p>Use New grant to give an active member scoped review authority.</p></div>}
            <p className="island-note"><Icon name="shield" size={16} /><span>Reviewers see only the exact submitted snapshot. Approving does not make them a reader of the published version, and no one can approve their own submission.</span></p>
          </div>
          <form id="admin-grant-form" className="island island-panel island-side admin-form-island admin-grant-form" aria-labelledby="admin-grant-title" onSubmit={submitReviewerGrant}>
            <h2 id="admin-grant-title">New grant</h2>
            <label className="organization-field"><span>Reviewer</span><select id="admin-reviewer-select" disabled={busy} value={reviewerId} aria-invalid={grantSubmitted && !reviewerId} aria-describedby="admin-reviewer-help" onChange={(event) => setReviewerId(event.target.value)}><option value="">Choose an active member</option>{data.members.filter((member) => member.status === "ACTIVE").map((member) => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select><small id="admin-reviewer-help" className={grantSubmitted && !reviewerId ? "field-error" : ""}>{grantSubmitted && !reviewerId ? "Choose a reviewer." : "Only active members can review."}</small></label>
            <label className="organization-field"><span>Department</span><select id="admin-review-department" disabled={busy} value={reviewDepartmentId} aria-invalid={grantSubmitted && !reviewDepartmentId} aria-describedby="admin-review-department-help" onChange={(event) => setReviewDepartmentId(event.target.value)}><option value="">Choose department</option>{data.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><small id="admin-review-department-help" className={grantSubmitted && !reviewDepartmentId ? "field-error" : ""}>{grantSubmitted && !reviewDepartmentId ? "Choose a department." : "Submissions owned by this department."}</small></label>
            <label className="organization-field"><span>Level</span><select disabled={busy} value={reviewLevel} onChange={(event) => { const level = event.target.value; if (level !== "STANDARD" && level !== "SPECIALIST" && level !== "SENIOR") return;
              setReviewLevel(level); if (level === "STANDARD") setReviewClassifications((current) => current.filter((item) => item !== "RESTRICTED")); }}>
              {(["STANDARD", "SPECIALIST", "SENIOR"] as const).map((level) => <option key={level} value={level}>{grantLevelLabel(level)}</option>)}</select><small>Standard covers Internal and Confidential. Specialist and Senior add Restricted.</small></label>
            <fieldset id="admin-grant-classes" tabIndex={-1} className="admin-grant-classes" aria-invalid={grantSubmitted && !reviewClassifications.length}><legend>Classifications</legend>{classifications.map((item) => <label key={item}><input type="checkbox" disabled={busy || (item === "RESTRICTED" && reviewLevel === "STANDARD")} checked={reviewClassifications.includes(item)} onChange={(event) => setReviewClassifications((current) => event.target.checked ? [...current, item] : current.filter((value) => value !== item))} /><span>{item}</span></label>)}
              <small className={grantSubmitted && !reviewClassifications.length ? "field-error" : ""}>{grantSubmitted && !reviewClassifications.length ? "Select at least one classification." : reviewLevel === "STANDARD" ? "RESTRICTED needs a Specialist or Senior grant." : "Restricted knowledge is available at this level."}</small></fieldset>
            <div className="admin-grant-tags">
              <label className="organization-field"><span>Team tag <small>Optional</small></span><input maxLength={100} disabled={busy} value={teamTag} onChange={(event) => setTeamTag(event.target.value)} /></label>
              <label className="organization-field"><span>Project tag <small>Optional</small></span><input maxLength={100} disabled={busy} value={projectTag} onChange={(event) => setProjectTag(event.target.value)} /></label>
            </div>
            <p className="admin-scope-preview" aria-live="polite">{scopePreview}</p>
            {overlappingGrant && <p className="admin-feedback is-warning">This reviewer already has an active grant overlapping this department and classification.</p>}
            {reviewClassifications.includes("RESTRICTED") && reviewLevel === "STANDARD" && <p role="alert" className="admin-feedback is-error">Choose Specialist or Senior for Restricted knowledge.</p>}
            <div className="admin-grant-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Granting…" : "Create grant"}</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { setReviewerId(""); setReviewDepartmentId(""); setReviewClassifications([]); setReviewLevel("STANDARD"); setTeamTag(""); setProjectTag(""); setGrantSubmitted(false); }}>Reset</button></div>
          </form>
          </div>
        </div>}
      </>}
    </WorkspacePageContent>
    {confirmation && <IslandConfirm title={confirmation.title} description={confirmation.description} actionLabel={confirmation.action}
      busy={busy} error={error} onCancel={() => setConfirmation(null)} onConfirm={confirmAction} />}
    {pendingTab && <KnowledgeDialog confirmation title="Discard unsaved audience changes?" onClose={() => setPendingTab(null)}>
      <p>Changes to this audience group have not been saved. Discard them and open {tabNames[pendingTab]}?</p>
      <div className="dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setPendingTab(null)}>Keep editing</button>
        <button type="button" className="admin-danger-button" onClick={() => { setTab(pendingTab); setPendingTab(null); }}>Discard changes</button></div>
    </KnowledgeDialog>}
    <ActionToast message={message} onDismiss={() => setMessage("")} />
  </main>;
}
