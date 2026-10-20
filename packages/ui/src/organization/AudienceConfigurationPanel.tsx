import { useEffect, useState } from "react";
import type { OrganizationMember } from "./previewModel";

type PreviewAudience = { id: string; name: string; description: string; memberIds: string[] };

export function AudienceConfigurationPanel({ members, onDirtyChange }: {
  members: OrganizationMember[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<PreviewAudience[]>([]);
  const [groups, setGroups] = useState<PreviewAudience[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const selected = groups.find(group => group.id === selectedId);
  const dirty = JSON.stringify(groups) !== JSON.stringify(saved);
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const update = (next: PreviewAudience) => setGroups(items => items.map(item => item.id === next.id ? next : item));
  const add = () => {
    const group = { id: crypto.randomUUID(), name: "New audience", description: "", memberIds: [] };
    setGroups(items => [...items, group]);
    setSelectedId(group.id);
  };
  return <div className="role-config-shell">
    <aside className="role-config-rail" aria-label="Audience groups"><div className="role-config-rail-heading">
      <span className="meta-label">AUDIENCE GROUPS · {groups.length}</span>
      <button type="button" className="secondary-button" onClick={add}>New group</button>
    </div><div className="role-config-role-list">{groups.map(group => <button type="button" key={group.id}
      aria-pressed={selectedId === group.id} onClick={() => setSelectedId(group.id)}><strong>{group.name}</strong>
      <small>{group.memberIds.length} readers</small></button>)}</div></aside>
    <section className="role-config-main">{selected ? <><div className="role-config-heading"><div>
      <span className="meta-label organization-jade">READERSHIP ONLY</span><h2>{selected.name}</h2>
      <p>Audience membership controls who may read matching published knowledge. It grants no administrative, review, edit, or publish capability.</p>
    </div></div><div className="role-config-section"><label className="organization-field"><span>Group name</span>
      <input value={selected.name} maxLength={80} onChange={event => update({ ...selected, name: event.target.value })}/></label>
      <label className="organization-field"><span>Description</span><textarea value={selected.description} maxLength={300}
        onChange={event => update({ ...selected, description: event.target.value })}/></label></div>
      <div className="role-config-section"><h3>Members</h3><div className="role-config-members">{members.map(member => <label key={member.id}>
        <input type="checkbox" disabled={member.status !== "active"} checked={selected.memberIds.includes(member.id)}
          onChange={event => update({ ...selected, memberIds: event.target.checked
            ? [...selected.memberIds, member.id] : selected.memberIds.filter(id => id !== member.id) })}/>
        <span><strong>{member.name}</strong><small>{member.email}</small></span></label>)}</div></div>
      <div className="organization-dialog-actions"><button type="button" className="secondary-button"
        disabled={!dirty} onClick={() => setGroups(saved)}>Discard</button><button type="button" className="primary-button"
        disabled={!dirty || groups.some(group => !group.name.trim())} onClick={() => setSaved(groups.map(group => ({ ...group,
          name: group.name.trim(), memberIds: [...group.memberIds] })))}>Save preview</button></div></>
      : <div className="role-config-empty"><h3>No audience groups yet</h3><p>Organization-wide and department-wide audiences are managed automatically.</p>
        <button type="button" className="primary-button" onClick={add}>Create preview group</button></div>}</section>
  </div>;
}
