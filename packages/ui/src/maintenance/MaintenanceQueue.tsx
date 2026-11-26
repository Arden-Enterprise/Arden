import { useState } from "react";
import { Icon } from "../shared/Icon";
import type { MaintenanceCase } from "./maintenance-client";
import { MaintenanceStatus } from "./MaintenanceStatus";

const filters = [
  { id: "unassigned", label: "Unassigned" },
  { id: "mine", label: "Mine" },
  { id: "all", label: "All I can review" },
] as const;

function matches(item: MaintenanceCase, filter: (typeof filters)[number]["id"]) {
  if (filter === "all") return true;
  if (filter === "mine") return Boolean(item.canDecide || item.needsReassignment);
  // Claim and reassignment both move a case to In Progress, so Submitted means unassigned for every role.
  return item.reporterStatus === "Submitted";
}

function caseTitle(item: MaintenanceCase) {
  return item.kind === "minimal" ? "Document unavailable" : item.title || "Untitled document";
}

export function MaintenanceQueue({ items, loading, error, onOpen, onRetry }: {
  items: MaintenanceCase[];
  loading: boolean;
  error: string;
  onOpen: (caseId: string) => void;
  onRetry: () => void;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("unassigned");
  const visible = items.filter((item) => matches(item, filter));
  const empty = filter === "mine" ? "Nothing is assigned to you" : filter === "unassigned" ? "No unassigned cases" : "No cases you can review";
  return <section className="island review-board maintenance-queue maintenance-enter" aria-labelledby="maintenance-queue-title">
    <header className="review-board-toolbar">
      <h2 id="maintenance-queue-title" className="sr-only">Maintenance queue</h2>
      <div className="island-seg" role="group" aria-label="Maintenance queue">
        {filters.map((item) => {
          const count = items.filter((row) => matches(row, item.id)).length;
          return <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
            {item.label}<span className="island-badge">{count}</span>
          </button>;
        })}
      </div>
      <span className="review-board-spacer" />
      <button type="button" className="secondary-button" onClick={onRetry}>Refresh</button>
    </header>
    <div className="review-board-groups">
      {loading && <p role="status" aria-busy="true">Loading cases…</p>}
      {error && <div className="island-empty" role="alert">
        <h3>The queue could not be loaded</h3>
        <p className="field-error">{error}</p>
        <button type="button" className="secondary-button" onClick={onRetry}>Retry</button>
      </div>}
      {!loading && !error && visible.length === 0 && <div className="island-empty">
        <h3>{empty}</h3>
        <p>Refresh after a new report arrives, or switch the queue filter.</p>
        <button type="button" className="secondary-button" onClick={onRetry}>Refresh</button>
      </div>}
      {visible.length > 0 && <ul className="maintenance-queue-list">
        {visible.map((item) => {
          const title = caseTitle(item);
          return <li key={item.caseId}>
            <button type="button" className={`maintenance-queue-row${item.unread ? " is-unread" : ""}`} onClick={() => onOpen(item.caseId)}
              aria-label={`Open ${title}, ${item.reporterStatus}${item.unread ? ", unread" : ""}`}>
              <span className="maintenance-row-icon" aria-hidden="true"><Icon name="document" size={14} /></span>
              <span className="maintenance-queue-title">
                <strong title={title}>{title}</strong>
                {item.unread && <span className="maintenance-unread"><span className="sr-only">Unread</span></span>}
              </span>
              <span className="maintenance-queue-flags">
                {item.needsReassignment && <span className="island-chip has-dot tone-warning">Needs reassignment</span>}
                <MaintenanceStatus status={item.reporterStatus} />
              </span>
              <span className="maintenance-row-chevron" aria-hidden="true"><Icon name="chevron" size={12} /></span>
            </button>
          </li>;
        })}
      </ul>}
    </div>
  </section>;
}
