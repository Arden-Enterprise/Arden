import { describe, expect, it } from "vitest";
import { planReviewDecision, type ReviewDecisionFacts, type ReviewDecisionRequest } from "./review-decision.js";

const now = new Date("2026-10-11T10:00:00Z");
const hash = "a".repeat(64);
const grant = {
  membershipId: "reviewer", organizationId: "org", scope: "DEPARTMENT" as const,
  departmentId: "engineering", status: "ACTIVE" as const,
  classifications: ["INTERNAL" as const], level: "STANDARD" as const,
  teamTag: null, projectTag: null, validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null,
};
const facts: ReviewDecisionFacts = {
  actor: { membershipId: "reviewer", organizationId: "org", status: "ACTIVE" },
  submission: {
    submissionId: "submission", snapshotVersionId: "version-2", contentHash: hash,
    organizationId: "org", submittedByMembershipId: "author", departmentId: "engineering",
    status: "PENDING_REVIEW", classification: "INTERNAL", policyVersion: 1,
    teamTag: null, projectTag: null, audienceBreadth: "LIMITED", reviewRule: "GRANT_SCOPE",
  },
  reviewerGrants: [grant], effectivePolicyVersion: 1, audienceEnforceable: true,
  policy: { kind: "SINGLE_REVIEWER" }, now,
};
const request: ReviewDecisionRequest = {
  action: "APPROVE", expectedSnapshotVersionId: "version-2", expectedContentHash: hash, comment: null,
};

describe("planReviewDecision", () => {
  it("plans publication preparation only for an authorized final one-step approval", () => {
    expect(planReviewDecision(facts, request)).toEqual({
      kind: "APPROVE_FOR_PREPARATION", decision: "APPROVED", submissionId: "submission",
      snapshotVersionId: "version-2", contentHash: hash, comment: null, readers: null,
    });
  });

  it("lets a reviewer reject but not yet approve a reader-change or withdrawal request (T6.1)", () => {
    for (const requestType of ["READER_CHANGE", "WITHDRAWAL"] as const) {
      expect(planReviewDecision({ ...facts, requestType }, request)).toEqual({ kind: "DENIED", reason: "REQUEST_NOT_SUPPORTED" });
      expect(planReviewDecision({ ...facts, requestType }, { ...request, action: "REJECT", comment: "Keep it" }))
        .toMatchObject({ kind: "RECORD_ONLY", decision: "REJECTED" });
      // Authorization still comes first: an outsider learns nothing about the request type.
      expect(planReviewDecision({ ...facts, requestType, reviewerGrants: [] }, request)).toEqual({ kind: "DENIED", reason: "NOT_AUTHORIZED" });
    }
  });

  it("never publishes the wrong or corrupted snapshot", () => {
    expect(planReviewDecision(facts, { ...request, expectedSnapshotVersionId: "version-1" })).toEqual({ kind: "DENIED", reason: "STALE_SNAPSHOT" });
    expect(planReviewDecision(facts, { ...request, expectedContentHash: "b".repeat(64) })).toEqual({ kind: "DENIED", reason: "STALE_SNAPSHOT" });
    expect(planReviewDecision({ ...facts, submission: { ...facts.submission, contentHash: "invalid" } }, request))
      .toEqual({ kind: "DENIED", reason: "INVALID_SNAPSHOT" });
  });

  it("rechecks identity, active grant, department, policy and self-review", () => {
    const denied: ReviewDecisionFacts[] = [
      { ...facts, actor: { ...facts.actor!, status: "SUSPENDED" } },
      { ...facts, actor: { ...facts.actor!, membershipId: "author" } },
      { ...facts, reviewerGrants: [{ ...grant, status: "INACTIVE" }] },
      { ...facts, reviewerGrants: [{ ...grant, validUntil: now }] },
      { ...facts, reviewerGrants: [{ ...grant, departmentId: "other" }] },
      { ...facts, effectivePolicyVersion: 2 },
      { ...facts, submission: { ...facts.submission, status: "APPROVED" } },
    ];
    for (const item of denied) expect(planReviewDecision(item, request)).toEqual({ kind: "DENIED", reason: "NOT_AUTHORIZED" });
  });

  it("blocks approval for unenforceable audience or unsupported multi-step policy", () => {
    expect(planReviewDecision({ ...facts, audienceEnforceable: false }, request))
      .toEqual({ kind: "DENIED", reason: "AUDIENCE_NOT_ENFORCEABLE" });
    expect(planReviewDecision({ ...facts, policy: { kind: "UNSUPPORTED" } }, request))
      .toEqual({ kind: "DENIED", reason: "UNSUPPORTED_POLICY" });
  });

  it("allows rejection with a reason but never emits publication intent", () => {
    const blocked = { ...facts, audienceEnforceable: false };
    expect(planReviewDecision(blocked, { ...request, action: "REJECT", comment: "Not suitable" }))
      .toEqual({ kind: "RECORD_ONLY", decision: "REJECTED", comment: "Not suitable" });
    expect(planReviewDecision(blocked, { ...request, action: "REJECT", comment: "  " }))
      .toEqual({ kind: "DENIED", reason: "COMMENT_REQUIRED" });
  });

  it("allows Organization Admin self-approval without a reviewer grant", () => {
    const adminFacts: ReviewDecisionFacts = {
      ...facts,
      actor: { membershipId: "author", organizationId: "org", status: "ACTIVE", isOrganizationAdmin: true },
      reviewerGrants: [],
    };
    expect(planReviewDecision(adminFacts, request)).toMatchObject({
      kind: "APPROVE_FOR_PREPARATION", decision: "APPROVED",
    });
  });

  describe("approved Target Readers (T2.1)", () => {
    const proposed = { mode: "DEPARTMENT" as const, departmentId: "engineering", memberIds: [] };
    const readerFacts: ReviewDecisionFacts = { ...facts, readers: { proposed, facts: {
      organizationId: "org",
      departments: [{ departmentId: "engineering", organizationId: "org", status: "ACTIVE" }],
      members: ["a", "b", "outsider"].map((membershipId) => ({ membershipId, organizationId: "org",
        status: "ACTIVE" as const, accountActive: true,
        departmentIds: [membershipId === "outsider" ? "sales" : "engineering"] })),
    } } };

    it("approves as proposed, narrows, and refuses widening or invalid readers", () => {
      expect(planReviewDecision(readerFacts, request)).toMatchObject({ kind: "APPROVE_FOR_PREPARATION",
        readers: { proposed, approved: proposed, narrowed: false } });
      expect(planReviewDecision(readerFacts, { ...request, approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: ["b", "a"] } }))
        .toMatchObject({ kind: "APPROVE_FOR_PREPARATION", readers: { narrowed: true,
          approved: { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: ["b", "a"] } } });
      expect(planReviewDecision(readerFacts, { ...request, approvedReaders: { mode: "ORGANIZATION" } }))
        .toEqual({ kind: "DENIED", reason: "READERS_WIDENED" });
      expect(planReviewDecision(readerFacts, { ...request, approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: ["a", "outsider"] } }))
        .toEqual({ kind: "DENIED", reason: "READERS_WIDENED" });
      expect(planReviewDecision(readerFacts, { ...request, approvedReaders: { mode: "SELECTED_MEMBERS", memberIds: ["a", "a"] } }))
        .toMatchObject({ kind: "DENIED", reason: "INVALID_READERS", field: "approvedReaders.memberIds" });
    });

    it("refuses REJECT with approved readers, but still requires a reject comment", () => {
      const reject = { ...request, action: "REJECT" as const, comment: "Not suitable" };
      expect(planReviewDecision(readerFacts, { ...reject, approvedReaders: { mode: "ORGANIZATION" } }))
        .toEqual({ kind: "DENIED", reason: "INVALID_REQUEST" });
      expect(planReviewDecision(readerFacts, { ...reject, comment: " " })).toEqual({ kind: "DENIED", reason: "COMMENT_REQUIRED" });
      expect(planReviewDecision(readerFacts, reject)).toEqual({ kind: "RECORD_ONLY", decision: "REJECTED", comment: "Not suitable" });
    });

    it("refuses an unauthorized actor before any reader check", () => {
      const unauthorized = { ...readerFacts, reviewerGrants: [] };
      for (const approvedReaders of [{ mode: "ORGANIZATION" as const }, { mode: "SELECTED_MEMBERS" as const, memberIds: ["a"] }]) {
        expect(planReviewDecision(unauthorized, { ...request, approvedReaders })).toEqual({ kind: "DENIED", reason: "NOT_AUTHORIZED" });
        expect(planReviewDecision(unauthorized, { ...request, action: "REJECT", comment: "x", approvedReaders }))
          .toEqual({ kind: "DENIED", reason: "NOT_AUTHORIZED" });
      }
    });

    it("keeps legacy audience submissions unchanged and rejects readers on them", () => {
      expect(planReviewDecision(facts, request)).toMatchObject({ kind: "APPROVE_FOR_PREPARATION", readers: null });
      expect(planReviewDecision(facts, { ...request, approvedReaders: { mode: "ORGANIZATION" } }))
        .toEqual({ kind: "DENIED", reason: "READERS_NOT_SUPPORTED" });
    });
  });
});
