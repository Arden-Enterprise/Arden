import type { MaintenanceHistory } from "./maintenance-client";

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function historyTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormat.format(date);
}

export function CaseHistory({ history, loading, error, onMore, onRetry }: {
  history: MaintenanceHistory | null;
  loading: boolean;
  error: string;
  onMore: () => void;
  onRetry: () => void;
}) {
  return <section className="maintenance-rail-section" aria-labelledby="case-history-title">
    <h3 id="case-history-title">Audit history</h3>
    {loading && <p className="maintenance-rail-copy" role="status" aria-busy="true">Loading history…</p>}
    {error && <div className="maintenance-inline-error" role="alert">
      <p className="field-error">{error}</p>
      <button type="button" className="secondary-button" onClick={onRetry}>Retry</button>
    </div>}
    {history && history.items.length === 0 && <p className="maintenance-rail-copy">No history yet.</p>}
    {history && history.items.length > 0 && <ol className="maintenance-timeline">
      {history.items.map((item) => <li key={item.sequence}>
        <span className="maintenance-timeline-dot" aria-hidden="true" />
        <p>{item.message}</p>
        <time dateTime={item.occurredAt}>{historyTime(item.occurredAt)}</time>
      </li>)}
    </ol>}
    {history?.nextCursor && <button type="button" className="maintenance-text-button" onClick={onMore}>Load more history</button>}
  </section>;
}
