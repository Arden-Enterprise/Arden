import type { PoolClient } from "pg";

export type SystemConsoleReportKind = "OVERVIEW" | "ORGANIZATIONS" | "ORGANIZATION" | "KNOWLEDGE"
  | "AI_USAGE" | "CONTRIBUTIONS" | "FEEDBACK" | "QUALITY" | "HEALTH";
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

type SystemAdminTransaction = <T>(actorUserId: string,
  work: (client: PoolClient) => Promise<T>) => Promise<T | null>;

export interface SystemConsoleStore {
  canAccess(actorUserId: string): Promise<boolean>;
  report(actorUserId: string, query: SystemConsoleQuery): Promise<SystemConsoleReport>;
}

export class PgSystemConsoleStore implements SystemConsoleStore {
  constructor(private readonly withSystemAdmin: SystemAdminTransaction) {}

  async canAccess(actorUserId: string) {
    return (await this.withSystemAdmin(actorUserId, async () => true)) === true;
  }

  async report(actorUserId: string, query: SystemConsoleQuery) {
    const result = await this.withSystemAdmin(actorUserId, async client => {
      const report = await client.query<{ report: SystemConsoleReport }>(`SELECT system_console_report(
        $1, $2, $3, $4, $5, $6, $7, $8, $9) AS report`, [
        actorUserId, query.kind, query.organizationId ?? null, query.from, query.to,
        query.search ?? "", query.status ?? "", query.page ?? 1, query.pageSize ?? 25,
      ]);
      return report.rows[0]?.report ?? {};
    });
    if (result === null) throw new SystemConsoleError("SYSTEM_CONSOLE_UNAVAILABLE");
    return result;
  }
}
