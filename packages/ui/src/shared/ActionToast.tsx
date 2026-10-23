import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { useStatusIsland } from "./StatusIslandContext";

const toastDurationMs = 5000;

/**
 * Announces a completed action. Inside the workspace shell the status island
 * renders it; without the shell it falls back to a floating island.
 */
export function ActionToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const island = useStatusIsland();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const setIslandToast = island?.setToast;

  useEffect(() => {
    if (!message) return;
    const toast = { message, onDismiss: () => dismiss.current() };
    setIslandToast?.(toast);
    const timeout = window.setTimeout(() => dismiss.current(), toastDurationMs);
    return () => {
      window.clearTimeout(timeout);
      setIslandToast?.((current) => current === toast ? null : current);
    };
  }, [message, setIslandToast]);

  if (!message || island) return null;
  return <div className="arden-action-toast" role="status" aria-live="polite">
    <ToastContent message={message} onDismiss={onDismiss} />
  </div>;
}

export function ToastContent({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return <>
    <span aria-hidden="true" className="arden-toast-mark"><Icon name="check" size={16} /></span>
    <span className="arden-toast-message">{message}</span>
    <button type="button" className="arden-toast-dismiss" onClick={onDismiss} aria-label="Dismiss notification"><Icon name="close" size={14} /></button>
  </>;
}
