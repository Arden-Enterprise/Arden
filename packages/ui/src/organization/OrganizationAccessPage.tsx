import { useEffect, useState } from "react";
import { AccessRules } from "./AccessRules";
import { DepartmentEditor, MemberEditor } from "./OrganizationEditors";
import { previewTemplates, validateOrganization, type OrganizationPreview } from "./previewModel";

type AccessTab = "organization" | "departments" | "members" | "access" | "audit";

const tabs: { id: AccessTab; label: string }[] = [
  { id: "organization", label: "Organization" },
  { id: "departments", label: "Departments" },
  { id: "members", label: "Members & roles" },
  { id: "access", label: "Access policies" },
  { id: "audit", label: "Audit information" },
];

export function OrganizationAccessPage({
  organization,
  onChange,
  onDirtyChange,
}: {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
  onDirtyChange: (isDirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(organization);
  const [tab, setTab] = useState<AccessTab>("organization");
  const [reviewing, setReviewing] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const isDirty = JSON.stringify(draft) !== JSON.stringify(organization);
  const template = previewTemplates.find((item) => item.id === draft.templateId);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [isDirty]);

  const updateDraft = (next: OrganizationPreview) => {
    setDraft(next);
    setErrors([]);
    setMessage("");
    setReviewing(false);
  };

  const reviewChanges = () => {
    const problems = validateOrganization(draft);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    setReviewing(true);
  };

  const applyChanges = () => {
    onChange(draft);
    setReviewing(false);
    setMessage("Preview changes applied in memory. No server configuration or audit event was created.");
  };

  return (
    <section className="workspace-page" aria-labelledby="organization-access-title">
      <header className="workspace-topbar">
        <span>ARDEN / ORGANIZATION &amp; ACCESS</span>
        <span className="preview-state">SYSTEM ADMIN UI PREVIEW · NOT SERVER ENFORCED</span>
      </header>
      <div className="workspace-content organization-access-content">
        <div className="page-title-row organization-access-heading">
          <div>
            <span className="meta-label">SCR-09 · ADMINISTRATION</span>
            <h1 id="organization-access-title">Organization &amp; Access</h1>
            <p>Review the organization structure, its members and the access boundaries around knowledge.</p>
          </div>
          <span className="organization-preview-badge">LOCAL PREVIEW</span>
        </div>

        <div className="organization-overview">
          <div><span className="meta-label">ORGANIZATION</span><strong>{organization.name || "Unnamed organization"}</strong><small>One installation · one organization</small></div>
          <div><span className="meta-label">DEPARTMENTS</span><strong>{organization.departments.length}</strong><small>Organization → Department</small></div>
          <div><span className="meta-label">MEMBERS</span><strong>{organization.members.length}</strong><small>Three primary roles</small></div>
        </div>

        <nav className="organization-tabs" aria-label="Organization and access sections">
          {tabs.map((item) => (
            <button key={item.id} type="button" className={tab === item.id ? "is-active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setErrors([]); }}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="organization-tab-panel">
          {tab === "organization" && (
            <div className="organization-editor-stack">
              <div className="organization-section-heading"><div><span className="meta-label">INSTALLATION CONTEXT</span><h2>Organization</h2><p>Each Arden installation is scoped to one organization. This name is editable in the local preview.</p></div></div>
              <label className="organization-field"><span>Organization name</span><input value={draft.name} maxLength={100} onChange={(event) => updateDraft({ ...draft, name: event.target.value })} /></label>
              <div className="organization-information-row"><span>Starting template</span><strong>{template?.name ?? "Custom preview"}</strong><small>Template changes belong to first-run setup; department names can be edited here.</small></div>
              <div className="organization-information-row"><span>Required hierarchy</span><strong>Organization → Department</strong><small>Project and Team are optional document attributes, not navigation levels.</small></div>
            </div>
          )}
          {tab === "departments" && <DepartmentEditor organization={draft} onChange={updateDraft} />}
          {tab === "members" && <MemberEditor organization={draft} onChange={updateDraft} />}
          {tab === "access" && <AccessRules />}
          {tab === "audit" && (
            <div className="organization-editor-stack">
              <div className="organization-section-heading"><div><span className="meta-label">AUDIT INFORMATION</span><h2>Recorded changes</h2><p>Access and role changes must be recorded by the server when the administration API is available.</p></div></div>
              <div className="organization-empty-audit"><strong>No server audit records in preview</strong><span>Local edits in this browser session do not create an audit event or change anyone's permissions.</span></div>
            </div>
          )}
        </div>

        {errors.length > 0 && <div className="organization-validation" role="alert"><strong>Review before applying</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
        {message && <p className="organization-feedback" role="status">{message}</p>}

        {isDirty && (
          <div className="organization-save-bar">
            <div><strong>Unsaved preview changes</strong><span>Changes are local and have not been applied to this preview session.</span></div>
            <button type="button" className="secondary-button" onClick={() => { setDraft(organization); setReviewing(false); setErrors([]); }}>Discard changes</button>
            <button type="button" className="primary-button" onClick={reviewChanges}>Review changes</button>
          </div>
        )}
        {reviewing && (
          <div className="organization-confirm-panel" role="group" aria-label="Confirm preview changes">
            <div><span className="meta-label">CONFIRM SENSITIVE CHANGES</span><h2>Apply to this preview?</h2><p>{draft.departments.length} departments · {draft.members.length} members. This updates in-memory UI data only; a real implementation must authorize and audit each change on the server.</p></div>
            <div><button type="button" className="secondary-button" onClick={() => setReviewing(false)}>Cancel</button><button type="button" className="primary-button" onClick={applyChanges}>Apply preview changes</button></div>
          </div>
        )}
      </div>
    </section>
  );
}
