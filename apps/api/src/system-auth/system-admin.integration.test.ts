import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { incompleteUsageMarker } from "../answers/usage-contracts.js";
import { ArdenRepository } from "../db/repository.js";
import { SystemAdministrationError } from "../system-administration/store.js";
import { SystemConsoleError } from "../system-console/store.js";
import { createSystemAdministrationServices, type SystemAdministrationServices } from "./services.js";

/**
 * Real PostgreSQL acceptance for the isolated System Admin identity (decision 0010,
 * 2026-11-27): dedicated login, RLS modes, setup gate, sessions, throttling, lifecycle,
 * the `arden_system_auth`-only Console routine and tenant usage writes under `arden_runtime`.
 */
const databaseUrl = process.env.ARDEN_TEST_DATABASE_URL;
const admin = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 2 }) : null;
const suffix = randomUUID().replaceAll("-", "");
const systemLogin = `arden_test_sysauth_${suffix}`;
const runtimeLogin = `arden_test_runtime_${suffix}`;
const password = randomUUID();
let systemPool: Pool | null = null;
let runtimePool: Pool | null = null;
let services: SystemAdministrationServices;

function loginUrl(user: string): string {
  const url = new URL(databaseUrl!);
  url.username = user;
  url.password = password;
  return url.href;
}

async function resetIsolatedStore(pool: Pool) {
  // Disposable target only: bypass the last-administrator trigger to start from a fresh install.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query("DELETE FROM arden_system.admin_session");
    await client.query("DELETE FROM arden_system.auth_throttle");
    await client.query("DELETE FROM arden_system.administration_event");
    await client.query("DELETE FROM arden_system.administrator");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(!databaseUrl)("Isolated System Admin identity with real PostgreSQL roles", () => {
  beforeAll(async () => {
    const identity = await admin!.query<{ database_name: string; is_superuser: boolean }>(`
      SELECT current_database() AS database_name, r.rolsuper AS is_superuser FROM pg_roles r WHERE r.rolname = current_user`);
    if (!identity.rows[0]?.database_name.startsWith("arden_test_") || !identity.rows[0]?.is_superuser) {
      throw new Error("Refusing System Admin fixtures outside a superuser connection to arden_test_*");
    }
    const applied = await admin!.query("SELECT 1 FROM public.arden_schema_migrations WHERE migration_id = '0074_system_admin_isolated_lifecycle'");
    if (!applied.rowCount) throw new Error("Apply migration 0074 to the isolated test database first");
    // Mirrors production provisioning: each login is a NOINHERIT member of exactly one role.
    await admin!.query(`CREATE ROLE ${systemLogin} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
    await admin!.query(`GRANT arden_system_auth TO ${systemLogin}`);
    await admin!.query(`CREATE ROLE ${runtimeLogin} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS PASSWORD '${password}'`);
    await admin!.query(`GRANT arden_runtime TO ${runtimeLogin}`);
    const database = identity.rows[0].database_name;
    await admin!.query(`GRANT CONNECT ON DATABASE ${database} TO ${systemLogin}, ${runtimeLogin}`);
    await resetIsolatedStore(admin!);
    systemPool = new Pool({ connectionString: loginUrl(systemLogin), max: 2 });
    runtimePool = new Pool({ connectionString: loginUrl(runtimeLogin), max: 2 });
    services = createSystemAdministrationServices(systemPool);
  });

  afterAll(async () => {
    await systemPool?.end();
    await runtimePool?.end();
    if (admin) {
      await resetIsolatedStore(admin).catch(() => undefined);
      const database = (await admin.query<{ name: string }>("SELECT current_database() AS name")).rows[0]!.name;
      for (const login of [systemLogin, runtimeLogin]) {
        await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM ${login}`).catch(() => undefined);
        await admin.query(`DROP ROLE IF EXISTS ${login}`).catch(() => undefined);
      }
      await admin.end();
    }
  });

  it("keeps the request login out of arden_system and its Console routine", async () => {
    const client = await runtimePool!.connect();
    try {
      await expect(client.query("SET ROLE arden_system_auth")).rejects.toMatchObject({ code: "42501" });
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await expect(client.query("SELECT 1 FROM arden_system.administrator")).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE arden_runtime");
      await client.query("SELECT set_config('arden.instance_admin', 'true', true), set_config('arden.system_auth_mode', 'session', true)");
      await expect(client.query("SELECT arden_system.console_report($1, 'OVERVIEW')", [randomUUID()]))
        .rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
      const legacy = await admin!.query("SELECT to_regprocedure('arden.system_console_report(uuid,text,uuid,timestamptz,timestamptz,text,text,integer,integer)') AS routine");
      expect(legacy.rows[0].routine).toBeNull();
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });

  it("uses only isolated administrator records and closes initial setup permanently", async () => {
    const retired = await admin!.query(`SELECT to_regclass('arden.system_administrator') AS administrators,
      to_regclass('arden.system_administration_event') AS events`);
    expect(retired.rows).toEqual([{ administrators: null, events: null }]);
    expect((await services.auth.setupStatus()).needsInitialSetup).toBe(true);
    const created = await services.auth.completeInitialSetup({ email: `first-${suffix}@arden.test`, fullName: "First Manager",
      passwordHash: `scrypt$32768$8$1$${"0".repeat(32)}$${"1".repeat(128)}`, requestId: "it-setup",
      sessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000) });
    expect(created.account.canManageSystemAdmins).toBe(true);
    expect((await services.auth.setupStatus()).needsInitialSetup).toBe(false);
    await expect(services.auth.completeInitialSetup({ email: `second-${suffix}@arden.test`, fullName: "Second",
      passwordHash: `scrypt$32768$8$1$${"0".repeat(32)}$${"1".repeat(128)}`, requestId: "it-setup-2",
      sessionExpiresAt: new Date(Date.now() + 60 * 60 * 1000) })).rejects.toMatchObject({ code: "SYSTEM_SETUP_ALREADY_COMPLETED" });
    const active = await services.auth.getActiveSession(created.session.sessionId);
    expect(active?.account.id).toBe(created.account.id);
  });

  it("runs the manager lifecycle on isolated identities and protects the last manager", async () => {
    const first = (await admin!.query<{ admin_id: string }>("SELECT id AS admin_id FROM arden_system.administrator WHERE email = $1",
      [`first-${suffix}@arden.test`])).rows[0]!.admin_id;
    const firstSession = await services.auth.startSession(first, "it-sign-in", new Date(Date.now() + 60 * 60 * 1000));
    const manager = { adminId: first, sessionId: firstSession.sessionId };

    await expect(services.administration.setManagerCapability(manager, first, false, "it-demote-last"))
      .rejects.toMatchObject({ code: "SYSTEM_ADMINISTRATOR_LAST_MANAGER" });
    const monitor = await services.administration.grant(manager, { email: `monitor-${suffix}@arden.test`, fullName: "Monitor",
      passwordHash: `scrypt$32768$8$1$${"0".repeat(32)}$${"2".repeat(128)}` }, "it-grant");
    expect(monitor).toMatchObject({ status: "ACTIVE", canManageSystemAdmins: false, grantedByAdminId: first });
    await expect(services.administration.grant(manager, { email: monitor.email, fullName: "Duplicate",
      passwordHash: `scrypt$32768$8$1$${"0".repeat(32)}$${"3".repeat(128)}` }, "it-grant-duplicate"))
      .rejects.toMatchObject({ code: "SYSTEM_ADMINISTRATOR_CONFLICT" });

    // A monitoring-only administrator cannot use or self-grant manager authority.
    const monitorSession = await services.auth.startSession(monitor.id, "it-monitor-sign-in", new Date(Date.now() + 60 * 60 * 1000));
    const monitorActor = { adminId: monitor.id, sessionId: monitorSession.sessionId };
    await expect(services.administration.setManagerCapability(monitorActor, monitor.id, true, "it-self-promote"))
      .rejects.toBeInstanceOf(SystemAdministrationError);

    expect((await services.administration.setManagerCapability(manager, monitor.id, true, "it-promote")).canManageSystemAdmins).toBe(true);
    expect((await services.administration.setManagerCapability(manager, monitor.id, false, "it-demote")).canManageSystemAdmins).toBe(false);
    const revoked = await services.administration.revoke(manager, monitor.id, "it-revoke");
    expect(revoked).toMatchObject({ status: "REVOKED", canManageSystemAdmins: false, revokedByAdminId: first });
    // Revocation ends the target's sessions immediately.
    expect(await services.auth.getActiveSession(monitorSession.sessionId)).toBeNull();
    await expect(services.administration.revoke(manager, first, "it-revoke-last"))
      .rejects.toMatchObject({ code: "SYSTEM_ADMINISTRATOR_LAST_MANAGER" });

    const overview = await services.administration.overview(manager);
    expect(overview.recentEvents.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "SYSTEM_ADMINISTRATOR_GRANTED", "SYSTEM_ADMIN_MANAGER_ENABLED", "SYSTEM_ADMIN_MANAGER_DISABLED", "SYSTEM_ADMINISTRATOR_REVOKED"]));

    await services.auth.endSession(firstSession.sessionId, "it-sign-out");
    expect(await services.auth.getActiveSession(firstSession.sessionId)).toBeNull();
    await expect(services.administration.overview(manager)).rejects.toMatchObject({ code: "SYSTEM_ADMINISTRATION_UNAVAILABLE" });
  });

  it("serves paginated aggregate Console reports only through an active isolated session", async () => {
    const first = (await admin!.query<{ admin_id: string }>("SELECT id AS admin_id FROM arden_system.administrator WHERE email = $1",
      [`first-${suffix}@arden.test`])).rows[0]!.admin_id;
    const session = await services.auth.startSession(first, "it-console", new Date(Date.now() + 60 * 60 * 1000));
    const actor = { adminId: first, sessionId: session.sessionId };
    const range = { from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), to: new Date() };
    const overview = await services.console.report(actor, { kind: "OVERVIEW", ...range });
    expect(overview).toHaveProperty("organizations");
    for (const kind of ["CONTRIBUTIONS", "QUALITY"] as const) {
      expect(await services.console.report(actor, { kind, ...range, page: 1, pageSize: 5 }))
        .toMatchObject({ page: 1, pageSize: 5, total: expect.any(Number), items: expect.any(Array) });
    }
    expect(((await services.console.report(actor, { kind: "PRIVATE_FEEDBACK", ...range })).weeks as unknown[]).length).toBe(12);
    for (const kind of ["FEEDBACK", "AI_USAGE", "KNOWLEDGE", "HEALTH"] as const) {
      expect(await services.console.report(actor, { kind, ...range })).toEqual(expect.any(Object));
    }
    expect(await services.console.report(actor, { kind: "FEEDBACK", ...range }))
      .toMatchObject({ positive: expect.any(Number), negative: expect.any(Number) });
    // LIKE metacharacters are literal search text.
    expect(await services.console.report(actor, { kind: "ORGANIZATIONS", ...range, search: "%_", page: 1, pageSize: 50 }))
      .toMatchObject({ total: 0, items: [] });
    await expect(services.console.report(actor, { kind: "ORGANIZATION", organizationId: randomUUID(), ...range }))
      .rejects.toBeInstanceOf(SystemConsoleError);
    await services.auth.endSession(session.sessionId, "it-console-out");
    await expect(services.console.report(actor, { kind: "OVERVIEW", ...range })).rejects.toBeInstanceOf(SystemConsoleError);
  });

  it("throttles failures across replicas with a shared lock and clears on success", async () => {
    const key = `throttle-${suffix}@arden.test`;
    for (let attempt = 1; attempt < 5; attempt++) expect(await services.auth.recordThrottleFailure("sign-in", key)).toBeNull();
    expect((await services.auth.recordThrottleFailure("sign-in", key))?.retryAfterSeconds).toBeGreaterThan(0);
    expect((await services.auth.throttleState("sign-in", key))?.retryAfterSeconds).toBeGreaterThan(0);
    await services.auth.clearThrottle("sign-in", key);
    expect(await services.auth.throttleState("sign-in", key)).toBeNull();
    const stored = await admin!.query<{ bucket: string }>("SELECT bucket_key AS bucket FROM arden_system.auth_throttle");
    expect(stored.rows.every((row) => !row.bucket.includes("@"))).toBe(true);
  });

  it("records tenant AI usage idempotently under arden_runtime and scopes feedback to owned answers", async () => {
    const repository = new ArdenRepository(admin!);
    const member = randomUUID();
    const created = await repository.createOrganization(member, `${member}@example.test`, "Usage Member",
      { name: `Usage ${suffix.slice(0, 8)}`, departmentName: "Usage" }, "it-org");
    const organizationId = created.organizationId;
    const requestId = randomUUID();
    const events = [{ eventId: randomUUID(), operation: "CHAT_GENERATION" as const, provider: "OPENAI", model: "gpt-test",
      inputTokens: 12, outputTokens: 4, latencyMs: 30, usageComplete: true }, incompleteUsageMarker(requestId, "CHAT_RETRIEVAL")];
    expect(await repository.recordAiUsageEvents(member, organizationId, requestId, events)).toBe(true);
    expect(await repository.recordAiUsageEvents(member, organizationId, requestId, events)).toBe(true);
    const stored = await admin!.query<{ count: string; incomplete: string }>(`SELECT count(*)::text AS count,
      count(*) FILTER (WHERE NOT is_complete)::text AS incomplete FROM arden.ai_usage WHERE request_id = $1`, [requestId]);
    expect(stored.rows[0]).toEqual({ count: "2", incomplete: "1" });

    expect(await repository.recordAiAnswerResult(member, organizationId, requestId, "READER_QUESTION", "ANSWERED", 1)).toBe(true);
    expect(await repository.submitAiAnswerFeedback(member, organizationId, requestId, "POSITIVE")).toBe(true);
    expect(await repository.submitAiAnswerFeedback(member, organizationId, requestId, "NEGATIVE")).toBe(true);
    // Chat answers are rated on the saved turn, never through this endpoint.
    const chatRequest = randomUUID();
    expect(await repository.recordAiAnswerResult(member, organizationId, chatRequest, "CHAT", "ANSWERED", 1)).toBe(true);
    expect(await repository.submitAiAnswerFeedback(member, organizationId, chatRequest, "POSITIVE")).toBe(false);
    expect(await repository.submitAiAnswerFeedback(member, organizationId, randomUUID(), "POSITIVE")).toBe(false);
  });
});
