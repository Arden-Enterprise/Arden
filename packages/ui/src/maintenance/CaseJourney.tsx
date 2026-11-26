import type { CSSProperties } from "react";
import { Icon } from "../shared/Icon";
import type { ReporterStatus } from "./maintenance-client";

const steps: ReporterStatus[] = ["Submitted", "In Progress", "Resolved"];

export function CaseJourney({ status }: { status: ReporterStatus }) {
  const current = steps.indexOf(status);
  const resolved = status === "Resolved";
  return <ol className={`case-journey${resolved ? " is-resolved" : ""}`} aria-label={`Status: ${status}`}
    style={{ "--journey-progress": current / (steps.length - 1) } as CSSProperties}>
    {steps.map((step, index) => <li key={step} data-state={index < current || resolved ? "done" : index === current ? "current" : "next"}
      aria-current={index === current ? "step" : undefined}>
      <span className="case-journey-node" aria-hidden="true">{resolved && index === current && <Icon name="check" size={10} />}</span>
      <span className="case-journey-label">{step}</span>
    </li>)}
  </ol>;
}
