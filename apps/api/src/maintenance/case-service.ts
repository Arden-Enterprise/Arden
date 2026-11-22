import { randomUUID } from "node:crypto";
import {
  type ActorRecord, type AnchorRecord, type CaseEventRecord, type CaseProjection, type CaseRecord,
  type HistoryPage, type IntakeInput, type LegacyReport, type NotificationRecord, type PublicationSubmission, MaintenanceError, assertUuid, commandHash, intakeHash, legacyRequestKey,
} from "./contracts.js";
import { maintenanceSourceTextLimit, type AnalysisAdapter, type AnalysisFinding, type AnalysisRun } from "./analysis.js";
import { compareLines, type DiffRow } from "./diff.js";
import { type PublicationProof } from "./publication-proof.js";
import { projectCase, type CaseAccess } from "./policy.js";

export interface MaintenanceTx {
  actor(): Promise<ActorRecord | null>;
  readAnchor(documentId: string, publishedVersionId: string): Promise<AnchorRecord | null>;
  canReadVersion(publishedVersionId: string): Promise<boolean>;
  hasReviewerGrant(anchor: Pick<AnchorRecord, "departmentId" | "classification" | "teamTag" | "projectTag">): Promise<boolean>;
  isAdmin(): Promise<boolean>;
  idempotency(membershipId: string, requestKey: string): Promise<{ payloadHash: string; caseId: string } | null>;
  saveIdempotency(membershipId: string, requestKey: string, payloadHash: string, caseId: string): Promise<void>;
  insertCase(row: CaseRecord): Promise<void>;
  lockCase(caseId: string): Promise<CaseRecord | null>;
  listCases(): Promise<CaseRecord[]>;
  nextSequence(caseId: string): Promise<number>;
  insertEvent(event: CaseEventRecord): Promise<void>;
  listEvents(caseId: string, afterSequence: number, limit: number): Promise<CaseEventRecord[]>;
  saveCase(row: CaseRecord): Promise<void>;
  insertNotification(notice: NotificationRecord): Promise<void>;
  notificationExists(recipientMembershipId: string, logicalKey: string): Promise<boolean>;
  eligibleReviewers(row: CaseRecord): Promise<Array<{ membershipId: string; displayName: string }>>;
  membershipHasGrant(membershipId: string, row: CaseRecord): Promise<boolean>;
  lockReaderIntake(documentId: string, reporterMembershipId: string): Promise<void>;
  hasOpenReaderReport(documentId: string, reporterMembershipId: string): Promise<boolean>;
  findImport(reportId: string): Promise<string | null>;
  saveImport(reportId: string, caseId: string): Promise<void>;
  unmappedOpenReports(): Promise<LegacyReport[]>;
  hasUnread(membershipId: string, caseId: string): Promise<boolean>;
  markRead(membershipId: string, caseId: string): Promise<void>;
  readVersionText(publishedVersionId: string): Promise<{ documentId: string; text: string | null } | null>;
  listDocumentVersions(documentId: string): Promise<Array<{ publishedVersionId: string; versionNo: number; publishedAt: string; current: boolean }>>;
  readPublicationProof(documentId: string, publishedVersionId: string): Promise<PublicationProof>;
  readPublicationSubmission(submissionId: string): Promise<PublicationSubmission | null>;
  saveLink(caseId: string, relatedCaseId: string): Promise<void>;
  listLinks(caseId: string): Promise<string[]>;
  activeAnalysis(caseId: string): Promise<boolean>;
  queueAnalysis(caseId: string, run: { runId: string; versionIds: string[]; startedByMembershipId: string; attempt: number }): Promise<void>;
  cancelActiveAnalysis(caseId: string): Promise<void>;
  latestAnalysis(caseId: string): Promise<AnalysisRun | null>;
  claimAnalysis(caseId: string, fence: string): Promise<AnalysisRun | null>;
  commitAnalysis(caseId: string, fence: string, state: "succeeded" | "failed", findings: AnalysisFinding[]): Promise<boolean>;
  failActiveAnalysis(caseId: string): Promise<void>;
}

export interface MaintenancePort {
  transaction<T>(userId: string, organizationId: string, work: (tx: MaintenanceTx) => Promise<T>): Promise<T>;
}

function grantSubject(row: CaseRecord): Pick<AnchorRecord, "departmentId" | "classification" | "teamTag" | "projectTag"> {
  return {
    departmentId: row.routeDepartmentId, classification: row.classification,
    teamTag: row.teamTag, projectTag: row.projectTag,
  };
}

export class MaintenanceCaseService {
  constructor(private readonly port: MaintenancePort, private readonly adapter: AnalysisAdapter | null = null) {}

  createCase(userId: string, organizationId: string, input: IntakeInput, requestKey: string): Promise<CaseProjection> {
    assertUuid(organizationId);
    assertUuid(input.documentId);
    assertUuid(input.publishedVersionId);
    assertUuid(requestKey);
    const description = input.description.trim();
    if (description.length < 1 || description.length > 4000) throw new MaintenanceError("INVALID");
    if (input.anchor?.page !== undefined && (!Number.isInteger(input.anchor.page) || input.anchor.page < 1 || input.anchor.page > 10000)) {
      throw new MaintenanceError("INVALID");
    }
    if ((input.anchor?.passage?.trim().length ?? 0) > 500) throw new MaintenanceError("INVALID");
    const hash = intakeHash({ ...input, description });
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      if (input.origin === "READER_REPORT") await tx.lockReaderIntake(input.documentId, actor.membershipId);
      const prior = await tx.idempotency(actor.membershipId, requestKey);
      if (prior) {
        if (prior.payloadHash !== hash) throw new MaintenanceError("CONFLICT");
        return this.projectLocked(tx, actor, prior.caseId);
      }
      const anchor = await tx.readAnchor(input.documentId, input.publishedVersionId);
      if (!anchor || anchor.organizationId !== organizationId) throw new MaintenanceError("DENIED");
      if (input.origin === "REVIEWER_INTAKE") {
        const grant = await tx.hasReviewerGrant(anchor);
        if (!grant || anchor.authorMembershipId === actor.membershipId) throw new MaintenanceError("DENIED");
      }
      const now = new Date().toISOString();
      const row: CaseRecord = {
        caseId: randomUUID(), organizationId, origin: input.origin,
        reporterMembershipId: input.origin === "READER_REPORT" ? actor.membershipId : null,
        documentId: anchor.documentId, publishedVersionId: anchor.publishedVersionId, contentHash: anchor.contentHash,
        title: anchor.title, description, anchorPage: input.anchor?.page ?? null,
        anchorPassage: input.anchor?.passage?.trim() || null, routeDepartmentId: anchor.departmentId,
        classification: anchor.classification, teamTag: anchor.teamTag, projectTag: anchor.projectTag,
        authorMembershipId: anchor.authorMembershipId, assigneeMembershipId: null, reporterStatus: "Submitted",
        outcome: null, reporterExplanation: null, reviewerRationale: null, publicationLinkVersionId: null,
        publicationLinkSubmissionId: null, publicationLinkReason: null, revision: 1,
        firstClaimedAt: null, createdAt: now, resolvedAt: null,
      };
      await tx.insertCase(row);
      await tx.insertEvent({
        eventId: randomUUID(), organizationId, caseId: row.caseId, sequence: await tx.nextSequence(row.caseId),
        actorMembershipId: actor.membershipId, eventType: "SUBMITTED", audience: "PUBLIC",
        message: "Report submitted.", occurredAt: now,
      });
      await tx.saveIdempotency(actor.membershipId, requestKey, hash, row.caseId);
      return this.projectRow(tx, actor, row);
    });
  }

  acceptLegacyReport(userId: string, organizationId: string, input: {
    documentId: string; publishedVersionId: string; message: string;
  }): Promise<CaseProjection> {
    const message = input.message.trim();
    if (message.length < 1 || message.length > 1000) throw new MaintenanceError("INVALID");
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      await tx.lockReaderIntake(input.documentId, actor.membershipId);
      if (await tx.hasOpenReaderReport(input.documentId, actor.membershipId)) throw new MaintenanceError("CONFLICT");
      let keyMessage = message;
      let requestKey = legacyRequestKey(organizationId, actor.membershipId, input.documentId, input.publishedVersionId, keyMessage);
      let prior = await tx.idempotency(actor.membershipId, requestKey);
      while (prior) {
        const existing = await tx.lockCase(prior.caseId);
        if (!existing || existing.reporterStatus !== "Resolved") return this.projectLocked(tx, actor, prior.caseId);
        keyMessage = `${message}\n${prior.caseId}`;
        requestKey = legacyRequestKey(organizationId, actor.membershipId, input.documentId, input.publishedVersionId, keyMessage);
        prior = await tx.idempotency(actor.membershipId, requestKey);
      }
      const anchor = await tx.readAnchor(input.documentId, input.publishedVersionId);
      if (!anchor || anchor.organizationId !== organizationId) throw new MaintenanceError("DENIED");
      const now = new Date().toISOString();
      const row = this.newCase(organizationId, anchor, {
        origin: "READER_REPORT", reporterMembershipId: actor.membershipId, description: message, createdAt: now,
      });
      await tx.insertCase(row);
      await tx.insertEvent({
        eventId: randomUUID(), organizationId, caseId: row.caseId, sequence: await tx.nextSequence(row.caseId),
        actorMembershipId: actor.membershipId, eventType: "SUBMITTED", audience: "PUBLIC",
        message: "Report submitted.", occurredAt: now,
      });
      await tx.saveIdempotency(actor.membershipId, requestKey, intakeHash({
        origin: "READER_REPORT", documentId: input.documentId, publishedVersionId: input.publishedVersionId, description: message,
      }), row.caseId);
      return this.projectRow(tx, actor, row);
    });
  }

  importReports(userId: string, organizationId: string, reports: LegacyReport[]): Promise<{
    imported: Array<{ reportId: string; caseId: string }>; retained: string[]; held: string[];
  }> {
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      if (!(await tx.isAdmin())) throw new MaintenanceError("DENIED");
      return this.importLoaded(tx, actor, organizationId, reports);
    });
  }

  importOpenReports(userId: string, organizationId: string): Promise<{
    imported: Array<{ reportId: string; caseId: string }>; retained: string[]; held: string[];
  }> {
    const once = () => this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      if (!(await tx.isAdmin())) throw new MaintenanceError("DENIED");
      return this.importLoaded(tx, actor, organizationId, await tx.unmappedOpenReports());
    });
    return once().catch((error: unknown) => {
      if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "23505") throw error;
      return once();
    });
  }

  private async importLoaded(tx: MaintenanceTx, actor: ActorRecord, organizationId: string, reports: LegacyReport[]): Promise<{
    imported: Array<{ reportId: string; caseId: string }>; retained: string[]; held: string[];
  }> {
      const imported: Array<{ reportId: string; caseId: string }> = [];
      const retained: string[] = [];
      const held: string[] = [];
      for (const report of reports) {
        assertUuid(report.reportId);
        const existing = await tx.findImport(report.reportId);
        if (existing) {
          imported.push({ reportId: report.reportId, caseId: existing });
          continue;
        }
        if (report.status === "CLOSED") {
          retained.push(report.reportId);
          continue;
        }
        const anchor = report.verifiable ? await tx.readAnchor(report.documentId, report.publishedVersionId) : null;
        if (!anchor || report.message.trim().length < 1) {
          held.push(report.reportId);
          continue;
        }
        const row = this.newCase(organizationId, anchor, {
          origin: "READER_REPORT", reporterMembershipId: report.reporterMembershipId,
          description: report.message.trim(), createdAt: report.createdAt,
        });
        await tx.insertCase(row);
        await tx.insertEvent({
          eventId: randomUUID(), organizationId, caseId: row.caseId, sequence: await tx.nextSequence(row.caseId),
          actorMembershipId: actor.membershipId, eventType: "IMPORTED", audience: "PUBLIC",
          message: "Imported from an existing report.", occurredAt: new Date().toISOString(),
        });
        await tx.saveImport(report.reportId, row.caseId);
        imported.push({ reportId: report.reportId, caseId: row.caseId });
      }
      return { imported, retained, held };
  }

  listCases(userId: string, organizationId: string, scope: "mine" | "queue"): Promise<CaseProjection[]> {
    assertUuid(organizationId);
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const rows = await tx.listCases();
      const projected: CaseProjection[] = [];
      for (const row of rows) {
        const access = {
          hasGrant: await tx.hasReviewerGrant(grantSubject(row)),
          isAdmin: await tx.isAdmin(),
          canReadDocument: await tx.canReadVersion(row.publishedVersionId),
        };
        const view = projectCase(row, actor, access);
        if (!view) continue;
        if (scope === "mine" && row.reporterMembershipId === actor.membershipId) projected.push(await this.withUnread(tx, actor, view));
        if (scope === "queue" && view.kind !== "reporter" && view.kind !== "minimal") projected.push(await this.withUnread(tx, actor, view));
      }
      return projected;
    });
  }

  claimCase(userId: string, organizationId: string, caseId: string, expectedRevision: number, commandKey: string): Promise<CaseProjection> {
    return this.withCommand(userId, organizationId, caseId, commandKey, ["claim", String(expectedRevision)], async (tx, actor, row) => {
      this.requireIndependent(actor, row);
      if (!(await tx.hasReviewerGrant(grantSubject(row)))) throw new MaintenanceError("DENIED");
      if (row.assigneeMembershipId && row.assigneeMembershipId !== actor.membershipId) throw new MaintenanceError("CONFLICT");
      if (row.revision !== expectedRevision) throw new MaintenanceError("STALE");
      if (row.assigneeMembershipId === actor.membershipId) return;
      const now = new Date().toISOString();
      row.assigneeMembershipId = actor.membershipId;
      row.reporterStatus = "In Progress";
      row.firstClaimedAt = row.firstClaimedAt ?? now;
      row.revision += 1;
      await tx.saveCase(row);
      await this.append(tx, row, actor.membershipId, "CLAIMED", "PUBLIC", "Review started.", now);
      if (row.reporterMembershipId) await this.notify(tx, row, row.reporterMembershipId, `claimed:${row.caseId}`, "Your report is in progress.");
    });
  }

  listEligibleReviewers(userId: string, organizationId: string, caseId: string): Promise<Array<{ membershipId: string; displayName: string }>> {
    assertUuid(organizationId);
    assertUuid(caseId);
    return this.port.transaction(userId, organizationId, async (tx) => {
      await this.requireActor(tx, organizationId);
      if (!(await tx.isAdmin())) throw new MaintenanceError("DENIED");
      const row = (await tx.listCases()).find((item) => item.caseId === caseId);
      if (!row) throw new MaintenanceError("DENIED");
      return tx.eligibleReviewers(row);
    });
  }

  reassignCase(userId: string, organizationId: string, caseId: string, expectedRevision: number,
    membershipId: string, reason: string, commandKey: string): Promise<CaseProjection> {
    assertUuid(membershipId);
    const cleanReason = reason.trim();
    if (cleanReason.length < 1 || cleanReason.length > 500) throw new MaintenanceError("INVALID");
    return this.withCommand(userId, organizationId, caseId, commandKey,
      ["reassign", String(expectedRevision), membershipId, cleanReason], async (tx, actor, row) => {
        if (!(await tx.isAdmin())) throw new MaintenanceError("DENIED");
        if (row.revision !== expectedRevision) throw new MaintenanceError("STALE");
        if (membershipId === row.authorMembershipId || !(await tx.membershipHasGrant(membershipId, row))) throw new MaintenanceError("DENIED");
        const now = new Date().toISOString();
        const previous = row.assigneeMembershipId;
        row.assigneeMembershipId = membershipId;
        row.reporterStatus = "In Progress";
        row.firstClaimedAt = row.firstClaimedAt ?? now;
        row.revision += 1;
        await tx.saveCase(row);
        await this.append(tx, row, actor.membershipId, "REASSIGNED", "PUBLIC", "Review was reassigned.", now);
        await this.append(tx, row, actor.membershipId, "REASSIGNED", "REVIEWER", cleanReason, now);
        if (previous && previous !== membershipId) {
          await this.notify(tx, row, previous, `reassigned-from:${row.caseId}:${row.revision}`, "This case was reassigned.");
        }
        await this.notify(tx, row, membershipId, `reassigned-to:${row.caseId}:${row.revision}`, "A maintenance case was assigned to you.");
      });
  }

  postMessage(userId: string, organizationId: string, caseId: string, expectedRevision: number, message: string, commandKey: string): Promise<CaseProjection> {
    const text = message.trim();
    if (text.length < 1 || text.length > 2000) throw new MaintenanceError("INVALID");
    return this.withCommand(userId, organizationId, caseId, commandKey, ["message", String(expectedRevision), text], async (tx, actor, row) => {
      if (row.reporterStatus === "Resolved") throw new MaintenanceError("CONFLICT");
      const reviewer = row.assigneeMembershipId === actor.membershipId && await tx.hasReviewerGrant(grantSubject(row));
      const reporter = row.reporterMembershipId === actor.membershipId;
      if (!reviewer && !reporter) throw new MaintenanceError("DENIED");
      if (row.revision !== expectedRevision) throw new MaintenanceError("STALE");
      await this.append(tx, row, actor.membershipId, "MESSAGE", "PUBLIC", text, new Date().toISOString());
      if (reporter && row.assigneeMembershipId) await this.notify(tx, row, row.assigneeMembershipId, `reply:${row.caseId}:${row.revision}`, "A reply is waiting.");
      if (reviewer && row.reporterMembershipId) await this.notify(tx, row, row.reporterMembershipId, `question:${row.caseId}:${row.revision}`, "A reviewer asked a question.");
    });
  }

  linkPublication(userId: string, organizationId: string, caseId: string, expectedRevision: number,
    reference: { publishedVersionId?: string | null; submissionId?: string | null }, reason: string, commandKey: string): Promise<CaseProjection> {
    const cleanReason = reason.trim();
    const publishedVersionId = reference.publishedVersionId || null;
    const submissionId = reference.submissionId || null;
    if (cleanReason.length < 1 || cleanReason.length > 2000 || (publishedVersionId === null) === (submissionId === null)) throw new MaintenanceError("INVALID");
    if (publishedVersionId) assertUuid(publishedVersionId);
    if (submissionId) assertUuid(submissionId);
    return this.withCommand(userId, organizationId, caseId, commandKey,
      ["publication-link", String(expectedRevision), publishedVersionId ?? "", submissionId ?? "", cleanReason], async (tx, actor, row) => {
        this.requireIndependent(actor, row);
        if (row.assigneeMembershipId !== actor.membershipId || !(await tx.hasReviewerGrant(grantSubject(row)))) throw new MaintenanceError("DENIED");
        if (row.revision !== expectedRevision || row.reporterStatus === "Resolved") throw new MaintenanceError("CONFLICT");
        if (publishedVersionId) {
          const proof = await tx.readPublicationProof(row.documentId, row.publishedVersionId);
          const source = await tx.readVersionText(publishedVersionId);
          if (proof.state !== "applicable" || proof.publishedVersionId !== publishedVersionId
            || !source || source.documentId !== row.documentId) throw new MaintenanceError("CONFLICT");
          row.publicationLinkVersionId = publishedVersionId;
          row.publicationLinkSubmissionId = null;
        } else {
          const submission = await tx.readPublicationSubmission(submissionId!);
          if (!submission || submission.documentId !== row.documentId
            || (submission.requestType !== "CONTENT" && submission.requestType !== "WITHDRAWAL")) throw new MaintenanceError("CONFLICT");
          row.publicationLinkVersionId = null;
          row.publicationLinkSubmissionId = submissionId;
        }
        row.publicationLinkReason = cleanReason;
        row.revision += 1;
        await tx.saveCase(row);
        await this.append(tx, row, actor.membershipId, "MESSAGE", "REVIEWER",
          publishedVersionId ? `Linked publication ${publishedVersionId}.` : `Linked publication request ${submissionId}.`, new Date().toISOString());
      });
  }

  confirmPublication(userId: string, organizationId: string, caseId: string, expectedRevision: number,
    reporterExplanation: string, reviewerRationale: string, evidencePublishedVersionId: string, commandKey: string): Promise<CaseProjection> {
    const explanation = reporterExplanation.trim();
    const rationale = reviewerRationale.trim();
    if (explanation.length < 1 || explanation.length > 2000 || rationale.length < 1 || rationale.length > 2000) throw new MaintenanceError("INVALID");
    assertUuid(evidencePublishedVersionId);
    return this.withCommand(userId, organizationId, caseId, commandKey,
      ["confirm-publication", String(expectedRevision), explanation, rationale, evidencePublishedVersionId], async (tx, actor, row) => {
        this.requireIndependent(actor, row);
        if (row.assigneeMembershipId !== actor.membershipId || !(await tx.hasReviewerGrant(grantSubject(row)))) throw new MaintenanceError("DENIED");
        if (row.revision !== expectedRevision) throw new MaintenanceError("STALE");
        if (row.reporterStatus === "Resolved") throw new MaintenanceError("CONFLICT");
        const proof = await tx.readPublicationProof(row.documentId, row.publishedVersionId);
        const submission = row.publicationLinkSubmissionId ? await tx.readPublicationSubmission(row.publicationLinkSubmissionId) : null;
        const linkedVersion = row.publicationLinkVersionId === evidencePublishedVersionId;
        const approvedWithdrawal = submission?.requestType === "WITHDRAWAL" && submission.status === "APPROVED"
          && submission.targetPublishedVersionId === evidencePublishedVersionId && proof.outcome === "WITHDRAWN";
        const linkedRequest = !!submission && submission.documentId === row.documentId && (
          submission.producedVersionId === evidencePublishedVersionId
            || approvedWithdrawal
          || (submission.withdrawn && proof.outcome === "WITHDRAWN" && proof.publishedVersionId === evidencePublishedVersionId));
        if (proof.state !== "applicable" || !proof.outcome || proof.publishedVersionId !== evidencePublishedVersionId
          || (!linkedVersion && !linkedRequest)) throw new MaintenanceError("CONFLICT");
        const now = new Date().toISOString();
        row.reporterStatus = "Resolved";
        row.outcome = proof.outcome;
        row.reporterExplanation = explanation;
        row.reviewerRationale = rationale;
        row.resolvedAt = now;
        row.revision += 1;
        await tx.saveCase(row);
        await this.append(tx, row, actor.membershipId, "RESOLVED", "PUBLIC", explanation, now);
        await this.append(tx, row, actor.membershipId, "RESOLVED", "REVIEWER", `${proof.outcome}: ${rationale}`, now);
        if (row.reporterMembershipId) await this.notify(tx, row, row.reporterMembershipId, `resolved:${row.caseId}`, "Your report was resolved.");
      });
  }

  decideNoChange(userId: string, organizationId: string, caseId: string, expectedRevision: number,
    reporterExplanation: string, reviewerRationale: string, commandKey: string): Promise<CaseProjection> {
    const explanation = reporterExplanation.trim();
    const rationale = reviewerRationale.trim();
    if (explanation.length < 1 || explanation.length > 2000 || rationale.length < 1 || rationale.length > 2000) throw new MaintenanceError("INVALID");
    return this.withCommand(userId, organizationId, caseId, commandKey,
      ["no-change", String(expectedRevision), explanation, rationale], async (tx, actor, row) => {
        this.requireIndependent(actor, row);
        if (row.assigneeMembershipId !== actor.membershipId || !(await tx.hasReviewerGrant(grantSubject(row)))) throw new MaintenanceError("DENIED");
        if (row.revision !== expectedRevision) throw new MaintenanceError("STALE");
        if (row.reporterStatus === "Resolved") throw new MaintenanceError("CONFLICT");
        const now = new Date().toISOString();
        row.reporterStatus = "Resolved";
        row.outcome = "NO_CHANGE_NEEDED";
        row.reporterExplanation = explanation;
        row.reviewerRationale = rationale;
        row.resolvedAt = now;
        row.revision += 1;
        await tx.saveCase(row);
        await this.append(tx, row, actor.membershipId, "RESOLVED", "PUBLIC", explanation, now);
        await this.append(tx, row, actor.membershipId, "RESOLVED", "REVIEWER", rationale, now);
        if (row.reporterMembershipId) await this.notify(tx, row, row.reporterMembershipId, `resolved:${row.caseId}`, "Your report was resolved.");
      });
  }

  listHistory(userId: string, organizationId: string, caseId: string, cursor: string | null): Promise<HistoryPage> {
    assertUuid(organizationId);
    assertUuid(caseId);
    const after = cursor === null || cursor === "" ? 0 : Number(cursor);
    if (!Number.isSafeInteger(after) || after < 0) throw new MaintenanceError("INVALID");
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const locked = await tx.lockCase(caseId);
      const view = locked ? projectCase(locked, actor, {
        hasGrant: await tx.hasReviewerGrant(grantSubject(locked)),
        isAdmin: await tx.isAdmin(),
        canReadDocument: await tx.canReadVersion(locked.publishedVersionId),
      }) : null;
      if (!locked || !view) throw new MaintenanceError("DENIED");
      if (view.kind === "minimal") return { items: [], nextCursor: null };
      const events = await tx.listEvents(caseId, after, 21);
      const visible = events.filter((event) => event.audience === "PUBLIC" || actor.membershipId !== locked.reporterMembershipId);
      const page = visible.slice(0, 20);
      return {
        items: page.map((event) => ({ sequence: event.sequence, eventType: event.eventType, message: event.message, occurredAt: event.occurredAt })),
        nextCursor: visible.length > 20 ? String(page[page.length - 1]?.sequence ?? after) : null,
      };
    });
  }

  startAnalysis(userId: string, organizationId: string, caseId: string, versionIds: string[], commandKey: string): Promise<AnalysisRun> {
    if (versionIds.length < 1 || versionIds.length > 4 || new Set(versionIds).size !== versionIds.length) {
      throw new MaintenanceError("INVALID");
    }
    for (const versionId of versionIds) assertUuid(versionId);
    return this.withCommand(userId, organizationId, caseId, commandKey, ["analyze", ...versionIds], async (tx, actor, row) => {
      if (row.assigneeMembershipId !== actor.membershipId || !(await tx.hasReviewerGrant(grantSubject(row)))) throw new MaintenanceError("DENIED");
      if (row.reporterStatus === "Resolved") throw new MaintenanceError("CONFLICT");
      if (await tx.activeAnalysis(row.caseId)) throw new MaintenanceError("CONFLICT");
      for (const versionId of versionIds) {
        const source = await tx.readVersionText(versionId);
        if (!source || source.documentId !== row.documentId || source.text === null) throw new MaintenanceError("DENIED");
      }
      const prior = await tx.latestAnalysis(row.caseId);
      await tx.queueAnalysis(row.caseId, {
        runId: randomUUID(), versionIds, startedByMembershipId: actor.membershipId, attempt: (prior?.attempt ?? 0) + 1,
      });
    }).then(() => this.port.transaction(userId, organizationId, async (tx) => {
      const latest = await tx.latestAnalysis(caseId);
      if (!latest) throw new MaintenanceError("DENIED");
      return latest;
    }));
  }

  async readAnalysis(userId: string, organizationId: string, caseId: string): Promise<AnalysisRun> {
    assertUuid(organizationId);
    assertUuid(caseId);
    const current = await this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const row = await tx.lockCase(caseId);
      if (!row || row.assigneeMembershipId !== actor.membershipId) throw new MaintenanceError("DENIED");
      return tx.latestAnalysis(caseId);
    });
    if (!current) throw new MaintenanceError("DENIED");
    if (current.state !== "queued" || !this.adapter) return current;
    return this.advanceAnalysis(userId, organizationId, caseId);
  }

  private async advanceAnalysis(userId: string, organizationId: string, caseId: string): Promise<AnalysisRun> {
    const { run: prepared, sources } = await this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const row = await tx.lockCase(caseId);
      if (!row || row.assigneeMembershipId !== actor.membershipId) throw new MaintenanceError("DENIED");
      const latest = await tx.latestAnalysis(caseId);
      if (!latest || latest.state !== "queued") return { run: latest };
      if (latest.startedByMembershipId !== actor.membershipId || !(await tx.hasReviewerGrant(grantSubject(row)))) {
        await tx.failActiveAnalysis(caseId);
        return { run: await tx.latestAnalysis(caseId) };
      }
      const sources: NonNullable<Parameters<AnalysisAdapter>[0]["sources"]> = [];
      for (const versionId of latest.versionIds) {
        const source = await tx.readVersionText(versionId);
        if (!source || source.documentId !== row.documentId || typeof source.text !== "string"
          || !source.text.trim() || source.text.length > maintenanceSourceTextLimit) {
          await tx.failActiveAnalysis(caseId);
          return { run: await tx.latestAnalysis(caseId) };
        }
        sources.push({ versionId, text: source.text });
      }
      return { run: await tx.claimAnalysis(caseId, randomUUID()), sources };
    });
    if (!prepared || prepared.state !== "running" || !prepared.fence || !this.adapter) return prepared ?? { runId: "", state: "failed", findings: [], versionIds: [], startedByMembershipId: "", fence: null, attempt: 0 };
    const fence = prepared.fence;
    let result: { findings: AnalysisFinding[] } | null = null;
    try {
      const response = await this.adapter({ contractVersion: 1, caseId, versionIds: prepared.versionIds, sources });
      const valid = response.contractVersion === 1 && response.state === "succeeded"
        && response.findings.length >= 1 && response.findings.length <= 4
        && response.findings.every((item) => prepared.versionIds.includes(item.versionId) && item.summary.trim().length > 0 && item.summary.length <= 350);
      result = valid ? { findings: response.findings } : null;
    } catch {
      result = null;
    }
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const row = await tx.lockCase(caseId);
      const latest = await tx.latestAnalysis(caseId);
      if (!latest) throw new MaintenanceError("DENIED");
      if (latest.state !== "running" || latest.fence !== fence) return latest;
      const sources = await Promise.all(prepared.versionIds.map((versionId) => tx.readVersionText(versionId)));
      const sourcesReady = sources.every((source) => source && row && source.documentId === row.documentId && source.text !== null);
      const stillAssigned = Boolean(row && row.assigneeMembershipId === actor.membershipId && row.assigneeMembershipId === prepared.startedByMembershipId
        && await tx.hasReviewerGrant(grantSubject(row)));
      await tx.commitAnalysis(caseId, fence, result && sourcesReady && stillAssigned ? "succeeded" : "failed", result && sourcesReady && stillAssigned ? result.findings : []);
      const saved = await tx.latestAnalysis(caseId);
      if (!saved) throw new MaintenanceError("DENIED");
      return saved;
    });
  }

  cancelAnalysis(userId: string, organizationId: string, caseId: string, commandKey: string): Promise<AnalysisRun> {
    return this.withCommand(userId, organizationId, caseId, commandKey, ["cancel-analysis"], async (tx, actor, row) => {
      if (row.assigneeMembershipId !== actor.membershipId) throw new MaintenanceError("DENIED");
      await tx.cancelActiveAnalysis(row.caseId);
    }).then(() => this.port.transaction(userId, organizationId, async (tx) => {
      const latest = await tx.latestAnalysis(caseId);
      if (!latest) throw new MaintenanceError("DENIED");
      return latest;
    }));
  }

  listRelated(userId: string, organizationId: string, caseId: string): Promise<Array<{ caseId: string; reporterStatus: CaseRecord["reporterStatus"]; title: string | null }>> {
    assertUuid(organizationId);
    assertUuid(caseId);
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const rows = await tx.listCases();
      const source = rows.find((item) => item.caseId === caseId);
      if (!source) throw new MaintenanceError("DENIED");
      const sourceView = await this.safeView(tx, actor, source);
      if (!sourceView || sourceView.kind === "reporter" || sourceView.kind === "minimal") throw new MaintenanceError("DENIED");
      const visible = [];
      for (const relatedId of await tx.listLinks(caseId)) {
        const related = rows.find((item) => item.caseId === relatedId);
        if (!related) continue;
        const view = await this.safeView(tx, actor, related);
        if (!view || view.kind === "reporter" || view.kind === "minimal") continue;
        visible.push({ caseId: view.caseId, reporterStatus: view.reporterStatus, title: view.title });
      }
      return visible;
    });
  }

  linkRelated(userId: string, organizationId: string, caseId: string, relatedCaseId: string, commandKey: string): Promise<CaseProjection> {
    assertUuid(relatedCaseId);
    if (caseId === relatedCaseId) throw new MaintenanceError("INVALID");
    return this.withCommand(userId, organizationId, caseId, commandKey, ["link", relatedCaseId], async (tx, actor, row) => {
      const related = await tx.lockCase(relatedCaseId);
      if (!related) throw new MaintenanceError("DENIED");
      const visible = async (item: CaseRecord) => projectCase(item, actor, {
        hasGrant: await tx.hasReviewerGrant(grantSubject(item)),
        isAdmin: await tx.isAdmin(),
        canReadDocument: await tx.canReadVersion(item.publishedVersionId),
      });
      const left = await visible(row);
      const right = await visible(related);
      if (!left || left.kind === "reporter" || left.kind === "minimal" || !right || right.kind === "reporter" || right.kind === "minimal") {
        throw new MaintenanceError("DENIED");
      }
      const before = { left: row.reporterStatus, right: related.reporterStatus, outcome: row.outcome };
      await tx.saveLink(row.caseId, related.caseId);
      await this.append(tx, row, actor.membershipId, "MESSAGE", "REVIEWER", `Linked case ${related.caseId}.`, new Date().toISOString());
      if (row.reporterStatus !== before.left || related.reporterStatus !== before.right || row.outcome !== before.outcome) {
        throw new MaintenanceError("CONFLICT");
      }
    });
  }

  compareCase(userId: string, organizationId: string, caseId: string, fromVersionId: string, toVersionId: string): Promise<
    { unavailable: true; fromVersionId: string; toVersionId: string } | { unavailable: false; fromVersionId: string; toVersionId: string; rows: DiffRow[] }
  > {
    assertUuid(organizationId);
    assertUuid(caseId);
    assertUuid(fromVersionId);
    assertUuid(toVersionId);
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const row = await tx.lockCase(caseId);
      if (!row) throw new MaintenanceError("DENIED");
      const access = {
        hasGrant: await tx.hasReviewerGrant(grantSubject(row)),
        isAdmin: await tx.isAdmin(),
        canReadDocument: await tx.canReadVersion(row.publishedVersionId),
      };
      const view = projectCase(row, actor, access);
      if (!view || view.kind === "minimal" || view.kind === "reporter" || (view.kind === "assigned" && !view.canDecide && !access.isAdmin)) {
        throw new MaintenanceError("DENIED");
      }
      const from = await tx.readVersionText(fromVersionId);
      const to = await tx.readVersionText(toVersionId);
      if (!from || !to || from.documentId !== row.documentId || to.documentId !== row.documentId
        || from.text === null || to.text === null || from.text.length > 20_000 || to.text.length > 20_000) {
        return { unavailable: true as const, fromVersionId, toVersionId };
      }
      return { unavailable: false as const, fromVersionId, toVersionId, rows: compareLines(from.text, to.text) };
    });
  }

  readOriginal(userId: string, organizationId: string, caseId: string, publishedVersionId: string): Promise<
    { unavailable: true; publishedVersionId: string } | { unavailable: false; publishedVersionId: string; text: string }
  > {
    assertUuid(organizationId);
    assertUuid(caseId);
    assertUuid(publishedVersionId);
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const row = await tx.lockCase(caseId);
      if (!row) throw new MaintenanceError("DENIED");
      const access = {
        hasGrant: await tx.hasReviewerGrant(grantSubject(row)),
        isAdmin: await tx.isAdmin(),
        canReadDocument: await tx.canReadVersion(row.publishedVersionId),
      };
      const view = projectCase(row, actor, access);
      if (!view || view.kind === "minimal" || view.kind === "reporter" || (view.kind === "assigned" && !view.canDecide && !access.isAdmin)) {
        throw new MaintenanceError("DENIED");
      }
      const source = await tx.readVersionText(publishedVersionId);
      if (!source || source.documentId !== row.documentId || source.text === null || source.text.length > 20_000) {
        return { unavailable: true as const, publishedVersionId };
      }
      return { unavailable: false as const, publishedVersionId, text: source.text };
    });
  }

  listVersions(userId: string, organizationId: string, caseId: string): Promise<{
    items: Array<{ publishedVersionId: string; versionNo: number; publishedAt: string; current: boolean }>;
    currentPublishedVersionId: string | null;
  }> {
    assertUuid(organizationId);
    assertUuid(caseId);
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const row = await tx.lockCase(caseId);
      if (!row) throw new MaintenanceError("DENIED");
      const access = {
        hasGrant: await tx.hasReviewerGrant(grantSubject(row)),
        isAdmin: await tx.isAdmin(),
        canReadDocument: await tx.canReadVersion(row.publishedVersionId),
      };
      const view = projectCase(row, actor, access);
      if (!view || view.kind === "minimal" || view.kind === "reporter" || (view.kind === "assigned" && !view.canDecide && !access.isAdmin)) {
        throw new MaintenanceError("DENIED");
      }
      const items = await tx.listDocumentVersions(row.documentId);
      return { items, currentPublishedVersionId: items.find((item) => item.current)?.publishedVersionId ?? null };
    });
  }

  getCase(userId: string, organizationId: string, caseId: string): Promise<CaseProjection> {
    assertUuid(organizationId);
    assertUuid(caseId);
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const view = await this.projectLocked(tx, actor, caseId);
      await tx.markRead(actor.membershipId, caseId);
      return { ...view, unread: false };
    });
  }

  private withCommand(userId: string, organizationId: string, caseId: string, commandKey: string, parts: string[],
    mutate: (tx: MaintenanceTx, actor: ActorRecord, row: CaseRecord) => Promise<void>): Promise<CaseProjection> {
    assertUuid(organizationId);
    assertUuid(caseId);
    assertUuid(commandKey);
    const hash = commandHash([caseId, ...parts]);
    return this.port.transaction(userId, organizationId, async (tx) => {
      const actor = await this.requireActor(tx, organizationId);
      const prior = await tx.idempotency(actor.membershipId, commandKey);
      if (prior) {
        if (prior.payloadHash !== hash || prior.caseId !== caseId) throw new MaintenanceError("CONFLICT");
        return this.projectLocked(tx, actor, caseId);
      }
      const row = await tx.lockCase(caseId);
      if (!row) throw new MaintenanceError("DENIED");
      await mutate(tx, actor, row);
      await tx.saveIdempotency(actor.membershipId, commandKey, hash, caseId);
      return this.projectRow(tx, actor, row);
    });
  }

  private newCase(organizationId: string, anchor: AnchorRecord, input: {
    origin: CaseRecord["origin"]; reporterMembershipId: string | null; description: string; createdAt: string;
  }): CaseRecord {
    return {
      caseId: randomUUID(), organizationId, origin: input.origin, reporterMembershipId: input.reporterMembershipId,
      documentId: anchor.documentId, publishedVersionId: anchor.publishedVersionId, contentHash: anchor.contentHash,
      title: anchor.title, description: input.description, anchorPage: null, anchorPassage: null,
      routeDepartmentId: anchor.departmentId, classification: anchor.classification, teamTag: anchor.teamTag,
      projectTag: anchor.projectTag, authorMembershipId: anchor.authorMembershipId, assigneeMembershipId: null,
      reporterStatus: "Submitted", outcome: null, reporterExplanation: null, reviewerRationale: null,
      publicationLinkVersionId: null, publicationLinkSubmissionId: null, publicationLinkReason: null, revision: 1,
      firstClaimedAt: null, createdAt: input.createdAt, resolvedAt: null,
    };
  }

  private requireIndependent(actor: ActorRecord, row: CaseRecord): void {
    if (actor.membershipId === row.authorMembershipId) throw new MaintenanceError("DENIED");
  }

  private async append(tx: MaintenanceTx, row: CaseRecord, actorMembershipId: string, eventType: CaseEventRecord["eventType"],
    audience: CaseEventRecord["audience"], message: string, occurredAt: string): Promise<void> {
    await tx.insertEvent({
      eventId: randomUUID(), organizationId: row.organizationId, caseId: row.caseId,
      sequence: await tx.nextSequence(row.caseId), actorMembershipId, eventType, audience, message, occurredAt,
    });
  }

  private async requireActor(tx: MaintenanceTx, organizationId: string): Promise<ActorRecord> {
    const actor = await tx.actor();
    if (!actor || actor.organizationId !== organizationId) throw new MaintenanceError("DENIED");
    return actor;
  }

  private async safeView(tx: MaintenanceTx, actor: ActorRecord, row: CaseRecord): Promise<CaseProjection | null> {
    return projectCase(row, actor, {
      hasGrant: await tx.hasReviewerGrant(grantSubject(row)),
      isAdmin: await tx.isAdmin(),
      canReadDocument: await tx.canReadVersion(row.publishedVersionId),
    });
  }

  private async projectLocked(tx: MaintenanceTx, actor: ActorRecord, caseId: string): Promise<CaseProjection> {
    const row = await tx.lockCase(caseId);
    if (!row) throw new MaintenanceError("DENIED");
    return this.projectRow(tx, actor, row);
  }

  private async projectRow(tx: MaintenanceTx, actor: ActorRecord, row: CaseRecord): Promise<CaseProjection> {
    const access: CaseAccess = {
      hasGrant: await tx.hasReviewerGrant(grantSubject(row)),
      isAdmin: await tx.isAdmin(),
      canReadDocument: await tx.canReadVersion(row.publishedVersionId),
    };
    const view = projectCase(row, actor, access);
    if (!view) throw new MaintenanceError("DENIED");
    if (view.kind !== "assigned") return view;
    return { ...view, publicationProof: await tx.readPublicationProof(row.documentId, row.publishedVersionId) };
  }

  private async withUnread(tx: MaintenanceTx, actor: ActorRecord, view: CaseProjection): Promise<CaseProjection> {
    return { ...view, unread: await tx.hasUnread(actor.membershipId, view.caseId) };
  }

  private async notify(tx: MaintenanceTx, row: CaseRecord, recipient: string, logicalKey: string, message: string): Promise<void> {
    if (await tx.notificationExists(recipient, logicalKey)) return;
    await tx.insertNotification({
      notificationId: randomUUID(), organizationId: row.organizationId, caseId: row.caseId,
      recipientMembershipId: recipient, logicalKey, message,
    });
  }
}
