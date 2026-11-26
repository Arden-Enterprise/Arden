import { jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import { broadcastNotification, notificationRealtimeConfiguration, notificationTopic,
  signNotificationReaderToken, signNotificationSenderToken } from "./realtime.js";

const secret = "ab".repeat(32);
const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function configuration() {
  const value = notificationRealtimeConfiguration({
    SUPABASE_REALTIME_PUBLIC_URL: "https://realtime.example.test/realtime/v1",
    SUPABASE_PUBLISHABLE_KEY: "publishable-key-value",
    ARDEN_NOTIFICATION_JWT_SECRET: secret,
    ARDEN_NOTIFICATION_CHANNEL_NAMESPACE: "staging-blue",
  } as NodeJS.ProcessEnv);
  if (!value) throw new Error("Expected notification realtime configuration");
  return value;
}

describe("notification Realtime credentials", () => {
  it("keeps Realtime disabled when only the existing Supabase Auth key is configured", () => {
    expect(notificationRealtimeConfiguration({ SUPABASE_PUBLISHABLE_KEY: "publishable-key-value" } as NodeJS.ProcessEnv))
      .toBeNull();
  });

  it("fails closed when only part of Realtime is configured", () => {
    expect(() => notificationRealtimeConfiguration({ SUPABASE_REALTIME_PUBLIC_URL: "https://realtime.example.test/realtime/v1" } as NodeJS.ProcessEnv))
      .toThrow("together");
  });

  it("limits a reader token to its exact organization and membership topic for two minutes and signs a Realtime socket key", async () => {
    const config = configuration();
    const now = Date.now();
    const credential = await signNotificationReaderToken(config, { userId, organizationId, membershipId });
    const { payload } = await jwtVerify(credential.accessToken, config.signingKey, { issuer: "arden-core" });
    const { payload: socketPayload } = await jwtVerify(credential.apiKey, config.signingKey, { issuer: "arden-core" });
    expect(credential.topic).toBe(notificationTopic(config.namespace, organizationId, membershipId));
    expect(payload).toMatchObject({ role: "arden_notification_reader", topic: credential.topic,
      namespace: config.namespace, organization_id: organizationId, membership_id: membershipId, sub: userId });
    expect(socketPayload).toMatchObject({ role: "arden_notification_socket",
      namespace: config.namespace, sub: "arden-notification-socket" });
    expect(socketPayload).not.toHaveProperty("topic");
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(120);
    await expect(jwtVerify(credential.accessToken, config.signingKey, {
      issuer: "arden-core", currentDate: new Date(now + 125_000),
    })).rejects.toMatchObject({ code: "ERR_JWT_EXPIRED" });
  });

  it("uses an explicit Realtime gateway API key when configured", async () => {
    const config = notificationRealtimeConfiguration({
      SUPABASE_REALTIME_PUBLIC_URL: "https://realtime.example.test/realtime/v1",
      SUPABASE_REALTIME_API_KEY: "explicit-realtime-gateway-key",
      ARDEN_NOTIFICATION_JWT_SECRET: secret,
      ARDEN_NOTIFICATION_CHANNEL_NAMESPACE: "staging-blue",
    } as NodeJS.ProcessEnv);
    if (!config) throw new Error("Expected notification realtime configuration");
    const credential = await signNotificationReaderToken(config, { userId, organizationId, membershipId });
    expect(credential.apiKey).toBe("explicit-realtime-gateway-key");
  });

  it("limits a sender token to a valid topic in the configured environment", async () => {
    const config = configuration();
    const topic = notificationTopic(config.namespace, organizationId, membershipId);
    const token = await signNotificationSenderToken(config, topic);
    const { payload } = await jwtVerify(token, config.signingKey, { issuer: "arden-core" });
    expect(payload).toMatchObject({ role: "arden_notification_sender", topic, namespace: config.namespace });
    await expect(signNotificationSenderToken(config, topic.replace(config.namespace, "production")))
      .rejects.toThrow("outside the configured namespace");
  });

  it("broadcasts only a notification ID to the private recipient topic via /api/broadcast", async () => {
    const config = configuration();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const notificationId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const topic = notificationTopic(config.namespace, organizationId, membershipId);
    await broadcastNotification(config, { organizationId, membershipId, notificationId }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, request] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://realtime.example.test/realtime/v1/api/broadcast");
    expect(JSON.parse(String(request?.body))).toEqual({
      messages: [{ topic, event: "notification", payload: { notificationId }, private: true }],
    });
    const headers = new Headers(request?.headers);
    const sender = await jwtVerify(String(headers.get("authorization"))
      .replace(/^Bearer /, ""), config.signingKey, { issuer: "arden-core" });
    const apiKeyToken = await jwtVerify(String(headers.get("apikey")), config.signingKey, { issuer: "arden-core" });
    expect(sender.payload.role).toBe("arden_notification_sender");
    expect(apiKeyToken.payload.role).toBe("arden_notification_sender");
  });

  it("reports failed HTTP delivery without returning a response body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider detail", { status: 503 }));
    await expect(broadcastNotification(configuration(), { organizationId, membershipId,
      notificationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }, fetcher)).rejects.toThrow("REALTIME_HTTP_503");
  });
});
