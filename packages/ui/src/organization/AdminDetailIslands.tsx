import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import type { OrganizationAdministration, ReviewerGrant } from "../shared/api-client";
import type { AudienceGroupRecord } from "../shared/audience-group-contracts";
import { departmentDeletionSummary } from "./memberAdministration";

type Member = OrganizationAdministration["members"][number];
type Department = OrganizationAdministration["departments"][number];

export function memberInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export function memberStatus(status: string, departmentId?: string | null, isOrganizationAdmin = false): { label: string; tone: string } {
  if (status === "ACTIVE" && !departmentId && !isOrganizationAdmin) {
    return { label: "Awaiting assignment", tone: "tone-info" };
  }
  return status === "ACTIVE" ? { label: "Active", tone: "tone-success" }
    : status === "INVITED" ? { label: "Awaiting assignment", tone: "tone-info" }
      : { label: "Inactive", tone: "" };
}

/** What a grant may review under decision 0015. */
export function grantCoverageLabel(scope: ReviewerGrant["scope"]): string {
  return scope === "ORGANIZATION" ? "Organization-wide documents" : "Department and group documents";
}

/** A grant with an end date shows when it ends; an open-ended grant shows when it started. */
export function grantValidity(grant: Pick<ReviewerGrant, "validFrom" | "validUntil">, formatDate: (iso: string) => string = (iso) => new Date(iso).toLocaleDateString()): string {
  return grant.validUntil ? `Until ${formatDate(grant.validUntil)}` : `Since ${formatDate(grant.validFrom)}`;
}

/** Moves focus into a detail island when it opens and back to its opener when it closes. */
function useDetailFocus() {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    heading.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  return heading;
}

export function MemberDetailIsland({ member, organizationName, isAdmin, departmentName, departments, grants, audienceGroups, groupsLoading,
  busy, feedback, feedbackError, onClose, onDepartmentChange, onGrant, onManageAudiences, onRemoveFromAudience }: {
  member: Member; organizationName: string; isAdmin: boolean; departmentName: (id: string | null) => string; departments: Department[];
  grants: ReviewerGrant[]; audienceGroups: AudienceGroupRecord[]; groupsLoading: boolean; busy: boolean; feedback: string; feedbackError: string;
  onClose: () => void; onDepartmentChange: (id: string) => void; onGrant: () => void; onManageAudiences: () => void;
  onRemoveFromAudience: (group: AudienceGroupRecord, groupMembershipId: string) => void;
}) {
  const heading = useDetailFocus();
  const titleId = useId();
  const [moving, setMoving] = useState(false);
  const status = memberStatus(member.status, member.departmentId, isAdmin);
  const otherDepartments = (member.departmentIds ?? []).filter((id) => id !== member.departmentId);
  const groupMemberships = audienceGroups.flatMap((group) => group.members
    .filter((groupMember) => groupMember.membershipId === member.id && groupMember.status === "ACTIVE")
    .map((groupMember) => ({ group, groupMember })));
  return <aside className="island island-panel island-side" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="island-side-header">
      <span className="island-avatar is-large" aria-hidden="true">{memberInitials(member.name)}</span>
      <div><h2 id={titleId} ref={heading} tabIndex={-1}>{member.name}</h2><p className="island-truncate" title={member.email}>{member.email}</p></div>
      <button type="button" className="island-icon-button" onClick={onClose} aria-label="Close member details"><Icon name="close" size={16} /></button>
    </div>
    <div className="island-chip-row"><span className={`island-chip has-dot ${status.tone}`}>{status.label}</span>
      <span className="island-chip tone-strong">{isAdmin ? "Organization Admin" : "Member"}</span></div>
    {feedbackError && <p className="admin-feedback is-error" role="alert">{feedbackError}</p>}
    {feedback && <p className="admin-feedback" role="status">{feedback}</p>}
    <div className="island-property-box">
      {/* Changing Org Admin access has no server route yet, so the action is shown but unavailable. */}
      <div className="island-property"><span><small>Access</small><strong>{isAdmin ? "Organization Admin" : "Member"}</strong></span>
        <button type="button" className="island-link-button" disabled title="Changing access is not available yet">{isAdmin ? "Make Member" : "Make Org Admin"}</button></div>
      {moving ? <label className="island-property"><span><small>Department</small>
        <select value={member.departmentId ?? ""} disabled={busy} autoFocus onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setMoving(false); } }}
          onChange={(event) => { onDepartmentChange(event.target.value); setMoving(false); }}>
          {!member.departmentId && <option value="">Choose department…</option>}
          {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></span>
        <button type="button" className="island-link-button" onClick={() => setMoving(false)}>Cancel</button></label>
        : <div className="island-property"><span><small>Department</small><strong>{departmentName(member.departmentId)}</strong></span>
          <span className="island-property-actions"><small className="island-property-hint" aria-live="polite">{busy ? "Saving…" : feedback === "Department updated." ? "Saved" : ""}</small>
            <button type="button" className="island-link-button" disabled={busy || !departments.length} onClick={() => setMoving(true)}>Move</button></span></div>}
      <div className="island-property"><span><small>Review permission</small>
        <strong>{grants.length ? grants.map((grant) => grant.scope === "ORGANIZATION"
          ? "Whole organization" : departmentName(grant.departmentId)).join(", ") : "None"}</strong></span>
        <button type="button" className="island-link-button" onClick={onGrant} disabled={member.status !== "ACTIVE"}>Manage</button></div>
    </div>
    {otherDepartments.length > 0 && <p className="island-meta">Also in {otherDepartments.map(departmentName).join(", ")}</p>}
    {grants.length > 0 && <ul className="island-grant-summary">{grants.map((grant) => <li key={grant.id}>
      <strong>{grant.scope === "ORGANIZATION" ? "Whole organization" : departmentName(grant.departmentId)}</strong>
      <span>{grantCoverageLabel(grant.scope)}</span></li>)}</ul>}
    <section className="island-detail-section" aria-label="Readers">
      <h3>Readers</h3>
      {groupsLoading ? <p className="island-meta" role="status">Loading reader groups…</p> : <div className="island-chip-row">
        {member.status === "ACTIVE" && <span className="island-chip">Everyone in {organizationName}</span>}
        {member.status === "ACTIVE" && member.departmentId && <span className="island-chip">Everyone in {departmentName(member.departmentId)}</span>}
        {groupMemberships.map(({ group, groupMember }) => <span className="island-chip" key={groupMember.id}>{group.name}
          <button type="button" className="island-chip-remove" disabled={busy} aria-label={`Remove ${member.name} from ${group.name}`}
            onClick={() => onRemoveFromAudience(group, groupMember.id)}><Icon name="close" size={12} /></button></span>)}
        {member.status !== "ACTIVE" && !groupMemberships.length && <span className="island-meta">No reader groups</span>}
      </div>}
      <button type="button" className="secondary-button" onClick={onManageAudiences}>Manage reader groups</button>
    </section>
    <div className="island-detail-section">
      <button type="button" className="secondary-button is-danger" disabled>Remove from organization</button>
      <small className="island-meta">Removing members is not available yet.</small>
    </div>
  </aside>;
}

export function DepartmentDetailIsland({ department, members, grants, busy, deleteError, onClose, onViewMembers, onDelete }: {
  department: Department; members: Member[]; grants: ReviewerGrant[]; busy?: boolean; deleteError?: string;
  onClose: () => void; onViewMembers: () => void; onDelete?: () => void;
}) {
  const heading = useDetailFocus();
  const titleId = useId();
  const inDepartment = members.filter((member) => (member.departmentIds ?? [member.departmentId]).includes(department.id));
  const reviewers = new Set(grants.filter((grant) => grant.status === "ACTIVE" && grant.departmentId === department.id).map((grant) => grant.reviewerMembershipId));
  return <aside className="island island-panel island-side" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="island-side-header">
      <span className="island-tile" aria-hidden="true"><Icon name="building" size={18} /></span>
      <div><h2 id={titleId} ref={heading} tabIndex={-1}>{department.name}</h2><p>Department</p></div>
      <button type="button" className="island-icon-button" disabled aria-label="Rename department (not available yet)" title="Renaming is not available yet"><Icon name="edit" size={16} /></button>
      <button type="button" className="island-icon-button" onClick={onClose} aria-label="Close department details"><Icon name="close" size={16} /></button>
    </div>
    {deleteError && <p className="admin-feedback is-error" role="alert">{deleteError}</p>}
    <dl className="island-kv">
      <dt>Members</dt><dd>{inDepartment.length}</dd>
      <dt>Reviewers</dt><dd>{reviewers.size} assigned</dd>
    </dl>
    <div className="island-box">
      <div className="island-box-title"><Icon name="people" size={15} /><strong>Everyone in {department.name}</strong><span className="island-chip">Automatic</span></div>
    </div>
    <section className="island-detail-section" aria-label="People">
      <h3>People</h3>
      {inDepartment.length ? <div className="island-avatar-row">
        {inDepartment.slice(0, 8).map((member) => <span key={member.id} className="island-avatar is-small" title={member.name}>
          <span aria-hidden="true">{memberInitials(member.name)}</span><span className="sr-only">{member.name}</span></span>)}
        {inDepartment.length > 8 && <span className="island-meta">+{inDepartment.length - 8}</span>}
      </div> : <p className="island-meta">No members yet.</p>}
      <button type="button" className="island-link-button" onClick={onViewMembers}>View all</button>
    </section>
    {onDelete ? (
      <section className="island-detail-section" aria-label="Department lifecycle">
        <h3>Delete department</h3>
        {inDepartment.length > 0 ? (
          <p className="island-meta">{departmentDeletionSummary(inDepartment.length)}</p>
        ) : (
          <p className="island-meta">No members assigned.</p>
        )}
        <button type="button" className="secondary-button is-danger" disabled={busy} onClick={onDelete}>Delete department</button>
      </section>
    ) : null}
  </aside>;}

