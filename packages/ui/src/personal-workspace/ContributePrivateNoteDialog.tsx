import { useEffect, useRef, useState, type FormEvent } from "react";
import { KnowledgeDialog } from "../knowledge/KnowledgeDialog";
import { KnowledgeNotice } from "../knowledge/KnowledgePrimitives";
import { ApiError, createKnowledgeDraft, type CreatedKnowledgeDraft } from "../shared/api-client";
import { isKnowledgeClassification, knowledgeClassifications, type KnowledgeClassification } from "../shared/knowledge-classification";
import type { Platform } from "../shared/types";

export type ContributionAttempt = {
  sourceVersionId: string;
  classification: KnowledgeClassification;
  idempotencyKey: string;
};

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

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
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

  return <KnowledgeDialog title="Contribute a private note" onClose={onClose} dismissible={!busy}>
    <p>Arden will copy this saved private-note version into a separate shared draft on the server. The original stays private. This does not submit, approve or publish the copy.</p>
    <div className="knowledge-source-preview"><strong>{source.title}</strong><span>Saved private version · exact text to copy</span><pre>{source.body}</pre></div>
    <form className="knowledge-contribute-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="contribution-classification">Classification</label>
      <select id="contribution-classification" value={classification} disabled={busy || retryPending} onChange={(event) => { if (isKnowledgeClassification(event.target.value)) setClassification(event.target.value); }}>
        {knowledgeClassifications.map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}
      </select>
      <small>Classification is stored with this draft. Audience and reviewer assignment are not available in this step.</small>
      {retryPending && <KnowledgeNotice title="Result uncertain" tone="amber">Retry here with the same request key to avoid creating a duplicate. Do not change source or classification until the result is known.</KnowledgeNotice>}
      {error && <p role="alert" className="knowledge-form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? "Creating…" : retryPending ? "Retry same request" : "Create shared draft"}</button></div>
    </form>
  </KnowledgeDialog>;
}
