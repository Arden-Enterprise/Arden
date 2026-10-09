import { Icon, type IconName } from "../shared/Icon";
import type { Platform, WorkspaceView } from "../shared/types";
import type { OrganizationPreview } from "../organization/previewModel";

type AppSidebarProps = {
  activeView: WorkspaceView;
  platform: Platform;
  previewRole: "member" | "admin";
  organization: OrganizationPreview | null;
  organizationLabel?: string;
  authenticated?: boolean;
  showAdmin?: boolean;
  memberName?: string;
  memberRole?: string;
  memberDepartment?: string;
  environmentLabel?: string;
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
  { label: "Knowledge", icon: "knowledge", view: "knowledge" },
  { label: "Ask Arden", icon: "knowledge", view: "ask-arden" },
  { label: "Review Queue", icon: "check", view: "review-queue" },
  { label: "Knowledge Handover", icon: "arrow", view: "knowledge-handover" },
];

export function AppSidebar({
  activeView,
  platform,
  previewRole,
  organization,
  organizationLabel,
  authenticated = false,
  showAdmin = false,
  memberName = "Lan Nguyen",
  memberRole = "Employee",
  memberDepartment = "Product Engineering",
  environmentLabel,
  onNavigate,
  onSignOut,
}: AppSidebarProps) {
  return (
    <aside className="app-sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true"><Icon name="knowledge" size={24} /></span>
        <span>ARDEN</span>
        <small>{environmentLabel ?? (!authenticated ? "PREVIEW" : null)}</small>
      </div>

      <section className="access-card" aria-labelledby="access-card-title">
        <span className="meta-label" id="access-card-title">
          {organizationLabel ?? organization?.name ?? "FPT DIGITAL"}
        </span>
        <strong>{previewRole === "admin" ? "Organization" : memberDepartment}</strong>
        <span>{previewRole === "admin" ? "Configuration access" : "Member workspace"}</span>
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
              onClick={() => { if (item.view) onNavigate(item.view); }}
              disabled={item.planned || authenticated}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              title={item.planned ? `${item.label} is not connected yet` : item.label}
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
          title="Personal Workspace"
          aria-current={activeView === "personal-workspace" ? "page" : undefined}
        >
          <Icon name="lock" size={16} />
          <span><span className="nav-label-full">Personal Workspace</span><span className="nav-label-short" aria-hidden="true">Notes</span></span>
        </button>
        <button type="button" className="sidebar-nav-item" disabled title="Integrations are not connected" aria-label="Integrations — not connected">
          <Icon name="plus" size={16} /><span>Integrations</span><small>Planned</small>
        </button>

        {((previewRole === "admin" && !authenticated) || showAdmin) && (
          <>
            <span className="meta-label navigation-label">MANAGE</span>
            <button
              type="button"
              className={`sidebar-nav-item${activeView === "organization-access" ? " is-active" : ""}`}
              onClick={() => onNavigate("organization-access")}
              aria-label="Organization & Access"
              title="Organization & Access"
              aria-current={activeView === "organization-access" ? "page" : undefined}
            >
              <Icon name="work" size={16} />
              <span><span className="nav-label-full">Administration</span><span className="nav-label-short" aria-hidden="true">Admin</span></span>
            </button>
          </>
        )}
      </nav>

      <div className="sidebar-session">
        <div className="sidebar-member">
          <span className="sidebar-avatar" aria-hidden="true">{memberName.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}</span>
          <div><strong>{memberName}</strong><span>{memberRole}</span></div>
        </div>
        <span>{platform === "desktop" ? "WINDOWS" : "WEB"} · {authenticated ? "SIGNED IN" : "SAMPLE SESSION"}</span>
        <button type="button" onClick={onSignOut} aria-label="Exit preview">
          <Icon name="logout" size={15} />
          <span><span className="nav-label-full">{authenticated ? "Sign out" : "Exit preview"}</span><span className="nav-label-short" aria-hidden="true">Exit</span></span>
        </button>
      </div>
    </aside>
  );
}
