import { useState } from "react";
import { PriorityQueue, type QueueItem } from "./PriorityQueue";
import { WorkActivityCard } from "./WorkActivityCard";
import { SearchField } from "../shared/SearchField";
import { useSearchShortcut } from "../shared/useSearchShortcut";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";

const priorityQueue: QueueItem[] = [
  {
    title: "API Gateway Runbook",
    meta: "Due today",
    description: "Platform Reliability",
  },
  {
    title: "Operations ownership handover",
    meta: "At risk",
    description: "Mai Pham · 3 assets need a receiving owner",
    icon: "work",
    tone: "amber",
    action: "handover",
  },
  {
    title: "Incident retrospective — 18 Sep",
    meta: "Check scope",
    description: "Department visibility requires confirmation",
    icon: "document",
    tone: "blue",
    action: "knowledge",
  },
  {
    title: "Checkout timeout decision",
    meta: "Source changed",
    description: "Jira ARD-482 changed after publication",
    icon: "document",
    tone: "amber",
    action: "knowledge",
  },
];

const recentItems = [
  ["On-call escalation guide", "Minh Tran · v3.1 · 1h ago"],
  ["Data retention decision", "Security · v1.0 · 3h ago"],
  ["Release readiness checklist", "Arden Core · v2.2 · Yesterday"],
] as const;

export function MyWorkPage({
  onOpenPrivateNotes,
  onOpenKnowledge,
  onOpenReview,
  onOpenHandover,
  memberName = "Lan Nguyen",
  contextOpen,
  onToggleContext,
}: {
  onOpenPrivateNotes: () => void;
  onOpenKnowledge?: () => void;
  onOpenReview?: () => void;
  onOpenHandover?: () => void;
  memberName?: string;
} & ContextControlProps) {
  const [query, setQuery] = useState("");
  const searchRef = useSearchShortcut();
  const greetingName = memberName.trim().split(/\s+/)[0] || "there";

  const filteredQueue = priorityQueue.filter((item) =>
    `${item.title} ${item.meta} ${item.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <main id="arden-main" className="workspace-page" aria-labelledby="my-work-title" tabIndex={-1}>
      <WorkspaceTopbar
        breadcrumb="WORKSPACE / MY WORK"
        previewLabel="SAMPLE DATA · PREVIEW"
        contextOpen={contextOpen}
        onToggleContext={onToggleContext}
        search={<SearchField ref={searchRef} value={query} onChange={setQuery} placeholder="Search priority queue…" />}
      />

      <div className="workspace-content my-work-content">
        <div className="page-title-row my-work-title-row">
          <div>
            <span className="meta-label">WORKSPACE / MY WORK</span>
            <h1 id="my-work-title">Good morning, {greetingName}.</h1>
            <p>A clear view of the work that needs your attention.</p>
          </div>
          <button type="button" className="primary-button" onClick={onOpenKnowledge} disabled={!onOpenKnowledge}>Create knowledge</button>
        </div>

        <div className="status-strip my-work-status-strip" aria-label="Sample work status summary">
          <div className="status-action">
            <strong>03</strong>
            <span>Needs action</span>
          </div>
          <div className="status-review">
            <strong>05</strong>
            <span>Waiting for review</span>
          </div>
          <div className="status-handover">
            <strong>01</strong>
            <span>Active handover</span>
          </div>
        </div>

        {filteredQueue.some((item) => item.title === "API Gateway Runbook") && (
          <section className="my-work-spotlight" aria-labelledby="spotlight-title">
            <div className="my-work-spotlight-copy">
              <div className="my-work-spotlight-meta"><span>Due today</span><span>Platform Reliability</span></div>
              <h2 id="spotlight-title">API Gateway Runbook</h2>
              <p>Two evidence checks remain before this runbook can be published.</p>
              <div className="my-work-spotlight-actions">
                <button type="button" className="primary-button" onClick={onOpenReview} disabled={!onOpenReview}>Open review</button>
                <button type="button" className="my-work-ghost-button" onClick={onOpenReview} disabled={!onOpenReview}>View changes</button>
              </div>
            </div>
            <div className="my-work-spotlight-signal"><strong>02</strong><span>CHECKS LEFT</span></div>
          </section>
        )}

        <div className="my-work-grid my-work-activity-grid">
          <PriorityQueue
            items={filteredQueue.filter((item) => item.title !== "API Gateway Runbook")}
            searchActive={query.trim().length > 0}
            onClearSearch={() => setQuery("")}
            onOpenKnowledge={onOpenKnowledge}
            onOpenHandover={onOpenHandover}
          />
          <WorkActivityCard recentItems={recentItems} onOpenPrivateNotes={onOpenPrivateNotes} onOpenKnowledge={onOpenKnowledge} />
        </div>
      </div>
    </main>
  );
}
