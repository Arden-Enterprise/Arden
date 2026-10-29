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
      snapshotVersionId: "version-2", contentHash: hash, comment: null,
    });
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
});
