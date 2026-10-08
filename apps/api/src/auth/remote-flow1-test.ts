const remoteTestTarget = {
  slotId: "dev-2",
  databaseHost: "postgres",
  databaseName: "arden_dev_2",
} as const;

export const kietLocalFlow1TestActor = {
  userId: "44444444-4444-4444-8444-444444444444",
  email: "kiet-local@example.test",
  fullName: "Kiet Local Test Actor",
  emailVerified: true,
} as const;

export function isKietLocalFlow1TestTarget(
  databaseUrl: string,
  nodeEnvironment: string | undefined,
  supabaseConfigured: boolean,
): boolean {
  if (nodeEnvironment !== "development" || supabaseConfigured) return false;

  let database: URL;
  try { database = new URL(databaseUrl); }
  catch { return false; }
  let databaseName: string;
  try { databaseName = decodeURIComponent(database.pathname.slice(1)); }
  catch { return false; }
  return (database.protocol === "postgres:" || database.protocol === "postgresql:") &&
    database.hostname === remoteTestTarget.databaseHost && databaseName === remoteTestTarget.databaseName;
}
