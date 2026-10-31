import { useEffect, useRef } from "react";
import { Icon } from "./Icon";
import { useStatusIsland, type StatusIslandToast } from "./StatusIslandContext";

const toastDurationMs = 5000;

type ToastAction = NonNullable<StatusIslandToast["action"]>;

/**
 * Announces a completed action. Inside the workspace shell the status island
 * renders it; without the shell it falls back to a floating island.
 * An optional action (for example Undo) runs once and dismisses the toast.
 */
export function ActionToast({ message, onDismiss, action }: { message: string; onDismiss: () => void; action?: ToastAction }) {
  const island = useStatusIsland();
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const actionRef = useRef(action);
  actionRef.current = action;
  const actionLabel = action?.label;
  const setIslandToast = island?.setToast;

  useEffect(() => {
    if (!message) return;
    const toast: StatusIslandToast = { message, onDismiss: () => dismiss.current(),
      action: actionLabel ? { label: actionLabel, run: () => { actionRef.current?.run(); dismiss.current(); } } : undefined };
    setIslandToast?.(toast);
    const timeout = window.setTimeout(() => dismiss.current(), toastDurationMs);
    return () => {
      window.clearTimeout(timeout);
      setIslandToast?.((current) => current === toast ? null : current);
    };
  }, [message, actionLabel, setIslandToast]);

  if (!message || island) return null;
  return <div className="arden-action-toast" role="status" aria-live="polite">
    <ToastContent message={message} onDismiss={onDismiss}
      action={action ? { label: action.label, run: () => { action.run(); onDismiss(); } } : undefined} />
  </div>;
}

export function ToastContent({ message, onDismiss, action }: { message: string; onDismiss: () => void; action?: ToastAction }) {
  return <>
    <span aria-hidden="true" className="arden-toast-mark"><Icon name="check" size={16} /></span>
    <span className="arden-toast-message">{message}</span>
    {action && <button type="button" className="arden-toast-action" onClick={action.run}>{action.label}</button>}
    <button type="button" className="arden-toast-dismiss" onClick={onDismiss} aria-label="Dismiss notification"><Icon name="close" size={14} /></button>
  </>;
}
