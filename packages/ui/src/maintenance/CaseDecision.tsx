import { useId, useState } from "react";
import type { MaintenanceCase } from "./maintenance-client";
import { IdField, NoteField } from "./CaseFields";

type Proof = NonNullable<MaintenanceCase["publicationProof"]>;

const proofChip: Record<Proof["state"], { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "tone-warning" },
  upcoming: { label: "Upcoming", tone: "tone-info" },
  rejected: { label: "Rejected", tone: "tone-danger" },
  applicable: { label: "Applicable", tone: "tone-success" },
};

function proofMessage(proof: Proof) {
  if (proof.state === "applicable") {
    return proof.outcome === "WITHDRAWN" ? "The withdrawal has applied and can close this case." : "A newer version is in effect and can close this case.";
  }
  if (proof.state === "upcoming") return "A newer version is published but not in effect yet. Confirm it once it applies.";
  if (proof.state === "rejected") return "The latest publication request was rejected. It can't close this case.";
  return "No applicable change yet. The case stays open until a correction or withdrawal applies.";
}

function PublicationChange({ item, busy, onLinkPublication, onLinkPublicationRequest }: {
  item: MaintenanceCase; busy: boolean; onLinkPublication?: () => void; onLinkPublicationRequest?: (submissionId: string) => void;
}) {
  const titleId = useId();
  const [requestId, setRequestId] = useState("");
  const proof = item.publicationProof;
  const applicableVersion = proof?.state === "applicable" ? proof.publishedVersionId : null;
  return <div className="maintenance-subcard" role="group" aria-labelledby={titleId}>
    <div className="maintenance-subcard-head">
      <p id={titleId}>Publication change · Flow 2</p>
      {proof && <span className={`island-chip has-dot ${proofChip[proof.state].tone}`}>{proofChip[proof.state].label}</span>}
    </div>
    {proof && <p className="maintenance-rail-copy" role="status">{proofMessage(proof)}</p>}
    {item.publicationLinkSubmissionId && <p className="island-note" role="status">A publication request is linked. The case stays open until that request applies.</p>}
    {onLinkPublicationRequest && <IdField label="Publication request ID" help="Paste the ID of the author's replacement or withdrawal request."
      value={requestId} onChange={setRequestId} actionLabel="Link request" busy={busy} onAction={onLinkPublicationRequest} />}
    {applicableVersion && item.publicationLinkVersionId !== applicableVersion && <button type="button" className="secondary-button"
      disabled={busy} onClick={() => onLinkPublication?.()}>Link current publication</button>}
    {item.publicationLinkVersionId && <p className="island-note is-success" role="status">The applicable publication is linked.</p>}
  </div>;
}

export function CaseDecision({ item, busy, onResolve, onConfirmPublication, onLinkPublication, onLinkPublicationRequest }: {
  item: MaintenanceCase;
  busy: boolean;
  onResolve: (explanation: string, rationale: string) => void;
  onConfirmPublication?: (explanation: string, rationale: string) => void;
  onLinkPublication?: () => void;
  onLinkPublicationRequest?: (submissionId: string) => void;
}) {
  const headingId = useId();
  const helpId = useId();
  const [explanation, setExplanation] = useState("");
  const [rationale, setRationale] = useState("");
  const notesReady = Boolean(explanation.trim() && rationale.trim());
  const proof = item.publicationProof;
  const applicable = proof?.state === "applicable" && Boolean(proof.publishedVersionId);
  const linked = Boolean(item.publicationLinkSubmissionId) || (applicable && item.publicationLinkVersionId === proof?.publishedVersionId);
  const help = !notesReady ? `Add both notes before recording ${applicable ? "the outcome" : "no change"}.`
    : applicable && !linked ? "Link the current publication before recording the outcome." : "This closes the case.";
  const noChange = <button type="button" className={applicable ? "secondary-button" : "primary-button"} disabled={busy || !notesReady}
    aria-describedby={helpId} onClick={() => onResolve(explanation.trim(), rationale.trim())}>No change needed</button>;
  return <section className="maintenance-rail-section" aria-labelledby={headingId}>
    <h3 id={headingId}>Decision</h3>
    <NoteField label="Reporter explanation" placeholder="What the reporter will read" help="The reporter sees this. It is stored separately from your rationale."
      value={explanation} onChange={setExplanation} maxLength={2000} required />
    <NoteField label="Reviewer rationale" placeholder="Evidence and reasoning for reviewers" help="Only reviewers see this." value={rationale} onChange={setRationale} maxLength={2000} required />
    <PublicationChange item={item} busy={busy} onLinkPublication={onLinkPublication} onLinkPublicationRequest={onLinkPublicationRequest} />
    <div className="maintenance-decision-actions">
      {applicable && <button type="button" className="primary-button" disabled={busy || !notesReady || !linked} aria-describedby={helpId}
        onClick={() => onConfirmPublication?.(explanation.trim(), rationale.trim())}>Record published outcome</button>}
      {noChange}
      <small id={helpId}>{help}</small>
    </div>
  </section>;
}
