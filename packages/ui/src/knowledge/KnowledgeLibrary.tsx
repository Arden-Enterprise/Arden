import { useState } from "react";
import { SearchField } from "../shared/SearchField";
import { useSearchShortcut } from "../shared/useSearchShortcut";
import { KnowledgeBadge, KnowledgeConnections, KnowledgeHeading, KnowledgeRow } from "./KnowledgePrimitives";

const sampleDocuments = [
  { title: "Release readiness checklist", details: "Checklist · Arden Core · Minh Tran", status: "Published", scope: "Company-wide", type: "Checklist" },
  { title: "Checkout timeout decision", details: "Decision · Product Engineering · Lan Nguyen", status: "Published", scope: "Department", type: "Decision" },
  { title: "Operations ownership handover", details: "Handover · Operations · Mai Pham", status: "In review", scope: "Company-wide", type: "Handover" },
  { title: "Incident retrospective — 18 Sep", details: "Retrospective · Your personal workspace", status: "Private", scope: "Private", type: "Retrospective" },
  { title: "Data retention policy mapping", details: "Policy · Security · Company-wide", status: "Published", scope: "Company-wide", type: "Policy" },
];

export function KnowledgeLibrary({ active, showPrivateSample, onCreate, onEdit, onOpenDocument }: { active: boolean; showPrivateSample: boolean; onCreate: () => void; onEdit: () => void; onOpenDocument: (title: string) => void }) {
  const [query, setQuery] = useState("");
  const [departmentOnly, setDepartmentOnly] = useState(false);
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [documentType, setDocumentType] = useState("All types");
  const searchRef = useSearchShortcut(undefined, active);
  const samples = sampleDocuments.filter(document => showPrivateSample || document.scope !== "Private");
  const filtered = samples.filter((document) => `${document.title} ${document.details}`.toLowerCase().includes(query.trim().toLowerCase()) && (!departmentOnly || document.scope === "Department") && (!publishedOnly || document.status === "Published") && (documentType === "All types" || document.type === documentType));
  const showFeatured = "api gateway runbook lan nguyen product engineering".includes(query.trim().toLowerCase()) && (documentType === "All types" || documentType === "Runbook");
  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title="Knowledge, connected." description="Find trusted decisions, guides and the context behind them." action={<button type="button" className="primary-button" onClick={onCreate}>Create knowledge</button>} />
    <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search sample knowledge, decisions and people…" />
    <div className="knowledge-filters" aria-label="Sample knowledge filters">
      <button type="button" className="knowledge-filter is-current" onClick={() => { setDepartmentOnly(false); setPublishedOnly(false); setDocumentType("All types"); }}><KnowledgeBadge tone="amber">All knowledge · {samples.length + 1} samples</KnowledgeBadge></button>
      <button type="button" className={`knowledge-filter ${departmentOnly ? "is-current" : ""}`} aria-pressed={departmentOnly} onClick={() => setDepartmentOnly(!departmentOnly)}><KnowledgeBadge tone={departmentOnly ? "amber" : "muted"}>Product Engineering</KnowledgeBadge></button>
      <button type="button" className="knowledge-filter" aria-pressed={publishedOnly} onClick={() => setPublishedOnly(!publishedOnly)}><KnowledgeBadge tone={publishedOnly ? "amber" : "jade"}>Published</KnowledgeBadge></button>
      <label className="knowledge-type-filter"><span className="sr-only">Document type</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{["All types", "Runbook", "Checklist", "Decision", "Handover", "Retrospective", "Policy"].map((type) => <option key={type}>{type}</option>)}</select></label>
    </div>
    {showFeatured && <button type="button" className="knowledge-featured" onClick={onEdit}>
      <span className="knowledge-featured-copy"><span className="meta-label knowledge-tone-jade">CONNECTED KNOWLEDGE</span><strong>API Gateway Runbook</strong><span>One operational guide. A clearer path to decisions, incidents and escalation.</span><span className="knowledge-inline-meta"><KnowledgeBadge tone="jade">Published · v2.4</KnowledgeBadge><small>Lan Nguyen · Sample</small></span></span>
      <KnowledgeConnections />
    </button>}
    <div className="knowledge-section-heading"><h2>Recently updated</h2><span>{filtered.length} sample items shown</span></div>
    <div className="knowledge-row-list">{filtered.map((document) => <KnowledgeRow key={document.title} title={document.title} details={document.details} status={document.status} tone={document.status === "Published" ? "jade" : document.status === "Private" ? "blue" : "amber"} onClick={() => onOpenDocument(document.title)} />)}</div>
    {filtered.length === 0 && !showFeatured && <div className="knowledge-empty"><h2>No matching samples</h2><p>Change the search or clear the filters to see the sample library.</p><button type="button" className="secondary-button" onClick={() => { setQuery(""); setDepartmentOnly(false); setPublishedOnly(false); setDocumentType("All types"); }}>Clear filters</button></div>}
    <p className="knowledge-preview-footnote">Synthetic sample library. Live search, content permissions and persistence require Arden Core.</p>
  </>;
}
