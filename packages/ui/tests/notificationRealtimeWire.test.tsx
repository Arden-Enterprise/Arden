// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/shared/api-client";
import { NotificationBell } from "../src/notifications/NotificationBell";
import { NotificationProvider } from "../src/notifications/NotificationProvider";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NotificationProvider with real @supabase/realtime-js client", () => {
  it("opens a wss:// socket and includes access_token in the initial private phx_join frame", async () => {
    const sockets: Array<{ url: string; sent: string[] }> = [];
    class FakeWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = FakeWebSocket.CONNECTING;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      readonly sent: string[] = [];

      constructor(readonly url: string) {
        sockets.push({ url, sent: this.sent });
        queueMicrotask(() => {
          if (this.readyState !== FakeWebSocket.CONNECTING) return;
          this.readyState = FakeWebSocket.OPEN;
          this.onopen?.();
        });
      }

      send(data: string) {
        this.sent.push(data);
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
      }
    }

    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(api, "listNotifications").mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null });
    vi.spyOn(api, "getNotificationRealtimeCredential").mockResolvedValue({
      endpoint: "https://realtime.example.test/realtime/v1",
      apiKey: "socket-transport-jwt",
      accessToken: "scoped-reader-jwt",
      topic: `arden-notifications:staging:${organizationId}:${membershipId}`,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });

    const view = render(createElement(NotificationProvider, {
      platform: "web",
      organizationId,
      onOpenTarget: vi.fn(),
      children: createElement(NotificationBell),
    }));

    await waitFor(() => expect(sockets[0]?.sent.length ?? 0).toBeGreaterThan(0));
    expect(sockets[0]!.url).toBe("wss://realtime.example.test/realtime/v1/websocket?apikey=socket-transport-jwt&vsn=2.0.0");
    const joinFrame = JSON.parse(sockets[0]!.sent[0]!) as [string, string, string, string, {
      access_token?: string;
      config?: { private?: boolean };
    }];
    expect(joinFrame[2]).toBe(`realtime:arden-notifications:staging:${organizationId}:${membershipId}`);
    expect(joinFrame[3]).toBe("phx_join");
    expect(joinFrame[4]).toMatchObject({
      access_token: "scoped-reader-jwt",
      config: { private: true },
    });

    view.unmount();
  });
});
