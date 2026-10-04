import { useEffect, useState, type FormEvent } from "react";
import { Icon, type IconName } from "../shared/Icon";
import { OrganizationDialog } from "./OrganizationDialog";
import { InviteMemberDialog } from "./InvitationsPanel";
import { membershipReadiness, transitionOrganization } from "./organizationWorkflow";
import { isPrimaryRole, primaryRoles, type OrganizationMember, type OrganizationPreview } from "./previewModel";

const roleDetails: Record<string, { icon: IconName; detail: string; tag: string }> = {
  Employee: { icon: "document", detail: "Query authorized knowledge · Create and submit", tag: "Contribute" },
  "Manager / Knowledge Reviewer": { icon: "check", detail: "Review · Request revision · Governed publication", tag: "Review" },
  "System Admin": { icon: "work", detail: "Organization metadata, departments and role assignments", tag: "Configure" },
};

export function SystemRoleOverview() {
  return <section className="organization-surface organization-role-overview">
    <span className="meta-label organization-amber">THREE SYSTEM ROLES</span><h2>Responsibility with clear limits</h2>
    <div className="organization-role-list">{primaryRoles.map((role) => <div key={role} className="organization-role-row"><Icon name={roleDetails[role].icon} size={24} /><div><strong>{role}</strong><small>{roleDetails[role].detail}</small></div><span>{roleDetails[role].tag}</span></div>)}</div>
    <div className="organization-notice is-success"><strong>Private means owner only</strong><span>Administrator and reviewer responsibilities do not grant access to another member's private document content.</span></div>
  </section>;
}

export function EffectiveAccessPreview({ organization, member }: { organization: OrganizationPreview; member?: OrganizationMember }) {
  const department = organization.departments.find((item) => item.id === member?.departmentId);
  const readiness = member ? membershipReadiness(organization, member.id) : undefined;
  return <section className="organization-surface organization-effective-access">
    <div className="organization-effective-heading"><h2>Effective access</h2>{member && <><span className="organization-status status-info">{member.name}</span><span className="organization-status">{member.role || "Role not assigned"} · {department?.name || "Department not assigned"}</span></>}</div>
    <div className="organization-access-boundaries">
      <div><span className="meta-label organization-jade">ROLE</span><strong>{readiness?.state === "ready" ? member?.role === "Employee" ? "Can query and contribute" : member?.role === "System Admin" ? "Can configure the organization" : "Can review within the assigned scope" : "Workspace access is not ready"}</strong><small>{member?.roleScope === "organization" ? "Organization responsibility" : "Primary department responsibility"}</small></div>
      <div><span className="meta-label organization-blue">DEPARTMENT</span><strong>{department ? `${department.name} publications` : "Waiting for a primary department"}</strong><small>Company-wide publications follow their audience.</small></div>
      <div><span className="meta-label organization-amber">PRIVATE</span><strong>Owner only — including for admins</strong><small>Roles do not override private ownership.</small></div>
    </div>
  </section>;
}

function MemberAssignmentDialog({ organization, member, onChange, onClose, onDirtyChange }: {
  organization: OrganizationPreview;
  member: OrganizationMember;
  onChange: (organization: OrganizationPreview) => void;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [departmentId, setDepartmentId] = useState(member.departmentId);
  const [role, setRole] = useState(member.role);
  const [roleScope, setRoleScope] = useState<"organization" | "department">(member.roleScope ?? (member.role === "System Admin" ? "organization" : "department"));
  const [reviewing, setReviewing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState("");
  const isDirty = departmentId !== member.departmentId || role !== member.role || roleScope !== (member.roleScope ?? (member.role === "System Admin" ? "organization" : "department"));
  useEffect(() => { onDirtyChange?.(isDirty); return () => onDirtyChange?.(false); }, [isDirty, onDirtyChange]);
  const close = () => { if (isDirty) setDiscarding(true); else onClose(); };
  const assignment = () => {
    if (!isPrimaryRole(role)) return { organization, error: "Select a system role before continuing." };
    return transitionOrganization(organization, { type: "assign", memberId: member.id, departmentId, role, roleScope }, Date.now());
  };
  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const result = assignment();
    if (result.error) { setError(result.error); return; } setError(""); setReviewing(true);
  };
  const apply = () => {
    const result = assignment();
    if (result.error) { setError(result.error); setReviewing(false); return; }
    onChange(result.organization); onClose();
  };
  const proposed = { ...member, departmentId, role, roleScope, status: member.status === "suspended" ? "suspended" as const : "active" as const };
  const department = organization.departments.find((item) => item.id === departmentId);
  return <OrganizationDialog title={discarding ? "Discard assignment changes?" : reviewing ? "Review access assignment" : "Member & access"} description={discarding ? "These department and role changes have not been applied." : `${member.name} · ${member.email}`} onClose={close} wide>
    {discarding ? <div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className="primary-button" onClick={onClose}>Discard changes</button></div> : reviewing ? <div className="organization-form">
      <div className="organization-assignment-review"><div><span className="meta-label">CURRENT</span><strong>{member.role || "Waiting for assignment"}</strong><small>{organization.departments.find((item) => item.id === member.departmentId)?.name || "No primary department"}</small></div><Icon name="arrow" size={20} /><div><span className="meta-label organization-jade">AFTER APPLYING</span><strong>{role}</strong><small>{department?.name} · {roleScope} responsibility</small></div></div>
      <EffectiveAccessPreview organization={{ ...organization, members: organization.members.map((item) => item.id === member.id ? proposed : item) }} member={proposed} />
      <p className="organization-helper">This updates the synthetic membership in this session. Real access remains subject to server authorization and document audiences.</p>
      <div className="organization-dialog-actions"><button type="button" className="secondary-button" onClick={() => setReviewing(false)}>Back to editing</button><button type="button" className="primary-button" onClick={apply}>Confirm assignment</button></div>
    </div> : <form className="organization-form" onSubmit={review}>
      <span className={`organization-status status-${member.status === "pending-assignment" ? "pending" : member.status === "suspended" ? "revoked" : "active"}`}>{member.status === "pending-assignment" ? "Membership created · Waiting for assignment" : member.status === "suspended" ? "Suspended" : "Active membership"}</span>
      <label className="organization-field"><span>Primary department</span><select value={departmentId} autoFocus required onChange={(event) => { setDepartmentId(event.target.value); setError(""); }}><option value="">Select a department</option>{organization.departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="organization-field"><span>System role</span><select value={role} required onChange={(event) => { const nextRole = event.target.value; if (isPrimaryRole(nextRole)) { setRole(nextRole); if (nextRole === "System Admin") setRoleScope("organization"); } setError(""); }}><option value="">Select a role</option>{primaryRoles.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="organization-field"><span>Responsibility scope</span><select value={roleScope} disabled={role === "System Admin"} onChange={(event) => { const value = event.target.value; if (value === "department" || value === "organization") setRoleScope(value); }}><option value="department">Primary department</option><option value="organization">Organization</option></select></label>
      <p className="organization-helper">Scope defines where role responsibilities apply. It does not grant access to private notes or every document. System Admin responsibilities apply to the organization.</p>
      {error && <p className="organization-form-error" role="alert">{error}</p>}
      <div className="organization-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="submit" className="primary-button">Review assignment</button></div>
    </form>}
  </OrganizationDialog>;
}

export function MemberDirectory({ organization, onChange, onPreviewAccess, onDirtyChange }: {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
  onPreviewAccess?: (memberId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [selectedDepartment, setSelectedDepartment] = useState(organization.departments[0]?.id ?? "all");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [statusTarget, setStatusTarget] = useState<OrganizationMember | null>(null);
  const [error, setError] = useState("");
  const selected = organization.departments.find((item) => item.id === selectedDepartment);
  const members = organization.members.filter((member) => selectedDepartment === "all" || (selectedDepartment === "unassigned" ? member.status === "pending-assignment" : member.departmentId === selectedDepartment));
  const pending = organization.members.filter((member) => member.status === "pending-assignment").length;
  const editing = organization.members.find((member) => member.id === selectedMember);
  const setStatus = () => {
    if (!statusTarget) return;
    const result = transitionOrganization(organization, { type: "status", memberId: statusTarget.id, status: statusTarget.status === "suspended" ? "active" : "suspended" }, Date.now());
    if (result.error) { setError(result.error); return; } onChange(result.organization); setStatusTarget(null); setError("");
  };
  return <>
    <div className="organization-members-layout">
      <aside className="organization-surface organization-department-nav"><span className="meta-label organization-jade">ORGANIZATION → DEPARTMENT</span><h2>{organization.name}</h2>
        <button type="button" className={selectedDepartment === "all" ? "is-selected" : ""} onClick={() => setSelectedDepartment("all")}><strong>All members</strong><small>{organization.members.length} members</small></button>
        {organization.departments.map((department) => <button type="button" key={department.id} className={selectedDepartment === department.id ? "is-selected" : ""} onClick={() => setSelectedDepartment(department.id)}><strong><Icon name={selectedDepartment === department.id ? "check" : "document"} size={15} />{department.name}</strong><small>{organization.members.filter((member) => member.departmentId === department.id).length} members</small></button>)}
        <button type="button" className={selectedDepartment === "unassigned" ? "is-selected" : ""} onClick={() => setSelectedDepartment("unassigned")}><strong>Waiting for assignment</strong><small>{pending} members</small></button>
      </aside>
      <section className="organization-surface organization-member-panel"><div className="organization-section-heading"><div><h2>{selectedDepartment === "all" ? "All members" : selectedDepartment === "unassigned" ? "Waiting for assignment" : selected?.name ?? "Members"}</h2><p>Each member has one primary department and one system role.</p></div><span className="organization-status status-active">{members.length} members</span></div>
        <div className="organization-table-wrap" role="region" aria-label="Members table — scroll horizontally on small screens" tabIndex={0}><table className="organization-member-table"><thead><tr><th>Member</th><th>Status</th><th>System role</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td><span className={`organization-status status-${member.status === "pending-assignment" ? "pending" : member.status === "suspended" ? "revoked" : "active"}`}>{member.status === "pending-assignment" ? "Awaiting assignment" : member.status === "suspended" ? "Suspended" : "Active"}</span></td><td>{member.role || "Not assigned"}<small>{member.role ? `${member.roleScope ?? "department"} responsibility` : "Accept → Assign → Access"}</small></td><td><div className="organization-row-actions"><button type="button" className="organization-text-button" onClick={() => setSelectedMember(member.id)}>{member.role ? "Edit access" : "Assign access"}</button>{onPreviewAccess && <button type="button" className="organization-text-button" onClick={() => onPreviewAccess(member.id)}>Preview access</button>}{member.status !== "pending-assignment" && <button type="button" className="organization-text-button" onClick={() => { setStatusTarget(member); setError(""); }}>{member.status === "suspended" ? "Restore" : "Suspend"}</button>}</div></td></tr>)}</tbody></table></div>
        {!members.length && <div className="organization-empty-state"><h3>{selectedDepartment === "unassigned" ? "No members waiting" : "No members in this department"}</h3><p>{selectedDepartment === "unassigned" ? "Accepted invitations appear here until their department and role are confirmed." : "Invite a member, then assign their primary department after acceptance."}</p></div>}
        <div className="organization-notice"><strong>{(organization.invitations ?? []).filter((invitation) => invitation.status === "pending").length} invitations pending · {pending} awaiting assignment</strong><span>Invitees receive workspace access only after their membership, department and role are confirmed.</span></div>
        <button type="button" className="secondary-button" onClick={() => setShowInvite(true)}>Invite member</button>
      </section>
    </div>
    {editing && <MemberAssignmentDialog key={editing.id} organization={organization} member={editing} onChange={onChange} onClose={() => setSelectedMember(null)} onDirtyChange={onDirtyChange} />}
    {showInvite && <InviteMemberDialog organization={organization} onChange={onChange} onClose={() => setShowInvite(false)} />}
    {statusTarget && <OrganizationDialog title={statusTarget.status === "suspended" ? "Restore membership?" : "Suspend membership?"} description={statusTarget.status === "suspended" ? `${statusTarget.name}'s existing assignment will be checked before access is restored.` : `${statusTarget.name} will no longer be eligible to enter the preview workspace.`} onClose={() => setStatusTarget(null)}>{error && <p className="organization-form-error" role="alert">{error}</p>}<div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setStatusTarget(null)}>Cancel</button><button type="button" className="primary-button" onClick={setStatus}>{statusTarget.status === "suspended" ? "Restore membership" : "Suspend membership"}</button></div></OrganizationDialog>}
  </>;
}
