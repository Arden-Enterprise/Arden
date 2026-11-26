import type { SystemAuthDatabase } from "../system-auth/database.js";

export type SystemConsoleReportKind = "OVERVIEW" | "ORGANIZATIONS" | "ORGANIZATION" | "KNOWLEDGE"
  | "AI_USAGE" | "CONTRIBUTIONS" | "FEEDBACK" | "QUALITY" | "HEALTH" | "PRIVATE_FEEDBACK";
export type SystemConsoleQuery = {
  kind: SystemConsoleReportKind;
  organizationId?: string;
  from: Date;
  to: Date;
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
};
export type SystemConsoleReport = Record<string, unknown>;
export type SystemConsoleErrorCode = "SYSTEM_CONSOLE_UNAVAILABLE";

export class SystemConsoleError extends Error {
  constructor(readonly code: SystemConsoleErrorCode) { super(code); }
}

/** The authenticated isolated administrator and the server-side session being used. */
export type SystemConsoleActor = { adminId: string; sessionId: string };

export interface SystemConsoleStore {
  report(actor: SystemConsoleActor, query: SystemConsoleQuery): Promise<SystemConsoleReport>;
}

export class PgSystemConsoleStore implements SystemConsoleStore {
  constructor(private readonly database: SystemAuthDatabase) {}

  /** Reports run only through `arden_system.console_report`, executable by `arden_system_auth`. */
  async report(actor: SystemConsoleActor, query: SystemConsoleQuery) {
    const report = await this.database.transaction("session", { actorId: actor.adminId, sessionId: actor.sessionId },
      async (client) => {
        const active = await client.query(
          `SELECT 1 FROM arden_system.admin_session
            WHERE session_id = $1 AND admin_id = $2 AND revoked_at IS NULL AND expires_at > now()`,
          [actor.sessionId, actor.adminId],
        );
        if (!active.rowCount) return null;
        const result = await client.query<{ report: SystemConsoleReport | null }>(
          `SELECT arden_system.console_report($1, $2, $3, $4, $5, $6, $7, $8, $9) AS report`, [
            actor.adminId, query.kind, query.organizationId ?? null, query.from, query.to,
            query.search ?? "", query.status ?? "", query.page ?? 1, query.pageSize ?? 25,
          ]);
        return result.rows[0]?.report ?? null;
      }).catch((error: unknown) => {
        // The routine refuses a revoked administrator with 42501; treat it as unavailable.
        if ((error as { code?: string }).code === "42501") return null;
        throw error;
      });
    // An unknown organization yields NULL, which is reported like any unavailable resource.
    if (report === null) throw new SystemConsoleError("SYSTEM_CONSOLE_UNAVAILABLE");
    return report;
  }
}
