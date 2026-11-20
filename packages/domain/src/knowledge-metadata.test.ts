import { describe, expect, it } from "vitest";
import { validityStatus, emptyKnowledgeMetadata, isCalendarDate, metadataSubmissionErrors, validKnowledgeMetadata } from "./knowledge-metadata.js";
import { plainTextToSemanticDocument, semanticDocumentHasText } from "./semantic-document.js";

describe("business document metadata", () => {
  it("allows incomplete drafts but not incomplete submissions", () => {
    expect(validKnowledgeMetadata(emptyKnowledgeMetadata())).toBe(true);
    expect(metadataSubmissionErrors(emptyKnowledgeMetadata(), false)).toEqual(["Choose a type.", "Enter a version."]);
    expect(metadataSubmissionErrors(emptyKnowledgeMetadata(), false)).not.toContain("Choose an effective date.");
  });
  it("validates the current Topic-free fields without mutating legacy input", () => {
    const value = { ...emptyKnowledgeMetadata(), type: "Guide" as const, version: "1.0" };
    expect(metadataSubmissionErrors(value, false)).toEqual([]);
    const legacy = { ...value, topicId: "00000000-0000-0000-0000-000000000001" };
    expect(metadataSubmissionErrors(legacy, false)).toEqual([]);
    expect(legacy.topicId).toBe("00000000-0000-0000-0000-000000000001");
    expect(validKnowledgeMetadata(value)).toBe(true);
    expect(metadataSubmissionErrors(value, true)).toEqual(["Add a change note."]);
  });
  it("validates calendar dates and the optional inclusive expiration date", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    const value = { ...emptyKnowledgeMetadata(), effectiveDate: "2026-11-12", expirationDate: "2026-11-11" };
    expect(validKnowledgeMetadata(value)).toBe(false);
    value.expirationDate = "2026-11-12";
    expect(validKnowledgeMetadata(value)).toBe(true);
    expect(validityStatus(value, "2026-11-12")).toEqual({ status: "Expiring soon", daysLeft: 0 });
    expect(validityStatus(value, "2026-11-13")).toEqual({ status: "Expired", daysLeft: 0 });
    expect(validityStatus(value, "2026-11-11").status).toBe("Upcoming");
  });
  it("requires change notes only for updates and never invents legacy dates", () => {
    expect(metadataSubmissionErrors(emptyKnowledgeMetadata(), true)).toContain("Add a change note.");
    expect(metadataSubmissionErrors(emptyKnowledgeMetadata(), false)).not.toContain("Add a change note.");
    expect(validityStatus(null, "2026-11-12")).toEqual({ status: "Current", daysLeft: null });
  });
  it("is in force from approval and warns 30 days before the optional expiration", () => {
    const value = { ...emptyKnowledgeMetadata(), expirationDate: "2026-12-31" };
    expect(validityStatus(value, "2026-11-15")).toEqual({ status: "Current", daysLeft: 46 });
    expect(validityStatus(value, "2026-12-01")).toEqual({ status: "Expiring soon", daysLeft: 30 });
    expect(validityStatus({ ...value, expirationDate: null }, "2030-01-01")).toEqual({ status: "Current", daysLeft: null });
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
