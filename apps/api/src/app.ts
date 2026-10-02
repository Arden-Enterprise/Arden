import Fastify from "fastify";

export function buildApp(checkDatabase: () => Promise<void>) {
  const app = Fastify({ logger: true });

  app.get("/api/health/live", async () => ({ status: "ok" }));

  app.get("/api/health/ready", async (_request, reply) => {
    try {
      await checkDatabase();
      return { status: "ok" };
    } catch {
      reply.code(503);
      return { status: "unavailable" };
    }
  });

  return app;
}
