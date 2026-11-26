import { useRef, useState } from "react";
import { emptyKnowledgeMetadata, validityStatus } from "@arden/domain";
import { ApiError, decidePublicationRenewal, requestPublicationRenewal, type PublicationRenewalState } from "../shared/api-client";
import type { Platform } from "../shared/types";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { libraryDateLabel } from "./libraryDisplay";
import { todayIso, validityLabel } from "./KnowledgeLibraryBrowse";

/** Decision 0032: validity words for people responsible for a document (never shown to ordinary readers). */
export function renewalStatus(state: Pick<PublicationRenewalState, "expirationDate" | "renewalPending" | "pending">, today = todayIso()):
  { label: string; tone: "" | "is-info" | "is-attention" | "is-danger" } {
  if (state.pending?.canDecide) return { label: "Renewal awaiting your decision", tone: "is-attention" };
  if (state.renewalPending) return { label: "Renewal awaiting review", tone: "is-info" };
  const validity = validityStatus({ ...emptyKnowledgeMetadata(), expirationDate: state.expirationDate }, today);
  if (validity.status === "Expired") return { label: "Expired", tone: "is-danger" };
  if (validity.status === "Expiring soon") return { label: validityLabel(validity), tone: "is-attention" };
  return { label: "Current", tone: "" };
}

const randomKey = () => globalThis.crypto.randomUUID();

/** A reviewed renewal: only the Valid until changes, and only after another person approves it. */
export function RenewPublicationDialog({ target, platform, organizationId, departmentName, onClose, onSent }: {
  target: Pick<PublicationRenewalState, "documentId" | "title" | "expirationDate" | "isAuthor" | "authorActive"
    | "authorName" | "responsibleDepartmentId">;
  platform: Platform; organizationId: string; departmentName?: (id: string | null) => string;
  onClose: () => void; onSent: () => void;
}) {
  const department = departmentName?.(target.responsibleDepartmentId) ?? "the responsible department";
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
        <p>Only its Valid until changes; content, readers and owner stay the same. Readers see the document again
          only after the renewal is approved.</p>
        {target.isAuthor ? <p>A reviewer for {department} decides it.</p>
          : target.authorActive ? <p>You’re renewing on behalf of {target.authorName || "the author"}. They’ll see your name and
            reason and can approve or reject it within 3 days; after that a reviewer for {department} can decide.</p>
          : <p>The author is no longer active, so a reviewer for {department} decides it.</p>}
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

/**
 * Decision 0032: the author decides a renewal someone asked for on their behalf. They have the first say for
 * 3 days (or until the document expires); a rejection is final.
 */
export function OnBehalfRenewalDecision({ pending, platform, organizationId, onDecided }: {
  pending: NonNullable<PublicationRenewalState["pending"]>; platform: Platform; organizationId: string;
  onDecided: (action: "APPROVE" | "REJECT") => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One key per action, reused if the same action is retried after a lost response.
  const keys = useRef<Record<"APPROVE" | "REJECT", string>>({ APPROVE: randomKey(), REJECT: randomKey() });
  const decide = async (action: "APPROVE" | "REJECT") => {
    if (action === "REJECT") { setAttempted(true); if (!note.trim()) return; }
    setBusy(true); setError("");
    try {
      await decidePublicationRenewal(platform, organizationId, pending, action, action === "REJECT" ? note.trim() : null,
        keys.current[action]);
      onDecided(action);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Couldn’t record your decision.");
      setBusy(false);
    }
  };
  const until = pending.expirationDate ? libraryDateLabel(`${pending.expirationDate}T00:00:00`) : "no expiry";
  return <section className="island-box contribution-renewal" aria-labelledby="renewal-decision-title">
    <strong id="renewal-decision-title">Renewal requested on your behalf</strong>
    <p>{pending.requestedByName ?? "A colleague"} asked to renew this document until {until}: {pending.reason}</p>
    {pending.authorWindowUntil && <p className="island-meta">You decide first, until {new Date(pending.authorWindowUntil)
      .toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. After that a reviewer can decide.</p>}
    {rejecting && <label className="island-field">Note for the requester *
      <textarea rows={3} maxLength={2000} value={note} disabled={busy} aria-invalid={attempted && !note.trim()}
        onChange={(event) => setNote(event.target.value)} />
      {attempted && !note.trim() && <small className="field-error" role="alert">Enter a note.</small>}</label>}
    {error && <p role="alert" className="knowledge-live-error">{error}</p>}
    <div className="contribution-withdraw-actions">
      {rejecting ? <>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setRejecting(false)}>Cancel</button>
        <button type="button" className="secondary-button contribution-withdraw-confirm" disabled={busy}
          onClick={() => void decide("REJECT")}>{busy ? "Rejecting…" : "Reject renewal"}</button>
      </> : <>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void decide("APPROVE")}>{busy ? "Approving…" : "Approve"}</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
      </>}
    </div>
  </section>;
}
