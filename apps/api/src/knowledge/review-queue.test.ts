import { describe, expect, it } from "vitest";
import { listAssignedReviews, type ReviewQueueCandidate } from "./review-queue.js";
import type { MembershipActor } from "./policy.js";

const now = new Date("2026-10-11T10:00:00Z");
const reviewer: MembershipActor = { membershipId: "reviewer", organizationId: "org", status: "ACTIVE" };
const grant = {
  membershipId: "reviewer", organizationId: "org", departmentId: "engineering", status: "ACTIVE" as const,
  classifications: ["INTERNAL" as const], level: "STANDARD" as const,
  teamTag: null, projectTag: null, validFrom: new Date("2026-10-01T00:00:00Z"), validUntil: null,
};
const candidate: ReviewQueueCandidate = {
  submissionId: "submission-1", snapshotId: "snapshot-1", title: "Recovery guide",
  submittedAt: new Date("2026-10-10T12:00:00Z"),
  submission: {
    organizationId: "org", submittedByMembershipId: "author", departmentId: "engineering",
    status: "PENDING_REVIEW", classification: "INTERNAL", policyVersion: 1,
    teamTag: null, projectTag: null,
  },
  reviewerGrants: [grant], effectivePolicyVersion: 1, audienceEnforceable: true,
};

describe("listAssignedReviews", () => {
  it("returns only currently authorized pending submissions", () => {
    const result = listAssignedReviews({ actor: reviewer, now, candidates: [
      candidate,
      { ...candidate, submissionId: "self", submission: { ...candidate.submission, submittedByMembershipId: "reviewer" } },
      { ...candidate, submissionId: "other-org", submission: { ...candidate.submission, organizationId: "other" } },
      { ...candidate, submissionId: "other-dept", submission: { ...candidate.submission, departmentId: "hr" } },
      { ...candidate, submissionId: "finished", submission: { ...candidate.submission, status: "APPROVED" } },
      { ...candidate, submissionId: "stale-policy", effectivePolicyVersion: 2 },
      { ...candidate, submissionId: "revoked", reviewerGrants: [{ ...grant, status: "INACTIVE" }] },
      { ...candidate, submissionId: "expired", reviewerGrants: [{ ...grant, validUntil: now }] },
    ] });
    expect(result.map((item) => item.submissionId)).toEqual(["submission-1"]);
    expect(result[0]).toEqual({
      submissionId: "submission-1", snapshotId: "snapshot-1", title: "Recovery guide",
      departmentId: "engineering", classification: "INTERNAL", submittedAt: candidate.submittedAt,
      approvalBlocked: false,
    });
  });

  it("keeps an invalid-audience submission visible so the reviewer can request correction", () => {
    expect(listAssignedReviews({ actor: reviewer, now, candidates: [{ ...candidate, audienceEnforceable: false }] }))
      .toEqual([{ submissionId: "submission-1", snapshotId: "snapshot-1", title: "Recovery guide",
        departmentId: "engineering", classification: "INTERNAL", submittedAt: candidate.submittedAt,
        approvalBlocked: true }]);
  });

  it("accepts one matching live grant, including classification and attribute filters", () => {
    const matching = { ...grant, teamTag: "platform", classifications: ["CONFIDENTIAL" as const] };
    const item: ReviewQueueCandidate = {
      ...candidate,
      submission: { ...candidate.submission, classification: "CONFIDENTIAL", teamTag: "platform" },
      reviewerGrants: [{ ...grant, teamTag: "other" }, matching],
    };
    expect(listAssignedReviews({ actor: reviewer, now, candidates: [item] })).toHaveLength(1);
    expect(listAssignedReviews({ actor: reviewer, now, candidates: [{ ...item, reviewerGrants: [matching],
      submission: { ...item.submission, teamTag: "other" } }] })).toEqual([]);
  });

  it("requires a specialist or senior grant for restricted material", () => {
    const item: ReviewQueueCandidate = { ...candidate,
      submission: { ...candidate.submission, classification: "RESTRICTED" },
      reviewerGrants: [{ ...grant, classifications: ["RESTRICTED"], level: "STANDARD" }],
    };
    expect(listAssignedReviews({ actor: reviewer, now, candidates: [item] })).toEqual([]);
    expect(listAssignedReviews({ actor: reviewer, now, candidates: [{ ...item,
      reviewerGrants: [{ ...grant, classifications: ["RESTRICTED"], level: "SPECIALIST" }],
    }] })).toHaveLength(1);
  });

  it("fails closed for inactive actors and invalid queue data", () => {
    expect(listAssignedReviews({ actor: null, now, candidates: [candidate] })).toEqual([]);
    expect(listAssignedReviews({ actor: { ...reviewer, status: "SUSPENDED" }, now, candidates: [candidate] })).toEqual([]);
    expect(listAssignedReviews({ actor: reviewer, now: new Date(Number.NaN), candidates: [candidate] })).toEqual([]);
    expect(listAssignedReviews({ actor: reviewer, now, candidates: [{ ...candidate, submittedAt: new Date(Number.NaN) }] })).toEqual([]);
  });

  it("deduplicates join results after authorization and sorts newest first", () => {
    const older = { ...candidate, submissionId: "older", submittedAt: new Date("2026-10-09T12:00:00Z") };
    const result = listAssignedReviews({ actor: reviewer, now, candidates: [older, candidate, candidate] });
    expect(result.map((item) => item.submissionId)).toEqual(["submission-1", "older"]);
  });
});
