import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, createKnowledgeDraft, type CreatedKnowledgeDraft } from "../shared/api-client";
import type { Platform } from "../shared/types";

/** A pending copy request, kept so a retry reuses the same idempotency key for the same source version. */
export type ContributionAttempt = {
  sourceVersionId: string;
  idempotencyKey: string;
};

/**
 * Contribute-a-copy form shown inside the status island (passed to WorkspaceTopbar as its panel).
 * Focus moves to its heading when it opens and back to the opener when it closes.
 */
export function ContributePrivateNoteDialog({ platform, organizationId, source, attempt, onAttemptChange, onClose, onCreated }: {
  platform: Platform;
  organizationId: string;
  source: { title: string; body: string; versionId: string };
  attempt: ContributionAttempt | null;
  onAttemptChange: (attempt: ContributionAttempt | null) => void;
  onClose: () => void;
  onCreated: (draft: CreatedKnowledgeDraft) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryPending, setRetryPending] = useState(Boolean(attempt));
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const excerpt = source.body.replace(/\s+/g, " ").trim();

  useEffect(() => {
    mounted.current = true;
    const opener = document.activeElement;
    heading.current?.focus();
    return () => {
      mounted.current = false;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const request = attempt ?? { sourceVersionId: source.versionId, idempotencyKey: crypto.randomUUID() };
    onAttemptChange(request);
    try {
      // Decision 0013: no classification is sent; readers chosen in the draft decide how it is reviewed.
      const created = await createKnowledgeDraft(platform, organizationId, request.sourceVersionId, undefined, request.idempotencyKey);
      if (mounted.current) onCreated(created);
    } catch (cause) {
      if (!mounted.current) return;
      const finalRejection = cause instanceof ApiError && cause.status >= 400 && cause.status < 500;
      if (finalRejection) onAttemptChange(null);
      setRetryPending(!finalRejection);
      setError(cause instanceof Error ? cause.message : "The shared draft could not be created.");
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return <div className="contribute-island" role="dialog" aria-labelledby={titleId}
    onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }}>
    <div>
      <h2 id={titleId} ref={heading} tabIndex={-1}>Create review draft</h2>
      <p className="island-meta">Your original stays private.</p>
    </div>
    <div className="knowledge-source-preview">
      <strong>{source.title}</strong>
      <p className={excerpt ? undefined : "is-empty"}>{excerpt || "Nothing written in this note yet."}</p>
    </div>
    <form className="knowledge-contribute-form" onSubmit={(event) => void submit(event)}>
      {retryPending && !error && <p role="status">Couldn’t confirm draft creation.</p>}
      {error && <p role="alert" className="knowledge-form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Creating…" : retryPending ? "Retry" : "Create draft"}</button></div>
    </form>
  </div>;
}
