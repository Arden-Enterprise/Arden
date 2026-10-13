import type { ReactNode } from "react";

export function WorkspacePageHeader({ eyebrow, title, description, action, titleId, className = "" }: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  titleId?: string;
  className?: string;
}) {
  return <header className={`workspace-page-header${className ? ` ${className}` : ""}`}>
    <span className="meta-label">{eyebrow}</span>
    <div className="workspace-page-header-row"><h1 id={titleId}>{title}</h1>{action}</div>
    {description && <p>{description}</p>}
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
