import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

const migrationStatuses = new Set(["NO_PENDING", "READY", "REQUIRES_OPERATOR", "DRIFT",
  "BACKUP_NOT_READY", "BASELINE_REQUIRED", "OUTCOME_UNKNOWN", "STALE_RUN"]);
const receiverErrors = new Set(["invalid_request", "release_failed"]);

function migrationBlock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== ["error", "migration_ids", "ok", "status"].sort().join("\0")
    || value.ok !== false || value.error !== "migration_blocked" || !migrationStatuses.has(value.status)
    || value.status === "READY" || value.status === "NO_PENDING"
    || !Array.isArray(value.migration_ids) || value.migration_ids.length > 1000
    || value.migration_ids.some(id => typeof id !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(id))
    || new Set(value.migration_ids).size !== value.migration_ids.length
    || (value.status === "NO_PENDING" && value.migration_ids.length !== 0)) return null;
  const error = new Error(`Migration plan blocked: ${value.status}`
    + (value.migration_ids.length ? ` (${value.migration_ids.join(", ")})` : ""));
  error.code = "ARDEN_MIGRATION_BLOCKED";
  error.status = value.status;
  error.migrationIds = value.migration_ids;
  return error;
}

function receiverFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== ["error", "ok"].sort().join("\0")
    || value.ok !== false || !receiverErrors.has(value.error)) return null;
  const error = new Error(`Release receiver rejected the request (${value.error}); inspect receiver status before retrying`);
  error.code = "ARDEN_RECEIVER_REJECTED";
  error.receiverCode = value.error;
  return error;
}

export async function exchange(child, request, archive, timeoutMs = 20 * 60 * 1000) {
  let output = "";
  let oversized = false;
  let input;
  const completion = new Promise((accept, reject) => {
    child.on("error", () => reject(new Error("Restricted transport could not start")));
    child.on("close", code => {
      if (oversized) { reject(new Error("Restricted release request failed; inspect status before retrying")); return; }
      let value;
      try { value = JSON.parse(output); }
      catch { reject(new Error("Restricted release request failed; inspect status before retrying")); return; }
      if (code === 0 && value?.ok === true && Object.hasOwn(value, "result")) {
        accept(value.result);
        return;
      }
      reject(migrationBlock(value) ?? receiverFailure(value)
        ?? new Error("Restricted release request failed; inspect status before retrying"));
    });
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  const feed = (async () => {
    if (!child.stdin || !child.stdout || !child.stderr) throw new Error("Transport pipes are unavailable");
    child.stdout.on("data", chunk => {
      output += chunk.toString("utf8");
      if (output.length > 65536) { oversized = true; child.kill("SIGKILL"); }
    });
    child.stderr.resume();
    child.stdin.on("error", () => undefined); // Completion still reports the failure.
    child.stdin.write(JSON.stringify(request) + "\n");
    if (archive) {
      input = createReadStream(archive);
      await pipeline(input, child.stdin);
    } else child.stdin.end();
  })();
  try {
    const [, value] = await Promise.all([feed, completion]);
    return value;
  } catch (error) {
    child.kill("SIGKILL");
    input?.destroy();
    child.stdin?.destroy();
    await Promise.allSettled([feed, completion]);
    if (["ARDEN_MIGRATION_BLOCKED", "ARDEN_RECEIVER_REJECTED"].includes(error?.code)) throw error;
    throw new Error("Release transport failed; reconcile receiver status before another deployment");
  } finally { clearTimeout(timer); }
}
