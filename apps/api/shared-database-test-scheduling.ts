/**
 * Repository and target-reader integration tests share one migrated database.
 * Their cleanup takes SHARE ROW EXCLUSIVE locks while disabling user triggers,
 * and a concurrent insert, update, or delete takes ROW EXCLUSIVE. Those modes
 * conflict, and the two files lock tables in opposite orders, so overlapping
 * files deadlock. Ordinary API tests do not use that database and stay parallel.
 */
export function apiTestFilesRunInParallel(sharedDatabaseUrl: string | undefined): boolean {
  return !sharedDatabaseUrl;
}
