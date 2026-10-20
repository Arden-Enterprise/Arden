import { Icon } from "./Icon";
import { useEffect, useRef, type ReactNode } from "react";
import { useWorkspaceNavigation } from "./WorkspaceNavigationContext";

export type ContextControlProps = { contextOpen: boolean; onToggleContext: () => void };

export function WorkspaceTopbar({ breadcrumb, previewLabel, contextOpen, onToggleContext, search }: ContextControlProps & {
  breadcrumb: string;
  previewLabel: string;
  search?: ReactNode;
}) {
  const navigation = useWorkspaceNavigation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (navigation?.open) document.querySelector<HTMLButtonElement>("#arden-primary-navigation .sidebar-nav-item:not(:disabled)")?.focus();
    else if (wasOpen.current && menuButton.current?.getClientRects().length) menuButton.current.focus();
    wasOpen.current = navigation?.open ?? false;
  }, [navigation?.open]);
  const crumbs = breadcrumb.split(" / ");
  return (
    <header className="workspace-topbar">
      <div className="topbar-leading">
        {navigation && <button ref={menuButton} type="button" className="topbar-menu-button" aria-label={navigation.open ? "Close navigation" : "Open navigation"}
          aria-controls="arden-primary-navigation" aria-expanded={navigation.open} onClick={() => navigation.setOpen((open) => !open)}>
          <span aria-hidden="true">{navigation.open ? "×" : "☰"}</span>
        </button>}
        <nav aria-label="Breadcrumb"><ol className="topbar-breadcrumb">{crumbs.map((crumb, index) =>
          <li key={`${index}:${crumb}`} aria-current={index === crumbs.length - 1 ? "page" : undefined}>{crumb}</li>)}</ol></nav>
      </div>
      <div className="topbar-actions">
        {search && <div className="topbar-search">{search}</div>}
        <span className="preview-state">{previewLabel}</span>
        <button type="button" className="context-toggle" onClick={onToggleContext} aria-expanded={contextOpen} aria-controls="arden-context-panel">
          <Icon name="knowledge" size={16} /><span>Context</span>
        </button>
      </div>
    </header>
  );
}
