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

function SourceExcerpt({ citation }: { citation: SubmissionReviewPoint["citation"] }) {
  return <details>
    <summary>{citation.page === null ? "Source excerpt" : `Source excerpt · page ${citation.page}`}</summary>
    <blockquote>{citation.excerpt}</blockquote>
  </details>;
}

export function SubmissionReviewAi({ platform, organizationId, review, disabled }: {
  platform: Platform; organizationId: string; review: KnowledgeReviewDetail; disabled: boolean;
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

  return <section className="review-ai" aria-labelledby={title}>
    <h3 id={title} className="review-section-label">AI REVIEW</h3>
    {result ? <div role="region" aria-label="AI review results">
      <p className="review-ai-hint">AI-generated. Verify against the submission before deciding.</p>
      <h4>Summary</h4>
      <ul>{result.summary.map((point, i) => <li key={i}>
        <p>{point.text}</p><SourceExcerpt citation={point.citation} />
      </li>)}</ul>
      <h4>Checks to consider</h4>
      {result.checks.length ? <ul>{result.checks.map((check, i) => <li key={i}>
        <p><strong>{categoryLabels[check.category]}</strong> · {check.text}</p>
        <SourceExcerpt citation={check.citation} />
      </li>)}</ul> : <p className="review-ai-hint">AI found no specific checks to flag.</p>}
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
