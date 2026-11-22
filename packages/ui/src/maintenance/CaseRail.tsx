import { useId, useState } from "react";
import { Icon } from "../shared/Icon";
import type { EligibleReviewer, MaintenanceCase, MaintenanceHistory, RelatedCase } from "./maintenance-client";
import { CaseDecision } from "./CaseDecision";
import { CaseHistory } from "./CaseHistory";
import { IdField, NoteField } from "./CaseFields";
import { Expand } from "./Expand";
import { MaintenanceStatus } from "./MaintenanceStatus";

export type CaseRailProps = {
  item: MaintenanceCase;
  history: MaintenanceHistory | null;
  busy: boolean;
  reviewers: EligibleReviewer[];
  relatedCases: RelatedCase[];
  onClaim: () => void;
  onResolve: (explanation: string, rationale: string) => void;
  onReassign: (membershipId: string, reason: string) => void;
  onMoreHistory: () => void;
  onRetry: () => void;
  onAsk?: (message: string) => void | Promise<void>;
  onConfirmPublication?: (explanation: string, rationale: string) => void;
  onLinkPublication?: () => void;
  onLinkPublicationRequest?: (submissionId: string) => void;
  onOpenRelated?: (caseId: string) => void;
  onLinkRelated?: (relatedCaseId: string) => void;
};

function Conversation({ label, placeholder, actionLabel, busy, onSend }: {
  label: string; placeholder: string; actionLabel: string; busy: boolean; onSend: (message: string) => void | Promise<void>;
}) {
  const [text, setText] = useState("");
  const send = () => {
    const message = text.trim();
    void Promise.resolve(onSend(message)).then(() => setText((current) => current.trim() === message ? "" : current)).catch(() => undefined);
  };
  return <section className="maintenance-rail-section maintenance-conversation">
    <NoteField label={label} placeholder={placeholder} value={text} onChange={setText} maxLength={2000} />
    <button type="button" className="secondary-button" disabled={busy || !text.trim()} onClick={send}>{actionLabel}</button>
  </section>;
}

function Reassign({ reviewers, busy, onReassign }: Pick<CaseRailProps, "reviewers" | "busy" | "onReassign">) {
  const headingId = useId();
  const pickerId = useId();
  const pickerHelpId = useId();
  const [membershipId, setMembershipId] = useState("");
  const [reason, setReason] = useState("");
  const ready = reviewers.some((reviewer) => reviewer.membershipId === membershipId) && Boolean(reason.trim());
  return <section className="maintenance-rail-section" aria-labelledby={headingId}>
    <h3 id={headingId}>Reassign</h3>
    <div className="maintenance-field">
      <label className="island-field" htmlFor={pickerId}>
        <span>Eligible reviewer</span>
        <select id={pickerId} value={membershipId} aria-describedby={pickerHelpId} onChange={(event) => setMembershipId(event.target.value)}>
          <option value="">Choose a reviewer</option>
          {reviewers.map((reviewer) => <option key={reviewer.membershipId} value={reviewer.membershipId}>{reviewer.displayName}</option>)}
        </select>
      </label>
      <small id={pickerHelpId}>{reviewers.length ? "The author of the document is not listed." : "No eligible reviewer is available."}</small>
    </div>
    <NoteField label="Reason for reassignment" placeholder="Why this case needs a new reviewer" value={reason} onChange={setReason} maxLength={500} />
    <button type="button" className="secondary-button" disabled={busy || !ready}
      onClick={() => onReassign(membershipId.trim(), reason.trim())}>Reassign</button>
    {!ready && <small>Add a reviewer and a reason before reassigning.</small>}
  </section>;
}

function RelatedCases({ relatedCases, busy, onOpenRelated, onLinkRelated }: Pick<CaseRailProps, "relatedCases" | "busy" | "onOpenRelated" | "onLinkRelated">) {
  const headingId = useId();
  const panelId = useId();
  const [linking, setLinking] = useState(false);
  const [relatedId, setRelatedId] = useState("");
  if (!relatedCases.length && !onLinkRelated) return null;
  return <section className="maintenance-rail-section" aria-labelledby={headingId}>
    <div className="maintenance-rail-heading">
      <h3 id={headingId}>Related cases</h3>
      {onLinkRelated && <button type="button" className="maintenance-text-button" aria-expanded={linking} aria-controls={panelId}
        onClick={() => setLinking((open) => !open)}>Link a case</button>}
    </div>
    {relatedCases.length > 0 && <ul className="maintenance-related">
      {relatedCases.map((related) => <li key={related.caseId}>
        <button type="button" className="maintenance-related-row" aria-label={`Open ${related.title || "related case"}, ${related.reporterStatus}`}
          onClick={() => onOpenRelated?.(related.caseId)}>
          <span title={related.title || undefined}>{related.title || "Related case"}</span>
          <MaintenanceStatus status={related.reporterStatus} />
        </button>
      </li>)}
    </ul>}
    {onLinkRelated && <Expand id={panelId} open={linking}>
      <IdField label="Case ID" help="Paste the ID of another case about this document." value={relatedId} onChange={setRelatedId}
        actionLabel="Link case" busy={busy} onAction={onLinkRelated} />
    </Expand>}
  </section>;
}

export function CaseRail({ item, history, busy, reviewers, relatedCases, onClaim, onResolve, onReassign, onMoreHistory, onRetry, onAsk,
  onConfirmPublication, onLinkPublication, onLinkPublicationRequest, onOpenRelated, onLinkRelated }: CaseRailProps) {
  const open = item.reporterStatus !== "Resolved";
  const reviewerView = item.kind === "assigned" || item.kind === "queue";
  return <aside className="case-aside" aria-label="Case actions">
    {item.needsReassignment && <p className="island-note is-warning" role="status">
      <Icon name="warning" size={14} />Needs reassignment. You can no longer decide this case.</p>}
    {item.kind === "queue" && <div className="maintenance-claim">
      <p className="maintenance-rail-copy">Read-only until you claim it.</p>
      <button type="button" className="primary-button" disabled={busy} aria-busy={busy || undefined} onClick={onClaim}>
        {busy ? "Claiming…" : "Claim"}
      </button>
    </div>}
    {open && onAsk && item.canDecide && <Conversation label="Question for the reporter" placeholder="Ask for a page, a photo or more detail…" actionLabel="Ask" busy={busy} onSend={onAsk} />}
    {open && onAsk && item.kind === "reporter" && <Conversation label="Reply" placeholder="Write a reply to the reviewer…" actionLabel="Send reply" busy={busy} onSend={onAsk} />}
    {open && item.canDecide && <CaseDecision item={item} busy={busy} onResolve={onResolve} onConfirmPublication={onConfirmPublication}
      onLinkPublication={onLinkPublication} onLinkPublicationRequest={onLinkPublicationRequest} />}
    {open && item.canReassign && <Reassign reviewers={reviewers} busy={busy} onReassign={onReassign} />}
    {reviewerView && <RelatedCases relatedCases={relatedCases} busy={busy} onOpenRelated={onOpenRelated} onLinkRelated={onLinkRelated} />}
    <CaseHistory history={history} loading={false} error="" onMore={onMoreHistory} onRetry={onRetry} />
  </aside>;
}
