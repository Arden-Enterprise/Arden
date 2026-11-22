import type { MaintenanceCase } from "./maintenance-client";
import { Icon } from "../shared/Icon";
import { MaintenanceStatus } from "./MaintenanceStatus";

function reportTitle(item: MaintenanceCase) {
  return item.kind === "minimal" ? "Document unavailable" : item.title || "Untitled document";
}

export function MyReports({ items, loading, error, onOpen, onRetry }: {
  items: MaintenanceCase[];
  loading: boolean;
  error: string;
  onOpen: (caseId: string) => void;
  onRetry: () => void;
}) {
  if (loading) return <div className="island island-empty" role="status" aria-busy="true">Loading reports…</div>;
  if (error) return <div className="island island-empty" role="alert">
    <h3>Reports could not be loaded</h3>
    <p className="field-error">{error}</p>
    <button type="button" className="secondary-button" onClick={onRetry}>Retry</button>
  </div>;
  if (items.length === 0) return <div className="island island-empty">
    <h3>No reports yet</h3>
    <p>Open a document and use Report an issue. Each report stays on that published version.</p>
  </div>;
  return <ul className="report-list" aria-label="My reports">
    {items.map((item) => {
      const title = reportTitle(item);
      return <li key={item.caseId}>
        <button type="button" className={`report-row${item.unread ? " is-unread" : ""}`} onClick={() => onOpen(item.caseId)}
          aria-label={`Open report for ${title}${item.unread ? ", unread" : ""}`}>
          <span className={`report-dot is-${item.reporterStatus === "Resolved" ? "done" : item.reporterStatus === "In Progress" ? "active" : "new"}`} aria-hidden="true" />
          <span className="report-main">
            <strong title={title}>{title}</strong>
            <span className="maintenance-id">{item.caseId}</span>
          </span>
          <span className="report-unread" data-unread={item.unread || undefined}>{item.unread && <span className="sr-only">Unread</span>}</span>
          <MaintenanceStatus status={item.reporterStatus} />
          <span className="maintenance-row-chevron" aria-hidden="true"><Icon name="chevron" size={12} /></span>
        </button>
      </li>;
    })}
  </ul>;
}
