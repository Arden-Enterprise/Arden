import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function requestAudience(request) {
  const digest = createHash("sha256").update(JSON.stringify(canonical(request))).digest("hex");
  return `https://ardenai.tech/releases/${request.environment}/${request.op}/${digest}`;
}

export async function requestIdentity(env, request, fetcher = fetch) {
  const endpoint = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
  if (endpoint.protocol !== "https:" || !endpoint.hostname.endsWith(".actions.githubusercontent.com")
    || endpoint.username || endpoint.password || endpoint.hash || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    || /[\r\n]/.test(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN)) throw new Error("Trusted runner identity endpoint is unavailable");
  endpoint.searchParams.set("audience", requestAudience(request));
  const response = await fetcher(endpoint, { headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body) throw new Error("GitHub job identity is unavailable");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) { await reader.cancel(); throw new Error("Job identity response exceeds limit"); }
    chunks.push(Buffer.from(value));
  }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof result.value !== "string" || result.value.length > 12288
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(result.value)) throw new Error("Invalid job identity response");
  return result.value;
}
