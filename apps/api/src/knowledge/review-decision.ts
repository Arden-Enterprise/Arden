import { canRespondToSubmission, canReviewSnapshot, type MembershipActor } from "./policy.js";

type ReviewAuthorization = Parameters<typeof canReviewSnapshot>[0];
type ReviewerGrant = NonNullable<ReviewAuthorization["grant"]>;

export type ReviewAction = "APPROVE" | "REQUEST_REVISION" | "REJECT";

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
  | { kind: "RECORD_ONLY"; decision: "CHANGES_REQUESTED" | "REJECTED"; comment: string }
  | { kind: "APPROVE_AND_PUBLISH_ATOMICALLY"; decision: "APPROVED"; submissionId: string; snapshotVersionId: string; contentHash: string; comment: string | null };

// This is a decision *plan*, not a database write. The caller must lock the
// submission, rehydrate these facts, then commit decision + publication +
// current-version pointer + audit evidence in one transaction.
export function planReviewDecision(facts: ReviewDecisionFacts, request: ReviewDecisionRequest): ReviewDecisionPlan {
  const { submission } = facts;
  if (!submission.submissionId || !submission.snapshotVersionId || !/^[0-9a-f]{64}$/.test(submission.contentHash)) {
    return { kind: "DENIED", reason: "INVALID_SNAPSHOT" };
  }
  if (request.expectedSnapshotVersionId !== submission.snapshotVersionId
    || request.expectedContentHash !== submission.contentHash) {
    return { kind: "DENIED", reason: "STALE_SNAPSHOT" };
  }
  const authorized = facts.reviewerGrants.some((grant) => canRespondToSubmission({
    actor: facts.actor,
    submission,
    grant,
    now: facts.now,
    effectivePolicyVersion: facts.effectivePolicyVersion,
  }));
  if (!authorized) return { kind: "DENIED", reason: "NOT_AUTHORIZED" };

  if (request.action === "REQUEST_REVISION" || request.action === "REJECT") {
    const comment = request.comment?.trim() ?? "";
    if (!comment) return { kind: "DENIED", reason: "COMMENT_REQUIRED" };
    return { kind: "RECORD_ONLY", decision: request.action === "REQUEST_REVISION" ? "CHANGES_REQUESTED" : "REJECTED", comment };
  }

  if (request.action !== "APPROVE" || facts.policy.kind !== "SINGLE_REVIEWER") {
    return { kind: "DENIED", reason: "UNSUPPORTED_POLICY" };
  }
  if (!facts.audienceEnforceable) return { kind: "DENIED", reason: "AUDIENCE_NOT_ENFORCEABLE" };
  const canApprove = facts.reviewerGrants.some((grant) => canReviewSnapshot({
    actor: facts.actor,
    submission,
    grant,
    now: facts.now,
    effectivePolicyVersion: facts.effectivePolicyVersion,
    audienceEnforceable: facts.audienceEnforceable,
  }));
  if (!canApprove) return { kind: "DENIED", reason: "NOT_AUTHORIZED" };

  return {
    kind: "APPROVE_AND_PUBLISH_ATOMICALLY",
    decision: "APPROVED",
    submissionId: submission.submissionId,
    snapshotVersionId: submission.snapshotVersionId,
    contentHash: submission.contentHash,
    comment: request.comment?.trim() || null,
  };
}
