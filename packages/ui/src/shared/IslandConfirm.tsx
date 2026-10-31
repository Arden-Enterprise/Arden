import { useEffect, useId, useRef } from "react";
import { useStatusIsland, type StatusIslandConfirm } from "./StatusIslandContext";

type Props = StatusIslandConfirm;

/**
 * Asks to confirm a destructive action. Inside the workspace shell the status island
 * morphs into the confirmation; without the shell it falls back to a modal dialog.
 * Focus returns to the control that opened it when it closes.
 */
export function IslandConfirm(props: Props) {
  const island = useStatusIsland();
  const setConfirm = island?.setConfirm;
  const { title, description, actionLabel, busy, error } = props;
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const opener = document.activeElement;
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);

  useEffect(() => {
    if (!setConfirm) return;
    const value: StatusIslandConfirm = { title, description, actionLabel, busy, error,
      onCancel: () => handlers.current.onCancel(), onConfirm: () => handlers.current.onConfirm() };
    setConfirm(value);
    return () => setConfirm((current) => current === value ? null : current);
  }, [setConfirm, title, description, actionLabel, busy, error]);

  return island ? null : <ConfirmDialog {...props} />;
}

function ConfirmDialog({ title, description, actionLabel, busy, error, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  return <dialog ref={dialog} className="organization-dialog admin-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
    <h2 id={titleId}>{title}</h2><p>{description}</p>{error && <p className="admin-feedback is-error" role="alert">{error}</p>}
    <div className="organization-dialog-actions"><button type="button" className="secondary-button" autoFocus disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="admin-danger-button" disabled={busy} onClick={onConfirm}>{busy ? "Working…" : actionLabel}</button></div>
  </dialog>;
}
