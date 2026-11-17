import { useEffect, useState } from "react";
import { knowledgeTypes, type KnowledgeMetadata } from "@arden/domain";
import { ApiError, findKnowledgeReaders, type KnowledgeCatalogEntry, type KnowledgeReaderMatch, type TargetReaders } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { Icon } from "../shared/Icon";

export function editableKnowledgeMetadata(value: KnowledgeMetadata): KnowledgeMetadata {
  // The response may carry server-owned snapshot labels; never send them as inputs.
  // A publication is in force from approval (requested 15 Nov 2026), so saving clears any older effective date.
  return { type: value.type, topicId: value.topicId, version: value.version, effectiveDate: null,
    expirationDate: value.expirationDate, changeNote: value.changeNote };
}

export function targetReadersLabel(readers: TargetReaders | null | undefined, departmentName: (id: string | null) => string): string {
  if (!readers) return "Not selected";
  if (readers.mode === "ORGANIZATION") return "Everyone in organization";
  if (readers.mode === "DEPARTMENT") return departmentName(readers.departmentId);
  return `${readers.memberIds.length} selected members`;
}

export function KnowledgeMetadataFields({ value, readers, topics, catalogError, departments, busy, isUpdate, platform, organizationId, onChange, onReaders }: {
  value: KnowledgeMetadata; readers: TargetReaders | null; topics: KnowledgeCatalogEntry[]; catalogError?: string;
  departments: Array<{ id: string; name: string }>; busy: boolean; isUpdate: boolean; platform: Platform; organizationId: string;
  onChange: (value: KnowledgeMetadata) => void; onReaders: (value: TargetReaders) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<KnowledgeReaderMatch[]>([]);
  const [known, setKnown] = useState<Record<string, KnowledgeReaderMatch>>({});
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const memberKey = readers?.mode === "SELECTED_MEMBERS" ? readers.memberIds.join(",") : "";
  useEffect(() => {
    if (readers?.mode !== "SELECTED_MEMBERS") return;
    let present = true;
    const ids = memberKey ? memberKey.split(",") : [];
    if (query.trim().length < 2 && !ids.length) { setMatches([]); return; }
    const timer = window.setTimeout(() => {
      setSearching(true); setError("");
      void findKnowledgeReaders(platform, organizationId, query, ids).then(items => {
        if (!present) return;
        setMatches(items); setKnown(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.id, item])) }));
      }).catch(cause => { if (present) setError(cause instanceof ApiError ? cause.message : "Couldn’t load members."); })
        .finally(() => { if (present) setSearching(false); });
    }, 250);
    return () => { present = false; window.clearTimeout(timer); };
  }, [platform, organizationId, query, memberKey, readers?.mode]);

  return <div className="km-metadata-fields">
    <label className="island-field">Type *<select disabled={busy} value={value.type ?? ""} onChange={event => onChange({ ...value, type: (event.target.value || null) as KnowledgeMetadata["type"] })}>
      <option value="">Choose type</option>{knowledgeTypes.map(type => <option key={type}>{type}</option>)}</select></label>
    <label className="island-field">Topic *<select disabled={busy} value={value.topicId ?? ""} onChange={event => onChange({ ...value, topicId: event.target.value || null })}>
      <option value="">Choose topic</option>{topics.filter(topic => topic.status === "ACTIVE" || topic.id === value.topicId).map(topic => <option key={topic.id} value={topic.id} disabled={topic.status !== "ACTIVE"}>{topic.name}{topic.status !== "ACTIVE" ? " (Inactive)" : ""}</option>)}</select>
      {catalogError ? <small className="field-error" role="alert">Topic catalog is unavailable. Refresh and try again.</small>
        : !topics.some(topic => topic.status === "ACTIVE") && <small>Ask an Org Admin to add a Topic in Knowledge Library → Discover → Manage catalog.</small>}</label>
    <label className="island-field">Version *<input disabled={busy} maxLength={30} placeholder="e.g. 1.0" value={value.version} onChange={event => onChange({ ...value, version: event.target.value })} /></label>
    <label className="island-field">Valid until<input disabled={busy} type="date" value={value.expirationDate ?? ""} onChange={event => onChange({ ...value, effectiveDate: null, expirationDate: event.target.value || null })} />
      <small>Optional. The document applies from approval.</small></label>
    {isUpdate && <label className="island-field">Change Note *<textarea disabled={busy} rows={3} maxLength={1000} placeholder="What changed in this version?" value={value.changeNote} onChange={event => onChange({ ...value, changeNote: event.target.value })} /></label>}
    <fieldset className="km-readers" disabled={busy}><legend>Target Readers *</legend>
      <select aria-label="Target Readers" value={readers?.mode ?? ""} onChange={event => {
        const mode = event.target.value as TargetReaders["mode"];
        onReaders({ mode, departmentId: null, memberIds: [] }); setQuery(""); setMatches([]);
      }}><option value="" disabled>Choose readers</option><option value="ORGANIZATION">Everyone in organization</option>
        <option value="DEPARTMENT">Department</option><option value="SELECTED_MEMBERS">Selected members</option></select>
      {readers?.mode === "DEPARTMENT" && <select aria-label="Reader department" value={readers.departmentId ?? ""} onChange={event => onReaders({ ...readers, departmentId: event.target.value || null })}>
        <option value="">Choose department</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select>}
      {readers?.mode === "SELECTED_MEMBERS" && <>
        <div className="km-selected-readers">{readers.memberIds.map(id => <button key={id} type="button" title={known[id]?.email}
          onClick={() => onReaders({ ...readers, memberIds: readers.memberIds.filter(member => member !== id) })}>
          {known[id]?.name ?? "Selected member"}<Icon name="close" size={11} /><span className="sr-only">Remove {known[id]?.name ?? "member"}</span></button>)}</div>
        {/* Decision 0021: add people by name or email, like sharing in Google Drive; only this organization's members. */}
        <input type="search" maxLength={80} aria-label="Add people by name or email" placeholder="Add people by name or email"
          value={query} onChange={event => setQuery(event.target.value)} />
        {query.trim().length >= 2 && <ul className="km-member-results">{matches.filter(member => !readers.memberIds.includes(member.id)).map(member => <li key={member.id}><button type="button" disabled={readers.memberIds.length >= 100}
          aria-label={`Add ${member.name}${member.email ? `, ${member.email}` : ""}`}
          onClick={() => { onReaders({ ...readers, memberIds: [...readers.memberIds, member.id] }); setQuery(""); }}>
          <span className="km-member-identity"><strong>{member.name}</strong>
            {(member.email || member.department) && <small>{[member.email, member.department].filter(Boolean).join(" · ")}</small>}</span>
          <Icon name="plus" size={12} /></button></li>)}</ul>}
        <small role="status">{searching ? "Finding members…" : error || (query.trim().length >= 2 && !matches.length
          ? (query.includes("@") ? "No member with this email in this organization." : "No members found.")
          : `${readers.memberIds.length} selected · choose 2–100`)}</small>
      </>}
    </fieldset>
  </div>;
}
