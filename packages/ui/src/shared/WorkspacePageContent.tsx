import type { ReactNode } from "react";

export function WorkspacePageHeader({ eyebrow, title, description, action, titleId, className = "" }: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  // The action sits beside the whole title block (eyebrow, title, description) so it stays vertically centred on it.
  return <header className={`workspace-page-header${className ? ` ${className}` : ""}`}>
    <div className="workspace-page-header-row">
      <div className="workspace-page-header-text">
        <span className="meta-label">{eyebrow}</span>
        <h1 id={titleId}>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  </header>;
}

export function WorkspacePageContent({ header, children, className = "", scrollClassName = "" }: {
  header: ReactNode;
  children: ReactNode;
  className?: string;
  scrollClassName?: string;
}) {
  return <div className={`workspace-content${className ? ` ${className}` : ""}`}>
    {header}
    <div className={`workspace-scroll-region${scrollClassName ? ` ${scrollClassName}` : ""}`}>
      <div className="workspace-scroll-content">{children}</div>
    </div>
  </div>;
}
