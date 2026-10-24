import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { KnowledgeNotice } from "../knowledge/KnowledgePrimitives";
import { ApiError, createKnowledgeDraft, type CreatedKnowledgeDraft } from "../shared/api-client";
import { knowledgeClassifications, type KnowledgeClassification } from "../shared/knowledge-classification";
import type { Platform } from "../shared/types";

export type ContributionAttempt = {
  sourceVersionId: string;
  classification: KnowledgeClassification;
  idempotencyKey: string;
};

const classificationHints: Record<KnowledgeClassification, string> = {
  INTERNAL: "Routine work instructions and lessons learned",
  CONFIDENTIAL: "Unreleased plans, internal recruiting",
  RESTRICTED: "Sensitive security or personnel detail",
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
  const [classification, setClassification] = useState<KnowledgeClassification>(attempt?.classification ?? "INTERNAL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryPending, setRetryPending] = useState(Boolean(attempt));
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

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
    const request = attempt ?? { sourceVersionId: source.versionId, classification, idempotencyKey: crypto.randomUUID() };
    onAttemptChange(request);
    try {
      const created = await createKnowledgeDraft(platform, organizationId, request.sourceVersionId, request.classification, request.idempotencyKey);
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
      <h2 id={titleId} ref={heading} tabIndex={-1}>Contribute a copy</h2>
      <p className="island-meta">Arden makes a separate shared draft from this saved version. Your private note stays private and unchanged. Nothing is submitted, approved or published.</p>
    </div>
    <div className="knowledge-source-preview"><strong>{source.title}</strong><span>Saved private version · exact text to copy</span><pre>{source.body}</pre></div>
    <form className="knowledge-contribute-form" onSubmit={(event) => void submit(event)}>
      <fieldset className="island-option-group" disabled={busy || retryPending}><legend>Proposed classification</legend>
        {knowledgeClassifications.map((value) => <label key={value} className={classification === value ? "is-selected" : ""}>
          <input type="radio" name="contribution-classification" checked={classification === value} onChange={() => setClassification(value)} />
          <span><strong>{value}</strong><small>{classificationHints[value]}</small></span></label>)}
      </fieldset>
      <small>Classification is stored with this draft. Audience and reviewer assignment come later, in the draft.</small>
      {retryPending && <KnowledgeNotice title="Result uncertain" tone="amber">Retry here with the same request key to avoid creating a duplicate. Do not change source or classification until the result is known.</KnowledgeNotice>}
      {error && <p role="alert" className="knowledge-form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Creating…" : retryPending ? "Retry same request" : "Create shared draft"}</button></div>
    </form>
  </div>;
}
