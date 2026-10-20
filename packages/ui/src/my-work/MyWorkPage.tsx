import { useState } from "react";
import { PriorityQueue } from "./PriorityQueue";
import { WorkActivityCard } from "./WorkActivityCard";
import { filterWorkQueue, sampleWorkQueue, type WorkType, type WorkStatus } from "./workQueueModel";
import { Icon } from "../shared/Icon";
import { SearchField } from "../shared/SearchField";
import { useSearchShortcut } from "../shared/useSearchShortcut";
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
  const searchRef = useSearchShortcut();
  const filteredQueue = filterWorkQueue(sampleWorkQueue, { query, type, status });
  const filtersActive = Boolean(query.trim()) || type !== "all" || status !== "all";
  const clearFilters = () => { setQuery(""); setType("all"); setStatus("all"); };

  return <main id="arden-main" className="workspace-page my-work-page" aria-labelledby="my-work-title" tabIndex={-1}>
    <WorkspaceTopbar breadcrumb="ARDEN / MY WORK" previewLabel="SAMPLE DATA · PREVIEW" contextOpen={contextOpen} onToggleContext={onToggleContext} />
    <WorkspacePageContent className="my-work-content" header={<WorkspacePageHeader className="my-work-title-row"
      eyebrow="WORKSPACE" title="My Work" titleId="my-work-title"
      action={<button type="button" className="secondary-button" onClick={onOpenKnowledge} disabled={!onOpenKnowledge}><Icon name="plus" size={16} /> Create knowledge</button>}
    />}>
      <div className="my-work-search"><SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search priority queue…" /></div>
      <section className="my-work-summary" aria-label="Sample work status summary">
        <button type="button" className="my-work-summary-card tone-amber" onClick={() => { setType("all"); setStatus("all"); searchRef.current?.focus(); }}>
          <span className="my-work-icon-tile"><Icon name="document" size={25} /></span><span><strong>03</strong><span>Tasks requiring action</span></span><Icon name="chevron" size={18} />
        </button>
        <button type="button" className="my-work-summary-card tone-blue" onClick={onOpenReview} disabled={!onOpenReview}>
          <span className="my-work-icon-tile"><Icon name="review" size={25} /></span><span><strong>05</strong><span>Reviews waiting</span></span><Icon name="chevron" size={18} />
        </button>
        <button type="button" className="my-work-summary-card tone-green" onClick={onOpenHandover} disabled={!onOpenHandover}>
          <span className="my-work-icon-tile"><Icon name="handover" size={25} /></span><span><strong>01</strong><span>Active handover</span></span><Icon name="chevron" size={18} />
        </button>
      </section>
      <div className="my-work-dashboard">
        <div className="my-work-queue-column">
          <div className="my-work-queue-heading"><h2 id="priority-title">Priority queue</h2>
            <div className="my-work-filters">
              <label><span className="sr-only">Work type</span><select value={type} onChange={(event) => { const value = event.target.value; if (value === "all" || value === "review" || value === "handover" || value === "knowledge") setType(value); }}><option value="all">All types</option><option value="review">Review</option><option value="handover">Handover</option><option value="knowledge">Knowledge</option></select></label>
              <label><span className="sr-only">Work status</span><select value={status} onChange={(event) => { const value = event.target.value; if (value === "all" || value === "review-requested" || value === "at-risk" || value === "in-progress" || value === "source-changed") setStatus(value); }}><option value="all">All statuses</option><option value="review-requested">Review requested</option><option value="at-risk">At risk</option><option value="in-progress">In progress</option><option value="source-changed">Source changed</option></select></label>
            </div>
          </div>
          <PriorityQueue items={filteredQueue} filtersActive={filtersActive} onClearFilters={clearFilters} onOpenKnowledge={onOpenKnowledge} onOpenReview={onOpenReview} onOpenHandover={onOpenHandover} />
        </div>
        <WorkActivityCard recentItems={recentItems} onOpenPrivateNotes={onOpenPrivateNotes} onOpenKnowledge={onOpenKnowledge} onOpenHandover={onOpenHandover} />
      </div>
    </WorkspacePageContent>
  </main>;
}
