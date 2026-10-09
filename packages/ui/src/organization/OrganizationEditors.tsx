import { useState, type FormEvent } from "react";
import { Icon } from "../shared/Icon";
import { OrganizationDialog } from "./OrganizationDialog";
import type { Department, OrganizationPreview } from "./previewModel";

export function DepartmentEditor({ organization, onChange }: {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
}) {
  const [editing, setEditing] = useState<Department | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const close = () => { setEditing(null); setAdding(false); setError(""); setDiscarding(false); };
  const requestClose = () => { if (name !== (editing?.name ?? "")) setDiscarding(true); else close(); };
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) { setError("Enter a department name."); return; }
    if (organization.departments.some((department) => department.id !== editing?.id && department.name.trim().toLowerCase() === nextName.toLowerCase())) {
      setError("That department already exists. Choose a unique name."); return;
    }
    const departments = editing
      ? organization.departments.map((department) => department.id === editing.id ? { ...department, name: nextName } : department)
      : [...organization.departments, { id: crypto.randomUUID(), name: nextName }];
    onChange({ ...organization, departments }); close();
  };
  return (
    <section className="organization-editor-stack">
      <div className="organization-section-heading"><div><span className="meta-label">ORGANIZATION → DEPARTMENT</span><h2>Departments</h2><p>A clear home for each member and their department knowledge.</p></div><button className="secondary-button" type="button" onClick={() => { setAdding(true); setName(""); }}><Icon name="plus" size={16} />Add department</button></div>
      <div className="department-list">
        {organization.departments.map((department, index) => {
          const count = organization.members.filter((member) => member.departmentId === department.id).length;
          return <div className="department-row" key={department.id}>
            <span className="department-index">{String(index + 1).padStart(2, "0")}</span>
            <div className="department-copy"><strong>{department.name}</strong><small>{count} {count === 1 ? "member" : "members"}</small></div>
            <button type="button" className="secondary-button" onClick={() => { setEditing(department); setName(department.name); }}>Edit</button>
            <button type="button" className="organization-icon-button" aria-label={`Remove ${department.name}`} title={count ? "Move members before removing this department" : organization.departments.length === 1 ? "Keep at least one department" : "Remove department"} disabled={count > 0 || organization.departments.length === 1} onClick={() => onChange({ ...organization, departments: organization.departments.filter((item) => item.id !== department.id) })}><Icon name="close" size={15} /></button>
          </div>;
        })}
      </div>
      <p className="organization-helper">Departments with assigned members cannot be removed. Move those members first.</p>
      {(editing || adding) && <OrganizationDialog title={discarding ? "Discard department changes?" : editing ? "Edit department" : "Add department"} description="Department names are unique within this organization. Changes stay in this preview session." onClose={requestClose}>
        {discarding ? <div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus onClick={() => setDiscarding(false)}>Keep editing</button><button type="button" className="primary-button" onClick={close}>Discard changes</button></div> : <form className="organization-form" onSubmit={save}>
          <label className="organization-field"><span>Department name</span><input value={name} maxLength={80} onChange={(event) => { setName(event.target.value); setError(""); }} autoFocus required placeholder="e.g. Product Engineering" /></label>
          {error && <p className="organization-form-error" role="alert">{error}</p>}
          <div className="organization-dialog-actions"><button type="button" className="secondary-button" onClick={requestClose}>Cancel</button><button type="submit" className="primary-button">{editing ? "Save department" : "Add department"}</button></div>
        </form>}
      </OrganizationDialog>}
    </section>
  );
}

// Retained for existing setup imports; the member workflow now includes invitations and reviewed assignments.
export { MemberDirectory as MemberEditor } from "./MemberDirectory";
