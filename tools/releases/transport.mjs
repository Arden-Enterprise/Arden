import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";

export async function exchange(child, request, archive, timeoutMs = 20 * 60 * 1000) {
  let output = "";
  let oversized = false;
  let input;
  const completion = new Promise((accept, reject) => {
    child.on("error", () => reject(new Error("Restricted transport could not start")));
    child.on("close", code => {
      try {
        if (oversized || code !== 0) throw new Error("Transport failed");
        const value = JSON.parse(output);
        if (value.ok !== true) throw new Error("Receiver rejected the operation");
        accept(value.result);
      } catch { reject(new Error("Restricted release request failed; inspect status before retrying")); }
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
  } catch {
    child.kill("SIGKILL");
    input?.destroy();
    child.stdin?.destroy();
    await Promise.allSettled([feed, completion]);
    throw new Error("Release transport failed; reconcile receiver status before another deployment");
  } finally { clearTimeout(timer); }
}
