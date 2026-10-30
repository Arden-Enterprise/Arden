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
  isUnassigned?: boolean;
  memberName?: string;
  memberRole?: string;
  memberDepartment?: string;
  environmentLabel?: string;
  assignedReviewCount?: number;
  canSwitchWorkspace?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSwitchWorkspace?: () => void;
  onCloseNavigation?: () => void;
  onNavigate: (view: WorkspaceView) => void;
  onSignOut: () => void;
};

export type NavigationItem = {
  label: string;
  shortLabel: string;
  icon: IconName;
  view?: WorkspaceView;
  planned?: boolean;
};

export const workNavigation: NavigationItem[] = [
  { label: "My Work", shortLabel: "My Work", icon: "work", view: "my-work" },
  { label: "Ask Arden", shortLabel: "Ask", icon: "chat", view: "ask-arden" },
  { label: "Private Notes", shortLabel: "Notes", icon: "lock", view: "personal-workspace" },
];

export const knowledgeNavigation: NavigationItem[] = [
  { label: "Library", shortLabel: "Library", icon: "knowledge", view: "knowledge" },
  { label: "Reviews", shortLabel: "Reviews", icon: "review", view: "review-queue" },
  { label: "Integrations", shortLabel: "Integrations", icon: "integrations", planned: true },
];

export const adminNavigation: NavigationItem = { label: "Administration", shortLabel: "Admin", icon: "organization", view: "organization-access" };

/** Server-backed sessions expose Ask Arden through the authenticated Core API and restrict destinations with connected server workflows. */
export function navigationDisabled(item: NavigationItem, authenticated: boolean, isUnassigned?: boolean): boolean {
  if (item.planned) return true;
  if (isUnassigned && (item.view === "personal-workspace" || item.view === "review-queue" || item.view === "knowledge-handover")) {
    return true;
  }
  return authenticated && item.view === "my-work";
}

export function initialsOf(label: string): string {
  return label.split(/[\s.@]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export function AppSidebar({
  activeView,
  platform,
  previewRole,
  organization,
  organizationLabel,
  authenticated = false,
  showAdmin = false,
  isUnassigned = false,
  memberName = "Lan Nguyen",
  memberRole = "Member",
  memberDepartment = "Product Engineering",
  environmentLabel,
  assignedReviewCount,
  canSwitchWorkspace = false,
  collapsed = false,
  onToggleCollapsed,
  onSwitchWorkspace,
  onCloseNavigation,
  onNavigate,
  onSignOut,
}: AppSidebarProps) {
  const organizationName = organizationLabel ?? organization?.name ?? "FPT Digital";
  const sessionLabel = environmentLabel ?? (authenticated ? "Signed in" : "Preview");
  const navButton = (item: NavigationItem) => {
    const active = item.view === activeView;
    const reviewCount = item.view === "review-queue" ? assignedReviewCount : undefined;
    const disabled = navigationDisabled(item, authenticated, isUnassigned);
    const unassignedNotice = isUnassigned && (item.view === "personal-workspace" || item.view === "review-queue")
      ? "Available once assigned to a department" : undefined;
    return (
      <button
        key={item.label}
        type="button"
        className={`sidebar-nav-item${active ? " is-active" : ""}`}
        onClick={() => { if (item.view) onNavigate(item.view); }}
        disabled={disabled}
        aria-label={reviewCount !== undefined ? `${item.label}, ${reviewCount} assigned` : item.planned ? `${item.label} — not available yet` : item.label}
        aria-current={active ? "page" : undefined}
        title={unassignedNotice ?? (item.planned ? `${item.label} is not available yet` : item.label)}
      >
        <Icon name={item.icon} size={18} />
        <span className="sidebar-nav-label"><span className="nav-label-full">{item.label}</span><span className="nav-label-short" aria-hidden="true">{item.shortLabel}</span></span>
        {reviewCount !== undefined && reviewCount > 0 && <small className="sidebar-review-count">{reviewCount}</small>}
        {item.planned && <small className="sidebar-planned">Coming later</small>}
      </button>
    );
  };

  return (
    <aside id="arden-primary-navigation" className={`app-sidebar${collapsed ? " is-collapsed" : ""}`} aria-label="Main navigation">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark" aria-hidden="true"><Icon name="knowledge" size={20} /></span>
        <span>ARDEN</span>
        <small>{sessionLabel.toUpperCase()}</small>
        <button type="button" className="sidebar-mobile-close" aria-label="Close navigation" onClick={onCloseNavigation}><Icon name="close" size={18} /></button>
      </div>

      <button type="button" className="access-card" disabled={!canSwitchWorkspace} onClick={onSwitchWorkspace}
        aria-label={`Workspace: ${organizationName}${canSwitchWorkspace ? ". Switch workspace" : ""}`} title={organizationName}>
        <span className="access-card-mark" aria-hidden="true">{initialsOf(organizationName)}</span>
        <span className="access-card-copy"><strong id="access-card-title">{organizationName}</strong>
          <span>{authenticated || previewRole === "admin" ? "Organization workspace" : `${memberDepartment} · Member`} · {sessionLabel}</span></span>
        {canSwitchWorkspace && <span className="access-card-switch" aria-hidden="true"><Icon name="expand" size={14} /></span>}
      </button>

      <nav className="sidebar-navigation" aria-label="Workspace">
        <span className="meta-label navigation-label">WORK</span>
        {workNavigation.map(navButton)}
        <span className="meta-label navigation-label">KNOWLEDGE</span>
        {knowledgeNavigation.map(navButton)}
        {((previewRole === "admin" && !authenticated) || showAdmin) && <>
          <span className="meta-label navigation-label">MANAGE ORGANIZATION</span>
          {navButton(adminNavigation)}
        </>}
      </nav>

      <div className="sidebar-session">
        {onToggleCollapsed && <button type="button" className="sidebar-nav-item sidebar-collapse" onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} aria-controls="arden-primary-navigation" title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          <Icon name="sidebar" size={18} /><span className="sidebar-nav-label">Collapse</span>
        </button>}
        <div className="sidebar-member" title={`${memberName} · ${memberRole}`}>
          <span className="sidebar-avatar" aria-hidden="true">{initialsOf(memberName)}</span>
          <div><strong>{memberName}</strong><span>{memberRole}</span></div>
        </div>
        <span className="sidebar-platform">{platform === "desktop" ? "WINDOWS" : "WEB"} · {authenticated ? "SIGNED IN" : "SAMPLE SESSION"}</span>
        <button type="button" className="sidebar-sign-out" onClick={onSignOut} aria-label={authenticated ? "Sign out" : "Exit preview"} title={authenticated ? "Sign out" : "Exit preview"}>
          <Icon name="logout" size={16} />
        </button>
      </div>
    </aside>
  );
}
