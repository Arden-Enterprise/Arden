import { createHash } from "node:crypto";

export type AnalysisState = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export const maintenanceSourceTextLimit = 8_000;

export type AnalysisFinding = {
  versionId: string;
  summary: string;
};

export type AnalysisRequest = {
  contractVersion: 1;
  caseId: string;
  versionIds: string[];
  sources?: { versionId: string; text: string }[];
};

export type AnalysisResult = {
  contractVersion: 1;
  state: "succeeded";
  findings: AnalysisFinding[];
};

export type AnalysisRun = {
  runId: string;
  state: AnalysisState;
  findings: AnalysisFinding[];
  versionIds: string[];
  startedByMembershipId: string;
  fence: string | null;
  attempt: number;
};

export type AnalysisAdapter = (request: AnalysisRequest) => Promise<AnalysisResult>;

/** Posts the versioned maintenance contract to Arden-AI. The token and response body are not logged. */
export function httpAnalysisAdapter(baseUrl: string, serviceToken: string, mode: "controlled" | "provider" = "controlled"): AnalysisAdapter {
  return async (request) => {
    const provider = mode === "provider";
    const sources = provider ? request.sources?.map(({ versionId, text }) => ({
      versionId, text, textHash: createHash("sha256").update(text).digest("hex"),
    })) : undefined;
    if (provider && (!sources || sources.length !== request.versionIds.length
      || sources.some((source, index) => source.versionId !== request.versionIds[index]
        || !source.text.trim() || source.text.length > maintenanceSourceTextLimit))) {
      throw new Error("Maintenance analysis evidence is unavailable or too large.");
    }
    const body = provider
      ? { contractVersion: 2, caseId: request.caseId, sources }
      : { contractVersion: 1, caseId: request.caseId, versionIds: request.versionIds };
    const response = await fetch(new URL(provider ? "/v2/maintenance-analyses" : "/v1/maintenance-analyses", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(27_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Maintenance analysis is unavailable.");
    const result = await response.json() as { contractVersion?: unknown; state?: unknown; findings?: unknown };
    if (result.contractVersion !== body.contractVersion || result.state !== "succeeded" || !Array.isArray(result.findings)
      || result.findings.length < 1 || result.findings.length > 4) {
      throw new Error("Maintenance analysis returned an invalid result.");
    }
    return {
      contractVersion: 1,
      state: "succeeded",
      findings: result.findings.map((item) => {
        const finding = item as { versionId?: unknown; summary?: unknown; textHash?: unknown; quote?: unknown };
        if (typeof finding?.versionId !== "string" || typeof finding.summary !== "string") {
          throw new Error("Maintenance analysis returned an invalid finding.");
        }
        if (sources) {
          const source = sources.find((entry) => entry.versionId === finding.versionId);
          if (!source || source.textHash !== finding.textHash || typeof finding.quote !== "string"
            || !finding.quote.trim() || finding.quote.length > 240 || !source.text.includes(finding.quote)) {
            throw new Error("Maintenance analysis returned an invalid citation.");
          }
        }
        return { versionId: finding.versionId, summary: finding.summary };
      }),
    };
  };
}

/** Controlled stand-in for the versioned Arden-AI maintenance contract. It does not call a provider. */
export const controlledAnalysisAdapter: AnalysisAdapter = async (request) => ({
  contractVersion: 1,
  state: "succeeded",
  findings: request.versionIds.slice(0, 4).map((versionId) => ({
    versionId,
    summary: "The selected version was compared with the reported evidence.",
  })),
});
