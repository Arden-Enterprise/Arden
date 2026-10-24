import { describe, expect, it } from "vitest";
import { matchesSampleKnowledge, sampleDocuments, samplePublications } from "../src/knowledge/KnowledgeLibrary";

describe("knowledge library search", () => {
  const workflow = sampleDocuments.find((document) => document.id === "knowledge-publication-workflow");

  it("matches governed metadata used by the search list", () => {
    expect(workflow).toBeDefined();
    expect(matchesSampleKnowledge(workflow!, "NSS-SOP-052")).toBe(true);
    expect(matchesSampleKnowledge(workflow!, "knowledge governance")).toBe(true);
    expect(matchesSampleKnowledge(workflow!, "indexed and active")).toBe(true);
  });

  it("does not match unrelated content", () => {
    expect(matchesSampleKnowledge(workflow!, "payroll reimbursement")).toBe(false);
  });

  it("keeps private and in-review samples out of shared search", () => {
    expect(samplePublications.every((document) => document.status === "Published" && document.scope !== "Private")).toBe(true);
    expect(samplePublications.some((document) => document.id === "incident-retrospective-18-sep")).toBe(false);
    expect(samplePublications.some((document) => document.id === "operations-ownership-handover")).toBe(false);
  });
});
