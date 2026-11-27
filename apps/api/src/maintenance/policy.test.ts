import { describe, expect, it } from "vitest";
import type { ActorRecord, CaseRecord } from "./contracts.js";
import { projectCase } from "./policy.js";

const actor: ActorRecord = { userId: "user", organizationId: "org", membershipId: "reporter" };
const row: CaseRecord = {
  caseId: "case", organizationId: "org", origin: "READER_REPORT", reporterMembershipId: "reporter",
  documentId: "doc", publishedVersionId: "ver", contentHash: "a".repeat(64), title: "IT Support Guide",
  description: "The restart step is wrong.", anchorPage: 3, anchorPassage: null, routeDepartmentId: "dept",
  classification: "INTERNAL", teamTag: null, projectTag: null, authorMembershipId: "author",
  assigneeMembershipId: null, reporterStatus: "Submitted", outcome: null, reporterExplanation: null,
  reviewerRationale: null, publicationLinkVersionId: null, publicationLinkSubmissionId: null,
  publicationLinkReason: null, revision: 1,
  firstClaimedAt: null, createdAt: "2026-11-17T00:00:00.000Z", resolvedAt: null,
};

describe("maintenance projections", () => {
  it("hides the document from a reporter who lost source access", () => {
    expect(projectCase(row, actor, { hasGrant: false, isAdmin: false, canReadDocument: false })).toEqual({
      kind: "minimal", caseId: "case", reporterStatus: "Submitted", unread: false,
    });
  });

  it("keeps the reviewer rationale off the reporter view", () => {
    const resolved = { ...row, reporterStatus: "Resolved" as const, outcome: "NO_CHANGE_NEEDED" as const,
      reporterExplanation: "The published step is still correct.", reviewerRationale: "Checked the source note.",
      assigneeMembershipId: "reviewer", revision: 2 };
    const view = projectCase(resolved, actor, { hasGrant: false, isAdmin: false, canReadDocument: true });
    expect(view?.kind).toBe("reporter");
    expect(view).not.toHaveProperty("reviewerRationale");
  });

  it("gives an unmatched member no projection", () => {
    expect(projectCase(row, { ...actor, membershipId: "peer" }, { hasGrant: false, isAdmin: false, canReadDocument: true })).toBeNull();
  });

  it("keeps only queue facts for an assignee who lost the grant", () => {
    const assigned = { ...row, assigneeMembershipId: "reviewer", reporterStatus: "In Progress" as const, revision: 2 };
    const view = projectCase(assigned, { ...actor, membershipId: "reviewer" }, { hasGrant: false, isAdmin: false, canReadDocument: true });
    expect(view).toMatchObject({ kind: "queue", documentId: "doc", needsReassignment: true, title: "IT Support Guide" });
    expect(view).not.toHaveProperty("description");
    expect(view).not.toHaveProperty("reviewerRationale");
  });

  it("includes documentId in the queue view only when the reviewer can read the document", () => {
    const readable = projectCase(row, { ...actor, membershipId: "reviewer" }, { hasGrant: true, isAdmin: false, canReadDocument: true });
    expect(readable).toMatchObject({ kind: "queue", documentId: "doc", title: "IT Support Guide" });

    const unreadable = projectCase(row, { ...actor, membershipId: "reviewer" }, { hasGrant: true, isAdmin: false, canReadDocument: false });
    expect(unreadable).toMatchObject({ kind: "queue", title: null });
    expect(unreadable).not.toHaveProperty("documentId");
  });
});
