import { useId, useState } from "react";
import { askReaderQuestion, type ReaderAnswer } from "../shared/reader-question-api";
import { useReaderOperation, type ReaderOperationOptions } from "./useReaderOperation";

export function ReaderQuestionPanel({ options, onClose }: { options: ReaderOperationOptions; onClose: () => void }) {
  const id = useId(), [query, setQuery] = useState(""), [submitted, setSubmitted] = useState("");
  const operation = useReaderOperation<ReaderAnswer, string>(options, {
    label: "Document Q&A", busyRetrySeconds: 10,
    run: (config, input, signal) => askReaderQuestion(config.platform, config.context, input, signal),
  });
  const { state } = operation, waiting = state.status === "loading" || state.status === "checking";
  if (options.visible === false) return null;
  return <section className="reader-ai-summary" aria-labelledby={`${id}-title`} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); operation.close(); onClose(); }
  }}>
    <header className="reader-ai-summary-header"><h2 id={`${id}-title`}>Ask this document</h2>
      <span className="island-meta">AI-generated</span>
      <button type="button" className="secondary-button" onClick={() => { operation.close(); onClose(); }}>Close</button></header>
    <form className="reader-ai-question-form" onSubmit={event => {
      event.preventDefault(); if (!query.trim() || waiting) return;
      options.onCitation(null); setSubmitted(query); void operation.open(query);
    }}>
      <label htmlFor={`${id}-query`}>Your question</label>
      <textarea id={`${id}-query`} value={query} maxLength={4_000} rows={2} placeholder="Ask about this version…" autoFocus
        onChange={event => setQuery(event.target.value)} disabled={waiting} />
      <button className="secondary-button" type="submit" disabled={!query.trim() || waiting}>Answer</button>
    </form>
    {waiting && <p role="status" className="reader-ai-summary-wait">{state.status === "loading" ? "Finding an answer…" : "Checking access…"}</p>}
    {state.status === "error" && <div role="alert" className="reader-ai-summary-error"><p>{state.message}</p>
      {state.retry && <button className="secondary-button" type="button" disabled={operation.retryAfterSeconds > 0}
        onClick={() => void operation.retry()}>{operation.retryAfterSeconds > 0 ? `Retry in ${operation.retryAfterSeconds}s` : "Retry"}</button>}</div>}
    {state.status === "ready" && state.result && <div className="reader-ai-question-answer">
      {query !== submitted && <p className="island-meta">Answer to: {submitted}</p>}
      <p className="reader-ai-answer-text">{state.result.answer}</p>
      <div className="reader-ai-summary-sources">{state.result.citations.map((citation, index) =>
        <button className="reader-ai-summary-source" key={index} type="button" aria-label={`View answer source ${index + 1}`}
          onClick={() => void operation.navigate(citation)}>{citation.page ? `Page ${citation.page}` : "View source"}</button>)}</div>
      <p className="sr-only" role="status">Answer ready.</p>
    </div>}
  </section>;
}
