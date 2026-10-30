import { Icon } from "../shared/Icon";
import { KnowledgeBadge, KnowledgeHeading, KnowledgeNotice, KnowledgeRow, KnowledgeSteps } from "./KnowledgePrimitives";
import { draftReadyForReview, formatSampleVersion, type KnowledgePreviewAction, type KnowledgePreviewState } from "./knowledgePreviewModel";

export function KnowledgeReview({ state, dispatch, onOpenDraft }: { state: KnowledgePreviewState; dispatch: (action: KnowledgePreviewAction) => void; onOpenDraft: () => void }) {
  const snapshot = state.submitted;
  const ready = snapshot ? draftReadyForReview(snapshot.draft) : false;
  const checksRemaining = snapshot ? Number(!snapshot.draft.recoveryReady) + Number(!snapshot.draft.sourceReady) : 2;
  const published = Boolean(snapshot && state.publication?.version === snapshot.version);
  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / REVIEW QUEUE" title="Review & prepare"  action={<KnowledgeBadge tone="amber">Assigned to me · Sample</KnowledgeBadge>} />
    <KnowledgeSteps steps={["Capture", "Enrich", "Review", "Publish", "Handover"]} active={published ? 3 : 2} />
    <div className="knowledge-inline-meta"><KnowledgeBadge>1 sample request</KnowledgeBadge><KnowledgeBadge tone="blue">{snapshot?.draft.title || "No submitted snapshot"}</KnowledgeBadge><KnowledgeBadge tone={published ? "jade" : "amber"}>{published ? "Published" : snapshot ? formatSampleVersion(snapshot.version) : "Draft"}</KnowledgeBadge></div>
    {!snapshot ? <div className="knowledge-empty"><h2>Nothing to review</h2><button type="button" className="primary-button" onClick={onOpenDraft}>Open draft</button></div> : <div className="knowledge-two-column">
      <article className="knowledge-panel knowledge-review-document"><span className="meta-label knowledge-tone-blue">SUBMITTED {formatSampleVersion(snapshot.version).toUpperCase()} · DEMO</span><h2>{snapshot.draft.title}</h2><p>Lan Nguyen · Product Engineering · Sample submission</p><div className="knowledge-inline-meta"><KnowledgeBadge tone="jade">{snapshot.draft.scope}</KnowledgeBadge><KnowledgeBadge>{snapshot.draft.documentType}</KnowledgeBadge><KnowledgeBadge tone="blue">{snapshot.draft.classification}</KnowledgeBadge></div><hr />
        <span className="meta-label">CHANGESET · RECOVERY PROCEDURE</span><div className="knowledge-diff is-removed">− Restart the gateway when error rate exceeds 5%.</div><div className="knowledge-diff is-added">+ Validate upstream health and retry saturation before restart.<br />+ Link the incident ticket and record the decision owner.</div>
        <span className="meta-label">LINKED EVIDENCE</span><KnowledgeRow title="On-call escalation guide" details="Company-wide · Synthetic evidence available to intended readers" status="Verified" tone="blue" />
        {snapshot.draft.sourceReady ? <KnowledgeRow title="Department recovery dashboard" details="Department · Sample replacement evidence" status="Verified" /> : <KnowledgeRow title="Source access needs confirmation" details="Private content is not included in this review" status="Check access" icon="lock" tone="amber" />}

      </article>
      <aside className="knowledge-panel knowledge-review-readiness"><span className="meta-label knowledge-tone-amber">PUBLICATION READINESS</span><h2>{ready ? "Ready for a decision" : `${checksRemaining} checks remaining`}</h2>
        <div className="knowledge-review-check"><Icon name="check" /><div><strong>Owner confirmed</strong><small>Lan Nguyen remains responsible.</small></div></div>
        <div className="knowledge-review-check"><Icon name="check" /><div><strong>Reviewer assigned</strong><small>{snapshot.draft.classification === "RESTRICTED" ? "Minh Tran · Demo" : "Minh Tran · Demo"}</small></div></div>
        <div className={`knowledge-review-check ${snapshot.draft.sourceReady ? "" : "needs-attention"}`}><Icon name={snapshot.draft.sourceReady ? "check" : "lock"} /><div><strong>Source access</strong><small>{snapshot.draft.sourceReady ? "Evidence audience confirmed in the sample." : "Private source → Department publication"}</small></div></div>
        <div className={`knowledge-review-check ${snapshot.draft.recoveryReady ? "" : "needs-attention"}`}><Icon name={snapshot.draft.recoveryReady ? "check" : "lock"} /><div><strong>Incident evidence</strong><small>{snapshot.draft.recoveryReady ? "Recovery checklist / INC-2841 confirmed." : "Link INC-2841 to the recovery procedure."}</small></div></div>
        <span className="meta-label">MINH TRAN · SAMPLE REVIEWER</span><p>“The safer restart condition is clear. Resolve evidence scope before publishing.”</p>
        {!ready && <KnowledgeNotice title="Permission check" tone="amber">Choose sources the readers can access.</KnowledgeNotice>}
        {snapshot.decision === "rejected" && <KnowledgeNotice title="Submission rejected" tone="amber">Demo decision</KnowledgeNotice>}
        {snapshot.decision === "approved" && !published && <KnowledgeNotice title={`Sample ${formatSampleVersion(snapshot.version)} is preparing`} tone="blue">Demo · Preparing publication</KnowledgeNotice>}
        {published && <KnowledgeNotice title={`Sample ${formatSampleVersion(snapshot.version)} activated`} tone="jade">Demo · No real documents changed.</KnowledgeNotice>}
        <div className="knowledge-review-actions"><button type="button" className="secondary-button" onClick={() => dispatch({ type: "reject" })} disabled={snapshot.decision !== "pending"}>Reject</button>
          <button type="button" className="primary-button" disabled={!ready || snapshot.decision !== "pending"} onClick={() => dispatch({ type: "approve", version: snapshot.version })}>Approve</button>
          <button type="button" className="knowledge-back-button" onClick={onOpenDraft}>Open working draft →</button></div>

      </aside>
    </div>}
  </>;
}
