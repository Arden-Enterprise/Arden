import { useEffect, useState } from "react";
import { ApiError, findKnowledgeReaders, type KnowledgeReaderMatch, type TargetReaders } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { Icon } from "../shared/Icon";

const modeLabels: Record<TargetReaders["mode"], string> = {
  ORGANIZATION: "Everyone in organization", DEPARTMENT: "Department", SELECTED_MEMBERS: "Selected members",
};

/** True when the selection is complete enough to send; the server still validates membership and limits. */
export function targetReadersComplete(readers: TargetReaders | null | undefined): boolean {
  return Boolean(readers && (readers.mode === "ORGANIZATION"
    || (readers.mode === "DEPARTMENT" && readers.departmentId)
    || (readers.mode === "SELECTED_MEMBERS" && readers.memberIds.length >= 2 && readers.memberIds.length <= 100)));
}

/**
 * Target Readers picker: everyone, one department, or 2–100 members found by name or email (decision 0021).
 * `modes` limits the offered choices (for example when a reviewer may only narrow), and `memberFilter`
 * hides search results that the selection could not accept.
 */
export function TargetReadersField({ readers, departments, busy, platform, organizationId, onReaders,
  legend = "Target Readers *", modes = ["ORGANIZATION", "DEPARTMENT", "SELECTED_MEMBERS"], memberFilter }: {
  readers: TargetReaders | null; departments: Array<{ id: string; name: string }>; busy: boolean;
  platform: Platform; organizationId: string; onReaders: (value: TargetReaders) => void;
  legend?: string; modes?: ReadonlyArray<TargetReaders["mode"]>; memberFilter?: (member: KnowledgeReaderMatch) => boolean;
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
  const available = memberFilter ? matches.filter(memberFilter) : matches;
  const offered = available.filter(member => readers?.mode === "SELECTED_MEMBERS" && !readers.memberIds.includes(member.id));

  return <fieldset className="km-readers" disabled={busy}><legend>{legend}</legend>
    <select aria-label={legend.replace(/\s*\*$/, "")} value={readers?.mode ?? ""} onChange={event => {
      const mode = event.target.value as TargetReaders["mode"];
      onReaders({ mode, departmentId: null, memberIds: [] }); setQuery(""); setMatches([]);
    }}><option value="" disabled>Choose readers</option>
      {modes.map(mode => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select>
    {readers?.mode === "DEPARTMENT" && <select aria-label="Reader department" value={readers.departmentId ?? ""} onChange={event => onReaders({ ...readers, departmentId: event.target.value || null })}>
      <option value="">Choose department</option>{departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select>}
    {readers?.mode === "SELECTED_MEMBERS" && <>
      <div className="km-selected-readers">{readers.memberIds.map(id => <button key={id} type="button" title={known[id]?.email}
        onClick={() => onReaders({ ...readers, memberIds: readers.memberIds.filter(member => member !== id) })}>
        {known[id]?.name ?? "Selected member"}<Icon name="close" size={11} /><span className="sr-only">Remove {known[id]?.name ?? "member"}</span></button>)}</div>
      {/* Decision 0021: add people by name or email, like sharing in Google Drive; only this organization's members. */}
      <input type="search" maxLength={80} aria-label="Add people by name or email" placeholder="Add people by name or email"
        value={query} onChange={event => setQuery(event.target.value)} />
      {query.trim().length >= 2 && <ul className="km-member-results">{offered.map(member => <li key={member.id}><button type="button" disabled={readers.memberIds.length >= 100}
        aria-label={`Add ${member.name}${member.email ? `, ${member.email}` : ""}`}
        onClick={() => { onReaders({ ...readers, memberIds: [...readers.memberIds, member.id] }); setQuery(""); }}>
        <span className="km-member-identity"><strong>{member.name}</strong>
          {(member.email || member.department) && <small>{[member.email, member.department].filter(Boolean).join(" · ")}</small>}</span>
        <Icon name="plus" size={12} /></button></li>)}</ul>}
      <small role="status">{searching ? "Finding members…" : error || (query.trim().length >= 2 && !available.length
        ? (query.includes("@") ? "No member with this email in this organization." : "No members found.")
        : `${readers.memberIds.length} selected · choose 2–100`)}</small>
    </>}
  </fieldset>;
}
