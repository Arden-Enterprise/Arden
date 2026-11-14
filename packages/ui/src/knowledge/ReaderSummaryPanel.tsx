import { Icon } from "../shared/Icon";
import type { useReaderSummary } from "./useReaderSummary";

const kindLabels = { KEY_POINT: "", STEP: "Step", CONDITION: "Condition", EXCEPTION: "Exception" };
export function ReaderSummaryPanel({ id, summary, onClose }: { id: string;
  summary: ReturnType<typeof useReaderSummary>; onClose: () => void }) {
  const { state } = summary;
  if (state.status === "closed") return null;
  return <section id={id} className="reader-ai-summary" aria-labelledby={`${id}-title`}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="reader-ai-summary-header">
      <h2 id={`${id}-title`}>Summary</h2><span className="island-meta">AI-generated</span>
      <button type="button" className="secondary-button" onClick={onClose}>Close</button>
    </header>
    {(state.status === "loading" || state.status === "checking") && <div className="reader-ai-summary-wait" role="status">
      <span>{state.status === "loading" ? "Preparing summary…" : "Checking access…"}</span>
      <div className="reader-ai-summary-skeleton" aria-hidden="true"><i /><i /><i /></div>
    </div>}
    {state.status === "error" && <div className="reader-ai-summary-error" role="alert">
      <p>{state.message}</p>{state.retry && <button type="button" className="secondary-button" onClick={() => void summary.retry()}>Retry</button>}
    </div>}
    {state.status === "ready" && state.result && <ol className="reader-ai-summary-points">
      {state.result.points.map((point, index) => <li key={index}>
        {kindLabels[point.kind] && <span className="reader-ai-summary-kind">{kindLabels[point.kind]}</span>}
        <p>{point.text}</p><div className="reader-ai-summary-sources">{point.citations.map((citation, reference) =>
          <button key={reference} type="button" className="reader-ai-summary-source"
            aria-label={`View source for point ${index + 1}, reference ${reference + 1}${citation.page ? `, page ${citation.page}` : ""}`}
            onClick={() => void summary.navigate(citation)}><Icon name="document" size={12} />
            {citation.page ? `Page ${citation.page}` : "View source"}</button>)}</div>
      </li>)}
    </ol>}
    {state.status === "ready" && <p className="sr-only" role="status">Summary ready.</p>}
  </section>;
}
