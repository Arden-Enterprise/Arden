import { useEffect, useRef } from "react";

export function DiscardChangesDialog({ exiting, onCancel, onDiscard, switchingMember = false }: {
  exiting: boolean;
  switchingMember?: boolean;
  onCancel: () => void;
  onDiscard: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="discard-dialog"
      aria-labelledby="discard-title"
      aria-describedby="discard-description"
      onCancel={(event) => { event.preventDefault(); onCancel(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <span className="meta-label">UNSAVED CHANGES</span>
      <h2 id="discard-title">{switchingMember ? "Switch preview member?" : exiting ? "Exit this preview?" : "Leave without applying changes?"}</h2>
      <p id="discard-description">{switchingMember
        ? "Switching members clears this member’s private notes and unsaved drafts. Keep working, or discard them and open the other member’s workspace."
        : exiting
        ? "Your notes and organization changes are kept only in this session. Exiting clears them."
        : "Your organization changes have not been applied. Stay to review them, or discard them and continue."}</p>
      <div className="dialog-actions">
        <button type="button" className="secondary-button" autoFocus onClick={onCancel}>Keep working</button>
        <button type="button" className="primary-button" onClick={onDiscard}>{switchingMember ? "Discard and switch" : exiting ? "Discard and exit" : "Discard changes"}</button>
      </div>
    </dialog>
  );
}
