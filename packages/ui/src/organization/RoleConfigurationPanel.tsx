import { useEffect, useId, useRef, useState } from "react";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { configurablePermissions, createSampleRoleConfigurations, toggleRoleMember,
  toggleRolePermission, validateRoleConfigurations, type RoleConfiguration, type RoleMember } from "./roleConfigurationModel";

type Props = {
  members: RoleMember[];
  initialRoles?: RoleConfiguration[];
  onDirtyChange?: (dirty: boolean) => void;
};
type Section = "display" | "permissions" | "members";

export function RoleConfigurationPanel({ members, initialRoles, onDirtyChange }: Props) {
  const [roles, setRoles] = useState<RoleConfiguration[]>(() => initialRoles ?? createSampleRoleConfigurations());
  const [saved, setSaved] = useState(roles);
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? "");
  const [section, setSection] = useState<Section>("permissions");
  const [query, setQuery] = useState("");
  const [addingMembers, setAddingMembers] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [resetting, setResetting] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const selected = roles.find((role) => role.id === selectedId);
  const dirty = JSON.stringify(roles) !== JSON.stringify(saved);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => { if (section === "display") nameInput.current?.focus(); }, [selectedId, section]);

  const change = (next: RoleConfiguration) => {
    setRoles((current) => current.map((role) => role.id === next.id ? next : role));
    setFeedback("");
  };
  const addRole = () => {
    let name = "New role";
    for (let index = 2; roles.some((role) => role.name.toLowerCase() === name.toLowerCase()); index++) name = `New role ${index}`;
    const role: RoleConfiguration = { id: crypto.randomUUID(), name, description: "", permissions: [], memberIds: [] };
    setRoles((current) => [...current, role]); setSelectedId(role.id); setSection("display"); setQuery(""); setFeedback("");
  };
  const apply = () => {
    const problem = validateRoleConfigurations(roles);
    if (problem) { setFeedback(problem); return; }
    const normalized = roles.map((role) => ({ ...role, name: role.name.trim() }));
    setRoles(normalized); setSaved(normalized);
    setFeedback("Applied to this UI preview only. No server permissions or memberships changed.");
  };
  const search = query.trim().toLowerCase();
  const assignedMembers = selected ? members.filter((member) => selected.memberIds.includes(member.id)) : [];
  const visibleMembers = members.filter((member) => (addingMembers || selected?.memberIds.includes(member.id))
    && `${member.name} ${member.email}`.toLowerCase().includes(search));

  return <section className="role-config" aria-labelledby={`${panelId}-heading`}>
    <header className="role-config-intro"><div><span className="meta-label">ORGANIZATION / ACCESS DESIGN</span>
      <h2 id={`${panelId}-heading`}>Roles & permissions</h2></div>
      <span className="role-config-badge">UI PREVIEW · NOT SAVED TO SERVER</span></header>

    <div className="role-config-layout">
      <aside className="role-config-rail" aria-label="Custom roles"><div className="role-config-rail-heading"><span className="meta-label">CUSTOM ROLES · {roles.length}</span>
        <button type="button" className="secondary-button" onClick={addRole} aria-label="Create preview role">+</button></div>
        <div className="role-config-role-list">{roles.map((role) => <button type="button" key={role.id} aria-pressed={selectedId === role.id}
          className={selectedId === role.id ? "is-selected" : ""} onClick={() => { setSelectedId(role.id); setQuery(""); setAddingMembers(false); }}>
          <span className="role-config-dot" aria-hidden="true" /><span>{role.name || "Unnamed role"}<small>{role.permissions.length} permissions · {role.memberIds.length} members</small></span></button>)}</div>
        <div className="role-config-protected"><span className="meta-label">PROTECTED BY ARDEN</span><strong>Organization Admin</strong>
          </div>
      </aside>
      <div className="role-config-editor">{selected ? <>
        <header className="role-config-editor-heading"><div><span className="meta-label">EDIT ROLE</span><h3>{selected.name || "Unnamed role"}</h3></div>
          <span className="role-config-badge">Organization-local</span></header>
        <nav className="role-config-tabs" aria-label="Role configuration sections">
          {([{ id: "display", label: "Display" }, { id: "permissions", label: "Permissions" }, { id: "members", label: `Members (${assignedMembers.length})` }] as const).map((tab) =>
            <button type="button" key={tab.id} aria-pressed={section === tab.id} className={section === tab.id ? "is-active" : ""}
              onClick={() => { setSection(tab.id); setQuery(""); setAddingMembers(false); }}>{tab.label}</button>)}
        </nav>
        {section === "display" && <div className="role-config-display">
          <label className="organization-field"><span>Role name</span><input ref={nameInput} maxLength={80} value={selected.name} onChange={(event) => change({ ...selected, name: event.target.value })} /></label>
          <label className="organization-field"><span>Description</span><textarea rows={3} maxLength={300} value={selected.description} onChange={(event) => change({ ...selected, description: event.target.value })} /></label>

        </div>}
        {section === "permissions" && <>
          <label className="role-config-search"><span className="sr-only">Search permissions</span><input type="search" placeholder="Search permissions…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {(["Reading", "Contribution"] as const).map((group) => {
            const permissions = configurablePermissions.filter((permission) => permission.group === group && `${permission.name} ${permission.description}`.toLowerCase().includes(search));
            return permissions.length > 0 && <section className="role-config-permission-group" key={group} aria-label={`${group} permissions`}>
              <div className="role-config-group-heading"><h4>{group}</h4><button type="button" className="role-config-text-button"
                onClick={() => change({ ...selected, permissions: selected.permissions.filter((code) => !permissions.some((permission) => permission.code === code)) })}>Clear {search ? "matching" : group.toLowerCase()} permissions</button></div>
              {permissions.map((permission) => <div className="role-config-permission" key={permission.code}><div>
                <strong id={`${panelId}-${permission.code}`}>{permission.name}</strong></div>
                <button type="button" role="switch" aria-checked={selected.permissions.includes(permission.code)} aria-labelledby={`${panelId}-${permission.code}`}
                   className="role-config-switch" onClick={() => change(toggleRolePermission(selected, permission.code))}><span /></button></div>)}
            </section>;
          })}
          {!configurablePermissions.some((permission) => `${permission.name} ${permission.description}`.toLowerCase().includes(search)) && <p className="role-config-empty">No permissions match this search.</p>}

        </>}
        {section === "members" && <>
          <div className="role-config-member-toolbar"><label className="role-config-search"><span className="sr-only">Search role members</span><input type="search" placeholder="Search members…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
            <button type="button" className="secondary-button" aria-pressed={addingMembers} onClick={() => setAddingMembers(!addingMembers)}>{addingMembers ? "View assigned" : "Add members"}</button></div>

          {visibleMembers.length ? <ul className="role-config-members">{visibleMembers.map((member) => <li key={member.id}>
            <span className="role-config-avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.name}</strong><small>{member.email}{!member.active && " · Inactive"}</small></div>
            <button type="button" className="secondary-button" disabled={!member.active && !selected.memberIds.includes(member.id)}
              aria-label={`${selected.memberIds.includes(member.id) ? "Remove" : "Add"} ${member.name} ${selected.memberIds.includes(member.id) ? "from" : "to"} preview role`}
              onClick={() => change(toggleRoleMember(selected, member))}>{selected.memberIds.includes(member.id) ? "Remove" : "Add"}</button></li>)}</ul>
            : <div className="role-config-empty"><strong>{search ? "No matching members" : "No members assigned"}</strong></div>}
        </>}
      </> : <div className="role-config-empty"><h3>No custom roles yet</h3><button type="button" className="primary-button" onClick={addRole}>Create preview role</button></div>}</div>
    </div>
    {feedback && <p className="role-config-feedback" role="status">{feedback}</p>}
    {dirty && <footer className="role-config-save"><div><strong>Unapplied preview changes</strong><span>No changes will be sent to the Arden server.</span></div>
      <button type="button" className="secondary-button" onClick={() => setResetting(true)}>Reset</button><button type="button" className="primary-button" onClick={apply}>Apply to preview</button></footer>}
    {resetting && <DiscardChangesDialog exiting={false} onCancel={() => setResetting(false)} onDiscard={() => {
      setRoles(saved); if (!saved.some((role) => role.id === selectedId)) setSelectedId(saved[0]?.id ?? ""); setResetting(false); setFeedback("");
    }} />}
  </section>;
}
