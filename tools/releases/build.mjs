import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";

const source = JSON.parse(execFileSync(process.execPath, ["tools/releases/release.mjs", "metadata"], { encoding: "utf8" }));
const temporary = process.env.RUNNER_TEMP;
if (!temporary || !isAbsolute(temporary) || !/^[0-9a-f]{40}$/.test(source.commit)
  || !/^[0-9a-f]{40}$/.test(source.tree) || !/^[0-9a-f]{64}$/.test(source.migrations)) {
  throw new Error("Invalid temporary build context");
}
const scanCache = join(temporary, "arden-trivy");
mkdirSync(scanCache, { recursive: true, mode: 0o700 });
const trivy = "aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c";
for (const component of ["api", "web"]) {
  const image = `arden-release-${component}:sha-${source.commit}`;
  execFileSync("docker", ["build", "--platform", "linux/amd64", "--file", "deploy/release/Dockerfile",
    "--target", component, "--build-arg", `REVISION=${source.commit}`, "--build-arg", `SOURCE_TREE=${source.tree}`,
    "--build-arg", `MIGRATIONS=${source.migrations}`, "--tag", image, "."], { stdio: "inherit", timeout: 20 * 60 * 1000 });
  execFileSync("docker", ["run", "--rm", "-v", "/var/run/docker.sock:/var/run/docker.sock",
    "-v", `${scanCache}:/root/.cache/`, trivy, "image", "--scanners", "vuln,secret", "--severity", "HIGH,CRITICAL",
    "--exit-code", "1", "--no-progress", image], { stdio: "inherit", timeout: 10 * 60 * 1000 });
}
execFileSync(process.execPath, ["tools/releases/release.mjs", "check-bundle"], { stdio: "inherit", timeout: 10 * 60 * 1000 });
execFileSync(process.execPath, ["tools/releases/smoke.mjs"], { stdio: "inherit", timeout: 5 * 60 * 1000 });
