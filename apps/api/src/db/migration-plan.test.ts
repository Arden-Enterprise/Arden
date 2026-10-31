import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Migration = { id: string; filename: string; sha256: string; rollout: "expand" | "operator" };
type LedgerRow = { migration_id: string; checksum: string | null };
type Plan = { status: string; pending: Migration[]; reason?: string };
type PlannerModule = { planMigrations: (inventory: Migration[], ledger: LedgerRow[]) => Plan };

let planner: PlannerModule | undefined;
const plannerUrl = new URL("./migration-plan.ts", import.meta.url);
const plannerExists = existsSync(fileURLToPath(plannerUrl));
if (plannerExists) {
  planner = await import(/* @vite-ignore */ plannerUrl.href) as PlannerModule;
}

const rows: Migration[] = [
  { id: "0001", filename: "0001_first.sql", sha256: "a".repeat(64), rollout: "expand" },
  { id: "0002", filename: "0002_second.sql", sha256: "b".repeat(64), rollout: "expand" },
  { id: "0003", filename: "0003_third.sql", sha256: "c".repeat(64), rollout: "operator" },
];

function ledger(...ids: string[]): LedgerRow[] {
  return ids.map(id => ({ migration_id: id, checksum: rows.find(row => row.filename.slice(0, -4) === id)?.sha256 ?? "f".repeat(64) }));
}

describe("migration planner availability", () => {
  it("implements the checksum-aware migration planner", () => {
    expect(plannerExists).toBe(true);
    expect(planner?.planMigrations).toBeTypeOf("function");
  });
});

if (planner) {
  describe("planMigrations", () => {
    it("selects only the ordered pending migrations after a proven applied prefix", () => {
      const safe = rows.slice(0, 2);
      const result = planner?.planMigrations(safe, ledger("0001_first"));
      expect(result).toEqual({ status: "READY", pending: safe.slice(1) });
    });

    it("accepts gaps in migration numbers without inventing a missing migration", () => {
      const sparse = [rows[0]!, { ...rows[2]!, rollout: "expand" as const }];
      expect(planner?.planMigrations(sparse, ledger("0001_first"))).toEqual({
        status: "READY", pending: [sparse[1]!],
      });
      expect(planner?.planMigrations(sparse, ledger("0001_first", "0003_third"))).toEqual({
        status: "NO_PENDING", pending: [],
      });
    });

    it("returns no pending work when all checksums match", () => {
      const result = planner?.planMigrations(rows, ledger("0001_first", "0002_second", "0003_third"));
      expect(result).toEqual({ status: "NO_PENDING", pending: [] });
    });

    it("blocks an operator-class pending migration", () => {
      const result = planner?.planMigrations(rows, ledger("0001_first", "0002_second"));
      expect(result).toEqual({ status: "REQUIRES_OPERATOR", pending: [rows[2]], reason: "OPERATOR_MIGRATION_PENDING" });
    });

    it("requires an operator checksum baseline for a missing or null checksum", () => {
      expect(planner?.planMigrations(rows, [{ migration_id: "0001_first" } as LedgerRow])).toMatchObject({
        status: "BASELINE_REQUIRED", reason: "CHECKSUM_MISSING",
      });
      expect(planner?.planMigrations(rows, [{ migration_id: "0001_first", checksum: null }])).toMatchObject({
        status: "BASELINE_REQUIRED", reason: "CHECKSUM_MISSING",
      });
    });

    it("stops on unknown applied IDs and checksum drift", () => {
      expect(planner?.planMigrations(rows, ledger("0001_first", "0099_missing"))).toMatchObject({
        status: "DRIFT", reason: "UNKNOWN_APPLIED_ID",
      });
      expect(planner?.planMigrations(rows, [{ migration_id: "0001_first", checksum: "f".repeat(64) }])).toMatchObject({
        status: "DRIFT", reason: "CHECKSUM_MISMATCH",
      });
    });

    it("rejects malformed, duplicate, and non-prefix ledger rows", () => {
      expect(planner?.planMigrations(rows, [{ migration_id: "bad", checksum: "a".repeat(64) }])).toMatchObject({
        status: "MALFORMED_LEDGER",
      });
      expect(planner?.planMigrations(rows, [...ledger("0001_first"), ...ledger("0001_first")])).toMatchObject({
        status: "MALFORMED_LEDGER",
      });
      expect(planner?.planMigrations(rows, ledger("0001_first", "0003_third"))).toMatchObject({
        status: "DRIFT", reason: "NON_PREFIX_LEDGER",
      });
    });

    it("rejects a candidate inventory that is not uniquely and lexically ordered", () => {
      expect(planner?.planMigrations([rows[1], rows[0]], ledger())).toMatchObject({ status: "DRIFT" });
      expect(planner?.planMigrations([rows[0], rows[0]], ledger())).toMatchObject({ status: "DRIFT" });
      expect(planner?.planMigrations([
        rows[0], { ...rows[1], filename: "0001_another.sql" },
      ], ledger())).toMatchObject({ status: "DRIFT" });
    });

    it("continues only the unapplied safe suffix after a checksum-proven partial run", () => {
      const safe = rows.slice(0, 2);
      const result = planner?.planMigrations(safe, ledger("0001_first"));
      expect(result).toEqual({ status: "READY", pending: [safe[1]] });
    });
  });
}
