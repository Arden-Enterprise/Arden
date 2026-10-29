export type MigrationRollout = "expand" | "operator";

export type MigrationInventoryEntry = {
  id: string;
  filename: string;
  sha256: string;
  rollout: MigrationRollout;
};

export type MigrationLedgerRow = {
  migration_id: string;
  checksum: string | null;
};

export type MigrationPlanStatus =
  | "READY"
  | "NO_PENDING"
  | "REQUIRES_OPERATOR"
  | "BASELINE_REQUIRED"
  | "DRIFT"
  | "MALFORMED_LEDGER";

export type MigrationPlan = {
  status: MigrationPlanStatus;
  pending: MigrationInventoryEntry[];
  reason?: string;
};

function isMigrationId(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}_[a-z0-9_]+$/.test(value);
}

function isInventoryEntry(value: unknown): value is MigrationInventoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MigrationInventoryEntry>;
  return typeof entry.id === "string" && /^\d{4}$/.test(entry.id)
    && typeof entry.filename === "string" && new RegExp(`^${entry.id}_[a-z0-9_]+\\.sql$`).test(entry.filename)
    && typeof entry.sha256 === "string"
    && /^[0-9a-f]{64}$/.test(entry.sha256)
    && (entry.rollout === "expand" || entry.rollout === "operator");
}

function failure(status: MigrationPlanStatus, reason: string): MigrationPlan {
  return { status, pending: [], reason };
}

/**
 * Compare one candidate image's immutable migration inventory to one database's
 * migration ledger. The function has no I/O so every release path can apply the
 * same fail-closed decision before touching a database.
 */
export function planMigrations(
  inventory: MigrationInventoryEntry[],
  ledgerRows: MigrationLedgerRow[],
): MigrationPlan {
  if (!Array.isArray(inventory) || inventory.length === 0 || !inventory.every(isInventoryEntry)) {
    return failure("DRIFT", "INVALID_INVENTORY");
  }

  const inventoryIds = inventory.map((entry) => entry.filename.slice(0, -4));
  const sequenceIds = inventory.map((entry) => entry.id);
  if (new Set(inventoryIds).size !== inventoryIds.length
    || new Set(sequenceIds).size !== sequenceIds.length
    || inventoryIds.some((id, index) => index > 0 && inventoryIds[index - 1]! >= id)) {
    return failure("DRIFT", "INVALID_INVENTORY_ORDER");
  }

  if (!Array.isArray(ledgerRows)) return failure("MALFORMED_LEDGER", "INVALID_LEDGER");
  const known = new Map(inventory.map((entry) => [entry.filename.slice(0, -4), entry]));
  const appliedIds = new Set<string>();

  for (const row of ledgerRows) {
    if (!row || typeof row !== "object" || !isMigrationId(row.migration_id)
      || (row.checksum !== null && row.checksum !== undefined
        && (typeof row.checksum !== "string" || !/^[0-9a-f]{64}$/.test(row.checksum)))) {
      return failure("MALFORMED_LEDGER", "INVALID_LEDGER_ROW");
    }
    if (appliedIds.has(row.migration_id)) return failure("MALFORMED_LEDGER", "DUPLICATE_LEDGER_ID");
    appliedIds.add(row.migration_id);

    const candidate = known.get(row.migration_id);
    if (!candidate) return failure("DRIFT", "UNKNOWN_APPLIED_ID");
    if (row.checksum === null || row.checksum === undefined) {
      return failure("BASELINE_REQUIRED", "CHECKSUM_MISSING");
    }
    if (row.checksum !== candidate.sha256) return failure("DRIFT", "CHECKSUM_MISMATCH");
  }

  const pending = inventory.filter((entry) => !appliedIds.has(entry.filename.slice(0, -4)));
  const appliedOrdered = inventory.filter((entry) => appliedIds.has(entry.filename.slice(0, -4)));
  if (appliedOrdered.some((entry, index) => entry !== inventory[index])) {
    return failure("DRIFT", "NON_PREFIX_LEDGER");
  }
  if (pending.length === 0) return { status: "NO_PENDING", pending: [] };
  if (pending.some((entry) => entry.rollout !== "expand")) {
    return { status: "REQUIRES_OPERATOR", pending, reason: "OPERATOR_MIGRATION_PENDING" };
  }
  return { status: "READY", pending };
}
