import { defineConfig } from "vitest/config";
import { apiTestFilesRunInParallel } from "./shared-database-test-scheduling.js";

const parallel = apiTestFilesRunInParallel(process.env.ARDEN_TEST_DATABASE_URL);

export default defineConfig({
  test: {
    // Vitest forces one worker when file parallelism is off, so cleanup in one
    // integration file cannot overlap another file's writes on the shared database.
    fileParallelism: parallel,
  },
});
