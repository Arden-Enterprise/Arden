import { useId, useState } from "react";
import { CitedAnswer } from "../ask-arden/CitedAnswer";
import { askReaderQuestion, type ReaderAnswer } from "../shared/reader-question-api";
import { Icon } from "../shared/Icon";
import { useReaderOperation, type ReaderOperationOptions } from "./useReaderOperation";
import type { ReaderAccessSession } from "./useReaderAccess";
import { ReaderAiGenerated } from "./ReaderAiPanel";

export function ReaderQuestionPanel({ id, labelledBy, options, access }: { id: string; labelledBy: string;
  options: ReaderOperationOptions; access: ReaderAccessSession }) {
  const fieldId = useId(), [query, setQuery] = useState(""), [submitted, setSubmitted] = useState("");
  const operation = useReaderOperation<ReaderAnswer, string>(options, access, {
    label: "Document Q&A", busyRetrySeconds: 10,
    run: (config, input, signal) => askReaderQuestion(config.platform, config.context, input, signal),
  });
  const { state } = operation, waiting = state.status === "loading" || state.status === "checking";
  if (options.visible === false) return null;
  const submit = () => {
    if (!query.trim() || waiting) return;
    options.onCitation(null); setSubmitted(query); void operation.open(query);
  };
  const showQuestion = Boolean(submitted) && state.status !== "closed";
  return <section id={id} role="tabpanel" className="reader-ai-body reader-ai-ask" aria-labelledby={labelledBy}>
    <div className="reader-ai-thread">
      {showQuestion && <p className="reader-ai-question"><span className="sr-only">Question: </span>{submitted}</p>}
      {waiting && <p role="status" className="reader-ai-wait">{state.status === "loading" ? "Finding an answer…" : "Updating…"}</p>}
      {state.status === "error" && <div role="alert" className="reader-ai-notice is-error"><p>{state.message}</p>
        {state.retry && <button className="secondary-button" type="button" disabled={operation.retryAfterSeconds > 0}
          onClick={() => void operation.retry()}>{operation.retryAfterSeconds > 0 ? `Retry in ${operation.retryAfterSeconds}s` : "Retry"}</button>}</div>}
      {state.status === "ready" && state.result && <div className="reader-ai-answer">
        {query !== submitted && <p className="island-meta">Answer to: {submitted}</p>}
        {state.result.status === "INSUFFICIENT_EVIDENCE"
          ? <div className="reader-ai-notice is-warning"><Icon name="warning" size={15} /><p>{state.result.answer}</p></div>
          : <>
            <ReaderAiGenerated><span>From this version</span></ReaderAiGenerated>
            <div className="reader-ai-answer-text"><CitedAnswer body={state.result.answer} citations={[]} />{state.result.citations.map((citation, index) =>
              <button className="reader-ai-source" key={index} type="button" aria-label={`View answer source ${index + 1}`}
                onClick={() => void operation.navigate(citation)}>{citation.page ? `p. ${citation.page}` : "Source"}</button>)}</div>
          </>}
        <p className="sr-only" role="status">Answer ready.</p>
      </div>}
    </div>
    <form className="reader-ai-composer" onSubmit={event => { event.preventDefault(); submit(); }}>
      <p id={`${fieldId}-hint`}>Each question is answered on its own, from this version only.</p>
      <div className="reader-ai-composer-field">
        <label className="sr-only" htmlFor={fieldId}>Your question</label>
        <textarea id={fieldId} value={query} maxLength={4_000} rows={2} placeholder="Ask about this document…" autoFocus
          aria-describedby={`${fieldId}-hint`} onChange={event => setQuery(event.target.value)} disabled={waiting}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); }
          }} />
        <button className="reader-ai-send" type="submit" aria-label="Send question" title="Send question" disabled={!query.trim() || waiting}>
          <Icon name="arrow-up" size={15} />
        </button>
      </div>
    </form>
  </section>;
}
