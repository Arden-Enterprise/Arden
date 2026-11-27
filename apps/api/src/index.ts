import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { resolveSupabaseAuthPublicUrl, SupabaseAuthProvider } from "./auth/provider.js";
import { sessionSigningKey } from "./auth/session-timebox.js";
import { assertLocalFlow1TestTarget, LocalFlow1TestAuthProvider, parseLocalTestAccounts } from "./auth/local-flow1-test.js";
import { ArdenRepository } from "./db/repository.js";
import { LocalPrivateContentStorage } from "./private-notes/content-storage.js";
import { createSmtpMailer, smtpConfigurationFromEnvironment } from "./email/smtp-mailer.js";
import { LocalFlow1TestInvitationMailer } from "./email/local-flow1-test-mailer.js";
import { isKietLocalFlow1TestTarget, kietLocalFlow1TestActor } from "./auth/remote-flow1-test.js";
import { HttpAskArdenClient } from "./answers/ai-client.js";
import { HttpArdenAiClient } from "./indexing/ai-client.js";
import { PgIndexGenerationStore } from "./indexing/store.js";
import { IndexingWorker, indexWorkerLeaseSeconds } from "./indexing/worker.js";
import { NotificationOutboxWorker, notificationWorkerPollMilliseconds } from "./notifications/outbox.js";
import { notificationRealtimeConfiguration } from "./notifications/realtime.js";
import { PrivateTrashRetention, startPrivateTrashRetentionLoop } from "./private-notes/trash-retention.js";
import { createSystemAdministrationServices, type SystemAdministrationServices } from "./system-auth/services.js";
import { createSystemHealthProbe } from "./system-console/routes.js";

const publicationExpiryReminderIntervalMs = 60 * 60 * 1000;

const databaseUrl = process.env.DATABASE_URL ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "postgresql://arden:arden_dev_only@127.0.0.1:5433/arden");

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in production");
}

const pool = new Pool({ connectionString: databaseUrl });
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const supabaseAuthPublicUrl = resolveSupabaseAuthPublicUrl(
  process.env.SUPABASE_AUTH_PUBLIC_URL, supabaseUrl,
);
const localFlow1TestMode = process.env.ARDEN_LOCAL_FLOW1_TEST_MODE === "true";
const remoteFlow1TestMode = isKietLocalFlow1TestTarget(
  databaseUrl, process.env.NODE_ENV, Boolean(supabaseUrl || supabasePublishableKey),
);
assertBooleanEnvironmentValue("ARDEN_LOCAL_FLOW1_TEST_MODE", process.env.ARDEN_LOCAL_FLOW1_TEST_MODE);
if (localFlow1TestMode && remoteFlow1TestMode) throw new Error("Choose only one Mainflow 1 test mode");
if (localFlow1TestMode) assertLocalFlow1TestTarget(databaseUrl, process.env.ARDEN_API_HOST ?? "127.0.0.1", process.env.NODE_ENV, Boolean(supabaseUrl || supabasePublishableKey));
if (process.env.NODE_ENV === "production" && (!supabaseUrl || !supabasePublishableKey)) {
  throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY) are required in production");
}
if (supabaseUrl) {
  const parsed = new URL(supabaseUrl);
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("SUPABASE_URL must be an HTTP(S) origin or trusted reverse-proxy URL");
  }
}
const configuredTrustedOrigins = process.env.ARDEN_AUTH_TRUSTED_ORIGINS;
if (process.env.NODE_ENV === "production" && !configuredTrustedOrigins) {
  throw new Error("ARDEN_AUTH_TRUSTED_ORIGINS must list the allowed web origins in production");
}
const requestedTrustedOrigins = (configuredTrustedOrigins ?? "http://127.0.0.1:5180,http://localhost:5180")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const trustedOrigins = [...new Set(requestedTrustedOrigins.map((origin) => {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.username || parsed.password || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
    throw new Error("ARDEN_AUTH_TRUSTED_ORIGINS must contain exact origins (HTTPS in production)");
  }
  return parsed.origin;
}))];
const privateStorageRoot = process.env.ARDEN_PRIVATE_STORAGE_ROOT;
if (process.env.NODE_ENV === "production" && !privateStorageRoot) {
  throw new Error("ARDEN_PRIVATE_STORAGE_ROOT must point to persistent private storage in production");
}

const apiDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const defaultStorageRoot = resolve(apiDirectory, "../../..", ".private", "note-content");
const flow1TestMode = localFlow1TestMode || remoteFlow1TestMode;
// Local disposable tests always use the mail sink. The fenced Kiet Local
// dev-2 actor may use real SMTP when all server-side settings are configured.
const smtpConfiguration = localFlow1TestMode ? null : smtpConfigurationFromEnvironment(process.env);
const invitationMailer = smtpConfiguration
  ? createSmtpMailer(smtpConfiguration)
  : flow1TestMode ? new LocalFlow1TestInvitationMailer() : null;
const aiUrl = process.env.ARDEN_AI_URL?.trim();
const aiServiceToken = process.env.ARDEN_AI_SERVICE_TOKEN?.trim();
const indexDatabaseUrl = process.env.ARDEN_INDEX_DATABASE_URL?.trim();
if (Boolean(aiUrl) !== Boolean(aiServiceToken)) {
  throw new Error("ARDEN_AI_URL and ARDEN_AI_SERVICE_TOKEN must be configured together");
}
const askArden = aiUrl && aiServiceToken ? new HttpAskArdenClient(aiUrl, aiServiceToken) : null;
function optedInOrganizations(variable: string): ReadonlySet<string> {
  const ids = new Set((process.env[variable] ?? "").split(",").map(id => id.trim().toLowerCase()).filter(Boolean));
  if ([...ids].some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))) {
    throw new Error(`${variable} requires comma-separated organization UUIDs`);
  }
  return ids;
}
const privateNoteAiOrganizations = optedInOrganizations("ARDEN_PRIVATE_NOTE_AI_ORGANIZATIONS");
const reviewerAiOrganizations = optedInOrganizations("ARDEN_REVIEWER_AI_ORGANIZATIONS");
const indexPool = askArden && indexDatabaseUrl
  ? new Pool({ connectionString: indexDatabaseUrl, max: 2, connectionTimeoutMillis: 10_000 }) : null;
const contentStorage = new LocalPrivateContentStorage(privateStorageRoot ?? defaultStorageRoot);
const notificationRealtime = notificationRealtimeConfiguration(process.env);
const notificationDatabaseUrl = process.env.ARDEN_NOTIFICATION_DATABASE_URL?.trim();
if (Boolean(notificationRealtime) !== Boolean(notificationDatabaseUrl)) {
  throw new Error("Realtime notifications require both complete Realtime configuration and ARDEN_NOTIFICATION_DATABASE_URL");
}
const notificationPool = notificationDatabaseUrl
  ? new Pool({ connectionString: notificationDatabaseUrl, max: 2, connectionTimeoutMillis: 10_000 }) : null;

async function checkRuntimeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE arden_runtime");
    await client.query("SET LOCAL search_path TO arden, public");
    await client.query("SELECT 1 FROM user_account LIMIT 0");
    await client.query("SELECT 1 FROM organization_membership LIMIT 0");
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function checkNotificationDatabase(): Promise<void> {
  if (!notificationPool) return;
  const client = await notificationPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE arden_notification_worker");
    await client.query("SET LOCAL search_path TO arden, public");
    await client.query("SELECT 1 FROM arden_notification_outbox LIMIT 0");
    await client.query("SELECT 1 FROM arden_notification LIMIT 0");
    await client.query("ROLLBACK");
  } catch {
    await client.query("ROLLBACK").catch(() => undefined);
    throw new Error("Notification worker database role or schema is unavailable");
  } finally { client.release(); }
}

try {
  await checkRuntimeDatabase();
} catch {
  await pool.end();
  await notificationPool?.end();
  throw new Error("Arden database schema or API runtime roles are unavailable; apply migrations and verify the configured database roles");
}
try {
  await checkNotificationDatabase();
} catch {
  await pool.end();
  await notificationPool?.end();
  throw new Error("Notification worker database role or schema is unavailable; verify ARDEN_NOTIFICATION_DATABASE_URL and its arden_notification_worker membership");
}

// Decision 0010 (2026-11-27): isolated System Admin storage is reached only through a
// dedicated login that is a member of `arden_system_auth`. The ordinary request login is
// never granted that role. Production without the URL disables System Admin routes (503).
const production = process.env.NODE_ENV === "production";
const systemAuthDatabaseUrl = process.env.ARDEN_SYSTEM_AUTH_DATABASE_URL?.trim();
const systemAuthPool = systemAuthDatabaseUrl
  ? new Pool({ connectionString: systemAuthDatabaseUrl, max: 4, connectionTimeoutMillis: 10_000 })
  // Local development only: the disposable superuser login can switch to the role itself.
  : production ? null : pool;
let systemAdministration: SystemAdministrationServices | null = systemAuthPool
  ? createSystemAdministrationServices(systemAuthPool) : null;
let systemSetupStatus: Awaited<ReturnType<SystemAdministrationServices["auth"]["setupStatus"]>> | null = null;
if (systemAdministration) {
  try {
    systemSetupStatus = await systemAdministration.auth.setupStatus();
  } catch {
    // Fail closed: System Admin routes answer 503 instead of failing per request.
    systemAdministration = null;
    console.warn("System Admin features are unavailable; verify ARDEN_SYSTEM_AUTH_DATABASE_URL, its arden_system_auth membership and migrations 0072 and 0074.");
  }
} else if (production) {
  console.warn("System Admin features are disabled: ARDEN_SYSTEM_AUTH_DATABASE_URL is not configured.");
}

// Production requires an operator-supplied setup token; a generated token would be printed
// to container logs. Development may still print a generated one-time token.
const configuredSystemSetupToken = process.env.ARDEN_SYSTEM_SETUP_TOKEN?.trim() || undefined;
const minimumSetupTokenLength = production ? 32 : 16;
if (configuredSystemSetupToken !== undefined && configuredSystemSetupToken.length < minimumSetupTokenLength) {
  throw new Error(`ARDEN_SYSTEM_SETUP_TOKEN must be at least ${minimumSetupTokenLength} characters when configured`);
}
const systemSetupToken = configuredSystemSetupToken ?? (production ? undefined : randomBytes(32).toString("base64url"));

const repository = new ArdenRepository(pool, contentStorage);
const app = buildApp({
  checkDatabase: checkRuntimeDatabase,
  auth: localFlow1TestMode
    ? new LocalFlow1TestAuthProvider(parseLocalTestAccounts(process.env.ARDEN_LOCAL_TEST_USERS))
    : supabaseUrl && supabasePublishableKey
      ? new SupabaseAuthProvider(supabaseUrl, supabasePublishableKey, supabaseAuthPublicUrl, {
        requirePublicAuthUrl: process.env.NODE_ENV === "production",
      })
      : null,
  testActor: remoteFlow1TestMode ? kietLocalFlow1TestActor : undefined,
  authTrustedOrigins: flow1TestMode ? [localFlow1Origin("ARDEN_PUBLIC_WEB_ORIGIN", "http://127.0.0.1:5180")] : trustedOrigins,
  secureCookies: process.env.NODE_ENV === "production",
  sessionSigningKey: sessionSigningKey(process.env.ARDEN_SESSION_SIGNING_KEY,
    process.env.NODE_ENV === "production"),
  systemSetupToken,
  systemAdministration,
  systemHealthProbe: createSystemHealthProbe({ supabaseUrl: process.env.SUPABASE_URL,
    ardenAiUrl: process.env.ARDEN_AI_URL, ardenAiServiceToken: process.env.ARDEN_AI_SERVICE_TOKEN }),
  repository,
  storage: contentStorage,
  invitationMailer,
  askArden,
  privateNoteAiOrganizations,
  reviewerAiOrganizations,
  readerAi: askArden,
  notificationRealtime,
  invitationDeliveryMode: smtpConfiguration ? "email" : "local-test-no-email",
  publicWebOrigin: (() => {
    if (flow1TestMode) return localFlow1Origin("ARDEN_PUBLIC_WEB_ORIGIN", "http://127.0.0.1:5180");
    const configured = process.env.ARDEN_PUBLIC_WEB_ORIGIN ?? (process.env.NODE_ENV === "production" ? null : "http://127.0.0.1:5180");
    if (!configured) return null;
    const parsed = new URL(configured);
    if (parsed.origin !== configured || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
      throw new Error("ARDEN_PUBLIC_WEB_ORIGIN must be an exact web origin (HTTPS in production)");
    }
    return parsed.origin;
  })(),
  publicApiOrigin: (() => {
    if (flow1TestMode) return localFlow1Origin("ARDEN_PUBLIC_API_ORIGIN", "http://127.0.0.1:3001");
    const configured = process.env.ARDEN_PUBLIC_API_ORIGIN ?? (process.env.NODE_ENV === "production" ? null : "http://127.0.0.1:3001");
    if (!configured) return null;
    const parsed = new URL(configured);
    if (parsed.origin !== configured || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
      throw new Error("ARDEN_PUBLIC_API_ORIGIN must be an exact API origin (HTTPS in production)");
    }
    return parsed.origin;
  })(),
});

const port = Number(process.env.ARDEN_API_PORT ?? 3001);
const host = process.env.ARDEN_API_HOST ?? "127.0.0.1";
indexPool?.on("error", () => {
  // pg emits idle-connection failures outside the worker's rejected promise.
  // The pool discards that client; a later poll obtains a new connection.
  app.log.warn("Indexing database connection interrupted; polling will retry");
});
if (askArden && !indexPool) {
  app.log.warn("Embedded indexing is disabled until a separate worker database login is configured");
}
const indexWorker = aiUrl && aiServiceToken && indexPool
  ? new IndexingWorker(
    randomUUID(),
    indexWorkerLeaseSeconds(process.env.ARDEN_INDEX_LEASE_SECONDS),
    new PgIndexGenerationStore(indexPool),
    contentStorage,
    new HttpArdenAiClient(aiUrl, aiServiceToken),
    {
      info: (fields, message) => app.log.info(fields, message),
      error: (fields, message) => app.log.error(fields, message),
    },
  )
  : null;
const notificationWorker = notificationRealtime
  ? new NotificationOutboxWorker(randomUUID(), notificationPool!, notificationRealtime, {
    info: (fields, message) => app.log.info(fields, message),
    warn: (fields, message) => app.log.warn(fields, message),
    error: (fields, message) => app.log.error(fields, message),
  })
  : null;
// Decision 0029: hourly in-process purge of private trash batches older than 30 days.
const privateTrashRetention = new PrivateTrashRetention(repository.privateTrashRetention, contentStorage, {
  info: (fields, message) => app.log.info(fields, message),
  error: (fields, message) => app.log.error(fields, message),
});
let privateTrashRetentionLoop: { stop(): void } | undefined;
let indexWorkerTimer: NodeJS.Timeout | undefined;
let notificationWorkerTimer: NodeJS.Timeout | undefined;
let expiryReminderTimer: NodeJS.Timeout | undefined;
let stopping = false;

/** Decision 0032 C: hourly, idempotent 30/7-day expiry reminders written into the in-app inbox. */
function scheduleExpiryReminders(delayMs: number): void {
  if (stopping) return;
  expiryReminderTimer = setTimeout(() => {
    void repository.enqueuePublicationExpiryReminders()
      .then((written) => { if (written) app.log.info({ written }, "Publication expiry reminders written"); })
      .catch((error: unknown) => {
        app.log.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Publication expiry reminders failed");
      })
      .finally(() => scheduleExpiryReminders(publicationExpiryReminderIntervalMs));
  }, delayMs);
  expiryReminderTimer.unref();
}

function scheduleIndexWorker(delayMs: number): void {
  if (!indexWorker || stopping) return;
  indexWorkerTimer = setTimeout(() => {
    void indexWorker.runOnce()
      .then((worked) => scheduleIndexWorker(worked ? 25 : 2_000))
      .catch((error: unknown) => {
        app.log.error({ error }, "Knowledge indexing worker poll failed");
        scheduleIndexWorker(5_000);
      });
  }, delayMs);
  indexWorkerTimer.unref();
}

function scheduleNotificationWorker(delayMs: number): void {
  if (!notificationWorker || stopping) return;
  notificationWorkerTimer = setTimeout(() => {
    void notificationWorker.runOnce()
      .then((worked) => scheduleNotificationWorker(notificationWorkerPollMilliseconds(worked)))
      .catch((error: unknown) => {
        app.log.error({ errorType: error instanceof Error ? error.name : "UnknownError" }, "Notification outbox poll failed");
        scheduleNotificationWorker(5_000);
      });
  }, delayMs);
  notificationWorkerTimer.unref();
}

async function shutdown() {
  stopping = true;
  if (indexWorkerTimer) clearTimeout(indexWorkerTimer);
  if (notificationWorkerTimer) clearTimeout(notificationWorkerTimer);
  if (expiryReminderTimer) clearTimeout(expiryReminderTimer);
  privateTrashRetentionLoop?.stop();
  await app.close();
  invitationMailer?.close();
  await pool.end();
  await indexPool?.end();
  await notificationPool?.end();
  if (systemAuthPool && systemAuthPool !== pool) await systemAuthPool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ port, host });
if (systemSetupStatus?.needsInitialSetup) {
  if (configuredSystemSetupToken) {
    app.log.warn("System Admin is not initialized. Open /system/setup and enter your configured ARDEN_SYSTEM_SETUP_TOKEN.");
  } else if (systemSetupToken) {
    // Development only (see above); production never prints a setup token.
    process.stdout.write(
      `\n[Arden System Setup] System Admin is not initialized.\n` +
      `[Arden System Setup] Open /system/setup and enter this one-time setup token:\n` +
      `[Arden System Setup] ${systemSetupToken}\n\n`,
    );
  } else {
    app.log.warn("System Admin setup is closed until ARDEN_SYSTEM_SETUP_TOKEN is configured.");
  }
}
scheduleIndexWorker(250);
scheduleNotificationWorker(250);
scheduleExpiryReminders(30_000);
privateTrashRetentionLoop = startPrivateTrashRetentionLoop(privateTrashRetention, {
  error: (fields, message) => app.log.error(fields, message),
});

function localFlow1Origin(name: string, fallback: string): string {
  const origin = process.env[name] || fallback;
  const parsed = new URL(origin);
  const host = parsed.hostname;
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
    || parsed.protocol !== "http:" || !loopback) {
    throw new Error(`${name} must be an exact loopback HTTP origin`);
  }
  return parsed.origin;
}

function assertBooleanEnvironmentValue(name: string, value: string | undefined): void {
  if (value !== undefined && value !== "true" && value !== "false") throw new Error(`${name} must be true or false`);
}
