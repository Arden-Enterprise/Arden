import { Icon } from "../shared/Icon";
import { WorkspaceTopbar, type ContextControlProps } from "../shared/WorkspaceTopbar";
import { WorkspacePageContent, WorkspacePageHeader } from "../shared/WorkspacePageContent";

type WaitingRoomPageProps = ContextControlProps & {
  organizationName: string;
  memberEmail: string;
  canSwitchWorkspace: boolean;
  onSwitchWorkspace: () => void;
  onRefresh: () => void;
  onOpenLibrary?: () => void;
  onSignOut?: () => void;
};

export function WaitingRoomPage({
  organizationName,
  memberEmail,
  canSwitchWorkspace,
  onSwitchWorkspace,
  onRefresh,
  onOpenLibrary,
  onSignOut,
  contextOpen,
  onToggleContext,
}: WaitingRoomPageProps) {
  return (
    <main id="arden-main" className="workspace-page waiting-room-page" aria-labelledby="waiting-room-title" tabIndex={-1}>
      <WorkspaceTopbar
        breadcrumb={`${organizationName} / Waiting Room`}
        previewLabel="AWAITING ASSIGNMENT"
        contextOpen={contextOpen}
        onToggleContext={onToggleContext}
      />
      <WorkspacePageContent
        className="waiting-room-content"
        header={
          <WorkspacePageHeader
            className="waiting-room-heading"
            eyebrow="ORGANIZATION ACCESS"
            title={`Welcome to ${organizationName}`}
            titleId="waiting-room-title"
          />
        }
      >
        <div className="waiting-room-grid" style={{ display: "grid", gap: "24px", maxWidth: "760px", margin: "24px 0" }}>
          <section className="island waiting-room-card" aria-labelledby="waiting-status-title" style={{ padding: "28px" }}>
            <div className="waiting-card-header" style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
              <span className="island-avatar is-large" aria-hidden="true" style={{ width: "48px", height: "48px", fontSize: "18px" }}>
                <Icon name="work" size={22} />
              </span>
              <div>
                <h2 id="waiting-status-title" style={{ margin: 0, fontSize: "18px" }}>Awaiting department assignment</h2>
                <p style={{ margin: "4px 0 0", color: "var(--arden-text-secondary)", fontSize: "13px" }}>
                  <span className="island-chip has-dot tone-info">Not assigned</span>
                </p>
              </div>
            </div>

            <div className="waiting-room-details island-box" style={{ marginBottom: "20px", padding: "16px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px", fontSize: "13px" }}>
                <span style={{ color: "var(--arden-text-secondary)" }}>Organization</span>
                <strong>{organizationName}</strong>
                <span style={{ color: "var(--arden-text-secondary)" }}>Account</span>
                <span>{memberEmail}</span>
                <span style={{ color: "var(--arden-text-secondary)" }}>Department</span>
                <span style={{ color: "var(--arden-text-secondary)", fontStyle: "italic" }}>Not yet assigned</span>
              </div>
            </div>

            <p style={{ fontSize: "14px", lineHeight: "1.6", margin: "0 0 14px", color: "var(--arden-text-secondary)" }}>
              Ask an admin to assign your department.
            </p>

            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="primary-button" onClick={onRefresh}>
                Check status
              </button>
              {onOpenLibrary && (
                <button type="button" className="secondary-button" onClick={onOpenLibrary}>
                  View organization library
                </button>
              )}
              {canSwitchWorkspace && (
                <button type="button" className="secondary-button" onClick={onSwitchWorkspace}>
                  Switch workspace
                </button>
              )}
              {onSignOut && (
                <button type="button" className="secondary-button" onClick={onSignOut}>
                  Sign out
                </button>
              )}
            </div>
          </section>
        </div>
      </WorkspacePageContent>
    </main>
  );
}
