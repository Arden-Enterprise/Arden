import { Icon } from "../shared/Icon";
import type { WorkspaceView } from "../shared/types";
import { adminNavigation, knowledgeNavigation, navigationDisabled, workNavigation, type NavigationItem } from "./AppSidebar";

/** Phone-width primary destinations. The menu drawer keeps every other destination. */
export function MobileTabIsland({ activeView, authenticated, showAdmin, assignedReviewCount, onNavigate }: {
  activeView: WorkspaceView;
  authenticated: boolean;
  showAdmin: boolean;
  assignedReviewCount?: number;
  onNavigate: (view: WorkspaceView) => void;
}) {
  const items: NavigationItem[] = [...workNavigation, ...knowledgeNavigation.filter((item) => item.view === "knowledge" || item.view === "review-queue"),
    ...(showAdmin ? [adminNavigation] : [])];
  return <nav className="mobile-tab-island" aria-label="Primary">
    {items.map((item) => {
      const active = item.view === activeView;
      const count = item.view === "review-queue" ? assignedReviewCount : undefined;
      return <button key={item.label} type="button" className={active ? "is-active" : ""} aria-current={active ? "page" : undefined}
        disabled={navigationDisabled(item, authenticated)} onClick={() => { if (item.view) onNavigate(item.view); }}
        aria-label={count ? `${item.label}, ${count} assigned` : item.label}>
        <Icon name={item.icon} size={20} /><span aria-hidden="true">{item.shortLabel}</span>
        {count ? <small aria-hidden="true">{count}</small> : null}
      </button>;
    })}
  </nav>;
}
