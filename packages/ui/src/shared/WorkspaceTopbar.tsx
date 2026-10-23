import { Icon } from "./Icon";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWorkspaceNavigation } from "./WorkspaceNavigationContext";
import { useStatusIsland } from "./StatusIslandContext";
import { ToastContent } from "./ActionToast";

export type ContextControlProps = { contextOpen: boolean; onToggleContext: () => void };

type IslandMode = "idle" | "search" | "toast";

function initials(label: string): string {
  return label.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * Workspace top bar. Its centre is the status island: it shows where the member is,
 * expands into the page's search (Ctrl K) and morphs to announce completed actions.
 */
export function WorkspaceTopbar({ breadcrumb, previewLabel, contextOpen, onToggleContext, search, searchActive = false }: ContextControlProps & {
  breadcrumb: string;
  previewLabel: string;
  /** Page-scoped search field revealed inside the island. */
  search?: ReactNode;
  /** Keeps the island expanded while the search holds a value. */
  searchActive?: boolean;
}) {
  const navigation = useWorkspaceNavigation();
  const island = useStatusIsland();
  const menuButton = useRef<HTMLButtonElement>(null);
  const islandRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    if (navigation?.open) document.querySelector<HTMLButtonElement>("#arden-primary-navigation .sidebar-nav-item:not(:disabled)")?.focus();
    else if (wasOpen.current && menuButton.current?.getClientRects().length) menuButton.current.focus();
    wasOpen.current = navigation?.open ?? false;
  }, [navigation?.open]);

  const hasSearch = Boolean(search);
  useEffect(() => {
    if (!hasSearch) return;
    const openSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return;
      // Hidden pages stay mounted; only the visible top bar responds.
      if (!islandRef.current?.getClientRects().length) return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, [hasSearch]);
  useEffect(() => {
    if (searchOpen) requestAnimationFrame(() => islandRef.current?.querySelector<HTMLInputElement>("input")?.focus());
  }, [searchOpen]);

  const toast = island?.toast ?? null;
  const expanded = hasSearch && (searchOpen || searchActive);
  const mode: IslandMode = toast ? "toast" : expanded ? "search" : "idle";
  const crumbs = breadcrumb.split(" / ");
  const trail = crumbs.length > 1 ? crumbs.slice(1) : crumbs;
  const closeSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => islandRef.current?.querySelector<HTMLButtonElement>(".status-island-trigger")?.focus());
  };

  return (
    <header className="workspace-topbar">
      <div className="topbar-leading">
        {navigation && <button ref={menuButton} type="button" className="topbar-menu-button" aria-label={navigation.open ? "Close navigation" : "Open navigation"}
          aria-controls="arden-primary-navigation" aria-expanded={navigation.open} onClick={() => navigation.setOpen((open) => !open)}>
          <Icon name={navigation.open ? "close" : "menu"} size={18} />
        </button>}
      </div>
      <div ref={islandRef} className={`status-island is-${mode}`} role="region" aria-label="Status island"
        onKeyDown={(event) => { if (event.key === "Escape" && mode === "search" && !searchActive) { event.stopPropagation(); closeSearch(); } }}
        onBlur={(event) => { if (mode === "search" && !searchActive && !event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
        <div className="status-island-live" role="status" aria-live="polite">
          {toast && <div className="status-island-content status-island-toast"><ToastContent message={toast.message} onDismiss={toast.onDismiss} /></div>}
        </div>
        {mode === "search" && <div className="status-island-content status-island-search">
          {search}
          {!searchActive && <button type="button" className="status-island-key" onClick={closeSearch}>Esc</button>}
        </div>}
        {mode === "idle" && <div className="status-island-content">
          <span className="status-island-mark" aria-hidden="true">{initials(crumbs[0] ?? "Arden")}</span>
          <nav aria-label="Breadcrumb"><ol className="topbar-breadcrumb">{trail.map((crumb, index) =>
            <li key={`${index}:${crumb}`} aria-current={index === trail.length - 1 ? "page" : undefined}>{crumb}</li>)}</ol></nav>
          {hasSearch && <button type="button" className="status-island-trigger" aria-label="Search (Ctrl K)" aria-keyshortcuts="Control+k Meta+k" onClick={() => setSearchOpen(true)}>
            <Icon name="search" size={14} /><span aria-hidden="true">Ctrl K</span>
          </button>}
        </div>}
      </div>
      <div className="topbar-actions">
        <span className="preview-state">{previewLabel}</span>
        <button type="button" className="context-toggle" onClick={onToggleContext} aria-expanded={contextOpen} aria-controls="arden-context-panel">
          <Icon name="knowledge" size={16} /><span>Context</span>
        </button>
      </div>
    </header>
  );
}
