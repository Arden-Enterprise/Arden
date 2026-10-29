import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { IslandEntryLayout } from "../shared/IslandEntryLayout";
import { EffectiveAccessPreview } from "./MemberDirectory";
import { membershipReadiness } from "./organizationWorkflow";
import type { OrganizationPreview } from "./previewModel";

export function MembershipAccessPage({ organization, memberId, onBack, onContinue }: {
  organization: OrganizationPreview;
  memberId: string;
  onBack: () => void;
  onContinue: (memberId: string) => void;
}) {
  const [checking, setChecking] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [error, setError] = useState("");
  const member = organization.members.find((item) => item.id === memberId);
  const readiness = membershipReadiness(organization, memberId);
  useEffect(() => {
    if (!checking) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => setChecking(false)); });
    return () => { cancelAnimationFrame(firstFrame); if (secondFrame) cancelAnimationFrame(secondFrame); };
  }, [checking]);
  const continueToWorkspace = () => {
    const current = membershipReadiness(organization, memberId);
    if (sessionExpired || checking || current.state !== "ready") { setError("Access is not ready. Check the current membership and assignment first."); return; }
    onContinue(memberId);
  };
  const title = checking ? "Checking your assignment" : sessionExpired ? "Sign in to continue" : readiness.state === "ready" ? "Your workspace is ready" : readiness.state === "pending" ? "You're in. Access comes next." : "Workspace access is unavailable";
  const ready = !checking && !sessionExpired && readiness.state === "ready";
  return <IslandEntryLayout titleId="membership-access-title" eyebrow="VALIDATE CURRENT ACCESS" badge="MEMBER ACCESS PREVIEW" wide={Boolean(member)}
    title={title} actions={<button type="button" className="secondary-button" onClick={onBack}>Back to administration</button>}>
    <section className="island island-panel island-entry-card" aria-label="Access check">
      <span className={`island-tile island-entry-state${ready ? " is-success" : ""}`} aria-hidden="true"><Icon name={ready ? "check" : "lock"} size={22} /></span>
      <p className="island-entry-status" role="status" aria-live="polite">{checking ? "Evaluating this session's synthetic membership and assignment." : sessionExpired ? "The session-expired scenario blocks entry. Return to the current scenario to continue the demo." : readiness.message}</p>
      {member && <div className="island-box island-entry-account">
        <span className="island-tile" aria-hidden="true"><Icon name="people" size={16} /></span>
        <span className="island-entry-row-copy"><strong>{member.name}</strong><small>{member.email} · {organization.name}</small></span>
      </div>}
      {ready ? <button type="button" className="primary-button" onClick={continueToWorkspace}>Enter preview workspace<Icon name="arrow" size={14} /></button>
        : <div className="island-entry-actions-stack">
          <button type="button" className="primary-button" onClick={onBack}>{readiness.state === "pending" ? "Return to admin to assign access" : "Back to administration"}</button>
          <button type="button" className="secondary-button" onClick={() => { setChecking(true); setError(""); }}>Check again</button>
        </div>}
      {error && <p className="island-note is-danger" role="alert"><Icon name="warning" size={14} /><span>{error}</span></p>}
      <details className="island-entry-details"><summary>Preview access states</summary>
        <label className="island-entry-check"><input type="checkbox" checked={sessionExpired} onChange={(event) => { setSessionExpired(event.target.checked); setError(""); }} /><span>Simulate an expired session</span></label>
      </details>
    </section>
    {member && <aside className="island-entry-side" aria-label="Effective access">
      <EffectiveAccessPreview organization={organization} member={member} />
      <p className="island-note" role="note"><Icon name="shield" size={14} /><span><strong>Access is checked before content opens.</strong> The live application revalidates the authenticated membership and each document audience on the server. This view demonstrates the workflow only.</span></p>
    </aside>}
  </IslandEntryLayout>;
}
