import type { ReactNode } from "react";
import { Icon, type IconName } from "../shared/Icon";

const statusAssets = {
  amber: new URL("./assets/status-amber.svg", import.meta.url).href,
  jade: new URL("./assets/status-jade.svg", import.meta.url).href,
  muted: new URL("./assets/status-muted.svg", import.meta.url).href,
};

export function KnowledgeBadge({ children, tone = "muted" }: { children: ReactNode; tone?: "amber" | "jade" | "muted" | "blue" }) {
  return <span className={`knowledge-badge knowledge-tone-${tone}`}><img src={statusAssets[tone === "blue" ? "muted" : tone]} alt="" width={7} height={7} />{children}</span>;
}

export function KnowledgeNotice({ title, children, tone = "blue" }: { title: string; children: ReactNode; tone?: "amber" | "jade" | "blue" }) {
  return <div className={`knowledge-notice knowledge-tone-${tone}`}><div><strong>{title}</strong><p>{children}</p></div></div>;
}

export function KnowledgeHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="knowledge-heading"><span className="meta-label">{eyebrow}</span><div><h1>{title}</h1>{action}</div><p>{description}</p></header>;
}

export function KnowledgeSteps({ steps, active }: { steps: string[]; active: number }) {
  return <ol className="knowledge-steps" aria-label="Workflow progress">{steps.map((step, index) => <li key={step} className={index === active ? "is-current" : index < active ? "is-complete" : ""} aria-current={index === active ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{step}</li>)}</ol>;
}

export function KnowledgeRow({ title, details, status, tone = "jade", icon = "document", onClick }: { title: string; details: string; status: string; tone?: "jade" | "blue" | "amber" | "muted"; icon?: IconName; onClick?: () => void }) {
  const content = <><Icon name={icon} size={24} /><span className="knowledge-row-copy"><strong>{title}</strong><small>{details}</small></span><span className={`knowledge-row-status knowledge-tone-${tone}`}>{status}</span></>;
  return onClick ? <button type="button" className="knowledge-row" onClick={onClick}>{content}</button> : <div className="knowledge-row">{content}</div>;
}

export function KnowledgeConnections() {
  return <div className="knowledge-connections" role="img" aria-label="Sample connections between the gateway runbook, a decision, an incident, a guide and a draft">
    <img className="knowledge-connection-lines" src={new URL("./assets/connections.svg", import.meta.url).href} alt="" />
    <span className="knowledge-node-runbook" /><span className="knowledge-label-runbook">Runbook</span>
    <img className="knowledge-node-decision" src={new URL("./assets/decision.svg", import.meta.url).href} alt="" /><span className="knowledge-label-decision">Decision</span>
    <img className="knowledge-node-incident" src={new URL("./assets/incident.svg", import.meta.url).href} alt="" /><span className="knowledge-label-incident">Incident</span>
    <span className="knowledge-node-guide" /><span className="knowledge-label-guide">Guide</span>
    <img className="knowledge-node-draft" src={new URL("./assets/draft.svg", import.meta.url).href} alt="" /><span className="knowledge-label-draft">Draft</span>
  </div>;
}
