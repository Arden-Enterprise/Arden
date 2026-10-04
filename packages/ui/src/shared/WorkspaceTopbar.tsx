import { Icon } from "./Icon";
import type { ReactNode } from "react";

export type ContextControlProps = { contextOpen: boolean; onToggleContext: () => void };

export function WorkspaceTopbar({ breadcrumb, previewLabel, contextOpen, onToggleContext, search }: ContextControlProps & {
  breadcrumb: string;
  previewLabel: string;
  search?: ReactNode;
}) {
  return (
    <header className="workspace-topbar">
      <span>{breadcrumb}</span>
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
