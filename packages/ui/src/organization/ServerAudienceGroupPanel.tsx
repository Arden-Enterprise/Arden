import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, addAudienceGroupMember, deactivateAudienceGroup, loadAudienceGroups,
  removeAudienceGroupMember, saveAudienceGroup } from "../shared/api-client";
import type { AudienceGroupRecord, AudienceGroupWrite } from "../shared/audience-group-contracts";
import type { Platform } from "../shared/types";
import { DiscardChangesDialog } from "../shared/DiscardChangesDialog";
import { Icon } from "../shared/Icon";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";

type Props = {
  platform: Platform;
  organizationId: string;
  members: Array<{ id: string; name: string; email: string; status: string }>;
  onDirtyChange?: (dirty: boolean) => void;
  onGroupsChanged?: () => void;
  createSignal?: number;
};

const emptyWrite = (): AudienceGroupWrite => ({ name: "", description: "" });
const groupWrite = (group: AudienceGroupRecord): AudienceGroupWrite =>
  ({ name: group.name, description: group.description });

export function ServerAudienceGroupPanel({ platform, organizationId, members, onDirtyChange,
  onGroupsChanged, createSignal = 0 }: Props) {
  const [groups, setGroups] = useState<AudienceGroupRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  const [removeMembershipId, setRemoveMembershipId] = useState<string | null>(null);
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
      setGroups(loaded); setSelectedId(loaded[0]?.id ?? null);
      setCreating(false); setDraft(loaded[0] ? groupWrite(loaded[0]) : emptyWrite());
    } catch (cause) {
      if (mounted.current && generation === requestGeneration.current) {
        setError(cause instanceof Error ? cause.message : "Audience groups are unavailable.");
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
    setSelectedId(group.id); setDraft(groupWrite(group)); setCreating(false);
    setQuery(""); setError(""); setMessage("");
  };
  const guard = (action: () => void) => { if (dirty) setDiscardAction(() => action); else action(); };
  const startNew = () => {
    setSelectedId(null); setCreating(true); setDraft(emptyWrite()); setSection("details");
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
      setSelectedId(updated.id); setDraft(groupWrite(updated)); setCreating(false); setMessage(success);
      onGroupsChanged?.();
      return true;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof ApiError && cause.status === 412
        ? "The audience group changed elsewhere. Reload before saving again."
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
  const eligibleMembers = members.filter(member => member.status === "ACTIVE"
    && !activeMembers.some(groupMember => groupMember.membershipId === member.id));

  return <section className="role-config" aria-label="Audience group configuration">
    <header className="role-config-intro"><div><h2>Audience groups</h2><p>Groups only control who may read approved knowledge.</p></div><span className="role-config-badge">SERVER MANAGED</span></header>
    {error && <div className="role-config-feedback" role="alert"><span>{error}</span><button className="secondary-button" type="button" disabled={busy || loading} onClick={() => guard(() => void load())}>Reload groups</button></div>}
    {message && <p className="role-config-feedback" role="status">{message}</p>}
    {loading ? <p className="role-config-empty" role="status">Loading audience groups…</p>
      : error && !groups.length && !creating ? null : <div className="role-config-layout">
        <aside className="role-config-rail" aria-label="Audience groups">
          <div className="role-config-rail-heading"><span className="meta-label">AUDIENCE GROUPS · {groups.length}</span>
            <button className="secondary-button" type="button" aria-label="Create audience group" disabled={busy} onClick={() => guard(startNew)}><Icon name="plus" /></button></div>
          <div className="role-config-role-list">{groups.map(group => <button type="button" key={group.id} disabled={busy}
            aria-pressed={selectedId === group.id} className={selectedId === group.id ? "is-selected" : ""} onClick={() => guard(() => select(group))}>
            <span className="role-config-dot" aria-hidden="true"/><span>{group.name}<small>{group.status === "INACTIVE" ? "Inactive" : `${group.members.filter(member => member.status === "ACTIVE").length} members`}</small></span>
          </button>)}</div>
          <div className="role-config-protected"><span className="meta-label">MANAGED AUDIENCES</span><strong>Organization and departments</strong><small>Membership is derived automatically.</small></div>
        </aside>
        <div className="role-config-editor">{selected || creating ? <>
          <header className="role-config-editor-heading"><h3>{draft.name || "New audience group"}</h3><span className="role-config-badge">{selected?.status ?? "UNSAVED"}</span></header>
          <nav className="role-config-tabs" aria-label="Audience group sections">{(["details", "members"] as const).map(tab =>
            <button key={tab} type="button" disabled={creating && tab === "members"} aria-pressed={section === tab} className={section === tab ? "is-active" : ""}
              onClick={() => { setSection(tab); setQuery(""); }}>{tab === "details" ? "Details" : `Members (${activeMembers.length})`}</button>)}</nav>
          {section === "details" && <div className="role-config-display">
            <label className="organization-field"><span>Group name *</span><input maxLength={80} value={draft.name} disabled={disabled}
              aria-invalid={nameSubmitted && !draft.name.trim()} aria-describedby="audience-group-name-help"
              onChange={event => setDraft({ ...draft, name: event.target.value })}/><small id="audience-group-name-help" className={nameSubmitted && !draft.name.trim() ? "field-error" : ""}>{nameSubmitted && !draft.name.trim() ? "Enter a group name." : "Visible only to members who can target this audience."}</small></label>
            <label className="organization-field"><span>Description (optional)</span><textarea maxLength={300} rows={3} value={draft.description} disabled={disabled} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
            {selected?.status === "ACTIVE" && <div className="role-config-danger-zone"><strong>Deactivate audience group</strong><p>Current publications or pending reviews prevent deactivation.</p><button className="admin-text-danger" type="button" disabled={busy || dirty} onClick={() => setDeactivationOpen(true)}>Deactivate…</button></div>}
          </div>}
          {section === "members" && <>
            <label className="role-config-search"><span className="sr-only">Search group members</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search members…"/></label>
            <ul className="role-config-members">{visibleMembers.map(groupMember => {
              const member = members.find(item => item.id === groupMember.membershipId);
              return <li key={groupMember.id}><div><strong>{member?.name ?? "Member"}</strong><small>{member?.email}</small></div>
                <button type="button" className="admin-text-danger" disabled={busy || dirty} aria-label={`Remove ${member?.name ?? "member"} from audience group`} onClick={() => setRemoveMembershipId(groupMember.id)}>Remove…</button></li>;
            })}</ul>
            {!visibleMembers.length && <p className="role-config-empty">No matching members.</p>}
            {selected?.status === "ACTIVE" && <form className="role-config-display" onSubmit={event => {
              event.preventDefault(); if (!selected || !memberId || dirty) return;
              void mutate(() => addAudienceGroupMember(platform, organizationId, selected.id, memberId), "Member added to audience group.").then(success => { if (success) setMemberId(""); });
            }}><label className="organization-field"><span>Member</span><select required value={memberId} disabled={busy || dirty} onChange={event => setMemberId(event.target.value)}>
              <option value="">Choose active member</option>{eligibleMembers.map(member => <option key={member.id} value={member.id}>{member.name} · {member.email}</option>)}</select></label>
              <button type="submit" className="primary-button" disabled={busy || dirty || !memberId}>Add member</button></form>}
            {creating && <p role="status">Save the audience group before adding members.</p>}
          </>}
        </> : <div className="role-config-empty"><h3>No audience groups yet</h3><p>Organization and department audiences remain available automatically.</p><button className="primary-button" type="button" onClick={startNew}>Create audience group</button></div>}</div>
      </div>}
    {dirty && <footer className="role-config-save"><strong>Unsaved audience group changes</strong>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => { setCreating(false); setDraft(selected ? groupWrite(selected) : emptyWrite()); setNameSubmitted(false); }}>Reset</button>
      <button type="button" className="primary-button" disabled={busy} onClick={() => { setNameSubmitted(true); if (!draft.name.trim()) { setSection("details"); return; } void mutate(() => saveAudienceGroup(platform, organizationId, selected, draft), "Audience group saved."); }}>{busy ? "Saving…" : "Save group"}</button>
    </footer>}
    {discardAction && (
      <DiscardChangesDialog
        exiting={false}
        onCancel={() => setDiscardAction(null)}
        onDiscard={() => { discardAction(); setDiscardAction(null); }}
      />
    )}
    {deactivationOpen && <KnowledgeDialog confirmation title={`Deactivate ${selected?.name}?`} onClose={() => setDeactivationOpen(false)} dismissible={!busy}>
      <p>Members will lose access granted by this group. Current publications and pending reviews must be moved first.</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" autoFocus disabled={busy} onClick={() => setDeactivationOpen(false)}>Cancel</button>
        <button className="admin-danger-button" type="button" disabled={busy} onClick={() => { if (selected) void mutate(() => deactivateAudienceGroup(platform, organizationId, selected), "Audience group deactivated.").then(success => { if (success) setDeactivationOpen(false); }); }}>{busy ? "Working…" : "Deactivate group"}</button></div>
    </KnowledgeDialog>}
    {removeMembershipId && selected && <KnowledgeDialog confirmation title={`Remove member from ${selected.name}?`} onClose={() => setRemoveMembershipId(null)} dismissible={!busy}>
      <p>The member will lose access granted by this audience group on their next request.</p>
      <div className="dialog-actions"><button className="secondary-button" type="button" autoFocus disabled={busy} onClick={() => setRemoveMembershipId(null)}>Cancel</button>
        <button className="admin-danger-button" type="button" disabled={busy} onClick={() => { void mutate(() => removeAudienceGroupMember(platform, organizationId, selected.id, removeMembershipId), "Member removed from audience group.").then(success => { if (success) setRemoveMembershipId(null); }); }}>{busy ? "Working…" : "Remove member"}</button></div>
    </KnowledgeDialog>}
  </section>;
}
