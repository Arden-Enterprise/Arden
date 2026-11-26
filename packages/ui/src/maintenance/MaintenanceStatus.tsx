import type { ReporterStatus } from "./maintenance-client";

const tones: Record<ReporterStatus, string> = {
  Submitted: "tone-info",
  "In Progress": "tone-warning",
  Resolved: "tone-success",
};

/** Status is text plus a tone. Color is not the only signal. */
export function MaintenanceStatus({ status }: { status: ReporterStatus }) {
  return <span className={`island-chip has-dot ${tones[status]}`}>{status}</span>;
}
