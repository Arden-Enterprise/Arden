import { describe, expect, it } from "vitest";
import { applicabilityStatus, emptyKnowledgeMetadata, isCalendarDate, metadataSubmissionErrors, validKnowledgeMetadata } from "./knowledge-metadata.js";
import { plainTextToSemanticDocument, semanticDocumentHasText } from "./semantic-document.js";

describe("business document metadata", () => {
  it("allows incomplete drafts but not incomplete submissions", () => {
    expect(validKnowledgeMetadata(emptyKnowledgeMetadata())).toBe(true);
    expect(metadataSubmissionErrors(emptyKnowledgeMetadata(), false)).toHaveLength(4);
  });
  it("validates calendar dates and the optional inclusive expiration date", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    const value = { ...emptyKnowledgeMetadata(), effectiveDate: "2026-11-12", expirationDate: "2026-11-11" };
    expect(validKnowledgeMetadata(value)).toBe(false);
    value.expirationDate = "2026-11-12";
    expect(validKnowledgeMetadata(value)).toBe(true);
    expect(applicabilityStatus(value, "2026-11-12")).toBe("Effective");
    expect(applicabilityStatus(value, "2026-11-13")).toBe("Expired");
    expect(applicabilityStatus(value, "2026-11-11")).toBe("Upcoming");
  });
  it("requires change notes only for updates and never invents legacy dates", () => {
    expect(metadataSubmissionErrors(emptyKnowledgeMetadata(), true)).toContain("Add a change note.");
    expect(metadataSubmissionErrors(emptyKnowledgeMetadata(), false)).not.toContain("Add a change note.");
    expect(applicabilityStatus(null, "2026-11-12")).toBeNull();
  });
  it("distinguishes empty editor structure and images from text-extractable content", () => {
    expect(semanticDocumentHasText(plainTextToSemanticDocument(" \n ", () => "empty"))).toBe(false);
    expect(semanticDocumentHasText(plainTextToSemanticDocument("A useful paragraph", () => "text"))).toBe(true);
    expect(semanticDocumentHasText({ schemaVersion: 1, blocks: [{ id: "asset", type: "asset",
      props: { assetVersionId: "source-image", label: "Not extracted text" }, content: [], children: [] }] })).toBe(false);
    expect(semanticDocumentHasText({ schemaVersion: 1, blocks: [{ id: "table", type: "table", props: { columns: 1 },
      children: [], content: [{ cells: [[{ type: "link", href: "https://example.test", content: [{ type: "text", text: "Reference", styles: {} }] }]] }] }] })).toBe(true);
  });
});
