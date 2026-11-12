import { useEffect, useState } from "react";
import { knowledgeTypes, type KnowledgeMetadata } from "@arden/domain";
import { ApiError, findKnowledgeReaders, type KnowledgeCatalogEntry, type TargetReaders } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { Icon } from "../shared/Icon";

export function editableKnowledgeMetadata(value: KnowledgeMetadata): KnowledgeMetadata {
  // The response may carry server-owned snapshot labels; never send them as inputs.
  return { type: value.type, topicId: value.topicId, version: value.version, effectiveDate: value.effectiveDate,
    expirationDate: value.expirationDate, changeNote: value.changeNote };
}

export function targetReadersLabel(readers: TargetReaders | null | undefined, departmentName: (id: string | null) => string): string {
  if (!readers) return "Not selected";
  if (readers.mode === "ORGANIZATION") return "Everyone in organization";
  if (readers.mode === "DEPARTMENT") return departmentName(readers.departmentId);
  return `${readers.memberIds.length} selected members`;
}

export function KnowledgeMetadataFields({ value, readers, topics, departments, busy, isUpdate, platform, organizationId, onChange, onReaders }: {
  value: KnowledgeMetadata; readers: TargetReaders | null; topics: KnowledgeCatalogEntry[];
  departments: Array<{ id: string; name: string }>; busy: boolean; isUpdate: boolean; platform: Platform; organizationId: string;
  onChange: (value: KnowledgeMetadata) => void; onReaders: (value: TargetReaders) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Array<{ id: string; name: string }>>([]);
  const [names, setNames] = useState<Record<string, string>>({});
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
        setMatches(items); setNames(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [item.id, item.name])) }));
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
      {!topics.some(topic => topic.status === "ACTIVE") && <small>Ask an admin to add a topic.</small>}</label>
    <label className="island-field">Version *<input disabled={busy} maxLength={30} placeholder="e.g. 1.0" value={value.version} onChange={event => onChange({ ...value, version: event.target.value })} /></label>
    <label className="island-field">Effective Date *<input disabled={busy} type="date" value={value.effectiveDate ?? ""} onChange={event => onChange({ ...value, effectiveDate: event.target.value || null })} /></label>
    <label className="island-field">Expiration Date<input disabled={busy} type="date" min={value.effectiveDate ?? undefined} value={value.expirationDate ?? ""} onChange={event => onChange({ ...value, expirationDate: event.target.value || null })} /></label>
    {value.effectiveDate && value.expirationDate && value.expirationDate < value.effectiveDate && <small className="field-error" role="alert">Expiration Date must be on or after Effective Date.</small>}
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
        <div className="km-selected-readers">{readers.memberIds.map(id => <button key={id} type="button" onClick={() => onReaders({ ...readers, memberIds: readers.memberIds.filter(member => member !== id) })}>
          {names[id] ?? "Selected member"}<Icon name="close" size={11} /><span className="sr-only">Remove</span></button>)}</div>
        <input type="search" maxLength={80} aria-label="Find members" placeholder="Search member names…" value={query} onChange={event => setQuery(event.target.value)} />
        {query.trim().length >= 2 && <ul className="km-member-results">{matches.filter(member => !readers.memberIds.includes(member.id)).map(member => <li key={member.id}><button type="button" disabled={readers.memberIds.length >= 100}
          onClick={() => { onReaders({ ...readers, memberIds: [...readers.memberIds, member.id] }); setQuery(""); }}>{member.name}<Icon name="plus" size={12} /></button></li>)}</ul>}
        <small role="status">{searching ? "Finding members…" : error || (query.trim().length >= 2 && !matches.length ? "No members found." : `${readers.memberIds.length} selected · choose 2–100`)}</small>
      </>}
    </fieldset>
  </div>;
}
