import type { PoolClient } from "pg";

export interface RenewalCandidateRow {
  documentId: string;
  publishedVersionId: string;
  ownerDepartmentId: string | null;
  expirationDate: string | null;
  governanceReaderMode: "ORGANIZATION" | "DEPARTMENT" | "SELECTED_MEMBERS";
  isAuthor: boolean;
  indexStatus: string;
}

function addUtcDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(year!, month! - 1, day! + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Computes Decision 0032 / migration 0068 `can_renew` eligibility for an exact set of
 * current publications without `list_publication_renewal_state()`'s 1,000-row cap.
 *
 * Mirrors `0068_expired_document_renewal.sql` (`list_publication_renewal_state`) 1:1:
 *   - `expirationDate` is non-null
 *   - no `PENDING_REVIEW` `RENEWAL` submission exists for `documentId`
 *   - caller is author, active Org Admin, or responsible reviewer (exact 0037 scope match)
 *   - caller is author OR author membership/account is inactive OR `expirationDate <= utcToday + 7`
 */
export async function computeCanRenewByDocument(
  client: PoolClient,
  input: {
    organizationId: string;
    actorMembershipId: string;
    isOrgAdmin: boolean;
    utcToday: string;
    candidates: readonly RenewalCandidateRow[];
    activeAuthorVersionIds: ReadonlySet<string>;
  },
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const expiringCandidates = input.candidates.filter((row) => row.expirationDate !== null);
  if (expiringCandidates.length === 0) return result;

  let hasOrgGrant = false;
  const deptGrantIds = new Set<string>();
  if (!input.isOrgAdmin) {
    const grantsResult = await client.query<{ scope: string; department_id: string | null }>(`
      SELECT g.scope, g.department_id
        FROM reviewer_grant g
       WHERE g.organization_id = $1
         AND g.reviewer_membership_id = $2
         AND g.status = 'ACTIVE'
         AND g.valid_from <= now()
         AND (g.valid_until IS NULL OR g.valid_until > now())`,
    [input.organizationId, input.actorMembershipId]);
    for (const grant of grantsResult.rows) {
      if (grant.scope === "ORGANIZATION") hasOrgGrant = true;
      else if (grant.scope === "DEPARTMENT" && grant.department_id) deptGrantIds.add(grant.department_id);
    }
  }

  const eligibleCandidates = expiringCandidates.filter((row) => {
    if (row.isAuthor || input.isOrgAdmin) return true;
    return row.governanceReaderMode === "ORGANIZATION"
      ? hasOrgGrant
      : row.ownerDepartmentId !== null && deptGrantIds.has(row.ownerDepartmentId);
  });
  if (eligibleCandidates.length === 0) return result;

  const utcTodayPlus7 = addUtcDays(input.utcToday, 7);
  const eligibleDocIds = [...new Set(eligibleCandidates.map((row) => row.documentId))];
  const pendingDocIds = new Set<string>();
  const adminAuthorActiveByVersion = new Map<string, boolean>();

  if (input.isOrgAdmin) {
    // Caller's active ORG_ADMIN role was already DB-verified in this transaction.
    // Scope the GUC strictly to this read-only renewal/author-activity lookup and reset immediately.
    await client.query("SELECT set_config('arden.org_admin', 'true', true)");
    try {
      const pendingResult = await client.query<{ shared_draft_id: string }>(`
        SELECT DISTINCT s.shared_draft_id
          FROM shared_submission s
         WHERE s.organization_id = $1
           AND s.shared_draft_id = ANY($2::uuid[])
           AND s.request_type = 'RENEWAL'
           AND s.status = 'PENDING_REVIEW'`,
      [input.organizationId, eligibleDocIds]);
      for (const row of pendingResult.rows) pendingDocIds.add(row.shared_draft_id);

      const needAuthorActiveVersionIds = [...new Set(
        eligibleCandidates
          .filter((row) => !row.isAuthor && row.expirationDate! > utcTodayPlus7)
          .map((row) => row.publishedVersionId),
      )];
      if (needAuthorActiveVersionIds.length > 0) {
        const activeResult = await client.query<{ published_version_id: string; author_active: boolean }>(`
          SELECT pv.published_version_id,
                 EXISTS (
                   SELECT 1
                     FROM organization_membership om
                     JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
                     JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
                    WHERE om.membership_id = COALESCE(pv.author_membership_id, sub.submitted_by_membership_id)
                      AND om.organization_id = $1
                      AND om.status = 'ACTIVE'
                 ) AS author_active
            FROM published_knowledge_version pv
            LEFT JOIN shared_submission sub ON sub.submission_id = pv.submission_id
           WHERE pv.published_version_id = ANY($2::uuid[])`,
        [input.organizationId, needAuthorActiveVersionIds]);
        for (const row of activeResult.rows) {
          adminAuthorActiveByVersion.set(row.published_version_id, row.author_active);
        }
      }
    } finally {
      await client.query("SELECT set_config('arden.org_admin', 'false', true)");
    }
  } else {
    const pendingResult = await client.query<{ shared_draft_id: string }>(`
      SELECT DISTINCT s.shared_draft_id
        FROM shared_submission s
       WHERE s.organization_id = $1
         AND s.shared_draft_id = ANY($2::uuid[])
         AND s.request_type = 'RENEWAL'
         AND s.status = 'PENDING_REVIEW'`,
    [input.organizationId, eligibleDocIds]);
    for (const row of pendingResult.rows) pendingDocIds.add(row.shared_draft_id);
  }

  for (const row of eligibleCandidates) {
    if (pendingDocIds.has(row.documentId)) {
      result.set(row.documentId, false);
      continue;
    }
    if (row.isAuthor || row.expirationDate! <= utcTodayPlus7) {
      result.set(row.documentId, true);
      continue;
    }
    const authorActive = input.isOrgAdmin
      ? (adminAuthorActiveByVersion.get(row.publishedVersionId) ?? true)
      : (row.indexStatus === "INDEXED" ? input.activeAuthorVersionIds.has(row.publishedVersionId) : true);
    result.set(row.documentId, !authorActive);
  }

  return result;
}
