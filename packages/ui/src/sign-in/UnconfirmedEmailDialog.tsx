import { useEffect, useRef } from "react";

/** Modal asking the user to verify their email before signing in (sign-in and invitation pages). */
export function UnconfirmedEmailDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="organization-dialog admin-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unconfirmed-email-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <div className="organization-dialog-heading">
        <h2 id="unconfirmed-email-title">Verify your email</h2>
      </div>
      <p className="organization-dialog-description">
        Check <strong>{email}</strong> for a verification link.
      </p>
      <div className="organization-dialog-actions">
        <button type="button" className="auth-primary" autoFocus onClick={onClose}>
          OK
        </button>
      </div>
    </dialog>
  );
}
