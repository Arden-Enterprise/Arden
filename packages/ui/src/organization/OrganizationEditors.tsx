import { useState, type FormEvent } from "react";
import { Icon } from "../shared/Icon";
import { primaryRoles, type OrganizationPreview, type PrimaryRole } from "./previewModel";

type EditorProps = {
  organization: OrganizationPreview;
  onChange: (organization: OrganizationPreview) => void;
};

export function DepartmentEditor({ organization, onChange }: EditorProps) {
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState("");

  const addDepartment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (organization.departments.some((department) => department.name.toLowerCase() === name.toLowerCase())) {
      setMessage("That department already exists.");
      return;
    }
    onChange({
      ...organization,
      departments: [...organization.departments, { id: crypto.randomUUID(), name }],
    });
    setNewName("");
    setMessage("");
  };

  return (
    <div className="organization-editor-stack">
      <div className="organization-section-heading">
        <div>
          <span className="meta-label">ORGANIZATION STRUCTURE</span>
          <h2>Departments</h2>
          <p>Departments are the lowest required level. The demo uses at least two to show distinct access boundaries.</p>
        </div>
        <span className="organization-count">{organization.departments.length} departments</span>
      </div>

      <div className="department-list">
        {organization.departments.map((department, index) => {
          const memberCount = organization.members.filter((member) => member.departmentId === department.id).length;
          return (
            <div className="department-row" key={department.id}>
              <span className="department-index">{String(index + 1).padStart(2, "0")}</span>
              <label>
                <span className="sr-only">Department {index + 1} name</span>
                <input
                  value={department.name}
                  maxLength={80}
                  onChange={(event) => {
                    onChange({
                      ...organization,
                      departments: organization.departments.map((item) =>
                        item.id === department.id ? { ...item, name: event.target.value } : item,
                      ),
                    });
                  }}
                />
              </label>
              <span className="department-members">{memberCount} members</span>
              <button
                type="button"
                className="organization-icon-button"
                aria-label={`Remove ${department.name || `department ${index + 1}`}`}
                title={memberCount ? "Move members before removing this department" : "Remove department"}
                disabled={memberCount > 0}
                onClick={() => onChange({ ...organization, departments: organization.departments.filter((item) => item.id !== department.id) })}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          );
        })}
      </div>

      <form className="organization-inline-form" onSubmit={addDepartment}>
        <label>
          <span className="sr-only">New department name</span>
          <input value={newName} maxLength={80} onChange={(event) => setNewName(event.target.value)} placeholder="New department name" />
        </label>
        <button type="submit" className="secondary-button"><Icon name="plus" size={15} /> Add department</button>
      </form>
      {message && <p className="organization-form-error" role="alert">{message}</p>}
    </div>
  );
}

export function MemberEditor({ organization, onChange }: EditorProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [departmentId, setDepartmentId] = useState(organization.departments[0]?.id ?? "");
  const [role, setRole] = useState<PrimaryRole>("Employee");
  const [message, setMessage] = useState("");
  const selectedDepartmentId = organization.departments.some((department) => department.id === departmentId)
    ? departmentId
    : organization.departments[0]?.id ?? "";

  const addMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !selectedDepartmentId) {
      setMessage("Enter a name, valid email and department.");
      return;
    }
    if (organization.members.some((member) => member.email.toLowerCase() === normalizedEmail)) {
      setMessage("That email is already in this preview organization.");
      return;
    }
    onChange({
      ...organization,
      members: [...organization.members, {
        id: crypto.randomUUID(),
        name: name.trim(),
        email: normalizedEmail,
        departmentId: selectedDepartmentId,
        role,
      }],
    });
    setName("");
    setEmail("");
    setRole("Employee");
    setMessage("");
  };

  return (
    <div className="organization-editor-stack">
      <div className="organization-section-heading">
        <div>
          <span className="meta-label">MEMBERSHIP &amp; ROLE</span>
          <h2>Members</h2>
          <p>Assign a department and one primary role to each synthetic member. Roles do not override document ownership.</p>
        </div>
        <span className="organization-count">{organization.members.length} members</span>
      </div>

      <div className="member-list">
        {organization.members.map((member) => (
          <div className="member-row" key={member.id}>
            <div className="member-identity">
              <strong>{member.name}</strong>
              <span>{member.email}</span>
            </div>
            <label>
              <span className="sr-only">Department for {member.name}</span>
              <select
                value={member.departmentId}
                onChange={(event) => onChange({
                  ...organization,
                  members: organization.members.map((item) => item.id === member.id ? { ...item, departmentId: event.target.value } : item),
                })}
              >
                {organization.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Role for {member.name}</span>
              <select
                value={member.role}
                onChange={(event) => onChange({
                  ...organization,
                  members: organization.members.map((item) => item.id === member.id ? { ...item, role: event.target.value as PrimaryRole } : item),
                })}
              >
                {primaryRoles.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="organization-icon-button"
              aria-label={`Remove ${member.name}`}
              onClick={() => onChange({ ...organization, members: organization.members.filter((item) => item.id !== member.id) })}
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ))}
        {organization.members.length === 0 && <p className="organization-empty">No members in this preview yet.</p>}
      </div>

      <form className="member-add-form" onSubmit={addMember}>
        <label><span>Name</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Member name" required /></label>
        <label><span>Work email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.example" required /></label>
        <label><span>Department</span><select value={selectedDepartmentId} onChange={(event) => setDepartmentId(event.target.value)}>{organization.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <label><span>Primary role</span><select value={role} onChange={(event) => setRole(event.target.value as PrimaryRole)}>{primaryRoles.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <button type="submit" className="secondary-button"><Icon name="plus" size={15} /> Add member</button>
      </form>
      {message && <p className="organization-form-error" role="alert">{message}</p>}
    </div>
  );
}
