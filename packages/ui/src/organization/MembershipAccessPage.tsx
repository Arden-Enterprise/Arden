import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
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
  return <main id="arden-main" className="organization-flow-page" aria-labelledby="membership-access-title" tabIndex={-1}>
    <header className="organization-flow-topbar"><div className="organization-flow-brand"><Icon name="knowledge" size={24} /><strong>ARDEN</strong></div><span className="organization-preview-badge">MEMBER ACCESS PREVIEW</span><button type="button" className="secondary-button" onClick={onBack}>Back to administration</button></header>
    <div className="organization-access-state-layout"><section className="organization-flow-card organization-access-state-card"><span className="meta-label organization-jade">03 / VALIDATE CURRENT ACCESS</span><div className={`organization-state-icon${readiness.state === "ready" && !sessionExpired ? " is-success" : ""}`}><Icon name={readiness.state === "ready" && !sessionExpired ? "check" : "lock"} size={30} /></div><h1 id="membership-access-title">{title}</h1><p className="organization-access-state-description" role="status" aria-live="polite">{checking ? "Evaluating this session's synthetic membership and assignment." : sessionExpired ? "The session-expired scenario blocks entry. Return to the current scenario to continue the demo." : readiness.message}</p>{member && <div className="organization-member-state-identity"><strong>{member.name}</strong><span>{member.email}</span><span>{organization.name}</span></div>}
      {!checking && !sessionExpired && readiness.state === "ready" ? <button type="button" className="primary-button organization-full-button" onClick={continueToWorkspace}>Enter preview workspace<Icon name="arrow" size={17} /></button> : <div className="organization-state-actions"><button type="button" className="primary-button" onClick={onBack}>{readiness.state === "pending" ? "Return to admin to assign access" : "Back to administration"}</button><button type="button" className="secondary-button" onClick={() => { setChecking(true); setError(""); }}>Check again</button></div>}
      {error && <p className="organization-form-error" role="alert">{error}</p>}
      <details className="organization-scenario-controls"><summary>Preview access states</summary><label className="organization-confirm-check"><input type="checkbox" checked={sessionExpired} onChange={(event) => { setSessionExpired(event.target.checked); setError(""); }} /><span>Simulate an expired session</span></label><p className="organization-helper">Pending and suspended states come from the actual preview membership. Assign or suspend the member in Administration to change them.</p></details>
      <p className="organization-preview-caption">Session preview · No server authentication or authorization</p>
    </section>{member && <div className="organization-access-state-boundaries"><EffectiveAccessPreview organization={organization} member={member} /><div className="organization-notice is-info"><strong>Access is checked before content opens</strong><span>The live application must revalidate the authenticated membership and each document audience on the server. This view demonstrates the workflow only.</span></div></div>}</div>
  </main>;
}
