import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon, type IconName } from "../shared/Icon";

/**
 * A modal dialog. The compact form is the island used for short tasks such as a required reason: a 480px
 * island with an icon, a 17px title and a one-line subtitle; focus starts on the element marked
 * `data-autofocus`, else the form's first field, instead of the close button.
 */
export function KnowledgeDialog({ title, children, onClose, dismissible = true, confirmation = false, compact = false,
  subtitle, icon, tone = "default" }: {
  title: string; children: ReactNode; onClose: () => void; dismissible?: boolean; confirmation?: boolean;
  compact?: boolean; subtitle?: ReactNode; icon?: IconName; tone?: "default" | "danger";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    if (compact) (dialog?.querySelector<HTMLElement>("[data-autofocus]")
      ?? dialog?.querySelector<HTMLElement>("form :is(input, select, textarea):not(:disabled)"))?.focus();
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, [compact]);
  const className = ["knowledge-dialog", confirmation && "knowledge-confirm-dialog", compact && "is-compact",
    tone === "danger" && "is-danger"].filter(Boolean).join(" ");
  return <dialog className={className} ref={dialogRef} role={confirmation ? "alertdialog" : "dialog"} aria-modal="true"
    aria-labelledby={titleId} aria-describedby={subtitle ? subtitleId : undefined}
    onCancel={(event) => { event.preventDefault(); if (dismissible) onClose(); }}>
    <div className="knowledge-dialog-heading">
      {icon && <span className="knowledge-dialog-icon"><Icon name={icon} size={16} /></span>}
      <div className="knowledge-dialog-titles">
        <h2 id={titleId}>{title}</h2>
        {subtitle && <p id={subtitleId} className="knowledge-dialog-subtitle">{subtitle}</p>}
      </div>
      {!confirmation && <button type="button" className="knowledge-icon-button" aria-label="Close dialog"
        autoFocus={!compact} disabled={!dismissible} onClick={onClose}><Icon name="close" size={compact ? 16 : 18} /></button>}
    </div>
    {children}
  </dialog>;
}
