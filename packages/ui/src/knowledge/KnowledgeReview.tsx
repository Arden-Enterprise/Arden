import { useState } from "react";
import { Icon } from "../shared/Icon";
import { KnowledgeDialog } from "./KnowledgeDialog";
import { KnowledgeBadge, KnowledgeHeading, KnowledgeNotice, KnowledgeRow, KnowledgeSteps } from "./KnowledgePrimitives";
import { draftReadyForReview, formatSampleVersion, type KnowledgePreviewAction, type KnowledgePreviewState } from "./knowledgePreviewModel";

export function KnowledgeReview({ state, dispatch, onOpenDraft }: { state: KnowledgePreviewState; dispatch: (action: KnowledgePreviewAction) => void; onOpenDraft: () => void }) {
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const snapshot = state.submitted;
  const ready = snapshot ? draftReadyForReview(snapshot.draft) : false;
  const checksRemaining = snapshot ? Number(!snapshot.draft.recoveryReady) + Number(!snapshot.draft.sourceReady) : 2;
  const published = Boolean(snapshot && state.publication?.version === snapshot.version);
  return <>
    <KnowledgeHeading eyebrow="WORKSPACE / REVIEW QUEUE" title="Review & publish" description="Verify evidence, ownership and access before sharing knowledge." action={<KnowledgeBadge tone="amber">Assigned to me · Sample</KnowledgeBadge>} />
    <KnowledgeSteps steps={["Capture", "Enrich", "Review", "Publish", "Handover"]} active={published ? 3 : 2} />
    <div className="knowledge-inline-meta"><KnowledgeBadge>1 sample request</KnowledgeBadge><KnowledgeBadge tone="blue">{snapshot?.draft.title || "No submitted snapshot"}</KnowledgeBadge><KnowledgeBadge tone={published ? "jade" : "amber"}>{published ? "Published" : snapshot ? formatSampleVersion(snapshot.version) : "Draft"}</KnowledgeBadge></div>
    {!snapshot ? <div className="knowledge-empty"><h2>No sample snapshot awaiting review</h2><p>Open the working draft and submit a snapshot to preview the review flow.</p><button type="button" className="primary-button" onClick={onOpenDraft}>Open draft</button></div> : <div className="knowledge-two-column">
      <article className="knowledge-panel knowledge-review-document"><span className="meta-label knowledge-tone-blue">SUBMITTED {formatSampleVersion(snapshot.version).toUpperCase()} · IMMUTABLE SAMPLE</span><h2>{snapshot.draft.title}</h2><p>Lan Nguyen · Product Engineering · Sample submission</p><div className="knowledge-inline-meta"><KnowledgeBadge tone="jade">{snapshot.draft.scope}</KnowledgeBadge><KnowledgeBadge>{snapshot.draft.documentType}</KnowledgeBadge></div><hr />
        <span className="meta-label">CHANGESET · RECOVERY PROCEDURE</span><div className="knowledge-diff is-removed">− Restart the gateway when error rate exceeds 5%.</div><div className="knowledge-diff is-added">+ Validate upstream health and retry saturation before restart.<br />+ Link the incident ticket and record the decision owner.</div>
        <span className="meta-label">LINKED EVIDENCE</span><KnowledgeRow title="On-call escalation guide" details="Company-wide · Synthetic evidence available to intended readers" status="Verified" tone="blue" />
        {snapshot.draft.sourceReady ? <KnowledgeRow title="Department recovery dashboard" details="Department · Sample replacement evidence" status="Verified" /> : <KnowledgeRow title="Source access needs confirmation" details="Private content is not included in this review" status="Check access" icon="lock" tone="amber" />}
        <p className="knowledge-preview-footnote">Review uses the submitted snapshot. Edits to the working draft do not alter it.</p>
      </article>
      <aside className="knowledge-panel knowledge-review-readiness"><span className="meta-label knowledge-tone-amber">PUBLICATION READINESS</span><h2>{ready ? "Ready for a decision" : `${checksRemaining} checks remaining`}</h2>
        <div className="knowledge-review-check"><Icon name="check" /><div><strong>Owner confirmed</strong><small>Lan Nguyen remains responsible.</small></div></div>
        <div className="knowledge-review-check"><Icon name="check" /><div><strong>Reviewers assigned</strong><small>Synthetic reviewer: Minh Tran.</small></div></div>
        <div className={`knowledge-review-check ${snapshot.draft.sourceReady ? "" : "needs-attention"}`}><Icon name={snapshot.draft.sourceReady ? "check" : "lock"} /><div><strong>Source access</strong><small>{snapshot.draft.sourceReady ? "Evidence audience confirmed in the sample." : "Private source → Department publication"}</small></div></div>
        <div className={`knowledge-review-check ${snapshot.draft.recoveryReady ? "" : "needs-attention"}`}><Icon name={snapshot.draft.recoveryReady ? "check" : "lock"} /><div><strong>Incident evidence</strong><small>{snapshot.draft.recoveryReady ? "Recovery checklist / INC-2841 confirmed." : "Link INC-2841 to the recovery procedure."}</small></div></div>
        <span className="meta-label">MINH TRAN · SAMPLE REVIEWER</span><p>“The safer restart condition is clear. Resolve evidence scope before publishing.”</p>
        {!ready && <KnowledgeNotice title="Permission check" tone="amber">Replace restricted evidence with a source available to the intended readers, then submit a new snapshot.</KnowledgeNotice>}
        {snapshot.decision === "revision-requested" && <KnowledgeNotice title="Revision requested" tone="amber">The author can revise the draft and submit a new snapshot.</KnowledgeNotice>}
        {published && <KnowledgeNotice title={`Sample ${formatSampleVersion(snapshot.version)} published`} tone="jade">This session now points to the approved snapshot. Real publication and audit history are not connected.</KnowledgeNotice>}
        <div className="knowledge-review-actions"><button type="button" className="secondary-button" onClick={() => { dispatch({ type: "request-revision" }); onOpenDraft(); }} disabled={snapshot.decision !== "pending"}>Request changes</button>
          {snapshot.decision === "approved" ? <button type="button" className="primary-button" disabled={published} onClick={() => setConfirmVersion(snapshot.version)}>Publish approved snapshot</button> : <button type="button" className="primary-button" disabled={!ready || snapshot.decision !== "pending"} onClick={() => dispatch({ type: "approve", version: snapshot.version })}>Approve sample snapshot</button>}
          <button type="button" className="knowledge-back-button" onClick={onOpenDraft}>Open working draft →</button></div>
        <small>Approval and publication are separate sample actions. Server authorization is not implemented.</small>
      </aside>
    </div>}
    {confirmVersion !== null && <KnowledgeDialog title="Publish this approved sample snapshot?" onClose={() => setConfirmVersion(null)}><p>The sample publication will point to <strong>{formatSampleVersion(confirmVersion)}</strong> of <strong>{snapshot?.draft.title}</strong>, for <strong>{snapshot?.draft.scope}</strong> readers.</p><p>The working draft remains separate. This creates no real publication or audit record.</p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setConfirmVersion(null)}>Cancel</button><button type="button" className="primary-button" onClick={() => { dispatch({ type: "publish", version: confirmVersion }); setConfirmVersion(null); }}>Confirm sample publication</button></div></KnowledgeDialog>}
  </>;
}
