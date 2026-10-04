import { WelcomePanel } from "./WelcomePanel";
import { entryAssets } from "./entryAssets";

export function WorkspaceSelectPage({ organizationName, onContinue, onBack }: {
  organizationName: string;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <main className="sign-in-page workspace-select-page">
      <WelcomePanel mode="workspace" />
      <section className="sign-in-panel" aria-labelledby="workspace-select-title">
        <div className="sign-in-card workspace-select-card">
          <span className="meta-label">01 / YOUR ORGANIZATION</span>
          <h2 id="workspace-select-title">Choose your workspace</h2>
          <p>Your selection establishes organization context. It does not grant access by itself.</p>
          <div className="workspace-memberships">
            <div className="workspace-membership is-selected" aria-label={`${organizationName}, selected sample workspace`}>
              <div className="workspace-membership-heading">
                <img src={entryAssets.selectedWorkspace} alt="" width={26} height={26} />
                <h3>{organizationName}</h3>
                <span className="workspace-membership-status">
                  <img src={entryAssets.statusAmber} alt="" width={7} height={7} />SELECTED
                </span>
              </div>
              <p>Product Engineering · Employee</p>
            </div>
            <button type="button" className="workspace-membership is-unavailable" disabled>
              <span className="workspace-membership-heading">
                <img src={entryAssets.unavailableWorkspace} alt="" width={26} height={26} />
                <strong>Research Sandbox</strong>
                <span className="workspace-membership-status">
                  <img src={entryAssets.statusMuted} alt="" width={7} height={7} />NOT CONNECTED
                </span>
              </span>
              <span>This sample workspace is not connected.</span>
            </button>
          </div>
          <button type="button" className="primary-button workspace-continue" onClick={onContinue}>Continue to workspace</button>
          <p className="workspace-preview-identity">Sample member · Lan Nguyen · Employee</p>
          <p className="preview-disclaimer">Member preview uses sample data. Workspace selection does not sign you in or grant organization access.</p>
          <button type="button" className="text-button workspace-back" onClick={onBack}>Back to sign in</button>
        </div>
      </section>
    </main>
  );
}
