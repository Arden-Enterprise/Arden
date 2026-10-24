import { canRespondToSubmission, canReviewSnapshot, type MembershipActor } from "./policy.js";

type ReviewAuthorization = Parameters<typeof canReviewSnapshot>[0];
type ReviewerGrant = NonNullable<ReviewAuthorization["grant"]>;

export type ReviewAction = "APPROVE" | "REJECT";

// All fields except action, expectedSnapshotVersionId, expectedContentHash and
// comment must be resolved from the database inside the decision transaction.
export type ReviewDecisionFacts = {
  actor: MembershipActor | null;
  submission: ReviewAuthorization["submission"] & {
    submissionId: string;
    snapshotVersionId: string;
    contentHash: string;
  };
  reviewerGrants: readonly ReviewerGrant[];
  effectivePolicyVersion: number;
  audienceEnforceable: boolean;
  policy: { kind: "SINGLE_REVIEWER" } | { kind: "UNSUPPORTED" };
  now: Date;
};

export type ReviewDecisionRequest = {
  action: ReviewAction;
  expectedSnapshotVersionId: string;
  expectedContentHash: string;
  comment: string | null;
};

export type ReviewDecisionPlan =
  | { kind: "DENIED"; reason: "INVALID_SNAPSHOT" | "STALE_SNAPSHOT" | "NOT_AUTHORIZED" | "AUDIENCE_NOT_ENFORCEABLE" | "UNSUPPORTED_POLICY" | "COMMENT_REQUIRED" }
  | { kind: "RECORD_ONLY"; decision: "REJECTED"; comment: string }
  | { kind: "APPROVE_FOR_PREPARATION"; decision: "APPROVED"; submissionId: string; snapshotVersionId: string; contentHash: string; comment: string | null };

// This is a decision *plan*, not a database write. The caller must lock the
// submission, rehydrate these facts, then commit the decision, PREPARING state
// and audit evidence in one transaction. Index activation is a later pipeline.
export function planReviewDecision(facts: ReviewDecisionFacts, request: ReviewDecisionRequest): ReviewDecisionPlan {
  const { submission } = facts;
  if (!submission.submissionId || !submission.snapshotVersionId || !/^[0-9a-f]{64}$/.test(submission.contentHash)) {
    return { kind: "DENIED", reason: "INVALID_SNAPSHOT" };
  }
  if (request.expectedSnapshotVersionId !== submission.snapshotVersionId
    || request.expectedContentHash !== submission.contentHash) {
    return { kind: "DENIED", reason: "STALE_SNAPSHOT" };
  }
  const authorize = (grant: ReviewerGrant | null) => canRespondToSubmission({
    actor: facts.actor,
    submission,
    grant,
    now: facts.now,
    effectivePolicyVersion: facts.effectivePolicyVersion,
  });
  const authorized = facts.actor?.isOrganizationAdmin === true
    ? authorize(null)
    : facts.reviewerGrants.some(authorize);
  if (!authorized) return { kind: "DENIED", reason: "NOT_AUTHORIZED" };

  if (request.action === "REJECT") {
    const comment = request.comment?.trim() ?? "";
    if (!comment) return { kind: "DENIED", reason: "COMMENT_REQUIRED" };
    return { kind: "RECORD_ONLY", decision: "REJECTED", comment };
  }

  if (request.action !== "APPROVE" || facts.policy.kind !== "SINGLE_REVIEWER") {
    return { kind: "DENIED", reason: "UNSUPPORTED_POLICY" };
  }
  if (!facts.audienceEnforceable) return { kind: "DENIED", reason: "AUDIENCE_NOT_ENFORCEABLE" };
  const approveWith = (grant: ReviewerGrant | null) => canReviewSnapshot({
    actor: facts.actor,
    submission,
    grant,
    now: facts.now,
    effectivePolicyVersion: facts.effectivePolicyVersion,
    audienceEnforceable: facts.audienceEnforceable,
  });
  const canApprove = facts.actor?.isOrganizationAdmin === true
    ? approveWith(null)
    : facts.reviewerGrants.some(approveWith);
  if (!canApprove) return { kind: "DENIED", reason: "NOT_AUTHORIZED" };

  return {
    kind: "APPROVE_FOR_PREPARATION",
    decision: "APPROVED",
    submissionId: submission.submissionId,
    snapshotVersionId: submission.snapshotVersionId,
    contentHash: submission.contentHash,
    comment: request.comment?.trim() || null,
  };
}
