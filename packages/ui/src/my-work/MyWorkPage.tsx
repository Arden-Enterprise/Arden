import { useState } from "react";
import { PriorityQueue } from "./PriorityQueue";
import { WorkActivityCard } from "./WorkActivityCard";
import { filterWorkQueue, sampleWorkQueue, type WorkType, type WorkStatus } from "./workQueueModel";
import { Icon } from "../shared/Icon";
import { SearchField } from "../shared/SearchField";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";

const recentItems = [
  ["On-call escalation guide", "v3.1 · Platform"],
  ["Data retention decision", "v1.0 · Security"],
  ["Release readiness checklist", "v2.2 · Arden Core"],
] as const;

export function MyWorkPage({ onOpenPrivateNotes, onOpenKnowledge, onOpenReview, onOpenHandover, contextOpen, onToggleContext }: {
  onOpenPrivateNotes: () => void;
  onOpenKnowledge?: () => void;
  onOpenReview?: () => void;
  onOpenHandover?: () => void;
  memberName?: string;
} & ContextControlProps) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<WorkType | "all">("all");
  const [status, setStatus] = useState<WorkStatus | "all">("all");
  const filteredQueue = filterWorkQueue(sampleWorkQueue, { query, type, status });
  const filtersActive = Boolean(query.trim()) || type !== "all" || status !== "all";
  const clearFilters = () => { setQuery(""); setType("all"); setStatus("all"); };
  const reviewCount = sampleWorkQueue.filter((item) => item.type === "review").length;
  const actionCount = sampleWorkQueue.length - reviewCount;

  return <main id="arden-main" className="workspace-page my-work-page" aria-labelledby="my-work-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb="Arden / Work / My Work" previewLabel="Demo" contextOpen={contextOpen} onToggleContext={onToggleContext}
      search={<SearchField value={query} onChange={setQuery} placeholder="Search tasks…" />} searchActive={Boolean(query)} />
    <WorkspacePageContent className="my-work-content" header={<WorkspacePageHeader className="my-work-title-row"
      eyebrow="WORK" title="My Work" titleId="my-work-title"
      description={`${actionCount} tasks · ${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}`}
      action={<button type="button" className="primary-button" onClick={onOpenKnowledge} disabled={!onOpenKnowledge}><Icon name="plus" size={14} />New draft</button>}
    />}>
      <div className="my-work-dashboard">
        <section className="island my-work-card my-work-queue-card" aria-labelledby="priority-title">
          <div className="my-work-card-heading"><h2 id="priority-title">Tasks</h2><span className="island-badge">{filteredQueue.length}</span>
            <div className="my-work-filters">
              <label className="island-filter"><span className="sr-only">Work type</span><select value={type} onChange={(event) => { const value = event.target.value; if (value === "all" || value === "review" || value === "handover" || value === "knowledge") setType(value); }}><option value="all">Type: All</option><option value="review">Review</option><option value="handover">Handover</option><option value="knowledge">Knowledge</option></select></label>
              <label className="island-filter"><span className="sr-only">Work status</span><select value={status} onChange={(event) => { const value = event.target.value; if (value === "all" || value === "review-requested" || value === "at-risk" || value === "in-progress" || value === "source-changed") setStatus(value); }}><option value="all">Status: Any</option><option value="review-requested">Review requested</option><option value="at-risk">At risk</option><option value="in-progress">In progress</option><option value="source-changed">Source changed</option></select></label>
            </div>
          </div>
          {query.trim() && <p className="my-work-search-scope" role="status">Filtering the priority queue for “{query.trim()}”.</p>}
          <PriorityQueue items={filteredQueue} filtersActive={filtersActive} onClearFilters={clearFilters} onOpenKnowledge={onOpenKnowledge} onOpenReview={onOpenReview} onOpenHandover={onOpenHandover} />
        </section>
        <WorkActivityCard recentItems={recentItems} onOpenPrivateNotes={onOpenPrivateNotes} onOpenKnowledge={onOpenKnowledge} onOpenHandover={onOpenHandover} />
      </div>
    </WorkspacePageContent>
  </main>;
}
