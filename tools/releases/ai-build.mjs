import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const aiTree = execFileSync("git", ["rev-parse", "HEAD:services/ai"], { encoding: "utf8" }).trim();
const temporary = process.env.RUNNER_TEMP;
if (!temporary || !isAbsolute(temporary) || !/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(aiTree)) {
  throw new Error("Invalid temporary AI build context");
}

const scanCache = join(temporary, "arden-ai-trivy");
mkdirSync(scanCache, { recursive: true, mode: 0o700 });
const trivy = "aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c";
const image = `arden-release-ai:sha-${commit}`;

execFileSync(
  "docker",
  [
    "build",
    "--platform", "linux/amd64",
    "--file", "services/ai/Dockerfile",
    "--target", "ai",
    "--build-arg", `REVISION=${commit}`,
    "--build-arg", `AI_TREE=${aiTree}`,
    "--tag", image,
    "services/ai",
  ],
  { stdio: "inherit", timeout: 20 * 60 * 1000 },
);

execFileSync(
  "docker",
  [
    "run", "--rm",
    "-v", "/var/run/docker.sock:/var/run/docker.sock",
    "-v", `${scanCache}:/root/.cache/`,
    trivy,
    "image",
    "--scanners", "vuln,secret",
    "--severity", "HIGH,CRITICAL",
    "--exit-code", "1",
    "--no-progress",
    image,
  ],
  { stdio: "inherit", timeout: 10 * 60 * 1000 },
);

execFileSync(process.execPath, ["tools/releases/ai-smoke.mjs"], { stdio: "inherit", timeout: 5 * 60 * 1000 });
