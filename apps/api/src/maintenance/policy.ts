import type { ActorRecord, CaseProjection, CaseRecord } from "./contracts.js";

export type CaseAccess = {
  hasGrant: boolean;
  isAdmin: boolean;
  canReadDocument: boolean;
};

/** Role-safe view. A reporter who lost the source sees only the case id and status. */
export function projectCase(row: CaseRecord, actor: ActorRecord, access: CaseAccess): CaseProjection | null {
  if (actor.organizationId !== row.organizationId) return null;
  if (row.reporterMembershipId === actor.membershipId) {
    if (!access.canReadDocument) return { kind: "minimal", caseId: row.caseId, reporterStatus: row.reporterStatus, unread: false };
    return {
      kind: "reporter", caseId: row.caseId, documentId: row.documentId, publishedVersionId: row.publishedVersionId,
      title: row.title, description: row.description, reporterStatus: row.reporterStatus,
      reporterExplanation: row.reporterExplanation, revision: row.revision, unread: false,
    };
  }
  const independent = actor.membershipId !== row.authorMembershipId && (access.hasGrant || access.isAdmin
    || row.assigneeMembershipId === actor.membershipId);
  if (!independent) return null;
  if (row.assigneeMembershipId !== actor.membershipId && !access.isAdmin) {
    return {
      kind: "queue", caseId: row.caseId, reporterStatus: row.reporterStatus, revision: row.revision,
      title: access.canReadDocument ? row.title : null, unread: false,
    };
  }
  return {
    kind: "assigned", caseId: row.caseId, documentId: row.documentId, publishedVersionId: row.publishedVersionId,
    title: row.title, description: row.description, reporterStatus: row.reporterStatus,
    reporterExplanation: row.reporterExplanation, reviewerRationale: row.reviewerRationale, revision: row.revision,
    assigneeMembershipId: row.assigneeMembershipId,
    canDecide: row.assigneeMembershipId === actor.membershipId && access.hasGrant,
    needsReassignment: row.assigneeMembershipId === actor.membershipId && !access.hasGrant,
    canReassign: access.isAdmin, unread: false,
    publicationLinkVersionId: row.publicationLinkVersionId,
    publicationLinkSubmissionId: row.publicationLinkSubmissionId,
  };
}
