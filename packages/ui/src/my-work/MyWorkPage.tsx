import { useState } from "react";
import { PriorityQueue, type QueueItem } from "./PriorityQueue";
import { WorkActivityCard } from "./WorkActivityCard";
import { SearchField } from "../shared/SearchField";
import { useSearchShortcut } from "../shared/useSearchShortcut";

const priorityQueue: QueueItem[] = [
  {
    title: "API Gateway Runbook",
    meta: "REVIEW REQUESTED · DUE TODAY",
    description: "Platform Reliability",
  },
  {
    title: "Operations ownership handover",
    meta: "MISSING OWNER · 2 DOCUMENTS",
    description: "Owner departure",
  },
  {
    title: "Incident retrospective — 18 Sep",
    meta: "VISIBILITY CHECK",
    description: "Department scope",
  },
  {
    title: "Checkout timeout decision",
    meta: "SOURCE CHANGED",
    description: "Jira ARD-482 updated",
  },
];

const recentItems = [
  ["On-call escalation guide", "v3.1 · Platform"],
  ["Data retention decision", "v1.0 · Security"],
  ["Release readiness checklist", "v2.2 · Arden Core"],
] as const;

export function MyWorkPage({
  onOpenPrivateNotes,
}: {
  onOpenPrivateNotes: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useSearchShortcut();

  const filteredQueue = priorityQueue.filter((item) =>
    `${item.title} ${item.meta} ${item.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  return (
    <section className="workspace-page" aria-labelledby="my-work-title">
      <header className="workspace-topbar">
        <span>ARDEN / MY WORK</span>
        <span className="preview-state">SAMPLE DATA · FRONTEND PREVIEW</span>
      </header>

      <div className="workspace-content my-work-content">
        <div className="page-title-row">
          <div>
            <h1 id="my-work-title">My Work</h1>
            <p>What needs your attention across governed knowledge workflows.</p>
          </div>
        </div>

        <SearchField
          ref={searchRef}
          value={query}
          onChange={setQuery}
          placeholder="Search your work, reviews and documents…"
        />

        <div className="status-strip" aria-label="Work status summary">
          <div>
            <strong>03</strong>
            <span>TASKS REQUIRING ACTION</span>
          </div>
          <div>
            <strong>05</strong>
            <span>REVIEWS WAITING</span>
          </div>
          <div>
            <strong>01</strong>
            <span>ACTIVE HANDOVER</span>
          </div>
        </div>

        <div className="my-work-grid">
          <PriorityQueue items={filteredQueue} onClearSearch={() => setQuery("")} />
          <WorkActivityCard recentItems={recentItems} onOpenPrivateNotes={onOpenPrivateNotes} />
        </div>
      </div>
    </section>
  );
}
