import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SystemActor, SystemActorResolver } from "../system-auth/routes.js";
import type { SystemConsoleQuery, SystemConsoleReportKind, SystemConsoleStore } from "./store.js";
import { SystemConsoleError } from "./store.js";

const dayMs = 24 * 60 * 60 * 1000;

/* ---------- Sanitized dependency health probes ---------- */

export type DependencyHealth = { status: "ok" | "unavailable" | "not_configured"; latencyMs: number | null };
export type SystemHealthProbe = () => Promise<{ auth: DependencyHealth; ardenAi: DependencyHealth }>;

export type SystemHealthConfiguration = {
  supabaseUrl?: string | undefined;
  ardenAiUrl?: string | undefined;
  ardenAiServiceToken?: string | undefined;
};

/** Resolves `path` under the configured base, keeping any path prefix (a reverse-proxy mount). */
export function dependencyProbeUrl(baseUrl: string, path: string): URL | null {
  const base = new URL(baseUrl);
  if (!(base.protocol === "https:" || base.protocol === "http:") || base.username || base.password) return null;
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname = `${base.pathname}/`;
  return new URL(path.replace(/^\/+/, ""), base);
}

export async function probeSystemDependency(baseUrl: string | undefined, path: string,
  headers?: Record<string, string>): Promise<DependencyHealth> {
  if (!baseUrl?.trim()) return { status: "not_configured", latencyMs: null };
  const startedAt = Date.now();
  try {
    const target = dependencyProbeUrl(baseUrl, path);
    if (!target) return { status: "unavailable", latencyMs: null };
    // Never follow a redirect: the Arden-AI probe carries a bearer token.
    const response = await fetch(target, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(1_500) });
    await response.body?.cancel().catch(() => undefined);
    return { status: response.ok ? "ok" : "unavailable", latencyMs: Date.now() - startedAt };
  } catch {
    return { status: "unavailable", latencyMs: Date.now() - startedAt };
  }
}

export function createSystemHealthProbe(configuration: SystemHealthConfiguration): SystemHealthProbe {
  return async () => {
    const [auth, ardenAi] = await Promise.all([
      probeSystemDependency(configuration.supabaseUrl, "/auth/v1/health"),
      probeSystemDependency(configuration.ardenAiUrl, "/health/ready", configuration.ardenAiServiceToken
        ? { authorization: `Bearer ${configuration.ardenAiServiceToken}` } : undefined),
    ]);
    return { auth, ardenAi };
  };
}

function failure(reply: FastifyReply, error: unknown) {
  if (!(error instanceof SystemConsoleError)) throw error;
  return reply.code(404).send({ error: { code: error.code, message: "The resource is not available." } });
}

function parseDate(value: unknown, fallback: Date) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length > 40) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

type ReportQuerystring = { from?: string; to?: string; search?: string; status?: string; page?: number;
  pageSize?: number; organizationId?: string };

export function registerSystemConsoleRoutes(app: FastifyInstance, store: SystemConsoleStore | undefined,
  resolveActor: SystemActorResolver, uuid: string, probeHealth: SystemHealthProbe) {
  const actors = new WeakMap<FastifyRequest, SystemActor>();

  const run = async (reply: FastifyReply, actor: SystemActor,
    kind: SystemConsoleReportKind, query: Omit<SystemConsoleQuery, "kind">) => {
    if (!store) return reply.code(503).send({ error: { code: "SYSTEM_CONSOLE_UNAVAILABLE",
      message: "System Console is unavailable." } });
    try {
      const started = performance.now();
      const report = await store.report(actor, { ...query, kind });
      if (kind !== "HEALTH") return report;
      const databaseLatencyMs = Math.max(0, Math.round(performance.now() - started));
      return { ...report,
        database: { status: "ok", latencyMs: databaseLatencyMs },
        ...await probeHealth(),
      };
    } catch (error) { return failure(reply, error); }
  };

  const querySchema = { type: "object", additionalProperties: false, properties: {
    from: { type: "string", maxLength: 40 }, to: { type: "string", maxLength: 40 },
    organizationId: { type: "string", pattern: uuid },
    search: { type: "string", maxLength: 120 }, status: { type: "string", enum: ["ACTIVE", "SUSPENDED", "ARCHIVED"] },
    page: { type: "integer", minimum: 1, maximum: 100000 }, pageSize: { type: "integer", minimum: 1, maximum: 50 },
  } };
  const registerReport = (path: string, kind: SystemConsoleReportKind, organization = false) => {
    app.get<{ Querystring: ReportQuerystring; Params: { organizationId: string } }>(path, {
      // Authenticate before schema validation: an unauthenticated caller gets the same 404 for
      // every input, and every response (including a 400) is already marked no-store.
      onRequest: async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const actor = await resolveActor(request, reply);
        if (!actor) return reply;
        actors.set(request, actor);
      },
      schema: {
        querystring: querySchema,
        ...(organization ? { params: { type: "object", additionalProperties: false, required: ["organizationId"],
          properties: { organizationId: { type: "string", pattern: uuid } } } } : {}),
      },
    }, (request, reply) => {
      const actor = actors.get(request);
      if (!actor) return reply;
      const now = new Date();
      const to = parseDate(request.query.to, now);
      const from = parseDate(request.query.from, new Date(now.valueOf() - 30 * dayMs));
      if (!from || !to || from >= to || to.valueOf() - from.valueOf() > 366 * dayMs) {
        return reply.code(400).send({ error: { code: "INVALID_REPORT_RANGE", message: "Choose a valid range of at most one year." } });
      }
      const query: Omit<SystemConsoleQuery, "kind"> = { from, to,
        ...(request.query.search ? { search: request.query.search.trim() } : {}),
        ...(request.query.status ? { status: request.query.status } : {}),
        page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 25,
        ...(request.query.organizationId ? { organizationId: request.query.organizationId } : {}),
        ...(organization ? { organizationId: request.params.organizationId } : {}),
      };
      return run(reply, actor, kind, query);
    });
  };

  registerReport("/api/v1/system/overview", "OVERVIEW");
  registerReport("/api/v1/system/organizations", "ORGANIZATIONS");
  registerReport("/api/v1/system/organizations/:organizationId", "ORGANIZATION", true);
  registerReport("/api/v1/system/reports/knowledge", "KNOWLEDGE");
  registerReport("/api/v1/system/reports/ai-usage", "AI_USAGE");
  registerReport("/api/v1/system/reports/contributions", "CONTRIBUTIONS");
  registerReport("/api/v1/system/reports/feedback", "FEEDBACK");
  registerReport("/api/v1/system/reports/quality", "QUALITY");
  registerReport("/api/v1/system/health", "HEALTH");
  // Private Notes answer ratings are read-only aggregates, so INSTANCE_ADMIN is sufficient.
  registerReport("/api/v1/system/analytics/private-feedback", "PRIVATE_FEEDBACK");
}
