import type { ReactNode } from "react";
import { Icon } from "../shared/Icon";

type RunState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
type Run = { state: RunState; findings: Array<{ versionId: string; summary: string }> };

const runChip: Record<RunState, { label: string; tone: string }> = {
  queued: { label: "Queued", tone: "tone-info" },
  running: { label: "Running", tone: "tone-accent" },
  succeeded: { label: "Ready", tone: "tone-success" },
  failed: { label: "Failed", tone: "tone-danger" },
  cancelled: { label: "Cancelled", tone: "tone-strong" },
};

function runMessage(run: Run | null) {
  if (!run) return "No analysis has been started.";
  if (run.state === "queued") return "Waiting for the analysis to start.";
  if (run.state === "running") return "Comparing the selected versions.";
  if (run.state === "cancelled") return "The run was cancelled. Earlier findings were not kept.";
  if (run.state === "failed") return "Analysis failed. You can continue manually.";
  return run.findings.length ? null : "No findings for these versions.";
}

export function Findings({ run, onOpenCitation, action, scope }: {
  run: Run | null;
  onOpenCitation?: (versionId: string) => void;
  action?: ReactNode;
  scope?: string;
}) {
  const active = run?.state === "queued" || run?.state === "running";
  const message = runMessage(run);
  return <section className="maintenance-card maintenance-findings" aria-labelledby="findings-title" aria-busy={active || undefined}>
    <header className="maintenance-card-header">
      <h3 id="findings-title">Findings</h3>
      {run && <span className={`island-chip has-dot ${runChip[run.state].tone}`}>{runChip[run.state].label}</span>}
      {action && <div className="maintenance-card-actions">{action}</div>}
    </header>
    {active && <div className="maintenance-progress" aria-hidden="true"><span /></div>}
    <div role="status">{message && <p className="maintenance-card-note">{message}</p>}</div>
    {run?.state === "succeeded" && run.findings.length > 0 && <ul className="maintenance-findings-list">
      {run.findings.map((item, index) => <li key={`${item.versionId}-${index}`}>
        <p>{item.summary}</p>
        {onOpenCitation && <button type="button" className="maintenance-cite" onClick={() => onOpenCitation(item.versionId)}>
          <Icon name="document" size={12} />Open citation</button>}
      </li>)}
    </ul>}
    {scope && <p className="maintenance-card-foot">{scope}</p>}
  </section>;
}
