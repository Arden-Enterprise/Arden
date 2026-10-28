import { useState } from "react";
import { SearchField } from "../shared/SearchField";
import { useSearchShortcut } from "../shared/useSearchShortcut";
import { IslandCell, IslandRow, IslandTable } from "../shared/IslandTable";
import { KnowledgeBadge, KnowledgeHeading } from "./KnowledgePrimitives";
import type { CreatedKnowledgeDraft } from "../shared/api-client";
import type { ReaderDocumentMetadata } from "./KnowledgeDocumentDetail";

export type SampleKnowledgeDocument = ReaderDocumentMetadata & {
  id: string;
  details: string;
  status: "Published" | "In review" | "Private";
  scope: "Company-wide" | "Department" | "Private";
  type: string;
  previewHeading: string;
  sourceBlocks: { id: string; heading?: string; text: string }[];
};

export const sampleDocuments: SampleKnowledgeDocument[] = [
  { id: "release-readiness-checklist", title: "Release readiness checklist", documentCode: "NSS-SOP-012", ownerDepartment: "Platform Engineering",
    summary: "Defines the evidence and ownership checks required before a production release is approved.",
    activeVersionId: "release-v2", versions: [
      { id: "release-v2", label: "2.0", status: "EFFECTIVE", effectiveDate: "2026-09-15" },
      { id: "release-v1", label: "1.0", status: "EXPIRED", effectiveDate: "2026-03-10" },
    ], details: "Checklist · Platform Engineering", status: "Published", scope: "Company-wide", type: "Checklist", previewHeading: "Release controls",
    sourceBlocks: [{ id: "release-evidence", heading: "Release controls", text: "Every production release must include named ownership, tested rollback evidence and the recorded approval outcome before deployment begins." }] },
  { id: "checkout-timeout-decision", title: "Checkout timeout decision", documentCode: "NSS-STD-019", ownerDepartment: "Product Engineering",
    summary: "Records the accepted checkout timeout behavior, operating limits and escalation path for affected services.",
    activeVersionId: "checkout-v1", versions: [{ id: "checkout-v1", label: "1.0", status: "EFFECTIVE", effectiveDate: "2026-08-22" }],
    details: "Decision · Product Engineering", status: "Published", scope: "Department", type: "Decision", previewHeading: "Accepted timeout behavior",
    sourceBlocks: [{ id: "accepted-timeout", heading: "Accepted timeout behavior", text: "Checkout requests use the agreed service timeout and follow the documented escalation path when the dependency exceeds its operating limit." }] },
  { id: "operations-ownership-handover", title: "Operations ownership handover", documentCode: "NSS-SOP-028", ownerDepartment: "Infrastructure Operations",
    summary: "Documents service ownership, unresolved risks and the operational contacts required for the handover.",
    activeVersionId: "handover-v1", versions: [{ id: "handover-v1", label: "1.0", status: "UPCOMING", effectiveDate: "2026-11-01" }],
    details: "Handover · Infrastructure Operations", status: "In review", scope: "Company-wide", type: "Handover", previewHeading: "Ownership transition",
    sourceBlocks: [{ id: "handover-ownership", heading: "Ownership transition", text: "The receiving team accepts service ownership only after open risks, operational contacts and escalation responsibilities are recorded." }] },
  { id: "incident-retrospective-18-sep", title: "Incident retrospective - 18 Sep", documentCode: "NSS-STD-034", ownerDepartment: "Infrastructure Operations",
    summary: "Captures the incident timeline, contributing conditions and follow-up work identified by the response team.",
    activeVersionId: "incident-v1", versions: [{ id: "incident-v1", label: "1.0", status: "EFFECTIVE", effectiveDate: "2026-09-20" }],
    details: "Retrospective · Your personal workspace", status: "Private", scope: "Private", type: "Retrospective", previewHeading: "Incident findings",
    sourceBlocks: [{ id: "incident-findings", heading: "Incident findings", text: "The response team recorded the incident timeline, contributing conditions and follow-up owners for private working use." }] },
  { id: "data-retention-policy-mapping", title: "Data retention policy mapping", documentCode: "NSS-POL-041", ownerDepartment: "Security & Compliance",
    summary: "Maps retained data categories to their approved retention periods and accountable control owners.",
    activeVersionId: "retention-v3", versions: [
      { id: "retention-v3", label: "3.0", status: "EFFECTIVE", effectiveDate: "2026-10-01" },
      { id: "retention-v2", label: "2.0", status: "EXPIRED", effectiveDate: "2025-10-01" },
    ], details: "Policy · Security & Compliance", status: "Published", scope: "Company-wide", type: "Policy", previewHeading: "Retention responsibilities",
    sourceBlocks: [{ id: "retention-responsibilities", heading: "Retention responsibilities", text: "Control owners must apply the approved retention period to each data category and record any exception through the security review process." }] },
  { id: "knowledge-publication-workflow", title: "Knowledge publication workflow", documentCode: "NSS-SOP-052", ownerDepartment: "Knowledge Governance",
    summary: "Defines how an authored draft becomes an authorized, indexed and active knowledge publication.",
    activeVersionId: "publication-workflow-v2-1", versions: [
      { id: "publication-workflow-v2-1", label: "2.1", status: "EFFECTIVE", effectiveDate: "2026-10-12" },
      { id: "publication-workflow-v2-0", label: "2.0", status: "EXPIRED", effectiveDate: "2026-06-20" },
    ], details: "Procedure · Knowledge Governance", status: "Published", scope: "Company-wide", type: "Procedure", previewHeading: "Publication boundary",
    sourceBlocks: [
      { id: "immutable-submission", heading: "Review snapshot", text: "Submitting a working draft for review creates an immutable snapshot. Later edits remain in the working draft and do not change the submitted version." },
      { id: "activation-boundary", heading: "Publication activation", text: "Approval prepares the reviewed snapshot. Search and Ask Arden can use it only after indexing succeeds and the release is activated." },
    ] },
  { id: "reviewer-responsibility-guide", title: "Reviewer responsibility guide", documentCode: "NSS-GDE-053", ownerDepartment: "Product Engineering",
    summary: "Clarifies reviewer authority, decision boundaries and responsibility for an exact submitted version.",
    activeVersionId: "reviewer-guide-v1-4", versions: [{ id: "reviewer-guide-v1-4", label: "1.4", status: "EFFECTIVE", effectiveDate: "2026-10-08" }],
    details: "Guide · Product Engineering", status: "Published", scope: "Department", type: "Guide", previewHeading: "Reviewer decision boundary",
    sourceBlocks: [{ id: "reviewer-decision-boundary", heading: "Reviewer decision boundary", text: "A reviewer may approve or reject only the exact submitted snapshot covered by an active reviewer grant." }] },
];

export const samplePublications = sampleDocuments.filter((document) => document.status === "Published" && document.scope !== "Private");

export function matchesSampleKnowledge(document: SampleKnowledgeDocument, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [document.title, document.documentCode, document.ownerDepartment, document.summary, document.type]
    .some((value) => value.toLocaleLowerCase().includes(normalized));
}

function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function KnowledgeLibrary({ active, createdDraft, onCreate, onOpenDocument }: { active: boolean; createdDraft: CreatedKnowledgeDraft | null; onCreate: () => void; onOpenDocument: (document: SampleKnowledgeDocument) => void }) {
  const [query, setQuery] = useState("");
  const [departmentOnly, setDepartmentOnly] = useState(false);
  const [documentType, setDocumentType] = useState("All types");
  const searchRef = useSearchShortcut(undefined, active);
  const samples = samplePublications;
  const filtered = samples.filter((document) => matchesSampleKnowledge(document, query)
    && (!departmentOnly || document.ownerDepartment === "Product Engineering")
    && (documentType === "All types" || document.type === documentType));
  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / KNOWLEDGE" title="Knowledge, connected."  action={<button type="button" className="primary-button" onClick={onCreate}>Explore sample creation</button>} />
    {createdDraft && <section className="knowledge-server-draft" aria-labelledby="knowledge-server-draft-title">
      <span className="meta-label knowledge-tone-jade">CREATED ON ARDEN SERVER · NOT PUBLISHED</span>
      <h2 id="knowledge-server-draft-title">{createdDraft.title}</h2>
      <div className="knowledge-inline-meta"><KnowledgeBadge tone="jade">Shared draft · v{createdDraft.version}</KnowledgeBadge><KnowledgeBadge tone="blue">{createdDraft.classification}</KnowledgeBadge></div>

      <details><summary>View copied text</summary><pre>{createdDraft.body}</pre></details>

    </section>}
    <SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search title, document code, owner or summary…" />
    <div className="knowledge-filters" aria-label="Sample knowledge filters">
      <button type="button" className="knowledge-filter is-current" onClick={() => { setDepartmentOnly(false); setDocumentType("All types"); }}><KnowledgeBadge tone="amber">All publications · {samples.length} samples</KnowledgeBadge></button>
      <button type="button" className={`knowledge-filter ${departmentOnly ? "is-current" : ""}`} aria-pressed={departmentOnly} onClick={() => setDepartmentOnly(!departmentOnly)}><KnowledgeBadge tone={departmentOnly ? "amber" : "muted"}>Product Engineering</KnowledgeBadge></button>
      <label className="knowledge-type-filter"><span className="sr-only">Document type</span><select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{["All types", ...Array.from(new Set(samples.map((document) => document.type)))].map((type) => <option key={type}>{type}</option>)}</select></label>
    </div>
    <div className="knowledge-section-heading"><h2>Published documents</h2><span>{filtered.length} accessible sample documents</span></div>
    {filtered.length > 0 ? <IslandTable label="Published knowledge search results" minWidth={820}
      columns="minmax(280px, 2fr) minmax(150px, 1fr) 90px 130px 110px"
      headers={["DOCUMENT", "OWNER", "VERSION", "EFFECTIVE DATE", "STATUS"]}>
      {filtered.map((document) => {
        const version = document.versions.find((item) => item.id === document.activeVersionId) ?? document.versions[0];
        return <IslandRow key={document.id}>
          <IslandCell className="island-row-cell is-name"><button type="button" className="island-row-name knowledge-result-name" onClick={() => onOpenDocument(document)}>
            <span><strong>{document.title}</strong><small>{document.documentCode} · {document.type}</small></span>
          </button></IslandCell>
          <IslandCell>{document.ownerDepartment}</IslandCell>
          <IslandCell className="island-row-cell is-number">v{version?.label ?? "Current"}</IslandCell>
          <IslandCell className="island-row-cell is-number">{version ? shortDate(version.effectiveDate) : "Not set"}</IslandCell>
          <IslandCell><span className={`island-chip knowledge-reader-status is-${(version?.status ?? "EFFECTIVE").toLowerCase()}`}>{version?.status === "UPCOMING" ? "Upcoming" : version?.status === "EXPIRED" ? "Expired" : "Effective"}</span></IslandCell>
        </IslandRow>;
      })}
    </IslandTable> : <div className="knowledge-empty"><h2>No matching publications</h2><p>Try another keyword, document code or owner department.</p><button type="button" className="secondary-button" onClick={() => { setQuery(""); setDepartmentOnly(false); setDocumentType("All types"); }}>Clear filters</button></div>}

  </>;
}
