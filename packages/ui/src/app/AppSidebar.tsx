import { Icon, type IconName } from "../shared/Icon";
import type { Platform, WorkspaceView } from "../shared/types";
import type { OrganizationPreview } from "../organization/previewModel";

type AppSidebarProps = {
  activeView: WorkspaceView;
  platform: Platform;
  previewRole: "member" | "admin";
  organization: OrganizationPreview | null;
  onNavigate: (view: WorkspaceView) => void;
  onSignOut: () => void;
};

type NavigationItem = {
  label: string;
  icon: IconName;
  view?: WorkspaceView;
  planned?: boolean;
};

const workspaceNavigation: NavigationItem[] = [
  { label: "My Work", icon: "work", view: "my-work" },
  { label: "Knowledge", icon: "knowledge", planned: true },
  { label: "Ask Arden", icon: "search", planned: true },
  { label: "Review Queue", icon: "document", planned: true },
  { label: "Knowledge Handover", icon: "arrow", planned: true },
];

export function AppSidebar({
  activeView,
  platform,
  previewRole,
  organization,
  onNavigate,
  onSignOut,
}: AppSidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true" />
        <span>ARDEN</span>
        <small>PREVIEW</small>
      </div>

      <section className="access-card" aria-labelledby="access-card-title">
        <span className="meta-label" id="access-card-title">
          YOUR ACCESS
        </span>
        <strong>{organization?.name ?? "Northstar Studio"}</strong>
        <span>{previewRole === "admin" ? "System Admin preview" : "Product Engineering · member preview"}</span>
        <span>Company-wide published</span>
        <span>Private workspace</span>
      </section>

      <nav className="sidebar-navigation" aria-label="Workspace">
        <span className="meta-label navigation-label">WORKSPACE</span>
        {workspaceNavigation.map((item) => {
          const active = item.view === activeView;
          return (
            <button
              key={item.label}
              type="button"
              className={`sidebar-nav-item${active ? " is-active" : ""}`}
              onClick={item.view ? () => onNavigate(item.view!) : undefined}
              disabled={item.planned}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              title={item.planned ? `${item.label} is not connected yet` : undefined}
            >
              <Icon name={item.icon} size={16} />
              <span>{item.label}</span>
              {item.planned && <small>Planned</small>}
            </button>
          );
        })}

        <span className="meta-label navigation-label">PERSONAL</span>
        <button
          type="button"
          className={`sidebar-nav-item${activeView === "personal-workspace" ? " is-active" : ""}`}
          onClick={() => onNavigate("personal-workspace")}
          aria-label="Personal Workspace"
          aria-current={activeView === "personal-workspace" ? "page" : undefined}
        >
          <Icon name="lock" size={16} />
          <span>Personal Workspace</span>
        </button>

        {previewRole === "admin" && (
          <>
            <span className="meta-label navigation-label">ADMINISTRATION</span>
            <button
              type="button"
              className={`sidebar-nav-item${activeView === "organization-access" ? " is-active" : ""}`}
              onClick={() => onNavigate("organization-access")}
              aria-label="Organization & Access"
              aria-current={activeView === "organization-access" ? "page" : undefined}
            >
              <Icon name="knowledge" size={16} />
              <span>Organization &amp; Access</span>
            </button>
          </>
        )}
      </nav>

      <div className="sidebar-session">
        <strong>{previewRole === "admin" ? "ALEX MORGAN" : "LAN NGUYEN"}</strong>
        <span>{previewRole === "admin" ? "SYSTEM ADMIN" : "EMPLOYEE"} · PREVIEW SESSION</span>
        <span>{platform === "desktop" ? "WINDOWS DESKTOP" : "WEB"}</span>
        <button type="button" onClick={onSignOut} aria-label="Exit preview">
          <Icon name="logout" size={15} />
          <span>Exit preview</span>
        </button>
      </div>
    </aside>
  );
}
