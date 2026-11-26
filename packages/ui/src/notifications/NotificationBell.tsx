import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useNotifications } from "./NotificationProvider";

function formatNotificationTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function NotificationBell() {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const headingId = useId();

  useEffect(() => { setOpen(false); }, [notifications?.organizationId]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => closeRef.current?.focus());
    return () => cancelAnimationFrame(focusFrame);
  }, [open]);

  if (!notifications?.enabled) return null;

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const openNotification = (item: (typeof notifications.items)[number]) => {
    void notifications.markRead(item.id);
    if (!item.target) return;
    notifications.openTarget(item.target);
    close();
  };

  return <>
    <button ref={buttonRef} type="button" className="notification-bell" aria-label={`Notifications${notifications.unreadCount ? `, ${notifications.unreadCount} unread` : ""}`}
      aria-haspopup="dialog" aria-expanded={open} aria-controls="arden-notification-dialog" title="Notifications"
      onClick={() => {
        const next = !open;
        setOpen(next);
        if (next) void notifications.refresh();
      }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {notifications.unreadCount > 0 && <span className="notification-badge" aria-hidden="true">
        {notifications.unreadCount > 99 ? "99+" : notifications.unreadCount}
      </span>}
    </button>
    {open && <div className="notification-layer">
      <button className="notification-scrim" type="button" aria-label="Close notifications" onClick={close} />
      <section ref={dialogRef} id="arden-notification-dialog" className="notification-dialog" role="dialog" aria-modal="true"
        aria-labelledby={headingId} onKeyDown={onDialogKeyDown}>
        <header className="notification-dialog-header">
          <div>
            <h2 id={headingId}>Notifications</h2>
            <p>{notifications.unreadCount ? `${notifications.unreadCount} unread` : "You're all caught up"}</p>
          </div>
          <button ref={closeRef} type="button" className="notification-close" aria-label="Close notifications" onClick={close}>×</button>
        </header>
        <div className="notification-controls">
          <div className="notification-filter" role="group" aria-label="Filter notifications">
            <button type="button" aria-pressed={notifications.filter === "all"} onClick={() => {
              notifications.setFilter("all");
            }}>All</button>
            <button type="button" aria-pressed={notifications.filter === "unread"} onClick={() => {
              notifications.setFilter("unread");
            }}>Unread</button>
          </div>
          <button type="button" className="notification-mark-all" disabled={notifications.unreadCount === 0}
            onClick={() => void notifications.markAllRead()}>Mark all read</button>
        </div>
        {notifications.realtimeAvailable === false && <p className="notification-offline" role="status">
          Live updates are unavailable. Your inbox will refresh when you open Arden or reconnect.
        </p>}
        {notifications.error && <div className="notification-error" role="alert">
          <span>{notifications.error}</span><button type="button" onClick={() => void notifications.refresh()}>Retry</button>
        </div>}
        <div className="notification-list" aria-live="polite" aria-busy={notifications.loading}>
          {notifications.items.map(item => <button key={item.id} type="button"
            className={`notification-item${item.readAt ? "" : " is-unread"}`}
            aria-label={`${item.message}${item.readAt ? "" : ", unread"}`}
            onClick={() => openNotification(item)}>
            <span className="notification-unread-dot" aria-hidden="true" />
            <span className="notification-item-copy">
              <span>{item.message}</span>
              <time dateTime={item.createdAt}>{formatNotificationTime(item.createdAt)}</time>
            </span>
            {item.target && <span className="notification-open-mark" aria-hidden="true">›</span>}
          </button>)}
          {!notifications.loading && notifications.items.length === 0 && !notifications.error && <p className="notification-empty">
            {notifications.filter === "unread" ? "No unread notifications." : "You don't have any notifications yet."}
          </p>}
          {notifications.loading && notifications.items.length === 0 && <p className="notification-empty" role="status">Loading notifications…</p>}
        </div>
        {notifications.nextCursor && <button type="button" className="notification-load-more" disabled={notifications.loading}
          onClick={() => void notifications.loadMore()}>{notifications.loading ? "Loading…" : "Load more"}</button>}
      </section>
    </div>}
  </>;
}
