import type { useReaderSummary } from "./useReaderSummary";
import { ReaderAiGenerated } from "./ReaderAiPanel";

const kindLabels = { KEY_POINT: "", STEP: "Step", CONDITION: "Condition", EXCEPTION: "Exception" };
export function ReaderSummaryPanel({ id, labelledBy, summary }: { id: string; labelledBy: string;
  summary: ReturnType<typeof useReaderSummary> }) {
  const { state } = summary;
  return <section id={id} role="tabpanel" className="reader-ai-body" aria-labelledby={labelledBy}>
    {state.status === "closed" && <div className="reader-ai-notice">
      <p>Summarize the whole version you are reading.</p>
      <button type="button" className="secondary-button" onClick={() => void summary.open()}>Summarize</button>
    </div>}
    {state.status !== "closed" && state.status !== "paused" && <ReaderAiGenerated><span>Whole version</span></ReaderAiGenerated>}
    {(state.status === "loading" || state.status === "checking") && <div className="reader-ai-wait" role="status">
      <span>{state.status === "loading" ? "Preparing summary…" : "Updating…"}</span>
      <div className="reader-ai-skeleton" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>}
    {state.status === "error" && <div className="reader-ai-notice is-error" role="alert">
      <p>{state.message}</p>{state.retry && <button type="button" className="secondary-button"
        disabled={summary.retryAfterSeconds > 0} onClick={() => void summary.retry()}>
        {summary.retryAfterSeconds > 0 ? `Retry in ${summary.retryAfterSeconds}s` : "Retry"}</button>}
    </div>}
    {state.status === "ready" && state.result && <ol className="reader-ai-points">
      {state.result.points.map((point, index) => <li key={index}>
        {kindLabels[point.kind] && <span className="reader-ai-kind">{kindLabels[point.kind]}</span>}
        <p>{point.text}{point.citations.map((citation, reference) =>
          <button key={reference} type="button" className="reader-ai-source"
            aria-label={`View source for point ${index + 1}, reference ${reference + 1}${citation.page ? `, page ${citation.page}` : ""}`}
            onClick={() => void summary.navigate(citation)}>{citation.page ? `p. ${citation.page}` : "Source"}</button>)}</p>
      </li>)}
    </ol>}
    {state.status === "ready" && <p className="sr-only" role="status">Summary ready.</p>}
  </section>;
}
