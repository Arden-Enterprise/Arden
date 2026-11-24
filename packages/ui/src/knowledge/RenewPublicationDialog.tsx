import { useRef, useState } from "react";
import { emptyKnowledgeMetadata, validityStatus } from "@arden/domain";
import { ApiError, requestPublicationRenewal, type PublicationRenewalState } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { libraryDateLabel } from "./libraryDisplay";
import { todayIso, validityLabel } from "./KnowledgeLibraryBrowse";

/** Decision 0032: validity words for people responsible for a document (never shown to ordinary readers). */
export function renewalStatus(state: Pick<PublicationRenewalState, "expirationDate" | "renewalPending">, today = todayIso()):
  { label: string; tone: "" | "is-info" | "is-attention" | "is-danger" } {
  if (state.renewalPending) return { label: "Renewal awaiting review", tone: "is-info" };
  const validity = validityStatus({ ...emptyKnowledgeMetadata(), expirationDate: state.expirationDate }, today);
  if (validity.status === "Expired") return { label: "Expired", tone: "is-danger" };
  if (validity.status === "Expiring soon") return { label: validityLabel(validity), tone: "is-attention" };
  return { label: "Current", tone: "" };
}

const randomKey = () => globalThis.crypto.randomUUID();

/** A reviewed renewal: only the Valid until changes, and only after another person approves it. */
export function RenewPublicationDialog({ target, platform, organizationId, onClose, onSent }: {
  target: Pick<PublicationRenewalState, "documentId" | "title" | "expirationDate" | "isAuthor">;
  platform: Platform; organizationId: string; onClose: () => void; onSent: () => void;
}) {
  const [date, setDate] = useState("");
  const [noExpiry, setNoExpiry] = useState(false);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per dialog: a retry after a lost response replays instead of creating a second request.
  const key = useRef(randomKey());
  const today = todayIso();
  const dateMissing = !noExpiry && !(date > today);
  const reasonMissing = !reason.trim();
  const submit = async () => {
    setAttempted(true);
    if (dateMissing || reasonMissing) return;
    setBusy(true); setError("");
    try {
      await requestPublicationRenewal(platform, organizationId, target.documentId,
        { expirationDate: noExpiry ? null : date, reason: reason.trim() }, key.current);
      onSent();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Couldn’t send the renewal request.");
      setBusy(false);
    }
  };
  return <KnowledgeDialog title="Renew document" dismissible={!busy} onClose={onClose}>
    <form className="publication-change-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <div className="publication-change-effect">
        <p><strong>{target.title}</strong>{target.expirationDate && <> · valid until {libraryDateLabel(`${target.expirationDate}T00:00:00`)}</>}</p>
        <p>Only its Valid until changes; content, readers and owner stay the same. A reviewer for the responsible
          department must approve it, and readers see the document again only after approval.</p>
        {!target.isAuthor && <p>You are asking on the author’s behalf. If they are still a member, they are told who asked and why.</p>}
      </div>
      <label className="island-field">New Valid until *
        <input type="date" min={today} value={date} disabled={busy || noExpiry} aria-invalid={attempted && dateMissing}
          onChange={(event) => setDate(event.target.value)} />
        {attempted && dateMissing && <small className="field-error" role="alert">Choose a date after today, or no expiry.</small>}
      </label>
      <label className="organization-confirm-check"><input type="checkbox" checked={noExpiry} disabled={busy}
        onChange={(event) => setNoExpiry(event.target.checked)} /><span>No expiry</span></label>
      <label className="island-field publication-change-reason">Reason *
        <textarea rows={3} maxLength={1000} value={reason} disabled={busy} aria-invalid={attempted && reasonMissing}
          placeholder="Why is this document still valid?" onChange={(event) => setReason(event.target.value)} />
        <small className={attempted && reasonMissing ? "field-error" : ""} role={attempted && reasonMissing ? "alert" : undefined}>
          {attempted && reasonMissing ? "Enter a reason." : `${reason.length}/1000`}</small>
      </label>
      {error && <p role="alert" className="knowledge-live-error">{error}</p>}
      <div className="publication-change-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="primary-button" disabled={busy}>{busy ? "Sending…" : "Send for review"}</button>
      </div>
    </form>
  </KnowledgeDialog>;
}
