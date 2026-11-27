import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { AnalysisRejectedError, httpAnalysisAdapter } from "./analysis.js";

const token = "local-analysis-token";

describe("maintenance analysis HTTP contract", () => {
  it("posts the versioned request and reads the citation", async () => {
    let seen = "";
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        seen = `${request.method} ${request.url} ${request.headers.authorization === `Bearer ${token}`} ${Buffer.concat(chunks).toString("utf8")}`;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          contractVersion: 1,
          state: "succeeded",
          usageEvents: [],
          findings: [{ versionId: "78787878-7878-4787-8787-787878787878", summary: "The selected version was compared through the analysis service." }],
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing port");
    const result = await httpAnalysisAdapter(`http://127.0.0.1:${address.port}`, token)({
      contractVersion: 1,
      requestId: "42a9eb2e-efcc-4bc0-9d81-b8fc3eab6f01",
      caseId: "2787171f-9777-42c2-be47-40d538821eee",
      versionIds: ["78787878-7878-4787-8787-787878787878"],
    });
    server.close();
    expect(result.findings[0]?.summary).toBe("The selected version was compared through the analysis service.");
    expect(seen.startsWith("POST /v1/maintenance-analyses true")).toBe(true);
    expect(seen).toContain("\"contractVersion\":1");
  });

  it("sends bounded exact evidence in provider mode and rejects an invented citation", async () => {
    const versionId = "78787878-7878-4787-8787-787878787878";
    const text = "Restart the synthetic test client.";
    const textHash = createHash("sha256").update(text).digest("hex");
    const usageEvents = [{ eventId: "11111111-1111-4111-8111-111111111111", operation: "MAINTENANCE_ANALYSIS",
      provider: "OPENAI", model: "gpt-6-luna", inputTokens: 10, outputTokens: 4, latencyMs: 22, usageComplete: true }];
    const result = (quote: string) => Response.json({
      contractVersion: 2, state: "succeeded", usageContractVersion: 1, usageEvents,
      findings: [{ versionId, textHash, summary: "Mentions a restart.", quote }],
    });
    const network = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(result("Restart the synthetic test client."))
      .mockResolvedValueOnce(result("A passage outside the evidence."));
    try {
      const adapter = httpAnalysisAdapter("http://127.0.0.1:8096", token, "provider");
      const input = { contractVersion: 1 as const, requestId: "42a9eb2e-efcc-4bc0-9d81-b8fc3eab6f01",
        caseId: "2787171f-9777-42c2-be47-40d538821eee",
        versionIds: [versionId], sources: [{ versionId, text }] };
      await expect(adapter(input)).resolves.toMatchObject({ findings: [{ versionId }], usageEvents });
      const [url, options] = network.mock.calls[0]!;
      expect(String(url)).toBe("http://127.0.0.1:8096/v2/maintenance-analyses");
      expect(JSON.parse(String(options?.body))).toEqual({
        contractVersion: 2, requestId: input.requestId, caseId: input.caseId,
        sources: [{ versionId, text, textHash }],
      });
      // A rejected citation still carries the provider usage so the run's cost is not lost.
      const rejected = await adapter(input).catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(AnalysisRejectedError);
      expect((rejected as AnalysisRejectedError).usageEvents).toEqual(usageEvents);
      await expect(adapter({ ...input, sources: [{ versionId, text: "x".repeat(8_001) }] }))
        .rejects.toThrow("too large");
      expect(network).toHaveBeenCalledTimes(2);
    } finally {
      network.mockRestore();
    }
  });
});
