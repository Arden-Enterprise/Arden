import type { PoolClient } from "pg";
import type {
  ActorRecord, AnchorRecord, CaseEventRecord, CaseRecord, NotificationRecord, PublicationProof, PublicationSubmission,
} from "./contracts.js";
import { publicationProofFromPointer, type PublicationPointer } from "./publication-proof.js";
import type { AnalysisFinding, AnalysisRun, AnalysisState } from "./analysis.js";
import type { MaintenancePort, MaintenanceTx } from "./case-service.js";
import type { ProviderUsageEvent } from "../answers/usage-contracts.js";
import { insertAiUsageEvents } from "../db/ai-usage.js";
import { visibleVersionText } from "./version-text.js";

type MemberTransaction = <T>(userId: string, organizationId: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;

type CaseRow = {
  id: string; organization_id: string; origin: CaseRecord["origin"]; reporter_id: string | null;
  document_id: string; published_version_id: string; content_hash: string; title: string; description: string;
  anchor_page: number | null; anchor_passage: string | null; review_department_id: string;
  classification: CaseRecord["classification"];
  author_id: string; assignee_id: string | null; reporter_status: CaseRecord["reporterStatus"];
  outcome: CaseRecord["outcome"]; reporter_explanation: string | null; reviewer_rationale: string | null;
  remedy_version_id: string | null; remedy_request_id: string | null; remedy_reason: string | null;
  revision: number; first_claimed_at: Date | null; created_at: Date; resolved_at: Date | null;
};

type AnalysisRow = {
  run_id: string; state: AnalysisState; findings: AnalysisFinding[]; version_ids: string[];
  started_by_membership_id: string | null; fence: string | null; attempt: number;
};

function mapAnalysis(row: AnalysisRow): AnalysisRun {
  return {
    runId: row.run_id, state: row.state, findings: row.findings ?? [], versionIds: row.version_ids ?? [],
    startedByMembershipId: row.started_by_membership_id ?? "", fence: row.fence, attempt: row.attempt,
  };
}

function mapCase(row: CaseRow): CaseRecord {
  return {
    caseId: row.id, organizationId: row.organization_id, origin: row.origin,
    reporterMembershipId: row.reporter_id, documentId: row.document_id,
    publishedVersionId: row.published_version_id, contentHash: row.content_hash, title: row.title,
    description: row.description, anchorPage: row.anchor_page, anchorPassage: row.anchor_passage,
    routeDepartmentId: row.review_department_id, classification: row.classification, authorMembershipId: row.author_id,
    assigneeMembershipId: row.assignee_id, reporterStatus: row.reporter_status, outcome: row.outcome,
    reporterExplanation: row.reporter_explanation, reviewerRationale: row.reviewer_rationale,
    publicationLinkVersionId: row.remedy_version_id, publicationLinkSubmissionId: row.remedy_request_id,
    publicationLinkReason: row.remedy_reason,
    revision: row.revision,
    firstClaimedAt: row.first_claimed_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  };
}

const caseColumns = `id, organization_id, origin, reporter_id, document_id, published_version_id,
  content_hash, title, description, anchor_page, anchor_passage, review_department_id, classification, author_id, assignee_id, reporter_status, outcome, reporter_explanation,
  reviewer_rationale, remedy_version_id, remedy_request_id, remedy_reason, revision, first_claimed_at, created_at, resolved_at`;

export type VersionContentReader = {
  read(sourceUri: string, expectedHash: string): Promise<string>;
  readPdf?(sourceUri: string, expectedHash: string): Promise<Buffer>;
};

const maxMaintenancePdfBytes = 5 * 1024 * 1024;
const pdfMagicHeader = Buffer.from("%PDF-");

export class PgMaintenanceStore implements MaintenancePort {
  constructor(private readonly withMember: MemberTransaction, private readonly content?: VersionContentReader) {}

  transaction<T>(userId: string, organizationId: string, work: (tx: MaintenanceTx) => Promise<T>): Promise<T> {
    return this.withMember(userId, organizationId, async (client) => {
      const admin = await client.query<{ ok: boolean }>(
        `SELECT maintenance_actor_is_admin($1) AS ok`, [organizationId]);
      await client.query(`SELECT set_config('arden.org_admin', $1, true)`, [admin.rows[0]?.ok ? "true" : "false"]);
      return work(new PgMaintenanceTx(client, organizationId, this.content));
    });
  }
}

class PgMaintenanceTx implements MaintenanceTx {
  constructor(private readonly client: PoolClient, private readonly organizationId: string,
    private readonly content?: VersionContentReader) {}

  async actor(): Promise<ActorRecord | null> {
    const result = await this.client.query<{ membership_id: string; user_id: string; organization_id: string }>(`
      SELECT om.id AS membership_id, om.account_id AS user_id, om.organization_id
        FROM membership om
        JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
       WHERE om.organization_id = $1 AND om.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'`, [this.organizationId]);
    const row = result.rows[0];
    return row ? { userId: row.user_id, organizationId: row.organization_id, membershipId: row.membership_id } : null;
  }

  async readAnchor(documentId: string, publishedVersionId: string): Promise<AnchorRecord | null> {
    const result = await this.client.query<{
      organization_id: string; document_id: string; published_version_id: string; content_hash: string; title: string;
      classification: AnchorRecord["classification"]; responsible_department_id: string; author_membership_id: string;
    }>(`
      SELECT cp.organization_id, pv.document_id AS document_id, pv.id AS published_version_id, pv.content_hash, pv.title,
             pv.classification, pv.owner_department_id AS responsible_department_id, pv.author_id AS author_membership_id
        FROM published_version pv
        JOIN current_publication cp ON cp.published_version_id = pv.id
       WHERE pv.id = $1 AND pv.document_id = $2 AND cp.organization_id = $3`,
    [publishedVersionId, documentId, this.organizationId]);
    const row = result.rows[0];
    if (!row?.classification || !row.responsible_department_id) return null;
    return {
      organizationId: row.organization_id, documentId: row.document_id, publishedVersionId: row.published_version_id,
      contentHash: row.content_hash, title: row.title, classification: row.classification,
      departmentId: row.responsible_department_id,
      authorMembershipId: row.author_membership_id,
    };
  }

  async canReadDocument(documentId: string): Promise<boolean> {
    // Runs under the caller's publication RLS: true only when they can read the document's current publication.
    const result = await this.client.query(`SELECT 1 FROM current_publication cp
      JOIN published_version pv ON pv.id = cp.published_version_id
      WHERE cp.document_id = $1 AND cp.organization_id = $2`, [documentId, this.organizationId]);
    return (result.rowCount ?? 0) > 0;
  }

  async hasReviewerGrant(publishedVersionId: string): Promise<boolean> {
    const result = await this.client.query<{ ok: boolean }>(
      `SELECT maintenance_actor_can_review_version($1) AS ok`, [publishedVersionId]);
    return Boolean(result.rows[0]?.ok);
  }

  async isAdmin(): Promise<boolean> {
    const result = await this.client.query<{ ok: boolean }>(`SELECT maintenance_actor_is_admin($1) AS ok`, [this.organizationId]);
    return Boolean(result.rows[0]?.ok);
  }

  async lockRequest(membershipId: string, requestKey: string): Promise<void> {
    await this.client.query(`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      concat_ws(':', 'maintenance-request', $1::uuid::text, $2::uuid::text, $3::uuid::text), 0))`,
    [this.organizationId, membershipId, requestKey]);
  }

  async lockCasePair(caseId: string, relatedCaseId: string): Promise<void> {
    const [left, right] = [caseId.toLowerCase(), relatedCaseId.toLowerCase()].sort();
    await this.client.query(`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      concat_ws(':', 'maintenance-link', $1::uuid::text, $2::uuid::text, $3::uuid::text), 0))`,
    [this.organizationId, left, right]);
  }

  async lockDocument(documentId: string): Promise<boolean> {
    const result = await this.client.query<{ ok: boolean }>(`SELECT maintenance_lock_document($1) AS ok`, [documentId]);
    return Boolean(result.rows[0]?.ok);
  }

  async idempotency(membershipId: string, requestKey: string) {
    const result = await this.client.query<{ payload_hash: string; case_id: string }>(`
      SELECT payload_hash, case_id FROM case_intake_key
       WHERE organization_id = $1 AND actor_id = $2 AND idempotency_key = $3`,
    [this.organizationId, membershipId, requestKey]);
    const row = result.rows[0];
    return row ? { payloadHash: row.payload_hash, caseId: row.case_id } : null;
  }

  async saveIdempotency(membershipId: string, requestKey: string, payloadHash: string, caseId: string) {
    await this.client.query(`INSERT INTO case_intake_key
      (organization_id, actor_id, idempotency_key, payload_hash, case_id)
      VALUES ($1, $2, $3, $4, $5)`, [this.organizationId, membershipId, requestKey, payloadHash, caseId]);
  }

  async insertCase(row: CaseRecord) {
    await this.client.query(`INSERT INTO maintenance_case (${caseColumns}) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [row.caseId, row.organizationId, row.origin, row.reporterMembershipId, row.documentId, row.publishedVersionId,
      row.contentHash, row.title, row.description, row.anchorPage, row.anchorPassage, row.routeDepartmentId,
      row.classification, row.authorMembershipId, row.assigneeMembershipId,
      row.reporterStatus, row.outcome, row.reporterExplanation, row.reviewerRationale,
      row.publicationLinkVersionId, row.publicationLinkSubmissionId, row.publicationLinkReason, row.revision,
      row.firstClaimedAt, row.createdAt, row.resolvedAt]);
  }

  async lockCase(caseId: string): Promise<CaseRecord | null> {
    const result = await this.client.query<CaseRow>(`SELECT ${caseColumns} FROM maintenance_case
      WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [caseId, this.organizationId]);
    const row = result.rows[0];
    return row ? mapCase(row) : null;
  }

  async listCases(): Promise<CaseRecord[]> {
    const result = await this.client.query<CaseRow>(`SELECT ${caseColumns} FROM maintenance_case
      WHERE organization_id = $1 ORDER BY created_at, id`, [this.organizationId]);
    return result.rows.map(mapCase);
  }

  async nextSequence(caseId: string): Promise<number> {
    const result = await this.client.query<{ sequence: string }>(
      `SELECT maintenance_next_event_sequence($1) AS sequence`, [caseId]);
    return Number(result.rows[0]?.sequence ?? 1);
  }

  async insertEvent(event: CaseEventRecord) {
    await this.client.query(`INSERT INTO case_event
      (id, organization_id, case_id, sequence, actor_id, event_type, visibility, message, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [event.eventId, event.organizationId, event.caseId, event.sequence, event.actorMembershipId,
      event.eventType, event.audience, event.message, event.occurredAt]);
  }

  async listEvents(caseId: string, afterSequence: number, limit: number): Promise<CaseEventRecord[]> {
    const result = await this.client.query<{
      event_id: string; organization_id: string; case_id: string; sequence: string; actor_membership_id: string | null;
      event_type: CaseEventRecord["eventType"]; audience: CaseEventRecord["audience"]; message: string; occurred_at: Date;
    }>(`SELECT id AS event_id, organization_id, case_id, sequence, actor_id AS actor_membership_id, event_type, visibility AS audience, message, occurred_at
      FROM case_event WHERE case_id = $1 AND organization_id = $2 AND sequence > $3
      ORDER BY sequence LIMIT $4`, [caseId, this.organizationId, afterSequence, limit]);
    return result.rows.map((row) => ({
      eventId: row.event_id, organizationId: row.organization_id, caseId: row.case_id, sequence: Number(row.sequence),
      actorMembershipId: row.actor_membership_id, eventType: row.event_type, audience: row.audience,
      message: row.message, occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async saveCase(row: CaseRecord) {
    await this.client.query(`UPDATE maintenance_case SET assignee_id = $3, reporter_status = $4,
      outcome = $5, reporter_explanation = $6, reviewer_rationale = $7, remedy_version_id = $8,
      remedy_request_id = $9, remedy_reason = $10, revision = $11, first_claimed_at = $12,
      resolved_at = $13 WHERE id = $1 AND organization_id = $2`,
    [row.caseId, row.organizationId, row.assigneeMembershipId, row.reporterStatus, row.outcome,
      row.reporterExplanation, row.reviewerRationale, row.publicationLinkVersionId, row.publicationLinkSubmissionId,
      row.publicationLinkReason, row.revision, row.firstClaimedAt, row.resolvedAt]);
  }

  async insertNotification(notice: NotificationRecord) {
    await this.client.query(`SELECT enqueue_maintenance_case_notice($1,$2,$3,$4,$5)`,
      [notice.notificationId, notice.caseId, notice.recipientMembershipId, notice.logicalKey, notice.message]);
  }


  async eligibleReviewers(row: CaseRecord): Promise<Array<{ membershipId: string; displayName: string }>> {
    const result = await this.client.query<{ membership_id: string; display_name: string }>(
      `SELECT membership_id, display_name FROM list_maintenance_eligible_reviewers($1)`, [row.publishedVersionId]);
    return result.rows.map((item) => ({ membershipId: item.membership_id, displayName: item.display_name }));
  }

  async membershipHasGrant(membershipId: string, row: CaseRecord): Promise<boolean> {
    const result = await this.client.query<{ ok: boolean }>(
      `SELECT maintenance_membership_can_review_version($1, $2) AS ok`, [membershipId, row.publishedVersionId]);
    return Boolean(result.rows[0]?.ok);
  }

  async lockReaderIntake(documentId: string, reporterMembershipId: string): Promise<void> {
    await this.client.query(`SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      concat_ws(':', 'maintenance-reader-intake', $1::uuid::text, $2::uuid::text, $3::uuid::text), 0))`,
    [this.organizationId, documentId, reporterMembershipId]);
  }

  async hasOpenReaderReport(documentId: string, reporterMembershipId: string): Promise<boolean> {
    const result = await this.client.query<{ has_open: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM maintenance_case
      WHERE organization_id = $1 AND document_id = $2 AND reporter_id = $3
        AND origin = 'READER_REPORT' AND reporter_status <> 'Resolved'
    ) AS has_open`,
    [this.organizationId, documentId, reporterMembershipId]);
    return result.rows[0]?.has_open ?? false;
  }

  async hasUnread(membershipId: string, caseId: string): Promise<boolean> {
    const result = await this.client.query(`SELECT 1 FROM notification
      WHERE organization_id = $1 AND resource_id = $2 AND recipient_id = $3
        AND event_type = 'MAINTENANCE_CASE_UPDATED' AND read_at IS NULL LIMIT 1`,
    [this.organizationId, caseId, membershipId]);
    return (result.rowCount ?? 0) > 0;
  }

  async readVersionText(publishedVersionId: string): Promise<{ documentId: string; text: string | null } | null> {
    const result = await this.client.query<{ document_id: string; content_uri: string; content_hash: string; mime_type: string }>(
      `SELECT document_id, content_uri, content_hash, mime_type FROM maintenance_version_source($1)`, [publishedVersionId]);
    const row = result.rows[0];
    if (!row || !this.content || row.mime_type === "application/pdf") return row ? { documentId: row.document_id, text: null } : null;
    try {
      const body = await this.content.read(row.content_uri, row.content_hash);
      return { documentId: row.document_id, text: visibleVersionText(body, row.mime_type) };
    } catch {
      return { documentId: row.document_id, text: null };
    }
  }

  async readVersionOriginal(publishedVersionId: string): Promise<
    { documentId: string; text: string | null; mimeType?: string; pdfBase64?: string | null } | null
  > {
    const result = await this.client.query<{ document_id: string; content_uri: string; content_hash: string; mime_type: string }>(
      `SELECT document_id, content_uri, content_hash, mime_type FROM maintenance_version_source($1)`, [publishedVersionId]);
    const row = result.rows[0];
    if (!row) return null;
    if (row.mime_type === "application/pdf") {
      if (!this.content?.readPdf) return { documentId: row.document_id, text: null };
      try {
        const bytes = await this.content.readPdf(row.content_uri, row.content_hash);
        if (bytes.length === 0 || bytes.length > maxMaintenancePdfBytes || !bytes.subarray(0, 5).equals(pdfMagicHeader)) {
          return { documentId: row.document_id, text: null };
        }
        return { documentId: row.document_id, mimeType: "application/pdf", pdfBase64: bytes.toString("base64"), text: null };
      } catch {
        return { documentId: row.document_id, text: null };
      }
    }
    if (!this.content) return { documentId: row.document_id, text: null };
    try {
      const body = await this.content.read(row.content_uri, row.content_hash);
      return { documentId: row.document_id, mimeType: row.mime_type, text: visibleVersionText(body, row.mime_type) };
    } catch {
      return { documentId: row.document_id, text: null };
    }
  }

  async listDocumentVersions(documentId: string, pinnedVersionId: string): Promise<Array<{ publishedVersionId: string; versionNo: number; publishedAt: string; current: boolean }>> {
    const result = await this.client.query<{ published_version_id: string; version_no: number; published_at: Date; is_current: boolean }>(
      `SELECT published_version_id, version_no, published_at, is_current FROM list_maintenance_document_versions($1, $2)`,
      [documentId, pinnedVersionId]);
    return result.rows.map((row) => ({
      publishedVersionId: row.published_version_id, versionNo: row.version_no,
      publishedAt: row.published_at.toISOString(), current: row.is_current,
    }));
  }

  async readPublicationSubmission(submissionId: string): Promise<PublicationSubmission | null> {
    const result = await this.client.query<{
      document_id: string; request_type: PublicationSubmission["requestType"]; status: string;
      produced_version_id: string | null; target_published_version_id: string | null; withdrawn: boolean;
    }>(`
      SELECT s.document_id AS document_id, s.request_type, s.status, s.target_published_version_id,
             (SELECT pv.id AS published_version_id FROM published_version pv
               WHERE pv.review_submission_id = s.id ORDER BY pv.version_no DESC LIMIT 1) AS produced_version_id,
             s.publication_state = 'WITHDRAWN' AS withdrawn
        FROM review_submission s
       WHERE s.id = $1 AND s.organization_id = $2`, [submissionId, this.organizationId]);
    const row = result.rows[0];
    return row ? {
      documentId: row.document_id, requestType: row.request_type, status: row.status,
      producedVersionId: row.produced_version_id, targetPublishedVersionId: row.target_published_version_id,
      withdrawn: row.withdrawn,
    } : null;
  }

  async readPublicationProof(documentId: string, publishedVersionId: string): Promise<PublicationProof> {
    const result = await this.client.query<{
      current_version_id: string | null; current_version_no: number | null; reported_version_no: number | null;
      valid_from: Date | null; valid_until: Date | null; status: string | null; request_type: string | null;
      publication_state: string | null; rejected: boolean; withdrawn_version_id: string | null;
    }>(`SELECT current_version_id, current_version_no, reported_version_no, valid_from, valid_until,
              status, request_type, publication_state, rejected, withdrawn_version_id
         FROM maintenance_publication_proof($1, $2)`, [documentId, publishedVersionId]);
    const row = result.rows[0];
    if (!row) return { state: "pending", outcome: null, publishedVersionId: null };
    const pointer: PublicationPointer | null = row.current_version_id ? {
      currentVersionId: row.current_version_id,
      currentVersionNo: row.current_version_no ?? 0,
      reportedVersionNo: row.reported_version_no ?? 0,
      validFrom: row.valid_from?.toISOString() ?? new Date(0).toISOString(),
      validUntil: row.valid_until?.toISOString() ?? null,
      status: row.status ?? "",
      requestType: row.request_type ?? "",
      publicationState: row.publication_state ?? "",
      rejected: row.rejected,
      withdrawn: false,
    } : null;
    if (!pointer && row.withdrawn_version_id) return { state: "applicable", outcome: "WITHDRAWN", publishedVersionId: row.withdrawn_version_id };
    return publicationProofFromPointer(publishedVersionId, pointer);
  }

  async saveLink(caseId: string, relatedCaseId: string): Promise<void> {
    const [left, right] = [caseId, relatedCaseId].sort();
    await this.client.query(`INSERT INTO case_link (organization_id, left_case_id, right_case_id)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [this.organizationId, left, right]);
  }

  async activeAnalysis(caseId: string): Promise<boolean> {
    const result = await this.client.query(`SELECT 1 FROM case_analysis
      WHERE organization_id = $1 AND case_id = $2 AND status IN ('queued', 'running')`, [this.organizationId, caseId]);
    return (result.rowCount ?? 0) > 0;
  }

  async queueAnalysis(caseId: string, run: { runId: string; versionIds: string[]; startedByMembershipId: string; attempt: number }): Promise<void> {
    await this.client.query(`INSERT INTO case_analysis
      (id, organization_id, case_id, status, findings, attempt, input_version_ids, started_by_id)
      VALUES ($1, $2, $3, 'queued', '[]'::jsonb, $4, $5::jsonb, $6)`,
    [run.runId, this.organizationId, caseId, run.attempt, JSON.stringify(run.versionIds), run.startedByMembershipId]);
  }

  async cancelActiveAnalysis(caseId: string): Promise<void> {
    await this.client.query(`UPDATE case_analysis SET status = 'cancelled', findings = '[]'::jsonb, fence_token = NULL
      WHERE organization_id = $1 AND case_id = $2 AND status IN ('queued', 'running')`, [this.organizationId, caseId]);
  }

  async expireStaleAnalysis(caseId: string): Promise<void> {
    await this.client.query(`UPDATE case_analysis SET status = 'failed', findings = '[]'::jsonb, fence_token = NULL
      WHERE organization_id = $1 AND case_id = $2 AND status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= now()`,
    [this.organizationId, caseId]);
  }

  async failActiveAnalysis(caseId: string): Promise<void> {
    await this.client.query(`UPDATE case_analysis SET status = 'failed', findings = '[]'::jsonb, fence_token = NULL
      WHERE organization_id = $1 AND case_id = $2 AND status IN ('queued', 'running')`, [this.organizationId, caseId]);
  }

  async claimAnalysis(caseId: string, fence: string): Promise<AnalysisRun | null> {
    const result = await this.client.query<AnalysisRow>(`UPDATE case_analysis
      SET status = 'running', fence_token = $3, lease_expires_at = now() + interval '30 seconds'
      WHERE organization_id = $1 AND case_id = $2 AND status = 'queued'
      RETURNING id AS run_id, status AS state, findings, input_version_ids AS version_ids, started_by_id AS started_by_membership_id, fence_token AS fence, attempt`,
    [this.organizationId, caseId, fence]);
    return result.rows[0] ? mapAnalysis(result.rows[0]) : null;
  }

  async recordAiUsageEvents(requestId: string, events: ProviderUsageEvent[]): Promise<boolean> {
    if (events.some((event) => event.operation !== "MAINTENANCE_ANALYSIS")) return false;
    return insertAiUsageEvents(this.client, this.organizationId, requestId, events);
  }

  async commitAnalysis(caseId: string, fence: string, state: "succeeded" | "failed", findings: Array<{ versionId: string; summary: string }>): Promise<boolean> {
    const result = await this.client.query(`UPDATE case_analysis
      SET status = CASE WHEN lease_expires_at IS NOT NULL AND lease_expires_at <= now() THEN 'failed' ELSE $4 END,
          findings = CASE WHEN lease_expires_at IS NOT NULL AND lease_expires_at <= now() THEN '[]'::jsonb ELSE $5::jsonb END
      WHERE organization_id = $1 AND case_id = $2 AND fence_token = $3 AND status = 'running'`,
    [this.organizationId, caseId, fence, state, JSON.stringify(findings)]);
    return (result.rowCount ?? 0) === 1;
  }

  async latestAnalysis(caseId: string): Promise<AnalysisRun | null> {
    const result = await this.client.query<AnalysisRow>(`SELECT id AS run_id, status AS state, findings, input_version_ids AS version_ids, started_by_id AS started_by_membership_id, fence_token AS fence, attempt
      FROM case_analysis WHERE organization_id = $1 AND case_id = $2
      ORDER BY created_at DESC LIMIT 1`, [this.organizationId, caseId]);
    return result.rows[0] ? mapAnalysis(result.rows[0]) : null;
  }

  async listLinks(caseId: string): Promise<string[]> {
    const result = await this.client.query<{ related: string }>(`
      SELECT CASE WHEN left_case_id = $2 THEN right_case_id ELSE left_case_id END AS related
        FROM case_link
       WHERE organization_id = $1 AND (left_case_id = $2 OR right_case_id = $2)`,
    [this.organizationId, caseId]);
    return result.rows.map((row) => row.related);
  }

  async markRead(membershipId: string, caseId: string): Promise<void> {
    await this.client.query(`UPDATE notification SET read_at = now()
      WHERE organization_id = $1 AND resource_id = $2 AND recipient_id = $3
        AND event_type = 'MAINTENANCE_CASE_UPDATED' AND read_at IS NULL`, [this.organizationId, caseId, membershipId]);
  }
}
