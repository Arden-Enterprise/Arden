import type { PoolClient } from "pg";
import type {
  ActorRecord, AnchorRecord, CaseEventRecord, CaseRecord, LegacyReport, NotificationRecord, PublicationProof, PublicationSubmission,
} from "./contracts.js";
import { publicationProofFromPointer, type PublicationPointer } from "./publication-proof.js";
import type { AnalysisFinding, AnalysisRun, AnalysisState } from "./analysis.js";
import type { MaintenancePort, MaintenanceTx } from "./case-service.js";
import { visibleVersionText } from "./version-text.js";

type MemberTransaction = <T>(userId: string, organizationId: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;

type CaseRow = {
  case_id: string; organization_id: string; origin: CaseRecord["origin"]; reporter_membership_id: string | null;
  document_id: string; published_version_id: string; content_hash: string; title: string; description: string;
  anchor_page: number | null; anchor_passage: string | null; route_department_id: string;
  classification: CaseRecord["classification"]; team_tag: string | null; project_tag: string | null;
  author_membership_id: string; assignee_membership_id: string | null; reporter_status: CaseRecord["reporterStatus"];
  outcome: CaseRecord["outcome"]; reporter_explanation: string | null; reviewer_rationale: string | null;
  publication_link_version_id: string | null; publication_link_submission_id: string | null; publication_link_reason: string | null;
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
    caseId: row.case_id, organizationId: row.organization_id, origin: row.origin,
    reporterMembershipId: row.reporter_membership_id, documentId: row.document_id,
    publishedVersionId: row.published_version_id, contentHash: row.content_hash, title: row.title,
    description: row.description, anchorPage: row.anchor_page, anchorPassage: row.anchor_passage,
    routeDepartmentId: row.route_department_id, classification: row.classification, teamTag: row.team_tag,
    projectTag: row.project_tag, authorMembershipId: row.author_membership_id,
    assigneeMembershipId: row.assignee_membership_id, reporterStatus: row.reporter_status, outcome: row.outcome,
    reporterExplanation: row.reporter_explanation, reviewerRationale: row.reviewer_rationale,
    publicationLinkVersionId: row.publication_link_version_id, publicationLinkSubmissionId: row.publication_link_submission_id,
    publicationLinkReason: row.publication_link_reason,
    revision: row.revision,
    firstClaimedAt: row.first_claimed_at?.toISOString() ?? null, createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
  };
}

const caseColumns = `case_id, organization_id, origin, reporter_membership_id, document_id, published_version_id,
  content_hash, title, description, anchor_page, anchor_passage, route_department_id, classification, team_tag,
  project_tag, author_membership_id, assignee_membership_id, reporter_status, outcome, reporter_explanation,
  reviewer_rationale, publication_link_version_id, publication_link_submission_id, publication_link_reason, revision, first_claimed_at, created_at, resolved_at`;

export type VersionContentReader = { read(sourceUri: string, expectedHash: string): Promise<string> };

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
    const result = await this.client.query<{ membership_id: string; user_id: string }>(`
      SELECT om.membership_id, om.user_id
        FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
       WHERE om.organization_id = $1 AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'`, [this.organizationId]);
    const row = result.rows[0];
    return row ? { userId: row.user_id, organizationId: this.organizationId, membershipId: row.membership_id } : null;
  }

  async readAnchor(documentId: string, publishedVersionId: string): Promise<AnchorRecord | null> {
    const result = await this.client.query<{
      organization_id: string; document_id: string; published_version_id: string; content_hash: string; title: string;
      classification: AnchorRecord["classification"]; responsible_department_id: string; team_tag: string | null;
      project_tag: string | null; author_membership_id: string;
    }>(`
      SELECT cp.organization_id, pv.shared_draft_id AS document_id, pv.published_version_id, pv.content_hash, pv.title,
             pv.classification, pv.responsible_department_id, pv.team_tag, pv.project_tag, pv.author_membership_id
        FROM published_knowledge_version pv
        JOIN knowledge_current_publication cp ON cp.published_version_id = pv.published_version_id
       WHERE pv.published_version_id = $1 AND pv.shared_draft_id = $2 AND cp.organization_id = $3`,
    [publishedVersionId, documentId, this.organizationId]);
    const row = result.rows[0];
    if (!row?.classification || !row.responsible_department_id) return null;
    return {
      organizationId: row.organization_id, documentId: row.document_id, publishedVersionId: row.published_version_id,
      contentHash: row.content_hash, title: row.title, classification: row.classification,
      departmentId: row.responsible_department_id, teamTag: row.team_tag, projectTag: row.project_tag,
      authorMembershipId: row.author_membership_id,
    };
  }

  async canReadDocument(documentId: string): Promise<boolean> {
    // Runs under the caller's publication RLS: true only when they can read the document's current publication.
    const result = await this.client.query(`SELECT 1 FROM knowledge_current_publication cp
      JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
      WHERE cp.shared_draft_id = $1 AND cp.organization_id = $2`, [documentId, this.organizationId]);
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
      concat_ws(':', 'maintenance-request', $1::text, $2::text, $3::text), 0))`,
    [this.organizationId, membershipId, requestKey]);
  }

  async lockDocument(documentId: string): Promise<boolean> {
    const result = await this.client.query<{ ok: boolean }>(`SELECT maintenance_lock_document($1) AS ok`, [documentId]);
    return Boolean(result.rows[0]?.ok);
  }

  async idempotency(membershipId: string, requestKey: string) {
    const result = await this.client.query<{ payload_hash: string; case_id: string }>(`
      SELECT payload_hash, case_id FROM maintenance_idempotency
       WHERE organization_id = $1 AND actor_membership_id = $2 AND request_key = $3`,
    [this.organizationId, membershipId, requestKey]);
    const row = result.rows[0];
    return row ? { payloadHash: row.payload_hash, caseId: row.case_id } : null;
  }

  async saveIdempotency(membershipId: string, requestKey: string, payloadHash: string, caseId: string) {
    await this.client.query(`INSERT INTO maintenance_idempotency
      (organization_id, actor_membership_id, request_key, payload_hash, case_id)
      VALUES ($1, $2, $3, $4, $5)`, [this.organizationId, membershipId, requestKey, payloadHash, caseId]);
  }

  async insertCase(row: CaseRecord) {
    await this.client.query(`INSERT INTO maintenance_case (${caseColumns}) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
    [row.caseId, row.organizationId, row.origin, row.reporterMembershipId, row.documentId, row.publishedVersionId,
      row.contentHash, row.title, row.description, row.anchorPage, row.anchorPassage, row.routeDepartmentId,
      row.classification, row.teamTag, row.projectTag, row.authorMembershipId, row.assigneeMembershipId,
      row.reporterStatus, row.outcome, row.reporterExplanation, row.reviewerRationale,
      row.publicationLinkVersionId, row.publicationLinkSubmissionId, row.publicationLinkReason, row.revision,
      row.firstClaimedAt, row.createdAt, row.resolvedAt]);
  }

  async lockCase(caseId: string): Promise<CaseRecord | null> {
    const result = await this.client.query<CaseRow>(`SELECT ${caseColumns} FROM maintenance_case
      WHERE case_id = $1 AND organization_id = $2 FOR UPDATE`, [caseId, this.organizationId]);
    const row = result.rows[0];
    return row ? mapCase(row) : null;
  }

  async listCases(): Promise<CaseRecord[]> {
    const result = await this.client.query<CaseRow>(`SELECT ${caseColumns} FROM maintenance_case
      WHERE organization_id = $1 ORDER BY created_at, case_id`, [this.organizationId]);
    return result.rows.map(mapCase);
  }

  async nextSequence(caseId: string): Promise<number> {
    const result = await this.client.query<{ sequence: string }>(
      `SELECT maintenance_next_event_sequence($1) AS sequence`, [caseId]);
    return Number(result.rows[0]?.sequence ?? 1);
  }

  async insertEvent(event: CaseEventRecord) {
    await this.client.query(`INSERT INTO maintenance_case_event
      (event_id, organization_id, case_id, sequence, actor_membership_id, event_type, audience, message, occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [event.eventId, event.organizationId, event.caseId, event.sequence, event.actorMembershipId,
      event.eventType, event.audience, event.message, event.occurredAt]);
  }

  async listEvents(caseId: string, afterSequence: number, limit: number): Promise<CaseEventRecord[]> {
    const result = await this.client.query<{
      event_id: string; organization_id: string; case_id: string; sequence: string; actor_membership_id: string | null;
      event_type: CaseEventRecord["eventType"]; audience: CaseEventRecord["audience"]; message: string; occurred_at: Date;
    }>(`SELECT event_id, organization_id, case_id, sequence, actor_membership_id, event_type, audience, message, occurred_at
      FROM maintenance_case_event WHERE case_id = $1 AND organization_id = $2 AND sequence > $3
      ORDER BY sequence LIMIT $4`, [caseId, this.organizationId, afterSequence, limit]);
    return result.rows.map((row) => ({
      eventId: row.event_id, organizationId: row.organization_id, caseId: row.case_id, sequence: Number(row.sequence),
      actorMembershipId: row.actor_membership_id, eventType: row.event_type, audience: row.audience,
      message: row.message, occurredAt: row.occurred_at.toISOString(),
    }));
  }

  async saveCase(row: CaseRecord) {
    await this.client.query(`UPDATE maintenance_case SET assignee_membership_id = $3, reporter_status = $4,
      outcome = $5, reporter_explanation = $6, reviewer_rationale = $7, publication_link_version_id = $8,
      publication_link_submission_id = $9, publication_link_reason = $10, revision = $11, first_claimed_at = $12,
      resolved_at = $13 WHERE case_id = $1 AND organization_id = $2`,
    [row.caseId, row.organizationId, row.assigneeMembershipId, row.reporterStatus, row.outcome,
      row.reporterExplanation, row.reviewerRationale, row.publicationLinkVersionId, row.publicationLinkSubmissionId,
      row.publicationLinkReason, row.revision, row.firstClaimedAt, row.resolvedAt]);
  }

  async insertNotification(notice: NotificationRecord) {
    await this.client.query(`INSERT INTO maintenance_notification
      (notification_id, organization_id, case_id, recipient_membership_id, logical_key, message)
      VALUES ($1,$2,$3,$4,$5,$6)`,
    [notice.notificationId, notice.organizationId, notice.caseId, notice.recipientMembershipId,
      notice.logicalKey, notice.message]);
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
      concat_ws(':', 'maintenance-reader-intake', $1::text, $2::text, $3::text), 0))`,
    [this.organizationId, documentId, reporterMembershipId]);
  }

  async hasOpenReaderReport(documentId: string, reporterMembershipId: string): Promise<boolean> {
    const result = await this.client.query<{ has_open: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM maintenance_case
      WHERE organization_id = $1 AND document_id = $2 AND reporter_membership_id = $3
        AND origin = 'READER_REPORT' AND reporter_status <> 'Resolved'
    ) OR maintenance_has_unmapped_open_reader_report($2) AS has_open`,
    [this.organizationId, documentId, reporterMembershipId]);
    return result.rows[0]?.has_open ?? false;
  }

  async findImport(reportId: string): Promise<string | null> {
    const result = await this.client.query<{ case_id: string }>(`SELECT case_id FROM maintenance_report_import
      WHERE organization_id = $1 AND report_id = $2`, [this.organizationId, reportId]);
    return result.rows[0]?.case_id ?? null;
  }

  async saveImport(reportId: string, caseId: string): Promise<void> {
    await this.client.query(`INSERT INTO maintenance_report_import (organization_id, report_id, case_id)
      VALUES ($1, $2, $3)`, [this.organizationId, reportId, caseId]);
  }

  async unmappedOpenReports(after: { createdAt: string; reportId: string } | null): Promise<LegacyReport[]> {
    const result = await this.client.query<{
      report_id: string; shared_draft_id: string; published_version_id: string; reporter_membership_id: string;
      message: string; created_at: Date; verifiable: boolean; title: string | null; content_hash: string | null;
      classification: AnchorRecord["classification"] | null; responsible_department_id: string | null;
      team_tag: string | null; project_tag: string | null; author_membership_id: string | null;
    }>(`SELECT report_id, shared_draft_id, published_version_id, reporter_membership_id, message, created_at, verifiable,
        title, content_hash, classification, responsible_department_id, team_tag, project_tag, author_membership_id
      FROM list_unmapped_open_publication_reports($1, $2)`, [after?.createdAt ?? null, after?.reportId ?? null]);
    return result.rows.map((row) => ({
      reportId: row.report_id, documentId: row.shared_draft_id, publishedVersionId: row.published_version_id,
      reporterMembershipId: row.reporter_membership_id, message: row.message,
      createdAt: row.created_at.toISOString(), status: "OPEN", verifiable: row.verifiable,
      anchor: row.verifiable ? {
        organizationId: this.organizationId, documentId: row.shared_draft_id, publishedVersionId: row.published_version_id,
        contentHash: row.content_hash ?? "", title: row.title ?? "", classification: row.classification!,
        departmentId: row.responsible_department_id!, teamTag: row.team_tag, projectTag: row.project_tag,
        authorMembershipId: row.author_membership_id!,
      } : null,
    }));
  }

  async hasUnread(membershipId: string, caseId: string): Promise<boolean> {
    const result = await this.client.query(`SELECT 1 FROM maintenance_notification n
      WHERE n.organization_id = $1 AND n.case_id = $2 AND n.recipient_membership_id = $3
        AND NOT EXISTS (
          SELECT 1 FROM maintenance_notification_receipt r
           WHERE r.notification_id = n.notification_id AND r.recipient_membership_id = n.recipient_membership_id
        )`, [this.organizationId, caseId, membershipId]);
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
      SELECT s.shared_draft_id AS document_id, s.request_type, s.status, s.target_published_version_id,
             (SELECT pv.published_version_id FROM published_knowledge_version pv
               WHERE pv.submission_id = s.submission_id ORDER BY pv.version_no DESC LIMIT 1) AS produced_version_id,
             s.publication_state = 'WITHDRAWN' AS withdrawn
        FROM shared_submission s
       WHERE s.submission_id = $1 AND s.organization_id = $2`, [submissionId, this.organizationId]);
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
    await this.client.query(`INSERT INTO maintenance_case_link (organization_id, left_case_id, right_case_id)
      VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [this.organizationId, left, right]);
  }

  async activeAnalysis(caseId: string): Promise<boolean> {
    const result = await this.client.query(`SELECT 1 FROM maintenance_analysis_run
      WHERE organization_id = $1 AND case_id = $2 AND state IN ('queued', 'running')`, [this.organizationId, caseId]);
    return (result.rowCount ?? 0) > 0;
  }

  async queueAnalysis(caseId: string, run: { runId: string; versionIds: string[]; startedByMembershipId: string; attempt: number }): Promise<void> {
    await this.client.query(`INSERT INTO maintenance_analysis_run
      (run_id, organization_id, case_id, state, findings, attempt, version_ids, started_by_membership_id)
      VALUES ($1, $2, $3, 'queued', '[]'::jsonb, $4, $5::jsonb, $6)`,
    [run.runId, this.organizationId, caseId, run.attempt, JSON.stringify(run.versionIds), run.startedByMembershipId]);
  }

  async cancelActiveAnalysis(caseId: string): Promise<void> {
    await this.client.query(`UPDATE maintenance_analysis_run SET state = 'cancelled', findings = '[]'::jsonb, fence = NULL
      WHERE organization_id = $1 AND case_id = $2 AND state IN ('queued', 'running')`, [this.organizationId, caseId]);
  }

  async expireStaleAnalysis(caseId: string): Promise<void> {
    await this.client.query(`UPDATE maintenance_analysis_run SET state = 'failed', findings = '[]'::jsonb, fence = NULL
      WHERE organization_id = $1 AND case_id = $2 AND state = 'running' AND lease_until IS NOT NULL AND lease_until <= now()`,
    [this.organizationId, caseId]);
  }

  async failActiveAnalysis(caseId: string): Promise<void> {
    await this.client.query(`UPDATE maintenance_analysis_run SET state = 'failed', findings = '[]'::jsonb, fence = NULL
      WHERE organization_id = $1 AND case_id = $2 AND state IN ('queued', 'running')`, [this.organizationId, caseId]);
  }

  async claimAnalysis(caseId: string, fence: string): Promise<AnalysisRun | null> {
    const result = await this.client.query<AnalysisRow>(`UPDATE maintenance_analysis_run
      SET state = 'running', fence = $3, lease_until = now() + interval '30 seconds'
      WHERE organization_id = $1 AND case_id = $2 AND state = 'queued'
      RETURNING run_id, state, findings, version_ids, started_by_membership_id, fence, attempt`,
    [this.organizationId, caseId, fence]);
    return result.rows[0] ? mapAnalysis(result.rows[0]) : null;
  }

  async commitAnalysis(caseId: string, fence: string, state: "succeeded" | "failed", findings: Array<{ versionId: string; summary: string }>): Promise<boolean> {
    const result = await this.client.query(`UPDATE maintenance_analysis_run
      SET state = CASE WHEN lease_until IS NOT NULL AND lease_until <= now() THEN 'failed' ELSE $4 END,
          findings = CASE WHEN lease_until IS NOT NULL AND lease_until <= now() THEN '[]'::jsonb ELSE $5::jsonb END
      WHERE organization_id = $1 AND case_id = $2 AND fence = $3 AND state = 'running'`,
    [this.organizationId, caseId, fence, state, JSON.stringify(findings)]);
    return (result.rowCount ?? 0) === 1;
  }

  async latestAnalysis(caseId: string): Promise<AnalysisRun | null> {
    const result = await this.client.query<AnalysisRow>(`SELECT run_id, state, findings, version_ids, started_by_membership_id, fence, attempt
      FROM maintenance_analysis_run WHERE organization_id = $1 AND case_id = $2
      ORDER BY created_at DESC LIMIT 1`, [this.organizationId, caseId]);
    return result.rows[0] ? mapAnalysis(result.rows[0]) : null;
  }

  async listLinks(caseId: string): Promise<string[]> {
    const result = await this.client.query<{ related: string }>(`
      SELECT CASE WHEN left_case_id = $2 THEN right_case_id ELSE left_case_id END AS related
        FROM maintenance_case_link
       WHERE organization_id = $1 AND (left_case_id = $2 OR right_case_id = $2)`,
    [this.organizationId, caseId]);
    return result.rows.map((row) => row.related);
  }

  async markRead(membershipId: string, caseId: string): Promise<void> {
    await this.client.query(`INSERT INTO maintenance_notification_receipt
      (organization_id, notification_id, recipient_membership_id)
      SELECT n.organization_id, n.notification_id, n.recipient_membership_id
        FROM maintenance_notification n
       WHERE n.organization_id = $1 AND n.case_id = $2 AND n.recipient_membership_id = $3
      ON CONFLICT DO NOTHING`, [this.organizationId, caseId, membershipId]);
  }
}
