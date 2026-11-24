import { useRef, useState } from "react";
import { ApiError, requestPublicationChange, type KnowledgeSubmission, type PublicationChangeRequest,
  type TargetReaders } from "../shared/api-client";
import type { Platform } from "../shared/types";
import type { IconName } from "../shared/Icon";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { ReasonField, ReasonNotice } from "./ReasonField";
import { TargetReadersField, targetReadersComplete } from "./TargetReadersField";

export type PublicationChangeType = PublicationChangeRequest["type"];

const copy: Record<PublicationChangeType, { title: string; icon: IconName; effect: string; submit: string; sent: string }> = {
  READER_CHANGE: {
    title: "Request a reader change", icon: "people",
    effect: "A reviewer must approve the new readers. Until then, the current readers keep access.",
    submit: "Send for review", sent: "Reader change sent for review",
  },
  WITHDRAWAL: {
    title: "Request withdrawal", icon: "warning",
    effect: "If a reviewer approves, this document leaves the Library and AI answers. Its versions stay in history, and publishing it again needs a new review.",
    submit: "Send for review", sent: "Withdrawal sent for review",
  },
};

export function publicationChangeSentMessage(type: PublicationChangeType): string { return copy[type].sent; }

/**
 * T6.4: the author of a published document asks a reviewer to replace its readers or to withdraw it (T6.1).
 * Nothing changes until a reviewer approves (T6.2). A retry with the same input reuses its idempotency key.
 */
export function PublicationChangeDialog({ type, documentTitle, documentId, platform, organizationId, departments, onClose, onSent }: {
  type: PublicationChangeType; documentTitle: string; documentId: string; platform: Platform; organizationId: string;
  departments: Array<{ id: string; name: string }>; onClose: () => void; onSent: (submission: KnowledgeSubmission) => void;
}) {
  const [reason, setReason] = useState("");
  const [readers, setReaders] = useState<TargetReaders | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ input: string; key: string } | null>(null);
  const reasonMissing = !reason.trim();
  const readersMissing = type === "READER_CHANGE" && !targetReadersComplete(readers);

  const send = async () => {
    setAttempted(true);
    if (reasonMissing || readersMissing) return;
    const input: PublicationChangeRequest = type === "READER_CHANGE"
      ? { type, reason: reason.trim(), targetReaders: readers! } : { type, reason: reason.trim() };
    const signature = JSON.stringify(input);
    const key = pending.current?.input === signature ? pending.current.key : crypto.randomUUID();
    pending.current = { input: signature, key };
    setBusy(true); setError("");
    try {
      const submission = await requestPublicationChange(platform, organizationId, documentId, input, key);
      pending.current = null;
      onSent(submission);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Couldn’t send this request.");
    } finally { setBusy(false); }
  };

  return <KnowledgeDialog title={copy[type].title} subtitle={documentTitle} icon={copy[type].icon} compact dismissible={!busy}
    onClose={onClose}>
    <form className="reason-dialog-form" onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="reason-dialog-body">
        {type === "READER_CHANGE" && <>
          <TargetReadersField readers={readers} departments={departments} busy={busy} platform={platform}
            organizationId={organizationId} onReaders={setReaders} legend="New readers" />
          {attempted && readersMissing && <small className="field-error" role="alert">Choose the new readers.</small>}
        </>}
        <ReasonField label="Reason" value={reason} busy={busy} showMissing={attempted && reasonMissing} onChange={setReason}
          initialFocus={type !== "READER_CHANGE"}
          placeholder={type === "WITHDRAWAL" ? "Why should this document be withdrawn?" : "Why should the readers change?"} />
        <ReasonNotice icon="review"><p>{copy[type].effect}</p></ReasonNotice>
        {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      </div>
      <div className="reason-dialog-footer">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Sending…" : copy[type].submit}</button>
      </div>
    </form>
  </KnowledgeDialog>;
}
