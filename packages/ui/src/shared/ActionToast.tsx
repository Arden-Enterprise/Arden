import { useEffect, useRef } from "react";

export function ActionToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => dismiss.current(), 5000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!message) return null;
  return <div className="arden-action-toast" role="status" aria-live="polite">
    <span aria-hidden="true" className="arden-toast-mark">✓</span>
    <span>{message}</span>
    <button type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button>
  </div>;
}
