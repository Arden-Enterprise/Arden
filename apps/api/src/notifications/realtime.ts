import { SignJWT } from "jose";

export type NotificationRealtimeConfiguration = {
  endpoint: string;
  gatewayApiKey?: string | null;
  signingKey: Uint8Array;
  namespace: string;
};

export type NotificationRealtimeCredential = {
  endpoint: string;
  apiKey: string;
  accessToken: string;
  topic: string;
  expiresAt: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const namespacePattern = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const socketTokenLifetimeSeconds = 24 * 60 * 60;

export function notificationRealtimeConfiguration(environment: NodeJS.ProcessEnv): NotificationRealtimeConfiguration | null {
  const endpointValue = environment.SUPABASE_REALTIME_PUBLIC_URL?.trim();
  const gatewayApiKey = environment.SUPABASE_REALTIME_API_KEY?.trim() || null;
  const signingSecret = environment.ARDEN_NOTIFICATION_JWT_SECRET?.trim();
  const namespace = environment.ARDEN_NOTIFICATION_CHANNEL_NAMESPACE?.trim();
  if (!endpointValue && !gatewayApiKey && !signingSecret && !namespace) return null;
  if (!endpointValue || !signingSecret || !namespace) {
    throw new Error("Notification Realtime requires SUPABASE_REALTIME_PUBLIC_URL, ARDEN_NOTIFICATION_JWT_SECRET, and ARDEN_NOTIFICATION_CHANNEL_NAMESPACE together");
  }
  const endpoint = new URL(endpointValue);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if ((endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback))
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
    || endpoint.pathname.replace(/\/$/, "") !== "/realtime/v1") {
    throw new Error("SUPABASE_REALTIME_PUBLIC_URL must be an HTTPS Realtime /realtime/v1 endpoint (HTTP is allowed on loopback)");
  }
  if (!/^[0-9a-f]{64}$/i.test(signingSecret)) {
    throw new Error("ARDEN_NOTIFICATION_JWT_SECRET must be a 64-character hexadecimal secret");
  }
  if (gatewayApiKey !== null && (gatewayApiKey.length < 16 || gatewayApiKey.length > 4096)) {
    throw new Error("SUPABASE_REALTIME_API_KEY must be between 16 and 4096 characters when set");
  }
  if (!namespacePattern.test(namespace)) throw new Error("ARDEN_NOTIFICATION_CHANNEL_NAMESPACE has an invalid format");
  return { endpoint: endpoint.toString().replace(/\/$/, ""), gatewayApiKey,
    signingKey: new TextEncoder().encode(signingSecret), namespace };
}

export function notificationTopic(namespace: string, organizationId: string, membershipId: string): string {
  if (!namespacePattern.test(namespace) || !uuidPattern.test(organizationId) || !uuidPattern.test(membershipId)) {
    throw new Error("Invalid notification channel scope");
  }
  return `arden-notifications:${namespace}:${organizationId}:${membershipId}`;
}

async function signNotificationSocketToken(configuration: NotificationRealtimeConfiguration, nowSeconds: number): Promise<string> {
  return new SignJWT({ role: "arden_notification_socket", namespace: configuration.namespace })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(nowSeconds).setExpirationTime(nowSeconds + socketTokenLifetimeSeconds)
    .setIssuer("arden-core").setSubject("arden-notification-socket")
    .sign(configuration.signingKey);
}

export async function signNotificationReaderToken(configuration: NotificationRealtimeConfiguration,
  input: { userId: string; organizationId: string; membershipId: string }): Promise<NotificationRealtimeCredential> {
  if (!uuidPattern.test(input.userId) || !uuidPattern.test(input.organizationId) || !uuidPattern.test(input.membershipId)) {
    throw new Error("Invalid notification token scope");
  }
  const topic = notificationTopic(configuration.namespace, input.organizationId, input.membershipId);
  const now = Math.floor(Date.now() / 1000);
  const [apiKey, accessToken] = await Promise.all([
    configuration.gatewayApiKey ? Promise.resolve(configuration.gatewayApiKey) : signNotificationSocketToken(configuration, now),
    new SignJWT({
      role: "arden_notification_reader", topic,
      namespace: configuration.namespace,
      organization_id: input.organizationId, membership_id: input.membershipId,
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(now).setExpirationTime(now + 120).setIssuer("arden-core")
      .setSubject(input.userId).sign(configuration.signingKey),
  ]);
  return { endpoint: configuration.endpoint, apiKey, accessToken, topic,
    expiresAt: new Date((now + 120) * 1000).toISOString() };
}

export async function signNotificationSenderToken(configuration: NotificationRealtimeConfiguration,
  topic: string): Promise<string> {
  const [prefix, namespace, organizationId, membershipId, extra] = topic.split(":");
  if (prefix !== "arden-notifications" || namespace !== configuration.namespace || extra !== undefined
    || !uuidPattern.test(organizationId ?? "") || !uuidPattern.test(membershipId ?? "")) {
    throw new Error("Notification sender topic is outside the configured namespace");
  }
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "arden_notification_sender", topic, namespace: configuration.namespace })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now).setExpirationTime(now + 60).setIssuer("arden-core")
    .setSubject("arden-notification-outbox").sign(configuration.signingKey);
}

export async function broadcastNotification(configuration: NotificationRealtimeConfiguration,
  input: { organizationId: string; membershipId: string; notificationId: string },
  fetcher: typeof fetch = fetch): Promise<void> {
  const topic = notificationTopic(configuration.namespace, input.organizationId, input.membershipId);
  const senderToken = await signNotificationSenderToken(configuration, topic);
  const response = await fetcher(`${configuration.endpoint}/api/broadcast`, {
    method: "POST",
    headers: {
      apikey: configuration.gatewayApiKey ?? senderToken,
      authorization: `Bearer ${senderToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { topic, event: "notification", payload: { notificationId: input.notificationId }, private: true },
      ],
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`REALTIME_HTTP_${response.status}`);
}
