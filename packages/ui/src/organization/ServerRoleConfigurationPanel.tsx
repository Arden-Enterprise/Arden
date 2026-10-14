import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError, assignCustomRole, deactivateCustomRole, loadCustomRoles, revokeCustomRole, saveCustomRole } from "../shared/api-client";
import type { CustomRoleRecord, CustomRoleWrite } from "../shared/role-contracts";
import type { Platform } from "../shared/types";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { Icon } from "../shared/Icon";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";

type Props = {
  platform: Platform; organizationId: string;
  members: Array<{ id: string; name: string; email: string; status: string; departmentId: string | null; departmentIds?: string[] }>;
  departments: Array<{ id: string; name: string }>;
  onDirtyChange?: (dirty: boolean) => void;
};
const emptyWrite = (): CustomRoleWrite => ({ name: "", description: "", permissions: [] });
function roleWrite(role: CustomRoleRecord): CustomRoleWrite {
  return { name: role.name, description: role.description, permissions: [...role.permissions] };
}

export function ServerRoleConfigurationPanel({ platform, organizationId, members, departments, onDirtyChange }: Props) {
  const [roles, setRoles] = useState<CustomRoleRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CustomRoleWrite>(emptyWrite);
  const [section, setSection] = useState<"display" | "permissions" | "members">("permissions");
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [scope, setScope] = useState("ORGANIZATION");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [deactivationOpen, setDeactivationOpen] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const requestGeneration = useRef(0);
  const permissionId = useId();
  const selected = roles.find(role => role.id === selectedId) ?? null;
  const dirty = creating || Boolean(selected && JSON.stringify(draft) !== JSON.stringify(roleWrite(selected)));
  const disabled = busy || selected?.status === "INACTIVE";
  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true); setError("");
    try {
      const loaded = await loadCustomRoles(platform, organizationId);
      if (!mounted.current || generation !== requestGeneration.current) return;
      setRoles(loaded); setSelectedId(loaded[0]?.id ?? null);
      setCreating(false); setDraft(loaded[0] ? roleWrite(loaded[0]) : emptyWrite());
    } catch (cause) {
      if (mounted.current && generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : "Role configuration is unavailable.");
    } finally {
      if (mounted.current && generation === requestGeneration.current) setLoading(false);
    }
  }, [platform, organizationId]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; requestGeneration.current++; }; }, [load]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const select = (role: CustomRoleRecord) => {
    setSelectedId(role.id); setDraft(roleWrite(role)); setCreating(false); setQuery(""); setError(""); setMessage("");
  };
  const guard = (action: () => void) => { if (dirty) setDiscardAction(() => action); else action(); };
  const startNew = () => { setSelectedId(null); setCreating(true); setDraft(emptyWrite()); setSection("display"); setError(""); setMessage(""); };
  const mutate = async (action: () => Promise<CustomRoleRecord>, success: string) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const updated = await action();
      if (!mounted.current) return;
      setRoles(current => current.some(role => role.id === updated.id)
        ? current.map(role => role.id === updated.id ? updated : role) : [...current, updated]);
      setSelectedId(updated.id); setDraft(roleWrite(updated)); setCreating(false); setMessage(success);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && cause.status === 412
        ? "The role changed elsewhere. Reload before saving again."
        : cause instanceof Error ? cause.message : "The change could not be saved.");
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const activeAssignments = selected?.assignments.filter(assignment => assignment.status === "ACTIVE") ?? [];
  const search = query.trim().toLowerCase();
  const visibleAssignments = activeAssignments.filter(assignment => {
    const member = members.find(member => member.id === assignment.membershipId);
    return `${member?.name ?? ""} ${member?.email ?? ""}`.toLowerCase().includes(search);
  });
  const eligibleMembers = members.filter(member => member.status === "ACTIVE"
    && (scope === "ORGANIZATION" || (member.departmentIds ?? [member.departmentId]).includes(scope)));

  return <section className="role-config" aria-label="Server role configuration">
    <header className="role-config-intro"><h2>Roles & permissions</h2><span className="role-config-badge">SERVER MANAGED</span>
      <button className="secondary-button" type="button" disabled={busy || loading} onClick={() => guard(() => void load())}>Reload roles</button></header>
    {error && <p className="role-config-feedback" role="alert">{error}</p>}
    {message && <p className="role-config-feedback" role="status">{message}</p>}
    {loading ? <p className="role-config-empty" role="status">Loading roles…</p> : error && !roles.length && !creating ? null : <div className="role-config-layout">
      <aside className="role-config-rail" aria-label="Custom roles">
        <div className="role-config-rail-heading"><span className="meta-label">CUSTOM ROLES · {roles.length}</span>
          <button className="secondary-button" type="button" aria-label="Create custom role" disabled={busy} onClick={() => guard(startNew)}><Icon name="plus" /></button></div>
        <div className="role-config-role-list">{roles.map(role => <button type="button" key={role.id} disabled={busy}
          aria-pressed={selectedId === role.id} className={selectedId === role.id ? "is-selected" : ""} onClick={() => guard(() => select(role))}>
          <span className="role-config-dot" aria-hidden="true" /><span>{role.name}<small>{role.status === "INACTIVE" ? "Inactive" : `${role.permissions.length} permissions`}</small></span>
        </button>)}</div>
        <div className="role-config-protected"><span className="meta-label">PROTECTED BY ARDEN</span><strong>Organization Admin</strong></div>
      </aside>
      <div className="role-config-editor">{selected || creating ? <>
        <header className="role-config-editor-heading"><h3>{draft.name || "New role"}</h3><span className="role-config-badge">{selected?.status ?? "UNSAVED"}</span></header>
        <nav className="role-config-tabs" aria-label="Role configuration sections">{(["display", "permissions", "members"] as const).map(tab =>
          <button key={tab} type="button" aria-pressed={section === tab} className={section === tab ? "is-active" : ""} onClick={() => { setSection(tab); setQuery(""); }}>
            {tab === "members" ? `Members (${activeAssignments.length} assignments)` : tab === "display" ? "Display" : "Permissions"}
          </button>)}</nav>
        {section === "display" && <div className="role-config-display">
          <label className="organization-field"><span>Role name</span><input maxLength={80} value={draft.name} disabled={disabled} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
          <label className="organization-field"><span>Description</span><textarea maxLength={300} rows={3} value={draft.description} disabled={disabled} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
          {selected?.status === "ACTIVE" && <button className="secondary-button" type="button" disabled={busy || dirty} onClick={() => setDeactivationOpen(true)}>Deactivate role</button>}
        </div>}
        {section === "permissions" && <section className="role-config-permission-group"><h4>Reading</h4>
          <div className="role-config-permission"><strong id={permissionId}>Read published knowledge</strong>
            <button type="button" role="switch" className="role-config-switch" aria-labelledby={permissionId}
              aria-checked={draft.permissions.includes("PUBLISHED_CONTENT_VIEW")} disabled={disabled}
              onClick={() => setDraft({ ...draft, permissions: draft.permissions.length ? [] : ["PUBLISHED_CONTENT_VIEW"] })}><span /></button></div>
        </section>}
        {section === "members" && <>
          <label className="role-config-search"><span className="sr-only">Search role assignments</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search members…" /></label>
          <ul className="role-config-members">{visibleAssignments.map(assignment => {
            const member = members.find(member => member.id === assignment.membershipId);
            const scopeLabel = assignment.scope.type === "ORGANIZATION" ? "Organization"
              : departments.find(department => department.id === assignment.scope.departmentId)?.name ?? "Department";
            return <li key={assignment.id}><div><strong>{member?.name ?? "Member"}</strong><small>{member?.email} · {scopeLabel}</small></div>
              <button type="button" className="secondary-button" disabled={busy || dirty} aria-label={`Revoke ${member?.name ?? "member"} role in ${scopeLabel}`}
                onClick={() => selected && void mutate(() => revokeCustomRole(platform, organizationId, selected.id, assignment.id), "Role assignment revoked.")}>Revoke</button></li>;
          })}</ul>
          {!visibleAssignments.length && <p className="role-config-empty">No matching assignments.</p>}
          {selected?.status === "ACTIVE" && <form className="role-config-display" onSubmit={event => {
            event.preventDefault(); if (!selected || !memberId || dirty) return;
            void mutate(() => assignCustomRole(platform, organizationId, selected.id, memberId, scope === "ORGANIZATION"
              ? { type: "ORGANIZATION", departmentId: null } : { type: "DEPARTMENT", departmentId: scope }), "Role assigned.");
          }}>
            <label className="organization-field"><span>Scope</span><select value={scope} disabled={busy || dirty} onChange={event => { setScope(event.target.value); setMemberId(""); }}>
              <option value="ORGANIZATION">Organization</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
            </select></label>
            <label className="organization-field"><span>Member</span><select required value={memberId} disabled={busy || dirty} onChange={event => setMemberId(event.target.value)}>
              <option value="">Choose member</option>{eligibleMembers.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}
            </select></label><button type="submit" className="primary-button" disabled={busy || dirty || !memberId}>Assign role</button>
          </form>}
          {creating && <p role="status">Save the role before assigning members.</p>}
        </>}
      </> : <div className="role-config-empty"><h3>No custom roles yet</h3><button className="primary-button" type="button" onClick={startNew}>Create custom role</button></div>}</div></div>}
    {dirty && <footer className="role-config-save"><strong>Unsaved role changes</strong>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => guard(() => { setCreating(false); setDraft(selected ? roleWrite(selected) : emptyWrite()); })}>Reset</button>
      <button type="button" className="primary-button" disabled={busy || !draft.name.trim()} onClick={() => void mutate(() => saveCustomRole(platform, organizationId, selected, draft), "Role saved.")}>{busy ? "Saving…" : "Save role"}</button>
    </footer>}
    {discardAction && <DiscardChangesDialog exiting={false} onCancel={() => setDiscardAction(null)} onDiscard={() => { discardAction(); setDiscardAction(null); }} />}
    {deactivationOpen && <KnowledgeDialog title={`Deactivate ${selected?.name}?`} onClose={() => setDeactivationOpen(false)}>
      <p>Assignments will no longer grant access. Roles used by current publications or pending reviews cannot be deactivated.</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDeactivationOpen(false)}>Cancel</button>
        <button className="primary-button" type="button" disabled={busy} onClick={() => { setDeactivationOpen(false); if (selected) void mutate(() => deactivateCustomRole(platform, organizationId, selected), "Role deactivated."); }}>Deactivate</button></div>
    </KnowledgeDialog>}
  </section>;
}
