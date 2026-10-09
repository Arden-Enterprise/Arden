import { useEffect, useRef, useId, type ReactNode } from "react";
import { Icon } from "../shared/Icon";

export function OrganizationDialog({ title, description, children, onClose, wide = false }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog ref={dialogRef} className={`organization-dialog${wide ? " organization-dialog-wide" : ""}`}
      aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <div className="organization-dialog-heading">
        <div><span className="meta-label">ORGANIZATION / SESSION PREVIEW</span><h2 id={titleId}>{title}</h2></div>
        <button type="button" className="organization-icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" size={18} /></button>
      </div>
      {description && <p id={descriptionId} className="organization-dialog-description">{description}</p>}
      {children}
    </dialog>
  );
}
