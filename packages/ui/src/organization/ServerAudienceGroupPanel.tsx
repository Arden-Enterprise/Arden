import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, addAudienceGroupMember, deactivateAudienceGroup, loadAudienceGroups,
  removeAudienceGroupMember, saveAudienceGroup } from "../shared/api-client";
import type { AudienceGroupRecord, AudienceGroupWrite } from "../shared/audience-group-contracts";
import type { Platform } from "../shared/types";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { Icon } from "../shared/Icon";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";
import { ActionToast } from "../shared/ActionToast";
import { memberInitials } from "./AdminDetailIslands";

type Props = {
  platform: Platform;
  organizationId: string;
  organizationName: string;
  members: Array<{ id: string; name: string; email: string; status: string; departmentId: string | null; departmentIds?: string[] }>;
  departments: Array<{ id: string; name: string }>;
  onDirtyChange?: (dirty: boolean) => void;
  onGroupsChanged?: () => void;
  createSignal?: number;
};

const emptyWrite = (): AudienceGroupWrite => ({ name: "", description: "" });
const groupWrite = (group: AudienceGroupRecord): AudienceGroupWrite =>
  ({ name: group.name, description: group.description });

export function ServerAudienceGroupPanel({ platform, organizationId, organizationName, members, departments, onDirtyChange,
  onGroupsChanged, createSignal = 0 }: Props) {
  const [groups, setGroups] = useState<AudienceGroupRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** A managed (organization or department) audience shown read-only instead of a group. */
  const [managedId, setManagedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<AudienceGroupWrite>(emptyWrite);
  const [section, setSection] = useState<"details" | "members">("members");
  const [query, setQuery] = useState("");
  const [memberId, setMemberId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [deactivationOpen, setDeactivationOpen] = useState(false);
  /** The last removal, kept so the status-island toast can undo it by adding the member back. */
  const [removal, setRemoval] = useState<{ message: string; groupId: string; membershipId: string } | null>(null);
  const [nameSubmitted, setNameSubmitted] = useState(false);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const requestGeneration = useRef(0);
  const previousCreateSignal = useRef(createSignal);
  const selected = groups.find(group => group.id === selectedId) ?? null;
  const dirty = creating || Boolean(selected && JSON.stringify(draft) !== JSON.stringify(groupWrite(selected)));
  const disabled = busy || selected?.status === "INACTIVE";

  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setLoading(true); setError("");
    try {
      const loaded = await loadAudienceGroups(platform, organizationId);
      if (!mounted.current || generation !== requestGeneration.current) return;
      setGroups(loaded); setSelectedId(loaded[0]?.id ?? null); setManagedId(loaded.length ? null : "organization");
      setCreating(false); setDraft(loaded[0] ? groupWrite(loaded[0]) : emptyWrite());
    } catch (cause) {
      if (mounted.current && generation === requestGeneration.current) {
        setError(cause instanceof Error ? cause.message : "Reader groups are unavailable.");
      }
    } finally {
      if (mounted.current && generation === requestGeneration.current) setLoading(false);
    }
  }, [platform, organizationId]);

  useEffect(() => { mounted.current = true; void load(); return () => {
    mounted.current = false; requestGeneration.current++;
  }; }, [load]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const select = (group: AudienceGroupRecord) => {
    setSelectedId(group.id); setManagedId(null); setDraft(groupWrite(group)); setCreating(false);
    setQuery(""); setError(""); setMessage("");
  };
  const selectManaged = (id: string) => {
    setManagedId(id); setCreating(false); setDraft(selected ? groupWrite(selected) : emptyWrite());
    setError(""); setMessage("");
  };
  const guard = (action: () => void) => { if (dirty) setDiscardAction(() => action); else action(); };
  const closeDetails = () => guard(() => {
    setCreating(false); setSelectedId(null); setManagedId(null); setDraft(emptyWrite());
    setNameSubmitted(false); setError(""); setMessage(""); setMemberId("");
  });
  const startNew = () => {
    setSelectedId(null); setManagedId(null); setCreating(true); setDraft(emptyWrite()); setSection("details");
    setError(""); setMessage("");
  };
  useEffect(() => {
    if (createSignal === previousCreateSignal.current) return;
    previousCreateSignal.current = createSignal;
    guard(startNew);
  }, [createSignal]);

  const mutate = async (action: () => Promise<AudienceGroupRecord>, success: string) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const updated = await action();
      if (!mounted.current) return false;
      setGroups(current => current.some(group => group.id === updated.id)
        ? current.map(group => group.id === updated.id ? updated : group) : [...current, updated]);
      setSelectedId(updated.id); setManagedId(null); setDraft(groupWrite(updated)); setCreating(false); setMessage(success);
      onGroupsChanged?.();
      return true;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && cause.status === 412
        ? "This group has changed. Reload before saving."
        : cause instanceof Error ? cause.message : "The change could not be saved.");
      return false;
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const activeMembers = selected?.members.filter(member => member.status === "ACTIVE") ?? [];
  const search = query.trim().toLowerCase();
  const visibleMembers = activeMembers.filter(groupMember => {
    const member = members.find(item => item.id === groupMember.membershipId);
    return `${member?.name ?? ""} ${member?.email ?? ""}`.toLowerCase().includes(search);
  });
  const removeMember = (groupMember: AudienceGroupRecord["members"][number]) => {
    if (!selected || dirty) return;
    const group = selected;
    const name = members.find(item => item.id === groupMember.membershipId)?.name ?? "Member";
    void mutate(() => removeAudienceGroupMember(platform, organizationId, group.id, groupMember.id), "").then(success => {
      if (success) setRemoval({ message: `${name} removed from ${group.name}`, groupId: group.id, membershipId: groupMember.membershipId });
    });
  };
  const undoRemoval = () => {
    if (!removal) return;
    const { groupId, membershipId } = removal;
    void mutate(() => addAudienceGroupMember(platform, organizationId, groupId, membershipId), "Member added back to the reader group.");
  };
  const eligibleMembers = members.filter(member => member.status === "ACTIVE"
    && !activeMembers.some(groupMember => groupMember.membershipId === member.id));

  const activeOrganizationMembers = members.filter(member => member.status === "ACTIVE");
  const managedAudiences = [
    { id: "organization", section: "ORGANIZATION", name: `Everyone in ${organizationName}`, description: "All active members",
      count: activeOrganizationMembers.length, syncWith: "active organization membership" },
    ...departments.map(department => ({ id: department.id, section: "DEPARTMENTS", name: `Everyone in ${department.name}`, description: "Department members",
      count: activeOrganizationMembers.filter(member => (member.departmentIds ?? [member.departmentId]).includes(department.id)).length,
      syncWith: `${department.name} membership` })),
  ];
  const managed = managedAudiences.find(audience => audience.id === managedId) ?? null;
  const managedRow = (audience: (typeof managedAudiences)[number]) => <button type="button" key={audience.id} className="audience-row"
    aria-pressed={managedId === audience.id} disabled={busy} onClick={() => guard(() => selectManaged(audience.id))}>
    <span className="island-tile" aria-hidden="true"><Icon name={audience.id === "organization" ? "building" : "people"} size={16} /></span>
    <span className="audience-row-copy"><strong>{audience.name}</strong><small>{audience.description}</small></span>
    <span className="island-badge" aria-label={`${audience.count} readers`}>{audience.count}</span><span className="island-chip">Automatic</span>
  </button>;

  return <div className="island-split audience-layout" aria-label="Readers">
    <div className="island-main">
      {error && <div className="admin-feedback is-error audience-feedback" role="alert"><span>{error}</span><button className="secondary-button" type="button" disabled={busy || loading} onClick={() => guard(() => void load())}>Reload groups</button></div>}
      {loading ? <div className="island island-empty" role="status">Loading reader groups…</div> : <>
        <section className="island audience-list" aria-label="Organization readers">
          <div className="island-section-label"><span>ORGANIZATION</span><span>Managed by Arden</span></div>
          {managedAudiences.filter(audience => audience.section === "ORGANIZATION").map(managedRow)}
        </section>
        {departments.length > 0 && <section className="island audience-list" aria-label="Department readers">
          <div className="island-section-label"><span>DEPARTMENTS</span><span>Managed by Arden</span></div>
          {managedAudiences.filter(audience => audience.section === "DEPARTMENTS").map(managedRow)}
        </section>}
        <section className="island audience-list" aria-label="Reader groups">
          <div className="island-section-label"><span>GROUPS · {groups.length}</span><span>Managed by Org Admins</span></div>
          {groups.map(group => <button type="button" key={group.id} className="audience-row" disabled={busy}
            aria-pressed={!managedId && selectedId === group.id} onClick={() => guard(() => select(group))}>
            <span className="island-tile" aria-hidden="true"><Icon name="people" size={16} /></span>
            <span className="audience-row-copy"><strong>{group.name}</strong><small>{group.description || "Reader group"}</small></span>
            <span className="island-badge" aria-label={`${group.members.filter(member => member.status === "ACTIVE").length} readers`}>{group.members.filter(member => member.status === "ACTIVE").length}</span>
            <span className={`island-chip${group.status === "INACTIVE" ? "" : " tone-strong"}`}>{group.status === "INACTIVE" ? "Inactive" : "Group"}</span>
          </button>)}
          {!groups.length && !creating && <div className="island-empty"><p>No reader groups yet.</p>
            <button className="secondary-button" type="button" onClick={() => guard(startNew)}>Create reader group</button></div>}
          {creating && <div className="audience-row is-pending" aria-current="true"><span className="island-tile" aria-hidden="true"><Icon name="plus" size={16} /></span>
            <span className="audience-row-copy"><strong>{draft.name || "New reader group"}</strong><small>Not saved yet</small></span></div>}
        </section>
      </>}
    </div>
    {!loading && managed && <aside className="island island-panel island-side" aria-label="Audience details">
      <div className="island-side-header"><div><span className="meta-label">AUTOMATIC GROUP</span><h2>{managed.name}</h2><p>{managed.count} readers · {managed.description}</p></div></div>
    </aside>}
    {!loading && !managed && (selected || creating) && <aside className="island island-panel island-side" aria-label="Reader group details">
      <div className="island-side-header"><div><span className="meta-label">READER GROUP</span><h2>{draft.name || "New reader group"}</h2>
        <p>{creating ? "Not saved yet" : `${activeMembers.length} readers · ${selected?.status === "INACTIVE" ? "Inactive" : "Active"}`}</p></div>
        <button type="button" className="island-icon-button" disabled={busy} aria-label="Close reader group details" onClick={closeDetails}><Icon name="close" size={16} /></button></div>
      {message && <p className="admin-feedback" role="status">{message}</p>}
      <div className="island-seg" role="group" aria-label="Reader group sections">{(["members", "details"] as const).map(tab =>
        <button key={tab} type="button" disabled={creating && tab === "members"} aria-pressed={section === tab}
          onClick={() => { setSection(tab); setQuery(""); }}>{tab === "details" ? "Details" : "Members"}{tab === "members" && <span className="island-badge">{activeMembers.length}</span>}</button>)}</div>
      {section === "details" && <div className="audience-details">
        <label className="organization-field"><span>Group name</span><input maxLength={80} value={draft.name} disabled={disabled}
          aria-invalid={nameSubmitted && !draft.name.trim()} aria-describedby="audience-group-name-help"
          onChange={event => setDraft({ ...draft, name: event.target.value })}/><small id="audience-group-name-help" className={nameSubmitted && !draft.name.trim() ? "field-error" : ""}>{nameSubmitted && !draft.name.trim() ? "Enter a group name." : ""}</small></label>
        <label className="organization-field"><span>Description (optional)</span><textarea maxLength={300} rows={3} value={draft.description} disabled={disabled} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
        {selected?.status === "ACTIVE" && <div className="role-config-danger-zone"><strong>Deactivate reader group</strong><button className="admin-text-danger" type="button" disabled={busy || dirty} onClick={() => setDeactivationOpen(true)}>Deactivate…</button></div>}
      </div>}
      {section === "members" && <>
        {selected?.status === "ACTIVE" && <form className="audience-add" onSubmit={event => {
          event.preventDefault(); if (!selected || !memberId || dirty) return;
          void mutate(() => addAudienceGroupMember(platform, organizationId, selected.id, memberId), "Member added to reader group.").then(success => { if (success) setMemberId(""); });
        }}><label className="organization-field"><span className="sr-only">Add an active member</span><select required value={memberId} disabled={busy || dirty} onChange={event => setMemberId(event.target.value)}>
          <option value="">Add an active member</option>{eligibleMembers.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
          <button type="submit" className="secondary-button" disabled={busy || dirty || !memberId}>Add</button></form>}
        {activeMembers.length > 4 && <label className="workspace-search"><Icon name="search" size={14} /><span className="sr-only">Search group members</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search members"/></label>}
        <ul className="audience-members">{visibleMembers.map(groupMember => {
          const member = members.find(item => item.id === groupMember.membershipId);
          return <li key={groupMember.id}><span className="island-avatar is-small" aria-hidden="true">{memberInitials(member?.name ?? "Member")}</span>
            <span><strong>{member?.name ?? "Member"}</strong><small>{member?.email}</small></span>
            <button type="button" className="island-icon-button" disabled={busy || dirty} aria-label={`Remove ${member?.name ?? "member"} from reader group`} onClick={() => removeMember(groupMember)}><Icon name="close" size={14} /></button></li>;
        })}</ul>
        {!visibleMembers.length && <p className="island-meta">{activeMembers.length ? "No matching members." : "No members yet."}</p>}
        {creating && <p role="status" className="island-meta">Save the reader group before adding members.</p>}
      </>}
      {dirty && <footer className="audience-save"><strong>Unsaved changes</strong>
        <button type="button" className="secondary-button" disabled={busy} onClick={closeDetails}>Cancel</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => { setNameSubmitted(true); if (!draft.name.trim()) { setSection("details"); return; } void mutate(() => saveAudienceGroup(platform, organizationId, selected, draft), "Reader group saved."); }}>{busy ? "Saving…" : "Save group"}</button>
      </footer>}
    </aside>}
    {discardAction && (
      <DiscardChangesDialog
        exiting={false}
        onCancel={() => setDiscardAction(null)}
        onDiscard={() => { discardAction(); setDiscardAction(null); }}
      />
    )}
    {deactivationOpen && <KnowledgeDialog confirmation title={`Deactivate ${selected?.name}?`} onClose={() => setDeactivationOpen(false)} dismissible={!busy}>
      <p>This group must not be used by published documents or pending reviews.</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" autoFocus disabled={busy} onClick={() => setDeactivationOpen(false)}>Cancel</button>
        <button className="admin-danger-button" type="button" disabled={busy} onClick={() => { if (selected) void mutate(() => deactivateAudienceGroup(platform, organizationId, selected), "Reader group deactivated.").then(success => { if (success) setDeactivationOpen(false); }); }}>{busy ? "Working…" : "Deactivate group"}</button></div>
    </KnowledgeDialog>}
    <ActionToast message={removal?.message ?? ""} onDismiss={() => setRemoval(null)} action={removal ? { label: "Undo", run: undoRemoval } : undefined} />
  </div>;
}
