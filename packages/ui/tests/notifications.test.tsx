// @vitest-environment jsdom
import { createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { NotificationBell, notificationAnchorRight } from "../src/notifications/NotificationBell";
import { NotificationProvider, useNotifications } from "../src/notifications/NotificationProvider";

const realtimeHarness = vi.hoisted(() => ({
  broadcast: null as null | ((message: unknown) => void),
  status: null as null | ((status: string) => void),
  topic: null as string | null,
  accessToken: null as null | (() => Promise<string | null>),
  removeCount: 0,
  disconnectCount: 0,
}));

vi.mock("@supabase/realtime-js", () => ({
  RealtimeClient: class {
    constructor(_endpoint: string, options: unknown) {
      realtimeHarness.accessToken = (options as { accessToken?: () => Promise<string | null> }).accessToken ?? null;
    }
    channel(topic: string, _options: unknown) {
      realtimeHarness.topic = topic;
      const channel = {
        on: (_kind: string, _filter: unknown, listener: (message: unknown) => void) => {
          realtimeHarness.broadcast = listener;
          return channel;
        },
        subscribe: (listener: (status: string) => void) => {
          realtimeHarness.status = listener;
          return channel;
        },
      };
      return channel;
    }
    removeChannel(_channel: unknown) {
      realtimeHarness.removeCount++;
      return Promise.resolve("ok");
    }
    disconnect() { realtimeHarness.disconnectCount++; }
  },
}));

const organizationOne = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const organizationTwo = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const notificationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const fixture: api.NotificationItem = {
  id: notificationId, type: "REVIEW_REQUESTED", message: "A knowledge item is waiting for your review.",
  createdAt: "2026-11-19T10:00:00.000Z", readAt: null,
  target: { view: "review-queue", id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
};

afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  realtimeHarness.broadcast = null; realtimeHarness.status = null; realtimeHarness.topic = null; realtimeHarness.accessToken = null;
  realtimeHarness.removeCount = 0; realtimeHarness.disconnectCount = 0;
});

function renderInbox(onOpenTarget = vi.fn()) {
  return render(createElement(NotificationProvider, { platform: "web", organizationId: organizationOne, onOpenTarget,
    children: createElement(NotificationBell) }));
}

describe("F21 in-app notification inbox", () => {
  it("shows the canonical inbox while Realtime is offline and opens an authorized target", async () => {
    const list = vi.spyOn(api, "listNotifications").mockResolvedValue({ items: [fixture], unreadCount: 1, nextCursor: null });
    vi.spyOn(api, "getNotificationRealtimeCredential").mockRejectedValue(new Error("offline"));
    const markRead = vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    const onOpenTarget = vi.fn();
    renderInbox(onOpenTarget);

    const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    fireEvent.click(bell);
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toContain("Live updates are unavailable");
    const row = await screen.findByRole("button", { name: /knowledge item is waiting for your review\., unread/ });
    fireEvent.click(row);
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("web", organizationOne, notificationId));
    expect(onOpenTarget).toHaveBeenCalledWith(fixture.target);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(list).toHaveBeenCalled();
  });

  it("hangs the dialog below the bell, inside the window", async () => {
    // A docked Ask Arden panel (window 1440, bell ending at 1036) leaves the dialog left of the panel.
    expect(notificationAnchorRight(1440, 1036)).toBe(404);
    // Bell near the window edge: the usual 16px margin.
    expect(notificationAnchorRight(1440, 1436)).toBe(16);
    // Narrow window: the dialog never runs past the left edge (500 - 64 - 420 = 16px from it).
    expect(notificationAnchorRight(500, 120)).toBe(64);
    expect(notificationAnchorRight(1000, 300)).toBe(564);

    vi.spyOn(api, "listNotifications").mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null });
    vi.spyOn(api, "getNotificationRealtimeCredential").mockRejectedValue(new Error("offline"));
    renderInbox();
    const bell = await screen.findByRole("button", { name: "Notifications" });
    vi.spyOn(bell, "getBoundingClientRect").mockReturnValue({ right: window.innerWidth - 300 } as DOMRect);
    fireEvent.click(bell);
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    const layer = dialog.parentElement!;
    await waitFor(() => expect(layer.style.getPropertyValue("--notification-anchor-right"))
      .toBe(`${notificationAnchorRight(window.innerWidth, window.innerWidth - 300)}px`));
  });

  it("supports filter and keyboard dismissal with focus returned to the bell", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null });
    vi.spyOn(api, "getNotificationRealtimeCredential").mockRejectedValue(new Error("offline"));
    renderInbox();

    const bell = await screen.findByRole("button", { name: "Notifications" });
    fireEvent.click(bell);
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    expect(await screen.findByText("No unread notifications.")).toBeTruthy();
    await act(async () => { fireEvent.keyDown(dialog, { key: "Escape" }); });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(bell));
  });

  it("refreshes the canonical inbox after duplicate broadcasts and reconnect, then closes the channel", async () => {
    const list = vi.spyOn(api, "listNotifications").mockResolvedValue({ items: [fixture], unreadCount: 1, nextCursor: null });
    vi.spyOn(api, "getNotificationRealtimeCredential").mockResolvedValue({
      endpoint: "https://realtime.example.test/realtime/v1", apiKey: "publishable-key-value",
      accessToken: "notification-reader-token", topic: `arden-notifications:staging:${organizationOne}:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const view = renderInbox();
    await waitFor(() => expect(realtimeHarness.broadcast).toEqual(expect.any(Function)));
    expect(realtimeHarness.topic).toBe(`arden-notifications:staging:${organizationOne}:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`);
    await act(async () => { realtimeHarness.status?.("SUBSCRIBED"); });
    await act(async () => { realtimeHarness.status?.("CHANNEL_ERROR"); });
    await act(async () => { realtimeHarness.status?.("SUBSCRIBED"); });
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
    const beforeBroadcast = list.mock.calls.length;
    await act(async () => {
      realtimeHarness.broadcast?.({ payload: { notificationId } });
      realtimeHarness.broadcast?.({ payload: { notificationId } });
    });
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(beforeBroadcast + 2));
    view.unmount();
    expect(realtimeHarness.removeCount).toBe(1);
    expect(realtimeHarness.disconnectCount).toBe(1);
  });

  it("clears the inbox and closes Realtime when membership expires", async () => {
    vi.spyOn(api, "listNotifications").mockResolvedValue({ items: [fixture], unreadCount: 1, nextCursor: null });
    const getCredential = vi.spyOn(api, "getNotificationRealtimeCredential")
      .mockResolvedValueOnce({ endpoint: "https://realtime.example.test/realtime/v1", apiKey: "publishable-key-value",
        accessToken: "notification-reader-token", topic: `arden-notifications:staging:${organizationOne}:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
        expiresAt: new Date(Date.now() + 30_000).toISOString() })
      .mockRejectedValueOnce(new api.ApiError(401, "expired"));
    renderInbox();
    await waitFor(() => expect(realtimeHarness.accessToken).toEqual(expect.any(Function)));
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeTruthy();
    await act(async () => {
      await expect(realtimeHarness.accessToken?.()).rejects.toMatchObject({ status: 401 });
    });
    expect(getCredential).toHaveBeenCalledTimes(2);
    expect(realtimeHarness.removeCount).toBe(1);
    expect(realtimeHarness.disconnectCount).toBe(1);
    expect((await screen.findByRole("alert")).textContent).toContain("Notifications are no longer available.");
    expect(screen.queryByText(fixture.message)).toBeNull();
  });

  it("ignores a pending inbox response after the provider unmounts", async () => {
    let resolvePage!: (page: api.NotificationPage) => void;
    const pendingPage = new Promise<api.NotificationPage>(resolve => { resolvePage = resolve; });
    const list = vi.spyOn(api, "listNotifications").mockReturnValue(pendingPage);
    vi.spyOn(api, "getNotificationRealtimeCredential").mockRejectedValue(new Error("offline"));
    const view = renderInbox();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {});
    vi.stubGlobal("window", undefined);
    try {
      resolvePage({ items: [], unreadCount: 0, nextCursor: null });
      await pendingPage;
      await new Promise(resolve => setTimeout(resolve, 0));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("clears old organization items when the active organization changes", async () => {
    const list = vi.spyOn(api, "listNotifications").mockImplementation(async (_platform, organizationId) =>
      organizationId === organizationOne
        ? { items: [fixture], unreadCount: 1, nextCursor: null }
        : { items: [], unreadCount: 0, nextCursor: null });
    vi.spyOn(api, "getNotificationRealtimeCredential").mockRejectedValue(new Error("offline"));
    function OrganizationHarness() {
      const [organizationId, setOrganizationId] = useState(organizationOne);
      return createElement("div", null,
        createElement("button", { type: "button", onClick: () => setOrganizationId(organizationTwo) }, "Switch organization"),
        createElement(NotificationProvider, { platform: "web", organizationId, onOpenTarget: vi.fn(),
          children: createElement(NotificationBell) }));
    }
    render(createElement(OrganizationHarness));
    fireEvent.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    expect(await screen.findByRole("button", { name: /knowledge item is waiting for your review/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unread" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("web", organizationOne,
      expect.objectContaining({ unreadOnly: true })));
    fireEvent.click(screen.getByRole("button", { name: "Switch organization" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy());
    await waitFor(() => expect(list).toHaveBeenLastCalledWith("web", organizationTwo,
      expect.objectContaining({ unreadOnly: false })));
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("You don't have any notifications yet.")).toBeTruthy();
    expect(screen.queryByText(fixture.message)).toBeNull();
  });

  it("decrements the unread count only once when the same notification is marked twice", async () => {
    const secondFixture = { ...fixture, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", message: "Another notification." };
    vi.spyOn(api, "listNotifications").mockResolvedValue({
      items: [fixture, secondFixture], unreadCount: 2, nextCursor: null,
    });
    vi.spyOn(api, "getNotificationRealtimeCredential").mockRejectedValue(new Error("offline"));
    const markRead = vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    function MarkReadHarness() {
      const notifications = useNotifications();
      return createElement("div", null,
        createElement("button", { type: "button", onClick: () => {
          void notifications?.markRead(notificationId);
          void notifications?.markRead(notificationId);
        } }, "Mark same notification twice"),
        createElement("output", { "data-testid": "unread-count" }, String(notifications?.unreadCount ?? 0)));
    }
    render(createElement(NotificationProvider, { platform: "web", organizationId: organizationOne,
      onOpenTarget: vi.fn(), children: createElement(MarkReadHarness) }));

    await waitFor(() => expect(screen.getByTestId("unread-count").textContent).toBe("2"));
    fireEvent.click(screen.getByRole("button", { name: "Mark same notification twice" }));
    await waitFor(() => expect(screen.getByTestId("unread-count").textContent).toBe("1"));
    expect(markRead).toHaveBeenCalledTimes(2);
  });
});
