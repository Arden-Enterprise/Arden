import type { MaintenanceCase } from "./maintenance-client";
import { Icon } from "../shared/Icon";
import { CaseJourney } from "./CaseJourney";
import { CaseRail, type CaseRailProps } from "./CaseRail";
import { Findings } from "./Findings";
import { VersionChanges, type VersionRow } from "./VersionChanges";
import { MaintenanceStatus } from "./MaintenanceStatus";
import type { VersionPair } from "./version-pair";

type AnalysisRun = { state: "queued" | "running" | "succeeded" | "failed" | "cancelled"; findings: Array<{ versionId: string; summary: string }> };

export type MaintenanceCaseScreenProps = Omit<CaseRailProps, "item" | "reviewers" | "relatedCases"> & {
  item: MaintenanceCase | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  comparison?: { unavailable: true } | { unavailable: false; rows: VersionRow[] } | null;
  versionPair?: VersionPair | null;
  onVersionPair?: (action: "previous" | "next" | "current") => void;
  original?: { unavailable: true; label: string } | { unavailable: false; label: string; text: string } | null;
  onOpenOriginal?: (which: "earlier" | "later") => void;
  relatedCases?: CaseRailProps["relatedCases"];
  reviewers?: CaseRailProps["reviewers"];
  onStartAnalysis?: () => void;
  onCancelAnalysis?: () => void;
  onOpenCitation?: (versionId: string) => void;
  analysis?: AnalysisRun | null;
};

function analysisScope(pair: VersionPair | null) {
  const reported = pair?.reportedLabel ?? "the reported version";
  return pair ? `Next analysis uses ${reported} and ${pair.earlierLabel} to ${pair.laterLabel}.` : "Next analysis uses the reported version.";
}

function BackButton({ onBack }: { onBack: () => void }) {
  return <button type="button" className="case-back" onClick={onBack}><span aria-hidden="true">←</span> Back</button>;
}

function AnalysisAction({ run, busy, onStart, onCancel }: { run: AnalysisRun | null; busy: boolean; onStart?: () => void; onCancel?: () => void }) {
  const active = run?.state === "queued" || run?.state === "running";
  return active
    ? <button type="button" className="secondary-button" disabled={busy} onClick={() => onCancel?.()}>Cancel analysis</button>
    : <button type="button" className="secondary-button" disabled={busy} onClick={() => onStart?.()}>{run ? "Retry analysis" : "Start analysis"}</button>;
}

export function MaintenanceCaseScreen({ item, loading, error, onBack, comparison = null, versionPair = null, onVersionPair, original = null,
  onOpenOriginal, relatedCases = [], reviewers = [], onStartAnalysis, onCancelAnalysis, onOpenCitation, analysis = null, ...rail }: MaintenanceCaseScreenProps) {
  if (loading) return <div className="case-state" role="status" aria-busy="true"><span className="case-state-spinner" aria-hidden="true" />Loading case…</div>;
  if (error || !item) return <div className="case-state" role="alert">
    <h2>That case is unavailable</h2>
    <p className="field-error">{error || "It may have moved, or you may no longer be allowed to open it."}</p>
    <div className="maintenance-empty-actions">
      <button type="button" className="secondary-button" onClick={onBack}>Back</button>
      <button type="button" className="secondary-button" onClick={rail.onRetry}>Retry</button>
    </div>
  </div>;
  if (item.kind === "minimal") return <div className="case-state case-minimal">
    <span className="case-minimal-mark" aria-hidden="true"><Icon name="lock" size={18} /></span>
    <h2>Report status</h2>
    <MaintenanceStatus status={item.reporterStatus} />
    <p className="maintenance-id">{item.caseId}</p>
    <p>The document is no longer available to you. The report status is all that can be shown.</p>
    <BackButton onBack={onBack} />
  </div>;
  const open = item.reporterStatus !== "Resolved";
  const canAnalyze = Boolean(open && item.canDecide && onStartAnalysis);
  return <div className="case-view">
    <article className="case-main" aria-labelledby="maintenance-case-title">
      <header className="case-header">
        <BackButton onBack={onBack} />
        <h2 id="maintenance-case-title" className="case-title">{item.title || "Maintenance case"}</h2>
        <p className="case-meta">
          {versionPair?.reportedLabel && <span>Reported on {versionPair.reportedLabel}</span>}
          <span className="maintenance-id">{item.caseId}</span>
        </p>
        <CaseJourney status={item.reporterStatus} />
      </header>
      {item.reporterExplanation && <section className="case-outcome" aria-label="Outcome">
        <span className="case-outcome-mark" aria-hidden="true"><Icon name="check" size={16} /></span>
        <div>
          <p className="case-outcome-title">Outcome</p>
          <p className="case-outcome-text">{item.reporterExplanation}</p>
        </div>
      </section>}
      {item.description && <figure className="case-quote">
        <blockquote>{item.description}</blockquote>
        <figcaption>{item.kind === "reporter" ? "Your report" : "Reader report"}</figcaption>
      </figure>}
      <VersionChanges comparison={comparison} original={original} onOpenOriginal={onOpenOriginal} pair={versionPair} onVersionPair={onVersionPair} />
      {item.kind === "assigned" && <Findings run={analysis} onOpenCitation={onOpenCitation}
        action={canAnalyze && <AnalysisAction run={analysis} busy={rail.busy} onStart={onStartAnalysis} onCancel={onCancelAnalysis} />}
        scope={canAnalyze ? analysisScope(versionPair) : undefined} />}
    </article>
    <CaseRail item={item} reviewers={reviewers} relatedCases={relatedCases} {...rail} />
  </div>;
}
