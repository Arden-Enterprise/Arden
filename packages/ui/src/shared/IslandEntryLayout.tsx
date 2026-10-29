import type { ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Island-system frame for post-sign-in onboarding pages: choosing a workspace, creating an organization and
 * joining through an invitation. It reuses the workspace shell's tokens and controls (the `arden-app-shell`
 * scope) without the navigation or status island. Sign-in and password screens keep the Living Archive look.
 */
export function IslandEntryLayout({ titleId, eyebrow, title, description, badge, actions, wide = false, children }: {
  titleId: string;
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  /** A visible label such as "SAMPLE DATA" or "INVITATION PREVIEW"; never hidden in a tooltip. */
  badge?: string;
  /** Top-bar actions, for example Sign out or Back to administration. */
  actions?: ReactNode;
  /** Two-column content (main card plus a side island) instead of a single column. */
  wide?: boolean;
  children: ReactNode;
}) {
  return <div className="arden-app-shell is-entry-page">
    <main id="arden-main" className="island-entry" aria-labelledby={titleId} tabIndex={-1}>
      <header className="island-entry-topbar">
        <span className="island-entry-brand"><span className="island-entry-mark" aria-hidden="true"><Icon name="knowledge" size={16} /></span>Arden</span>
        {badge && <span className="island-chip island-entry-badge">{badge}</span>}
        {actions && <div className="island-entry-actions">{actions}</div>}
      </header>
      <div className={`island-entry-body${wide ? " is-wide" : ""}`}>
        <div className="island-entry-heading">
          <span className="meta-label">{eyebrow}</span>
          <h1 id={titleId}>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {children}
      </div>
    </main>
  </div>;
}
