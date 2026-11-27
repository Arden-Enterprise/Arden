import { useEffect, useId, useRef, useState } from "react";
import type { SubmissionReviewPoint, SubmissionReviewResult } from "@arden/domain";
import { ApiError, runSubmissionReview, type KnowledgeReviewDetail } from "../shared/api-client";
import { Icon } from "../shared/Icon";
import type { Platform } from "../shared/types";

const categoryLabels = {
  CLARITY: "Clarity",
  CONSISTENCY: "Consistency",
  MISSING_CONTEXT: "Missing context",
  SENSITIVE_CONTENT: "Sensitive content",
} as const;

type SourceCitation = SubmissionReviewPoint["citation"];

export function SubmissionReviewAi({ platform, organizationId, review, disabled, activeSource, onOpenSource, sourceMessage }: {
  platform: Platform; organizationId: string; review: KnowledgeReviewDetail; disabled: boolean;
  activeSource?: SourceCitation;
  onOpenSource: (source: SourceCitation, additionalExcerpts: readonly string[]) => void;
  sourceMessage: string;
}) {
  const title = useId();
  const current = useRef<AbortController | null>(null);
  const [result, setResult] = useState<SubmissionReviewResult | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => () => current.current?.abort(), []);

  const run = async () => {
    if (current.current || disabled || unavailable) return;
    const controller = new AbortController();
    current.current = controller;
    setPending(true);
    setError("");
    try {
      const next = await runSubmissionReview(platform, organizationId, review, controller.signal);
      if (!controller.signal.aborted) setResult(next);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const unavailable = failure instanceof ApiError && [401, 404, 422].includes(failure.status);
      setUnavailable(unavailable);
      setError(failure instanceof ApiError ? failure.message : "AI review is unavailable. You can still review manually.");
    } finally {
      current.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  };

  const sourceButtons = (point: SubmissionReviewPoint, label: string) => {
    const citations = [point.citation, ...(point.additionalCitations ?? [])];
    return citations.map((source, index) => {
      if (source.page !== null && citations.slice(0, index).some(citation => citation.page === source.page)) return null;
      const additionalExcerpts = source.page === null ? [] : citations.slice(index + 1)
        .filter(citation => citation.page === source.page).map(citation => citation.excerpt);
      const pageLabel = source.page === null ? (citations.length === 1 ? "Source" : `Source ${index + 1}`) : `Page ${source.page}`;
      return <button key={index} type="button" className="review-ai-source" title="Jump to the cited text"
        aria-label={`Open ${label} ${source.page === null ? pageLabel.toLowerCase() : `source on page ${source.page}`}`}
        aria-current={activeSource === source ? "location" : undefined}
        disabled={disabled} onClick={() => onOpenSource(source, additionalExcerpts)}>
        <Icon name="arrow" size={12} /><span>{pageLabel}</span>
      </button>;
    });
  };

  return <section className="review-ai" aria-labelledby={title}>
    <h3 id={title} className="review-ai-title"><span><Icon name="review" size={15} /></span>AI review</h3>
    {result ? <div role="region" aria-label="AI review results">
      <p className="review-ai-hint">Verify AI findings against the submission.</p>
      <h4>Summary</h4>
      <ul>{result.summary.map((point, i) => <li key={i}>
        <p>{point.text}</p><div className="review-ai-sources">{sourceButtons(point, `summary ${i + 1}`)}</div>
      </li>)}</ul>
      <h4>Checks to consider</h4>
      {result.checks.length ? <ul className="review-ai-checks">{result.checks.map((check, i) => <li key={i}>
        <strong>{categoryLabels[check.category]}</strong>
        <p>{check.text}</p><div className="review-ai-sources">{sourceButtons(check, `check ${i + 1}`)}</div>
      </li>)}</ul> : <p className="review-ai-hint">AI found no specific checks to flag.</p>}
      {sourceMessage && <p className="review-ai-hint review-ai-source-message" role="status">{sourceMessage}</p>}
    </div> : <>
      {!unavailable && <button type="button" className="secondary-button" disabled={disabled || pending}
        onClick={() => void run()}><Icon name="review" size={14} />
        {pending ? "Reviewing…" : error ? "Retry AI review" : "Review with AI"}
      </button>}
      {pending && <p role="status" className="review-ai-hint">Analyzing the submitted version…</p>}
      {error && <p role="alert" className="field-error">{error}</p>}
    </>}
  </section>;
}
