import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { SystemConsoleQuery, SystemConsoleReportKind, SystemConsoleStore } from "./store.js";
import { SystemConsoleError } from "./store.js";

type ActorResolver = (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>;
type HealthProbe = () => Promise<{ auth: { status: string; latencyMs: number | null };
  ardenAi: { status: string; latencyMs: number | null } }>;

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

export function registerSystemConsoleRoutes(app: FastifyInstance, store: SystemConsoleStore | undefined,
  actor: ActorResolver, uuid: string, probeHealth: HealthProbe) {
  const run = async (request: FastifyRequest, reply: FastifyReply,
    kind: SystemConsoleReportKind, query: Omit<SystemConsoleQuery, "kind">) => {
    const session = await actor(request, reply);
    if (!session) return;
    reply.header("Cache-Control", "no-store");
    if (!store) return reply.code(503).send({ error: { code: "SYSTEM_CONSOLE_UNAVAILABLE",
      message: "System Console is unavailable." } });
    try {
      const started = performance.now();
      const report = await store.report(session.userId, { ...query, kind });
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
  app.get<{ Querystring: { from?: string; to?: string; search?: string; status?: string; page?: number; pageSize?: number; organizationId?: string };
      Params: { organizationId: string } }>(path, { schema: {
        querystring: querySchema,
        ...(organization ? { params: { type: "object", additionalProperties: false, required: ["organizationId"],
          properties: { organizationId: { type: "string", pattern: uuid } } } } : {}),
      } }, (request, reply) => {
        const now = new Date();
        const to = parseDate(request.query.to, now);
        const from = parseDate(request.query.from, new Date(now.valueOf() - 30 * 24 * 60 * 60 * 1000));
        if (!from || !to || from >= to || to.valueOf() - from.valueOf() > 366 * 24 * 60 * 60 * 1000) {
          return reply.code(400).send({ error: { code: "INVALID_REPORT_RANGE", message: "Choose a valid range of at most one year." } });
        }
        const query: Omit<SystemConsoleQuery, "kind"> = { from, to,
          ...(request.query.search ? { search: request.query.search.trim() } : {}),
          ...(request.query.status ? { status: request.query.status } : {}),
          page: request.query.page ?? 1, pageSize: request.query.pageSize ?? 25,
          ...(request.query.organizationId ? { organizationId: request.query.organizationId } : {}),
          ...(organization ? { organizationId: request.params.organizationId } : {}),
        };
        return run(request, reply, kind, query);
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
}
