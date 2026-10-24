import { describe, expect, it } from "vitest";
import { AiAnswerContractError, parseAiAnswerResponse, type AiAnswerRequest } from "./contracts.js";

const request: AiAnswerRequest = {
  contractVersion: 1,
  requestId: "10000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  query: "MFA",
  allowedGenerationIds: ["10000000-0000-4000-8000-000000000003"],
};

function answer() {
  return {
    contractVersion: 1,
    requestId: request.requestId,
    status: "ANSWERED",
    answer: "Use MFA.",
    citations: [{
      generationId: request.allowedGenerationIds[0],
      snapshotVersionId: "10000000-0000-4000-8000-000000000004",
      snapshotContentHash: "a".repeat(64),
      chunkId: "b".repeat(64),
      sourceBlockIds: ["mfa"],
      parentSectionBlockId: null,
      excerpt: "Use MFA.",
    }],
  };
}

describe("Arden-AI answer contract", () => {
  it("accepts a bounded exact response", () => {
    expect(parseAiAnswerResponse(answer(), request).citations[0]?.sourceBlockIds).toEqual(["mfa"]);
  });

  it("rejects unknown fields and ungrounded answered responses", () => {
    expect(() => parseAiAnswerResponse({ ...answer(), unexpected: true }, request)).toThrow(AiAnswerContractError);
    expect(() => parseAiAnswerResponse({ ...answer(), citations: [] }, request)).toThrow(AiAnswerContractError);
  });

  it("accepts an honest no-evidence response", () => {
    expect(parseAiAnswerResponse({ ...answer(), status: "INSUFFICIENT_EVIDENCE", citations: [] }, request).status)
      .toBe("INSUFFICIENT_EVIDENCE");
  });
});
