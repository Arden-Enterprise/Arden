import { Pool } from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { SupabaseAuthProvider } from "./auth/provider.js";
import { ArdenRepository } from "./db/repository.js";
import { LocalPrivateContentStorage } from "./private-notes/content-storage.js";
import { createSmtpMailer, smtpConfigurationFromEnvironment } from "./email/smtp-mailer.js";

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
const smtpConfiguration = smtpConfigurationFromEnvironment(process.env);
const invitationMailer = smtpConfiguration ? createSmtpMailer(smtpConfiguration) : null;

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

try {
  await checkRuntimeDatabase();
} catch {
  await pool.end();
  throw new Error("Arden database schema or API runtime roles are unavailable; apply migrations and verify the configured database roles");
}

const app = buildApp({
  checkDatabase: checkRuntimeDatabase,
  auth: supabaseUrl && supabasePublishableKey ? new SupabaseAuthProvider(supabaseUrl, supabasePublishableKey) : null,
  authTrustedOrigins: trustedOrigins,
  secureCookies: process.env.NODE_ENV === "production",
  repository: new ArdenRepository(pool),
  storage: new LocalPrivateContentStorage(privateStorageRoot ?? defaultStorageRoot),
  invitationMailer,
  publicWebOrigin: (() => {
    const configured = process.env.ARDEN_PUBLIC_WEB_ORIGIN;
    if (!configured) return null;
    const parsed = new URL(configured);
    if (parsed.origin !== configured || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
      throw new Error("ARDEN_PUBLIC_WEB_ORIGIN must be an exact web origin (HTTPS in production)");
    }
    return parsed.origin;
  })(),
});

const port = Number(process.env.ARDEN_API_PORT ?? 3001);
const host = process.env.ARDEN_API_HOST ?? "127.0.0.1";

async function shutdown() {
  await app.close();
  invitationMailer?.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ port, host });
