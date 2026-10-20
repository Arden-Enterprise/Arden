import { describe, expect, it } from "vitest";
import { draftStatus, validatePdfFile } from "../src/knowledge/knowledgeStatus";
import type { KnowledgeDraftSummary, KnowledgeSubmission } from "../src/shared/api-client";

const draft: KnowledgeDraftSummary = {
  id: "draft", organizationId: "org", title: "Guide", classification: "INTERNAL",
  responsibleDepartmentId: null, targetScopeType: null, teamTag: null, projectTag: null,
  audienceIds: [], versionId: "version-2", mimeType: "application/pdf", contentHash: "hash",
  currentVersion: 2, hasPendingSubmission: false, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z",
};
const submission: KnowledgeSubmission = {
  id: "submission", draftId: "draft", snapshotVersionId: "version-2", title: "Guide",
  classification: "INTERNAL", responsibleDepartmentId: "dept", targetScopeType: "DEPARTMENT",
  targetDepartmentId: "dept", audienceIds: ["audience"], contentHash: "hash", status: "APPROVED",
  submittedAt: "2026-10-02T00:00:00Z", publishedVersionId: "published", decisionComment: null,
};

describe("redesigned knowledge states", () => {
  it("rejects non-PDF, empty and oversized local files before upload", () => {
    expect(validatePdfFile(null)).toContain("Choose a PDF file");
    expect(validatePdfFile({ name: "notes.txt", type: "text/plain", size: 100 })).toContain("Other formats");
    expect(validatePdfFile({ name: "empty.pdf", type: "application/pdf", size: 0 })).toContain("empty");
    expect(validatePdfFile({ name: "large.pdf", type: "application/pdf", size: 5 * 1024 * 1024 + 1 })).toContain("limit is 5 MB");
    expect(validatePdfFile({ name: "guide.pdf", type: "application/pdf", size: 1024 })).toBe("");
  });

  it("distinguishes a published snapshot from a later working version", () => {
    expect(draftStatus(draft).label).toBe("Draft · metadata incomplete");
    expect(draftStatus({ ...draft, responsibleDepartmentId: "dept" }).label).toBe("Draft · metadata incomplete");
    expect(draftStatus({ ...draft, responsibleDepartmentId: "dept", targetScopeType: "DEPARTMENT", audienceIds: ["audience"] }).label).toBe("Draft");
    expect(draftStatus({ ...draft, hasPendingSubmission: true }, submission).label).toBe("Awaiting review");
    expect(draftStatus(draft, submission).label).toBe("Published");
    expect(draftStatus({ ...draft, versionId: "version-3" }, submission).label).toBe("Edited after publication");
    expect(draftStatus(draft, { ...submission, status: "CHANGES_REQUESTED" }).label).toBe("Revision requested");
    expect(draftStatus(draft, { ...submission, status: "REJECTED" }).tone).toBe("is-danger");
  });
});
