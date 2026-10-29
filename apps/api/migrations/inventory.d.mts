export type MigrationRollout = "expand" | "operator";

export interface MigrationInventoryEntry {
  id: string;
  filename: string;
  sha256: string;
  rollout: MigrationRollout;
}

export declare function migrationSqlChecksum(content: string | Uint8Array): string;

export declare function loadMigrationInventory(
  migrationDirectory: string,
  policyPath?: string,
): MigrationInventoryEntry[];

export declare function fingerprintMigrationInventory(
  entries: readonly MigrationInventoryEntry[],
): string;

export declare function assertSafeExpandMigrations(
  entries: readonly MigrationInventoryEntry[],
  migrationDirectory: string,
): void;

export declare function assertImmutableMigrationHistory(
  baseSha: string,
  options?: { repoRoot?: string; head?: string },
): void;
