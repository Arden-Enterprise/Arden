import { describe, expect, it } from "vitest";
import { answerMessage, starterPrompts } from "../src/ask-arden/askArdenModel";

describe("Ask Arden model", () => {
  it("keeps real citations navigable", () => {
    const message = answerMessage({ status: "ANSWERED", answer: "Use MFA.", citations: [{
      documentId: "document", versionId: "version", blockId: "mfa", excerpt: "Use MFA.",
      title: "Security", version: "v2", scope: "Company-wide", classification: "INTERNAL",
    }] }, "answer-1");
    expect(starterPrompts).toHaveLength(3);
    expect(message.citations?.[0]).toMatchObject({ versionId: "version", blockId: "mfa" });
    expect(message.insufficientEvidence).toBe(false);
  });

  it("marks an honest no-evidence response without inventing citations", () => {
    const message = answerMessage({ status: "INSUFFICIENT_EVIDENCE", answer: "Not enough evidence.", citations: [] }, "answer-2");
    expect(message.insufficientEvidence).toBe(true);
    expect(message.citations).toBeUndefined();
  });
});
