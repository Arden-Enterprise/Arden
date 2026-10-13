import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "../shared/Icon";

export function KnowledgeDialog({ title, children, onClose, dismissible = true }: { title: string; children: ReactNode; onClose: () => void; dismissible?: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => { dialog?.close(); if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);
  return <dialog className="knowledge-dialog" ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (dismissible) onClose(); }}><div className="knowledge-dialog-heading"><h2 id={titleId}>{title}</h2><button type="button" className="knowledge-icon-button" aria-label="Close dialog" autoFocus disabled={!dismissible} onClick={onClose}><Icon name="close" /></button></div>{children}</dialog>;
}
