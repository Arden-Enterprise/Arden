import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RealtimeChannel, RealtimeClient } from "@supabase/realtime-js";
import { ApiError, getNotificationRealtimeCredential, listNotifications, markAllNotificationsRead, markNotificationRead,
  type NotificationItem, type NotificationPage } from "../shared/api-client";
import type { Platform } from "../shared/types";

type NotificationFilter = "all" | "unread";
type NotificationContextValue = {
  enabled: boolean;
  organizationId: string | null;
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
  loading: boolean;
  error: string;
  realtimeAvailable: boolean | null;
  filter: NotificationFilter;
  setFilter: (filter: NotificationFilter) => void;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  openTarget: (target: NonNullable<NotificationItem["target"]>) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);
const notificationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function NotificationProvider(props: {
  platform: Platform;
  organizationId: string | null;
  onOpenTarget: (target: NonNullable<NotificationItem["target"]>) => void;
  children: ReactNode;
}) {
  return <ScopedNotificationProvider key={`${props.platform}:${props.organizationId ?? "signed-out"}`} {...props} />;
}

function ScopedNotificationProvider({ platform, organizationId, onOpenTarget, children }: {
  platform: Platform;
  organizationId: string | null;
  onOpenTarget: (target: NonNullable<NotificationItem["target"]>) => void;
  children: ReactNode;
}) {
  const [inbox, setInbox] = useState<NotificationPage>({ items: [], unreadCount: 0, nextCursor: null });
  const { items, unreadCount, nextCursor } = inbox;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [realtimeAvailable, setRealtimeAvailable] = useState<boolean | null>(null);
  const [filter, setFilterState] = useState<NotificationFilter>("all");
  const orgRef = useRef(organizationId);
  const requestRef = useRef(0);
  orgRef.current = organizationId;

  const refreshPage = useCallback(async (append: boolean, selectedFilter = filter) => {
    if (!organizationId) return;
    const requestId = ++requestRef.current;
    const cursor = append ? nextCursor : null;
    setLoading(true);
    setError("");
    try {
      const page: NotificationPage = await listNotifications(platform, organizationId, {
        cursor, unreadOnly: selectedFilter === "unread", limit: 30,
      });
      if (requestId !== requestRef.current || orgRef.current !== organizationId) return;
      setInbox(current => {
        const next = append ? [...current.items, ...page.items] : page.items;
        const byId = new Map(next.map(item => [item.id, item]));
        return { items: [...byId.values()], unreadCount: page.unreadCount, nextCursor: page.nextCursor };
      });
    } catch (cause) {
      if (requestId === requestRef.current && orgRef.current === organizationId) {
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 404)) {
          requestRef.current++;
          setInbox({ items: [], unreadCount: 0, nextCursor: null }); setLoading(false);
          setRealtimeAvailable(false);
          setError("Notifications are no longer available.");
        } else {
          setError("Notifications could not be loaded. Try again.");
        }
      }
    } finally {
      if (requestId === requestRef.current && orgRef.current === organizationId) setLoading(false);
    }
  }, [filter, nextCursor, organizationId, platform]);

  const refresh = useCallback(async () => refreshPage(false), [refreshPage]);
  const setFilter = useCallback((next: NotificationFilter) => {
    setFilterState(next);
    void refreshPage(false, next);
  }, [refreshPage]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const loadMore = useCallback(async () => {
    if (nextCursor && !loading) await refreshPage(true);
  }, [loading, nextCursor, refreshPage]);

  const markRead = useCallback(async (id: string) => {
    if (!organizationId || !notificationIdPattern.test(id)) return;
    try {
      await markNotificationRead(platform, organizationId, id);
      const readAt = new Date().toISOString();
      setInbox(current => {
        const item = current.items.find(entry => entry.id === id);
        if (!item || item.readAt !== null) return current;
        return {
          ...current,
          items: current.items.map(entry => entry.id === id ? { ...entry, readAt: entry.readAt ?? readAt } : entry),
          unreadCount: Math.max(0, current.unreadCount - 1),
        };
      });
      if (filter === "unread") await refresh();
    } catch {
      setError("The notification could not be marked as read.");
    }
  }, [filter, organizationId, platform, refresh]);

  const markAllRead = useCallback(async () => {
    if (!organizationId) return;
    try {
      await markAllNotificationsRead(platform, organizationId);
      const readAt = new Date().toISOString();
      setInbox(current => ({
        ...current,
        items: current.items.map(item => ({ ...item, readAt: item.readAt ?? readAt })),
        unreadCount: 0,
      }));
      if (filter === "unread") await refresh();
    } catch {
      setError("Notifications could not be marked as read.");
    }
  }, [filter, organizationId, platform, refresh]);

  useEffect(() => {
    requestRef.current++;
    setInbox({ items: [], unreadCount: 0, nextCursor: null }); setError("");
    setFilterState("all");
    setRealtimeAvailable(organizationId ? null : false);
    if (organizationId) void refreshPage(false, "all");
    return () => { requestRef.current++; };
  }, [organizationId, platform]); // refreshPage intentionally follows the current filter through the refresh control.

  useEffect(() => {
    if (!organizationId) return;
    let stopped = false;
    let client: RealtimeClient | null = null;
    let channel: RealtimeChannel | null = null;
    let initialCredential: Awaited<ReturnType<typeof getNotificationRealtimeCredential>> | null = null;
    let credentialPromise: Promise<string> | null = null;
    const clearExpiredSession = () => {
      if (stopped) return;
      requestRef.current++;
      setInbox({ items: [], unreadCount: 0, nextCursor: null }); setLoading(false);
      setError("Notifications are no longer available.");
      setRealtimeAvailable(false);
      const expiredClient = client;
      const expiredChannel = channel;
      client = null; channel = null; initialCredential = null;
      if (expiredClient && expiredChannel) void expiredClient.removeChannel(expiredChannel);
      expiredClient?.disconnect();
    };
    const readToken = async () => {
      if (credentialPromise) return credentialPromise;
      credentialPromise = (async () => {
        if (!initialCredential || Date.parse(initialCredential.expiresAt) <= Date.now() + 45_000) {
          try {
            const next = await getNotificationRealtimeCredential(platform, organizationId);
            if (initialCredential && (next.topic !== initialCredential.topic || next.endpoint !== initialCredential.endpoint)) {
              throw new Error("Notification channel scope changed");
            }
            initialCredential = next;
          } catch (cause) {
            if (cause instanceof ApiError && (cause.status === 401 || cause.status === 404)) clearExpiredSession();
            throw cause;
          }
        }
        return initialCredential.accessToken;
      })().finally(() => { credentialPromise = null; });
      return credentialPromise;
    };

    const startWebStream = async () => {
      if (platform === "desktop") {
        const bridge = window.ardenDesktop;
        if (!bridge?.startNotificationStream || !bridge.stopNotificationStream
          || !bridge.subscribeNotificationEvents || !bridge.subscribeNotificationStatus) {
          throw new Error("Desktop notification channel is unavailable");
        }
        const unsubscribeEvent = bridge.subscribeNotificationEvents(id => {
          if (notificationIdPattern.test(id)) void refreshRef.current();
        });
        const unsubscribeStatus = bridge.subscribeNotificationStatus(status => {
          if (status === "connected" || status === "reconnected") {
            setRealtimeAvailable(true);
            if (status === "reconnected") void refreshRef.current();
          } else {
            setRealtimeAvailable(false);
            if (status === "session-ended") {
              requestRef.current++;
              setInbox({ items: [], unreadCount: 0, nextCursor: null }); setLoading(false);
              setError("Notifications are no longer available.");
            }
          }
        });
        try { await bridge.startNotificationStream(organizationId); }
        catch (cause) { unsubscribeEvent(); unsubscribeStatus(); throw cause; }
        if (stopped) {
          unsubscribeEvent(); unsubscribeStatus();
          void bridge.stopNotificationStream?.(organizationId);
          return undefined;
        }
        return () => {
          unsubscribeEvent(); unsubscribeStatus();
          void bridge.stopNotificationStream?.(organizationId);
        };
      }

      const { RealtimeClient: RealtimeClientClass } = await import("@supabase/realtime-js");
      try { initialCredential = await getNotificationRealtimeCredential(platform, organizationId); }
      catch (cause) {
        if (cause instanceof ApiError && (cause.status === 401 || cause.status === 404)) clearExpiredSession();
        throw cause;
      }
      if (stopped) return;
      client = new RealtimeClientClass(initialCredential.endpoint, {
        params: { apikey: initialCredential.apiKey },
        accessToken: readToken,
      });
      channel = client.channel(initialCredential.topic, { config: { private: true } });
      channel.on("broadcast", { event: "notification" }, message => {
        const payload = message.payload as { notificationId?: unknown } | null;
        if (payload && typeof payload.notificationId === "string" && notificationIdPattern.test(payload.notificationId)) {
          void refreshRef.current();
        }
      });
      let connected = false;
      channel.subscribe(status => {
        if (status === "SUBSCRIBED") {
          setRealtimeAvailable(true);
          if (connected) void refreshRef.current();
          connected = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeAvailable(false);
        }
      });
      return undefined;
    };

    let stopDesktop: (() => void) | undefined;
    void startWebStream().then(stop => { stopDesktop = stop; }).catch(() => {
      if (!stopped) setRealtimeAvailable(false);
    });
    const onFocus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      stopDesktop?.();
      if (client && channel) void client.removeChannel(channel);
      client?.disconnect();
    };
  }, [organizationId, platform]);

  const value = useMemo<NotificationContextValue>(() => ({
    enabled: Boolean(organizationId), organizationId, items, unreadCount, nextCursor, loading, error,
    realtimeAvailable, filter, setFilter, refresh, loadMore, markRead, markAllRead,
    openTarget: onOpenTarget,
  }), [organizationId, items, unreadCount, nextCursor, loading, error, realtimeAvailable, filter,
    refresh, loadMore, markRead, markAllRead, onOpenTarget]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue | null {
  return useContext(NotificationContext);
}
