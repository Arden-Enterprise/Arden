import { canRespondToSubmission, canReviewSnapshot, type MembershipActor } from "./policy.js";

type ReviewAuthorization = Parameters<typeof canReviewSnapshot>[0];
type ReviewerGrant = NonNullable<ReviewAuthorization["grant"]>;

// Candidates and grants must be loaded from current server-side database state.
// A request body must never supply any of these authorization facts.
export type ReviewQueueCandidate = {
  submissionId: string;
  snapshotId: string;
  title: string;
  submittedAt: Date;
  submission: ReviewAuthorization["submission"];
  reviewerGrants: readonly ReviewerGrant[];
  effectivePolicyVersion: number;
  audienceEnforceable: boolean;
};

export type AssignedReview = {
  submissionId: string;
  snapshotId: string;
  title: string;
  departmentId: string;
  classification: ReviewAuthorization["submission"]["classification"];
  submittedAt: Date;
  approvalBlocked: boolean;
};

export function listAssignedReviews(input: {
  actor: MembershipActor | null;
  now: Date;
  candidates: readonly ReviewQueueCandidate[];
}): AssignedReview[] {
  if (!input.actor || input.actor.status !== "ACTIVE" || !Number.isFinite(input.now.getTime())) return [];

  const seen = new Set<string>();
  const assigned: AssignedReview[] = [];
  for (const candidate of input.candidates) {
    if (!candidate.submissionId || !candidate.snapshotId || !candidate.title.trim()
      || !Number.isFinite(candidate.submittedAt.getTime()) || seen.has(candidate.submissionId)) continue;

    const authorize = (grant: ReviewerGrant | null) => canRespondToSubmission({
      actor: input.actor,
      submission: candidate.submission,
      grant,
      now: input.now,
      effectivePolicyVersion: candidate.effectivePolicyVersion,
    });
    const authorized = input.actor.isOrganizationAdmin === true
      ? authorize(null)
      : candidate.reviewerGrants.some(authorize);
    if (!authorized) continue;

    seen.add(candidate.submissionId);
    assigned.push({
      submissionId: candidate.submissionId,
      snapshotId: candidate.snapshotId,
      title: candidate.title,
      departmentId: candidate.submission.departmentId,
      classification: candidate.submission.classification,
      submittedAt: candidate.submittedAt,
      approvalBlocked: !candidate.audienceEnforceable,
    });
  }

  return assigned.sort((left, right) => right.submittedAt.getTime() - left.submittedAt.getTime()
    || left.submissionId.localeCompare(right.submissionId));
}
