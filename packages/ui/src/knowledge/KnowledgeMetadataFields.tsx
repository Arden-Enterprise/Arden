import { knowledgeTypes, type KnowledgeMetadata } from "@arden/domain";
import type { KnowledgeCatalogEntry, TargetReaders } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { TargetReadersField } from "./TargetReadersField";

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
    <TargetReadersField readers={readers} departments={departments} busy={busy} platform={platform}
      organizationId={organizationId} onReaders={onReaders} />
  </div>;
}
