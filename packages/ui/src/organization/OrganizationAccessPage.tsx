import { useEffect, useState, type FormEvent } from "react";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { AccessRules } from "./AccessRules";
import { DepartmentEditor } from "./OrganizationEditors";
import { OrganizationDialog } from "./OrganizationDialog";
import { InviteMemberDialog, InvitationsPanel } from "./InvitationsPanel";
import { EffectiveAccessPreview, MemberDirectory, SystemRoleOverview } from "./MemberDirectory";
import { validateOrganization, type OrganizationPreview } from "./previewModel";

type AccessTab = "organization" | "departments" | "members" | "invitations" | "roles" | "policies" | "audit";
const tabs: { id: AccessTab; label: string }[] = [
  { id: "organization", label: "Organization" }, { id: "departments", label: "Departments" },
  { id: "members", label: "Members" }, { id: "invitations", label: "Invitations" },
  { id: "roles", label: "Roles & permissions" }, { id: "policies", label: "Policies" }, { id: "audit", label: "Audit" },
];

function OrganizationMetadataDialog({ organization, onChange, onClose, onDirtyChange }: {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(organization.name);
  const [reviewing, setReviewing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const dirty = name !== organization.name;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const close = () => { if (dirty) setDiscarding(true); else onClose(); };
  const review = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const problems = validateOrganization({ ...organization, name: name.trim() });
    if (problems.length) { setErrors(problems); return; } setReviewing(true);
  };
  return <OrganizationDialog title={discarding ? "Discard organization changes?" : reviewing ? "Review organization change" : "Organization information"} description={discarding ? "The organization name has not been updated." : "One installation. One organization. Changes stay in this session."} onClose={close}>
    {discarding ? <div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className="primary-button" onClick={onClose}>Discard changes</button></div> : reviewing ? <div className="organization-form"><div className="organization-assignment-review"><div><span className="meta-label">CURRENT</span><strong>{organization.name}</strong></div><div><span className="meta-label organization-jade">AFTER APPLYING</span><strong>{name.trim()}</strong></div></div><div className="organization-dialog-actions"><button type="button" className="secondary-button" onClick={() => setReviewing(false)}>Back to editing</button><button type="button" className="primary-button" onClick={() => { onChange({ ...organization, name: name.trim() }); onClose(); }}>Confirm change</button></div></div> : <form className="organization-form" onSubmit={review}><label className="organization-field"><span>Organization name</span><input value={name} maxLength={100} autoFocus required onChange={(event) => { setName(event.target.value); setErrors([]); }} /></label><div className="organization-information-row"><span>Required hierarchy</span><strong>Organization → Department</strong><small>Team and Project are optional document attributes.</small></div>{errors.length > 0 && <div className="organization-validation" role="alert"><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}<div className="organization-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="submit" className="primary-button">Review change</button></div></form>}
  </OrganizationDialog>;
}

export function OrganizationAccessPage({ organization, onChange, onDirtyChange, onPreviewInvitation, onPreviewAccess, onOpenSetup, contextOpen, onToggleContext }: {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
  onDirtyChange: (isDirty: boolean) => void;
  onPreviewInvitation?: (id: string) => void;
  onPreviewAccess?: (memberId: string) => void;
  onOpenSetup?: () => void;
} & ContextControlProps) {
  const [tab, setTab] = useState<AccessTab>("roles");
  const [showInvite, setShowInvite] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [selectedAccessMember, setSelectedAccessMember] = useState("sample-employee");
  const selectedMember = organization.members.find((member) => member.id === selectedAccessMember) ?? organization.members[0];
  const pendingCount = (organization.invitations ?? []).filter((invitation) => invitation.status === "pending").length;
  const waitingCount = organization.members.filter((member) => member.status === "pending-assignment").length;
  const title = tab === "members" ? "Departments & members" : "Organization & access";
  return <main id="arden-main" className="workspace-page" aria-labelledby="organization-access-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb={`${organization.name} / Administration`} previewLabel="SESSION PREVIEW · SYNTHETIC DATA" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <div className="workspace-content organization-access-content">
      <div className="page-title-row organization-access-heading"><div><span className="meta-label">ORGANIZATION / GOVERNANCE</span><h1 id="organization-access-title">{title}</h1><p>Manage departments, members and the boundaries of shared knowledge.</p></div><button type="button" className="primary-button" onClick={() => tab === "members" || tab === "invitations" ? setShowInvite(true) : setTab("departments")}>{tab === "members" || tab === "invitations" ? "Invite member" : "Manage departments"}</button></div>
      <nav className="organization-tabs" aria-label="Organization and access sections">{tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}{item.id === "invitations" && pendingCount > 0 ? ` · ${pendingCount}` : item.id === "members" && waitingCount > 0 ? ` · ${waitingCount} waiting` : ""}</button>)}</nav>
      <div className="organization-tab-panel">
        {tab === "roles" && <><div className="organization-governance-grid"><section className="organization-surface organization-department-overview"><span className="meta-label organization-jade">{organization.name.toUpperCase()} · ONE SELF-HOSTED INSTALLATION</span><h2>{organization.departments.length} departments. One organization.</h2><div className="organization-overview-departments">{organization.departments.map((department, index) => <div key={department.id}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{department.name}</strong><small>{organization.members.filter((member) => member.departmentId === department.id).length} members</small></div></div>)}</div><button type="button" className="secondary-button" onClick={() => setTab("departments")}>Manage departments</button></section><SystemRoleOverview /></div><div className="organization-access-selector"><label className="organization-field"><span>Preview effective access for</span><select value={selectedMember?.id ?? ""} onChange={(event) => setSelectedAccessMember(event.target.value)}>{organization.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>{selectedMember && onPreviewAccess && <button type="button" className="secondary-button" onClick={() => onPreviewAccess(selectedMember.id)}>Check member access</button>}</div><EffectiveAccessPreview organization={organization} member={selectedMember} /><p className="organization-helper">Fixed system roles describe responsibilities. Document audiences and private ownership remain separate.</p></>}
        {tab === "departments" && <section className="organization-surface"><DepartmentEditor organization={organization} onChange={onChange} /></section>}
        {tab === "members" && <MemberDirectory organization={organization} onChange={onChange} onPreviewAccess={onPreviewAccess} onDirtyChange={onDirtyChange} />}
        {tab === "invitations" && <section className="organization-surface"><InvitationsPanel organization={organization} onChange={onChange} onPreviewInvitation={onPreviewInvitation} onInvite={() => setShowInvite(true)} /></section>}
        {tab === "organization" && <section className="organization-surface organization-editor-stack"><span className="meta-label organization-jade">INSTALLATION CONTEXT</span><h2>{organization.name}</h2><p className="organization-helper">One organization contains its departments, active members and pending invitations.</p><div className="organization-review-summary"><div><span className="meta-label">DEPARTMENTS</span><strong>{organization.departments.length}</strong></div><div><span className="meta-label">MEMBERS</span><strong>{organization.members.length}</strong></div><div><span className="meta-label">INVITATIONS</span><strong>{pendingCount} pending</strong></div></div><div className="organization-row-actions"><button type="button" className="secondary-button" onClick={() => setShowMetadata(true)}>Edit organization</button>{onOpenSetup && <button type="button" className="secondary-button" onClick={onOpenSetup}>Review setup</button>}</div><div className="organization-notice is-info"><strong>Session preview</strong><span>Configuration is synthetic and held in memory. These forms do not modify a server or create an audit record.</span></div></section>}
        {tab === "policies" && <section className="organization-surface"><AccessRules /></section>}
        {tab === "audit" && <section className="organization-surface organization-editor-stack"><span className="meta-label organization-blue">ACCOUNTABILITY</span><h2>Recorded changes</h2><div className="organization-empty-state"><h3>No server audit records in preview</h3><p>Local invitation, membership and role changes are held in session memory. An administration API must authorize and record real changes.</p></div></section>}
      </div>
      <div className="organization-notice is-success"><strong>Setup readiness</strong><span>{organization.departments.length} departments · {organization.members.length} members · {pendingCount} invitations pending · {waitingCount} awaiting assignment. {waitingCount ? "Assign departments and roles before those members enter the workspace." : "Review role assignments and document audiences before granting real access."}</span></div>
    </div>
    {showInvite && <InviteMemberDialog organization={organization} onChange={onChange} onClose={() => { setShowInvite(false); setTab("invitations"); }} />}
    {showMetadata && <OrganizationMetadataDialog organization={organization} onChange={onChange} onClose={() => setShowMetadata(false)} onDirtyChange={onDirtyChange} />}
  </main>;
}
