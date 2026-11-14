import { canRespondToSubmission, canReviewSnapshot, type MembershipActor } from "./policy.js";
import { resolveApprovedReaders, type ApprovedReadersField } from "../target-readers/narrowing.js";
import type { ReaderSelection, SelectionFacts, TargetReadersInput } from "../target-readers/policy.js";

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
  /**
   * T2.1: the readers frozen at submit and the facts needed to check approved readers. A submission
   * without proposed readers (legacy audience model) keeps today's behaviour. Omitted means legacy.
   */
  readers?: { proposed: ReaderSelection | null; facts: SelectionFacts };
  /** T6.1/T6.2: what the submission asks for. Omitted means CONTENT. */
  requestType?: "CONTENT" | "READER_CHANGE" | "WITHDRAWAL";
  /**
   * T6.2: for a change request, whether it still names the current publication and whether a newer approved
   * version is being prepared (which a withdrawal would race). Omitted for a change request refuses approval.
   */
  publicationChange?: { targetIsCurrent: boolean; newerVersionPreparing: boolean };
};

export type ReviewDecisionRequest = {
  action: ReviewAction;
  expectedSnapshotVersionId: string;
  expectedContentHash: string;
  comment: string | null;
  /** Approved Target Readers; absent approves exactly the proposed readers. */
  approvedReaders?: TargetReadersInput;
};

/** P and A for a Target Readers submission; null for a legacy audience submission. */
export type ApprovedReadersPlan = { proposed: ReaderSelection; approved: ReaderSelection; narrowed: boolean };

export type ReviewDecisionPlan =
  | { kind: "DENIED"; reason: "INVALID_SNAPSHOT" | "STALE_SNAPSHOT" | "NOT_AUTHORIZED" | "AUDIENCE_NOT_ENFORCEABLE"
      | "UNSUPPORTED_POLICY" | "COMMENT_REQUIRED" | "INVALID_REQUEST" | "READERS_NOT_SUPPORTED" | "READERS_WIDENED"
      | "PUBLICATION_CHANGED" }
  | { kind: "DENIED"; reason: "INVALID_READERS"; field: ApprovedReadersField; message: string }
  | { kind: "RECORD_ONLY"; decision: "REJECTED"; comment: string }
  | { kind: "APPROVE_FOR_PREPARATION"; decision: "APPROVED"; submissionId: string; snapshotVersionId: string;
      contentHash: string; comment: string | null; readers: ApprovedReadersPlan | null };

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

  // Reader checks run only after authorization, so an unauthorized caller learns nothing about readers.
  if (request.action === "REJECT") {
    if (request.approvedReaders !== undefined) return { kind: "DENIED", reason: "INVALID_REQUEST" };
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
  const requestType = facts.requestType ?? "CONTENT";
  if (requestType !== "CONTENT" && (!facts.publicationChange?.targetIsCurrent
    || (requestType === "WITHDRAWAL" && facts.publicationChange.newerVersionPreparing))) {
    return { kind: "DENIED", reason: "PUBLICATION_CHANGED" };
  }

  let readers: ApprovedReadersPlan | null = null;
  const proposed = facts.readers?.proposed ?? null;
  if (proposed === null) {
    if (request.approvedReaders !== undefined) return { kind: "DENIED", reason: "READERS_NOT_SUPPORTED" };
  } else {
    const resolved = resolveApprovedReaders(proposed, request.approvedReaders, facts.readers!.facts);
    if (!resolved.ok) {
      return resolved.reason === "INVALID_READERS"
        ? { kind: "DENIED", reason: "INVALID_READERS", field: resolved.field, message: resolved.message }
        : { kind: "DENIED", reason: "READERS_WIDENED" };
    }
    readers = { proposed, approved: resolved.selection, narrowed: resolved.narrowed };
  }

  return {
    kind: "APPROVE_FOR_PREPARATION",
    decision: "APPROVED",
    submissionId: submission.submissionId,
    snapshotVersionId: submission.snapshotVersionId,
    contentHash: submission.contentHash,
    comment: request.comment?.trim() || null,
    readers,
  };
}
