import type { Pool } from "pg";
import { PgSystemAdministrationStore, type SystemAdministrationStore } from "../system-administration/store.js";
import { PgSystemConsoleStore, type SystemConsoleStore } from "../system-console/store.js";
import { SystemAuthDatabase } from "./database.js";
import { PgSystemAuthStore, type SystemAuthStore } from "./store.js";

/** Everything that reads `arden_system`; all of it shares the dedicated system-auth pool. */
export type SystemAdministrationServices = {
  auth: SystemAuthStore;
  console: SystemConsoleStore;
  administration: SystemAdministrationStore;
};

export function createSystemAdministrationServices(pool: Pool): SystemAdministrationServices {
  const database = new SystemAuthDatabase(pool);
  return {
    auth: new PgSystemAuthStore(database),
    console: new PgSystemConsoleStore(database),
    administration: new PgSystemAdministrationStore(database),
  };
}
