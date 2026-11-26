import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorRecord, AnchorRecord, CaseEventRecord, CaseRecord, LegacyReport, NotificationRecord, PublicationSubmission } from "./contracts.js";
import { MaintenanceCaseService, type MaintenanceTx } from "./case-service.js";
import { publicationProofFromPointer } from "./publication-proof.js";
import { MaintenanceError, canonicalIds } from "./contracts.js";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const reporter = { userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", organizationId: org, membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const reviewer = { userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", organizationId: org, membershipId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
const author = { userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", organizationId: org, membershipId: "ffffffff-ffff-4fff-8fff-ffffffffffff" };

class MemoryMaintenance {
  cases: CaseRecord[] = [];
  events: CaseEventRecord[] = [];
  notices: NotificationRecord[] = [];
  imports = new Map<string, string>();
  unmapped: LegacyReport[] = [];
  reads = new Set<string>();
  versions = new Map<string, { documentId: string; text: string | null }>();
  proofs = new Map<string, { state: "pending" | "applicable" | "rejected" | "upcoming"; outcome: "UPDATED" | "WITHDRAWN" | null; publishedVersionId?: string | null }>();
  submissions = new Map<string, PublicationSubmission>();
  links: Array<[string, string]> = [];
  analyses: Array<{ runId: string; caseId: string; state: "queued" | "running" | "succeeded" | "failed" | "cancelled"; findings: Array<{ versionId: string; summary: string }>; versionIds: string[]; startedByMembershipId: string; fence: string | null; attempt: number }> = [];
  keys: Array<{ membershipId: string; requestKey: string; payloadHash: string; caseId: string }> = [];
  anchors = new Map<string, AnchorRecord>();
  grants = new Set<string>();
  names = new Map<string, string>();
  admins = new Set<string>();
  readable = new Set<string>([versionId]);
  private chain: Promise<unknown> = Promise.resolve();

  transaction<T>(_userId: string, organizationId: string, work: (tx: MaintenanceTx) => Promise<T>, actor: ActorRecord | null): Promise<T> {
    const run = this.chain.then(() => work(this.tx(organizationId, actor)));
    this.chain = run.then(() => undefined, () => undefined);
    return run;
  }

  private tx(organizationId: string, actor: ActorRecord | null): MaintenanceTx {
    return {
      actor: async () => actor?.organizationId === organizationId ? actor : null,
      readAnchor: async (document, version) => {
        const anchor = this.anchors.get(`${document}:${version}`);
        return anchor && anchor.organizationId === organizationId && this.readable.has(version) ? anchor : null;
      },
      canReadDocument: async (document) => [...this.anchors.values()]
        .some((anchor) => anchor.documentId === document && this.readable.has(anchor.publishedVersionId)),
      hasReviewerGrant: async () => actor ? this.grants.has(actor.membershipId) : false,
      isAdmin: async () => actor ? this.admins.has(actor.membershipId) : false,
      lockRequest: async () => {},
      lockDocument: async () => true,
      lockCasePair: async () => {},
      idempotency: async (membershipId, requestKey) => this.keys.find((item) => item.membershipId === membershipId && item.requestKey === requestKey) ?? null,
      saveIdempotency: async (membershipId, requestKey, payloadHash, caseId) => { this.keys.push({ membershipId, requestKey, payloadHash, caseId }); },
      insertCase: async (row) => { this.cases.push(structuredClone(row)); },
      lockCase: async (caseId) => structuredClone(this.cases.find((item) => item.caseId === caseId && item.organizationId === organizationId) ?? null),
      listCases: async () => this.cases.filter((item) => item.organizationId === organizationId).map((item) => structuredClone(item)),
      nextSequence: async (caseId) => this.events.filter((item) => item.caseId === caseId).length + 1,
      insertEvent: async (event) => {
        this.events.push(event);
        if (event.eventType !== "SUBMITTED" || event.sequence !== 1) return;
        const row = this.cases.find((item) => item.caseId === event.caseId);
        const eligible = [...this.grants].filter((id) => id !== row?.authorMembershipId);
        for (const recipientMembershipId of eligible.length ? eligible : this.admins) {
          this.notices.push({ notificationId: randomUUID(), organizationId, caseId: event.caseId,
            recipientMembershipId, logicalKey: `submitted:${event.caseId}`,
            message: "A maintenance case is waiting for review." });
        }
      },
      listEvents: async (caseId, after, limit) => this.events.filter((item) => item.caseId === caseId && item.sequence > after)
        .sort((left, right) => left.sequence - right.sequence || left.occurredAt.localeCompare(right.occurredAt)).slice(0, limit),
      saveCase: async (row) => {
        const index = this.cases.findIndex((item) => item.caseId === row.caseId);
        if (index >= 0) this.cases[index] = structuredClone(row);
      },
      insertNotification: async (notice) => {
        if (this.notices.some((item) => item.recipientMembershipId === notice.recipientMembershipId && item.logicalKey === notice.logicalKey)) {
          throw new Error("duplicate notification key");
        }
        this.notices.push(notice);
      },
      eligibleReviewers: async (row) => [...this.grants].filter((id) => id !== row.authorMembershipId)
        .map((membershipId) => ({ membershipId, displayName: this.names.get(membershipId) ?? membershipId })),
      membershipHasGrant: async (membershipId) => this.grants.has(membershipId),
      lockReaderIntake: async () => {},
      hasOpenReaderReport: async (documentId, reporterMembershipId) => this.cases.some((item) => item.organizationId === organizationId
        && item.documentId === documentId && item.reporterMembershipId === reporterMembershipId
        && item.origin === "READER_REPORT" && item.reporterStatus !== "Resolved")
        || this.unmapped.some((report) => report.documentId === documentId
          && report.reporterMembershipId === reporterMembershipId && report.status === "OPEN"),
      findImport: async (reportId) => this.imports.get(`${organizationId}:${reportId}`) ?? null,
      saveImport: async (reportId, caseId) => {
        this.imports.set(`${organizationId}:${reportId}`, caseId);
        this.unmapped = this.unmapped.filter((item) => item.reportId !== reportId);
      },
      unmappedOpenReports: async () => this.unmapped,
      hasUnread: async (membershipId, caseId) => this.notices.some((item) => item.recipientMembershipId === membershipId
        && item.caseId === caseId && !this.reads.has(`${membershipId}:${caseId}`)),
      markRead: async (membershipId, caseId) => { this.reads.add(`${membershipId}:${caseId}`); },
      readVersionText: async (publishedVersionId) => this.versions.get(publishedVersionId) ?? null,
      listDocumentVersions: async () => [],
      readPublicationSubmission: async (submissionId) => this.submissions.get(submissionId) ?? null,
      readPublicationProof: async (documentId, publishedVersionId) => {
        const proof = this.proofs.get(documentId) ?? { state: "pending" as const, outcome: null, publishedVersionId: null };
        return { ...proof, publishedVersionId: proof.publishedVersionId ?? (proof.state === "applicable" ? publishedVersionId : null) };
      },
      saveLink: async (caseId, relatedCaseId) => { this.links.push([caseId, relatedCaseId]); },
      listLinks: async (caseId) => this.links.filter((pair) => pair.includes(caseId)).map((pair) => pair.find((id) => id !== caseId) ?? ""),
      activeAnalysis: async (caseId) => this.analyses.some((item) => item.caseId === caseId && (item.state === "queued" || item.state === "running")),
      queueAnalysis: async (caseId, run) => { this.analyses.push({ ...run, caseId, state: "queued", findings: [], fence: null }); },
      cancelActiveAnalysis: async (caseId) => { this.analyses = this.analyses.map((item) => item.caseId === caseId && (item.state === "queued" || item.state === "running") ? { ...item, state: "cancelled", findings: [], fence: null } : item); },
      expireStaleAnalysis: async () => {},
      failActiveAnalysis: async (caseId) => { this.analyses = this.analyses.map((item) => item.caseId === caseId && (item.state === "queued" || item.state === "running") ? { ...item, state: "failed", findings: [], fence: null } : item); },
      claimAnalysis: async (caseId, fence) => {
        const item = this.analyses.find((run) => run.caseId === caseId && run.state === "queued");
        if (!item) return null;
        item.state = "running";
        item.fence = fence;
        return structuredClone(item);
      },
      commitAnalysis: async (caseId, fence, state, findings) => {
        const item = this.analyses.find((run) => run.caseId === caseId && run.fence === fence && run.state === "running");
        if (!item) return false;
        item.state = state;
        item.findings = findings;
        return true;
      },
      latestAnalysis: async (caseId) => structuredClone(this.analyses.filter((item) => item.caseId === caseId).at(-1) ?? null),
    };
  }
}

function serviceFor(memory: MemoryMaintenance, actor: ActorRecord | null, adapter: import("./analysis.js").AnalysisAdapter | null = null) {
  return new MaintenanceCaseService({
    transaction: (userId, organizationId, work) => memory.transaction(userId, organizationId, work, actor),
  }, adapter);
}

describe("maintenance intake", () => {
  function setup() {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    return memory;
  }

  it("pins the published version and replays the same request key as one case", async () => {
    const memory = setup();
    const service = serviceFor(memory, reporter);
    const key = randomUUID();
    const input = { origin: "READER_REPORT" as const, documentId, publishedVersionId: versionId, description: "Step 3 is wrong." };
    const first = await service.createCase(reporter.userId, org, input, key);
    const second = await service.createCase(reporter.userId, org, input, key);
    expect(first.kind).toBe("reporter");
    expect(second).toMatchObject({ caseId: first.caseId, publishedVersionId: versionId });
    expect(memory.cases).toHaveLength(1);
    expect(memory.events).toHaveLength(1);
    expect(memory.cases[0]).toMatchObject({ documentId, publishedVersionId: versionId, reporterStatus: "Submitted" });
  });

  it("keeps an independent report when the text changes", async () => {
    const memory = setup();
    const service = serviceFor(memory, reporter);
    const key = randomUUID();
    await service.createCase(reporter.userId, org, { origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "First" }, key);
    await expect(service.createCase(reporter.userId, org, { origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Different" }, key))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.cases).toHaveLength(1);
    expect(memory.events).toHaveLength(1);
  });

  it("writes nothing for a forged, stale, or cross-organization anchor", async () => {
    const memory = setup();
    const service = serviceFor(memory, reporter);
    const attempts = [
      { origin: "READER_REPORT" as const, documentId, publishedVersionId: randomUUID(), description: "Missing version" },
      { origin: "READER_REPORT" as const, documentId: randomUUID(), publishedVersionId: versionId, description: "Wrong document" },
    ];
    for (const input of attempts) {
      await expect(service.createCase(reporter.userId, org, input, randomUUID())).rejects.toBeInstanceOf(MaintenanceError);
    }
    await expect(service.createCase(reporter.userId, otherOrg, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Other org",
    }, randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    expect(memory.cases).toHaveLength(0);
    expect(memory.events).toHaveLength(0);
  });

  it("pins an optional passage and lets a reviewer open a case without a reporter", async () => {
    const memory = setup();
    const created = await serviceFor(memory, reviewer).createCase(reviewer.userId, org, {
      origin: "REVIEWER_INTAKE", documentId, publishedVersionId: versionId, description: "Check step 3.",
      anchor: { page: 4, passage: "Restart the service." },
    }, randomUUID());
    expect(created.kind).toBe("queue");
    expect(memory.cases[0]).toMatchObject({
      origin: "REVIEWER_INTAKE", reporterMembershipId: null, anchorPage: 4, anchorPassage: "Restart the service.",
    });
    await expect(serviceFor(memory, author).createCase(author.userId, org, {
      origin: "REVIEWER_INTAKE", documentId, publishedVersionId: versionId, description: "Own document.",
    }, randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    expect(memory.cases).toHaveLength(1);
  });

  it("returns the minimal reporter projection after source access is lost", async () => {
    const memory = setup();
    const service = serviceFor(memory, reporter);
    const created = await service.createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    memory.readable.delete(versionId);
    const view = await service.getCase(reporter.userId, org, created.caseId);
    expect(view).toEqual({ kind: "minimal", caseId: created.caseId, reporterStatus: "Submitted", unread: false });
    const hidden = serviceFor(memory, author);
    await expect(hidden.getCase(author.userId, org, created.caseId)).rejects.toMatchObject({ code: "DENIED" });
  });
});

describe("maintenance assignment", () => {
  function reported() {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    return memory;
  }

  it("lets one reviewer win a claim and keeps the author out", async () => {
    const memory = reported();
    const reporterService = serviceFor(memory, reporter);
    const created = await reporterService.createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    const other = { ...reviewer, userId: randomUUID(), membershipId: randomUUID() };
    memory.grants.add(other.membershipId);
    memory.grants.add(author.membershipId);
    const [winner] = await Promise.all([
      serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID()),
      serviceFor(memory, other).claimCase(other.userId, org, created.caseId, 1, randomUUID()).catch((error: unknown) => error),
    ]);
    expect(winner).toMatchObject({ kind: "assigned", reporterStatus: "In Progress", assigneeMembershipId: reviewer.membershipId });
    await expect(serviceFor(memory, author).claimCase(author.userId, org, created.caseId, 1, randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    const queued = await serviceFor(memory, reviewer).listCases(reviewer.userId, org, "queue");
    expect(queued.some((item) => item.caseId === created.caseId && item.unread)).toBe(true);
    await serviceFor(memory, reviewer).getCase(reviewer.userId, org, created.caseId);
    const opened = await serviceFor(memory, reviewer).listCases(reviewer.userId, org, "queue");
    expect(opened.find((item) => item.caseId === created.caseId)?.unread).toBe(false);
    expect(memory.cases.filter((item) => item.assigneeMembershipId === reviewer.membershipId)).toHaveLength(1);
    expect(memory.events.filter((item) => item.eventType === "CLAIMED")).toHaveLength(1);
    memory.grants.delete(reviewer.membershipId);
    const lost = await serviceFor(memory, reviewer).getCase(reviewer.userId, org, created.caseId);
    expect(lost).toMatchObject({ kind: "queue", needsReassignment: true });
    expect(lost).not.toHaveProperty("description");
  });

  it("blocks the previous reviewer after reassignment and separates the reporter explanation", async () => {
    const memory = reported();
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    const claimed = await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    if (claimed.kind !== "assigned") throw new Error("expected the claimer to see the assigned case");
    const admin = { userId: randomUUID(), organizationId: org, membershipId: randomUUID() };
    const next = { userId: randomUUID(), organizationId: org, membershipId: randomUUID() };
    memory.admins.add(admin.membershipId);
    memory.grants.add(next.membershipId);
    memory.grants.add(author.membershipId);
    memory.names.set(next.membershipId, "Synthetic Next");
    await expect(serviceFor(memory, reviewer).listEligibleReviewers(reviewer.userId, org, created.caseId)).rejects.toMatchObject({ code: "DENIED" });
    const choices = await serviceFor(memory, admin).listEligibleReviewers(admin.userId, org, created.caseId);
    expect(choices).toContainEqual({ membershipId: next.membershipId, displayName: "Synthetic Next" });
    expect(choices.some((item) => item.membershipId === author.membershipId)).toBe(false);
    memory.grants.delete(author.membershipId);
    const moved = await serviceFor(memory, admin).reassignCase(admin.userId, org, created.caseId, claimed.revision, next.membershipId, "Coverage changed.", randomUUID());
    if (moved.kind !== "assigned") throw new Error("expected the admin to see the reassigned case");
    await expect(serviceFor(memory, reviewer).decideNoChange(reviewer.userId, org, created.caseId, claimed.revision,
      "Nothing to change.", "Internal note.", randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    await expect(serviceFor(memory, next).decideNoChange(next.userId, org, created.caseId, claimed.revision,
      "Nothing to change.", "Internal note.", randomUUID())).rejects.toMatchObject({ code: "STALE" });
    memory.grants.delete(next.membershipId);
    await expect(serviceFor(memory, next).decideNoChange(next.userId, org, created.caseId, moved.revision,
      "Nothing to change.", "Internal note.", randomUUID())).rejects.toMatchObject({ code: "DENIED" });
    memory.grants.add(next.membershipId);
    const resolved = await serviceFor(memory, next).decideNoChange(next.userId, org, created.caseId, moved.revision,
      "The published step is still correct.", "Checked the source note.", randomUUID());
    expect(resolved).toMatchObject({ reporterStatus: "Resolved" });
    const reporterHistory = await serviceFor(memory, reporter).listHistory(reporter.userId, org, created.caseId, null);
    expect(reporterHistory.items.map((item) => item.message)).toContain("The published step is still correct.");
    expect(reporterHistory.items.map((item) => item.message)).not.toContain("Checked the source note.");
    expect(memory.notices.filter((item) => item.logicalKey === `resolved:${created.caseId}`)).toHaveLength(1);
    await serviceFor(memory, next).decideNoChange(next.userId, org, created.caseId, moved.revision,
      "The published step is still correct.", "Checked the source note.", memory.keys.at(-1)!.requestKey);
    expect(memory.notices.filter((item) => item.logicalKey === `resolved:${created.caseId}`)).toHaveLength(1);
  });
});

describe("version comparison access", () => {
  it("returns the labeled pair for readable text and withholds a missing source", async () => {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    const next = randomUUID();
    memory.versions.set(versionId, { documentId, text: "Restart the service." });
    memory.versions.set(next, { documentId, text: "Restart the service after saving." });
    memory.readable.add(next);
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    const compared = await serviceFor(memory, reviewer).compareCase(reviewer.userId, org, created.caseId, versionId, next);
    expect(compared.unavailable).toBe(false);
    if (!compared.unavailable) expect(compared.rows).toContainEqual({ kind: "added", text: "Restart the service after saving." });
    memory.versions.set(next, { documentId, text: "x".repeat(20_001) });
    const oversized = await serviceFor(memory, reviewer).compareCase(reviewer.userId, org, created.caseId, versionId, next);
    expect(oversized).toMatchObject({ unavailable: true });
    const otherDocument = randomUUID();
    memory.versions.set(next, { documentId: otherDocument, text: "A different guide." });
    const foreign = await serviceFor(memory, reviewer).compareCase(reviewer.userId, org, created.caseId, versionId, next);
    expect(foreign).toMatchObject({ unavailable: true });
    const original = await serviceFor(memory, reviewer).readOriginal(reviewer.userId, org, created.caseId, versionId);
    expect(original).toMatchObject({ unavailable: false, publishedVersionId: versionId, text: "Restart the service." });
    const hiddenOriginal = await serviceFor(memory, reviewer).readOriginal(reviewer.userId, org, created.caseId, next);
    expect(hiddenOriginal).toMatchObject({ unavailable: true, publishedVersionId: next });
    memory.versions.set(next, { documentId, text: "Restart the service." });
    const identical = await serviceFor(memory, reviewer).compareCase(reviewer.userId, org, created.caseId, versionId, next);
    expect(identical.unavailable).toBe(false);
    if (!identical.unavailable) expect(identical.rows.some((row) => row.kind === "added" || row.kind === "removed")).toBe(false);
    memory.versions.set(versionId, { documentId, text: "" });
    memory.versions.set(next, { documentId, text: "" });
    const empty = await serviceFor(memory, reviewer).compareCase(reviewer.userId, org, created.caseId, versionId, next);
    expect(empty).toMatchObject({ unavailable: false, rows: [] });
    memory.versions.set(next, { documentId, text: null });
    const scanned = await serviceFor(memory, reviewer).compareCase(reviewer.userId, org, created.caseId, versionId, next);
    expect(scanned).toMatchObject({ unavailable: true });
    memory.grants.delete(reviewer.membershipId);
    const lost = await serviceFor(memory, reviewer).getCase(reviewer.userId, org, created.caseId);
    expect(lost).toMatchObject({ kind: "queue", needsReassignment: true });
    await expect(serviceFor(memory, reviewer).compareCase(reviewer.userId, org, created.caseId, versionId, next)).rejects.toMatchObject({ code: "DENIED" });
    await expect(serviceFor(memory, reviewer).readOriginal(reviewer.userId, org, created.caseId, versionId)).rejects.toMatchObject({ code: "DENIED" });
    memory.grants.add(reviewer.membershipId);
    await expect(serviceFor(memory, reporter).compareCase(reporter.userId, org, created.caseId, versionId, next)).rejects.toMatchObject({ code: "DENIED" });
    await expect(serviceFor(memory, reporter).readOriginal(reporter.userId, org, created.caseId, versionId)).rejects.toMatchObject({ code: "DENIED" });
    const admin = { userId: randomUUID(), organizationId: org, membershipId: randomUUID() };
    memory.admins.add(admin.membershipId);
    await expect(serviceFor(memory, admin).readOriginal(admin.userId, org, created.caseId, versionId)).rejects.toMatchObject({ code: "DENIED" });
    await expect(serviceFor(memory, admin).compareCase(admin.userId, org, created.caseId, versionId, next)).rejects.toMatchObject({ code: "DENIED" });
    await expect(serviceFor(memory, admin).listVersions(admin.userId, org, created.caseId)).resolves.toMatchObject({ items: [] });
  });
});

describe("publication proof", () => {
  const reported = "44444444-4444-4444-8444-444444444444";
  const current = "78787878-7878-4787-8787-787878787878";
  const pointer = {
    currentVersionId: current, currentVersionNo: 5, reportedVersionNo: 3,
    validFrom: "2020-01-01T00:00:00.000Z", validUntil: null, status: "APPROVED",
    requestType: "CONTENT", publicationState: "ACTIVE", rejected: false, withdrawn: false,
  };

  it("accepts only a later in-force version or an applied withdrawal", () => {
    expect(publicationProofFromPointer(reported, pointer).outcome).toBe("UPDATED");
    expect(publicationProofFromPointer(reported, { ...pointer, currentVersionId: reported, currentVersionNo: 3 }).state).toBe("pending");
    expect(publicationProofFromPointer(reported, { ...pointer, currentVersionId: reported, currentVersionNo: 3, rejected: true }).state).toBe("rejected");
    expect(publicationProofFromPointer(reported, { ...pointer, validFrom: "2999-01-01T00:00:00.000Z" }).state).toBe("upcoming");
    expect(publicationProofFromPointer(reported, null).state).toBe("pending");
    expect(publicationProofFromPointer(reported, { ...pointer, currentVersionId: "", withdrawn: true })).toMatchObject({ state: "applicable", outcome: "WITHDRAWN" });
  });

  async function claimed() {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    const claim = await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    return { memory, claim };
  }

  it("keeps the case open until the publication outcome applies", async () => {
    const { memory, claim } = await claimed();
    if (claim.kind !== "assigned") throw new Error("expected an assigned case");
    const confirm = (evidence = versionId) => serviceFor(memory, reviewer).confirmPublication(reviewer.userId, org, claim.caseId, claim.revision,
      "The correction is published.", "Matched the replacement.", evidence, randomUUID());
    await expect(confirm()).rejects.toMatchObject({ code: "CONFLICT" });
    memory.proofs.set(documentId, { state: "rejected", outcome: null });
    await expect(confirm()).rejects.toMatchObject({ code: "CONFLICT" });
    memory.proofs.set(documentId, { state: "upcoming", outcome: "UPDATED" });
    await expect(confirm()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.cases[0]?.reporterStatus).toBe("In Progress");
    memory.versions.set(versionId, { documentId, text: "Restart the service." });
    memory.proofs.set(documentId, { state: "applicable", outcome: "UPDATED", publishedVersionId: versionId });
    await expect(serviceFor(memory, reviewer).linkPublication(reviewer.userId, org, claim.caseId, claim.revision,
      { publishedVersionId: randomUUID() }, "A different version.", randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(confirm(randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(confirm(versionId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.cases[0]?.reporterStatus).toBe("In Progress");
    const linked = await serviceFor(memory, reviewer).linkPublication(reviewer.userId, org, claim.caseId, claim.revision,
      { publishedVersionId: versionId }, "Version 5 is the current publication.", randomUUID());
    expect(linked.reporterStatus).toBe("In Progress");
    if (linked.kind !== "assigned") throw new Error("expected the linked case to stay assigned");
    expect(linked.publicationLinkVersionId).toBe(versionId);
    const resolved = await serviceFor(memory, reviewer).confirmPublication(reviewer.userId, org, claim.caseId, linked.revision,
      "The correction is published.", "Matched the replacement.", versionId, randomUUID());
    expect(resolved.reporterStatus).toBe("Resolved");
    expect(memory.cases[0]?.outcome).toBe("UPDATED");
  });

  it("accepts a withdrawn document only for the exact withdrawn version", async () => {
    const { memory, claim } = await claimed();
    if (claim.kind !== "assigned") throw new Error("expected an assigned case");
    const withdrawnVersion = randomUUID();
    const unrelated = randomUUID();
    const replacement = randomUUID();
    memory.submissions.set(unrelated, { documentId, requestType: "CONTENT", status: "APPROVED",
      producedVersionId: randomUUID(), targetPublishedVersionId: null, withdrawn: true });
    memory.submissions.set(replacement, { documentId, requestType: "CONTENT", status: "APPROVED",
      producedVersionId: withdrawnVersion, targetPublishedVersionId: null, withdrawn: true });
    memory.proofs.set(documentId, { state: "applicable", outcome: "WITHDRAWN", publishedVersionId: withdrawnVersion });
    const link = async (submissionId: string, revision: number) => serviceFor(memory, reviewer).linkPublication(reviewer.userId, org,
      claim.caseId, revision, { submissionId }, "The replacement was withdrawn.", randomUUID());
    const confirm = (revision: number) => serviceFor(memory, reviewer).confirmPublication(reviewer.userId, org, claim.caseId,
      revision, "The guide was withdrawn.", "Matched the withdrawn version.", withdrawnVersion, randomUUID());
    const wrong = await link(unrelated, claim.revision);
    await expect(confirm((wrong as { revision: number }).revision)).rejects.toMatchObject({ code: "CONFLICT" });
    const right = await link(replacement, (wrong as { revision: number }).revision);
    await expect(confirm((right as { revision: number }).revision)).resolves.toMatchObject({ reporterStatus: "Resolved" });
    expect(memory.cases[0]?.outcome).toBe("WITHDRAWN");
  });

  it("keeps a pending author request open until that request applies", async () => {
    const { memory, claim } = await claimed();
    if (claim.kind !== "assigned") throw new Error("expected an assigned case");
    const submissionId = randomUUID();
    memory.submissions.set(submissionId, {
      documentId, requestType: "WITHDRAWAL", status: "PENDING_REVIEW", producedVersionId: null,
      targetPublishedVersionId: versionId, withdrawn: false,
    });
    const link = (reference: { publishedVersionId?: string; submissionId?: string }, revision = claim.revision) =>
      serviceFor(memory, reviewer).linkPublication(reviewer.userId, org, claim.caseId, revision, reference, "The author asked to withdraw the guide.", randomUUID());
    const readerChange = randomUUID();
    memory.submissions.set(readerChange, { documentId, requestType: "READER_CHANGE", status: "PENDING_REVIEW",
      producedVersionId: null, targetPublishedVersionId: versionId, withdrawn: false });
    await expect(link({ submissionId: readerChange })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(link({ submissionId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    const linked = await link({ submissionId });
    expect(linked.reporterStatus).toBe("In Progress");
    if (linked.kind !== "assigned") throw new Error("expected the request to stay assigned");
    expect(linked.publicationLinkSubmissionId).toBe(submissionId);
    memory.proofs.set(documentId, { state: "applicable", outcome: "UPDATED", publishedVersionId: versionId });
    await expect(serviceFor(memory, reviewer).confirmPublication(reviewer.userId, org, claim.caseId, linked.revision,
      "The guide was withdrawn.", "The request is still pending.", versionId, randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.cases[0]?.reporterStatus).toBe("In Progress");
    const pending = memory.submissions.get(submissionId)!;
    memory.proofs.set(documentId, { state: "applicable", outcome: "WITHDRAWN", publishedVersionId: versionId });
    memory.submissions.set(submissionId, { ...pending, status: "APPROVED", targetPublishedVersionId: randomUUID() });
    await expect(serviceFor(memory, reviewer).confirmPublication(reviewer.userId, org, claim.caseId, linked.revision,
      "The guide was withdrawn.", "A different version was targeted.", versionId, randomUUID())).rejects.toMatchObject({ code: "CONFLICT" });
    memory.submissions.set(submissionId, { ...pending, status: "APPROVED" });
    const resolved = await serviceFor(memory, reviewer).confirmPublication(reviewer.userId, org, claim.caseId, linked.revision,
      "The guide was withdrawn.", "The approved request targeted the report’s exact version.", versionId, randomUUID());
    expect(resolved.reporterStatus).toBe("Resolved");
    expect(memory.cases[0]?.outcome).toBe("WITHDRAWN");
  });
});

describe("bounded analysis", () => {
  it("keeps one active run, drops a cancelled result, and cites the selected version", async () => {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    memory.versions.set(versionId, { documentId, text: "Restart the service." });
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    const service = serviceFor(memory, reviewer, async (request) => {
      if (request.versionIds.includes(versionId) && memory.analyses.some((item) => item.state === "running")) {
        await serviceFor(memory, reviewer).cancelAnalysis(reviewer.userId, org, created.caseId, randomUUID());
      }
      return { contractVersion: 1, state: "succeeded", findings: request.versionIds.map((id) => ({ versionId: id, summary: "The selected version was compared with the reported evidence." })) };
    });
    const queued = await service.startAnalysis(reviewer.userId, org, created.caseId, [versionId], randomUUID());
    expect(queued.state).toBe("queued");
    await expect(service.startAnalysis(reviewer.userId, org, created.caseId, [versionId], randomUUID()))
      .rejects.toMatchObject({ code: "CONFLICT" });
    const withheld = await service.readAnalysis(reviewer.userId, org, created.caseId);
    expect(withheld.state).toBe("cancelled");
    expect(withheld.findings).toEqual([]);
    const retry = serviceFor(memory, reviewer, async (request) => ({
      contractVersion: 1 as const, state: "succeeded" as const,
      findings: request.versionIds.map((id) => ({ versionId: id, summary: "The selected version was compared with the reported evidence." })),
    }));
    const again = await retry.startAnalysis(reviewer.userId, org, created.caseId, [versionId], randomUUID());
    expect(again.attempt).toBe(2);
    const finished = await retry.readAnalysis(reviewer.userId, org, created.caseId);
    expect(finished.state).toBe("succeeded");
    expect(finished.findings).toEqual([{ versionId, summary: "The selected version was compared with the reported evidence." }]);
    memory.versions.set(versionId, { documentId, text: null });
    await expect(retry.readAnalysis(reviewer.userId, org, created.caseId)).resolves.toMatchObject({ state: "succeeded", findings: [] });
    memory.versions.set(versionId, { documentId, text: "Restart the service." });
    memory.grants.delete(reviewer.membershipId);
    await retry.startAnalysis(reviewer.userId, org, created.caseId, [versionId], randomUUID()).catch(() => undefined);
    memory.grants.add(reviewer.membershipId);
    const lost = await serviceFor(memory, reviewer, async () => ({ contractVersion: 1, state: "succeeded", findings: [{ versionId, summary: "Late." }] }))
      .startAnalysis(reviewer.userId, org, created.caseId, [versionId], randomUUID());
    expect(lost.state).toBe("queued");
    memory.grants.delete(reviewer.membershipId);
    await expect(serviceFor(memory, reviewer, async () => ({ contractVersion: 1, state: "succeeded", findings: [{ versionId, summary: "Late." }] }))
      .readAnalysis(reviewer.userId, org, created.caseId)).rejects.toMatchObject({ code: "DENIED" });
    expect(() => serviceFor(memory, reviewer).startAnalysis(reviewer.userId, org, created.caseId, [versionId], randomUUID()))
      .toThrow("UNAVAILABLE");
  });

  it("returns a run that another poll finished meanwhile with its findings", async () => {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    memory.versions.set(versionId, { documentId, text: "Restart the service." });
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    const adapter: import("./analysis.js").AnalysisAdapter = async (request) => ({
      contractVersion: 1, state: "succeeded", findings: request.versionIds.map((id) => ({ versionId: id, summary: "Compared." })),
    });
    await serviceFor(memory, reviewer, adapter).startAnalysis(reviewer.userId, org, created.caseId, [versionId], randomUUID());
    // The second poll reads the run as queued; the first poll finishes it before the second one advances.
    let transactions = 0;
    const second = new MaintenanceCaseService({
      transaction: async (userId, organizationId, work) => {
        transactions += 1;
        if (transactions === 2) await serviceFor(memory, reviewer, adapter).readAnalysis(reviewer.userId, org, created.caseId);
        return memory.transaction(userId, organizationId, work, reviewer);
      },
    }, adapter);
    await expect(second.readAnalysis(reviewer.userId, org, created.caseId))
      .resolves.toMatchObject({ state: "succeeded", findings: [{ versionId, summary: "Compared." }] });
  });
});

describe("canonical identifiers", () => {
  it("lowercases identifier fields and keeps free text as typed", () => {
    const upper = "44444444-4444-4444-8444-44444444ABCD";
    expect(canonicalIds({ publishedVersionId: upper, versionIds: [upper], description: upper, anchor: { passage: upper } }))
      .toEqual({ publishedVersionId: upper.toLowerCase(), versionIds: [upper.toLowerCase()], description: upper, anchor: { passage: upper } });
    expect(canonicalIds(upper)).toBe(upper.toLowerCase());
  });
});

describe("case conversation", () => {
  it("notifies every follow-up question and reply instead of failing on a repeated key", async () => {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    const claimed = await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    const say = (actor: ActorRecord, message: string) =>
      serviceFor(memory, actor).postMessage(actor.userId, org, created.caseId, (claimed as { revision: number }).revision, message, randomUUID());
    await say(reviewer, "Which checklist?");
    await say(reviewer, "Is it the printed one?");
    await say(reporter, "Trolley 2.");
    await say(reporter, "Printed last week.");
    const keys = (recipient: string, prefix: string) => memory.notices
      .filter((item) => item.recipientMembershipId === recipient && item.logicalKey.startsWith(prefix)).map((item) => item.logicalKey);
    expect(new Set(keys(reporter.membershipId, "question:")).size).toBe(2);
    expect(new Set(keys(reviewer.membershipId, "reply:")).size).toBe(2);
    expect(memory.events.filter((item) => item.eventType === "MESSAGE")).toHaveLength(4);
  });
});

describe("review independence and private history", () => {
  it("keeps reviewer-only history to the assigned view and the reporter off their own report", async () => {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    memory.grants.add(reporter.membershipId);
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    await expect(serviceFor(memory, reporter).claimCase(reporter.userId, org, created.caseId, 1, randomUUID()))
      .rejects.toMatchObject({ code: "DENIED" });
    const claimed = await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    const resolved = await serviceFor(memory, reviewer).decideNoChange(reviewer.userId, org, created.caseId,
      (claimed as { revision: number }).revision, "Correct as published.", "Private reviewer reasoning.", randomUUID());
    expect(resolved).toMatchObject({ kind: "assigned", canDecide: false });
    const peer = { userId: randomUUID(), organizationId: org, membershipId: randomUUID() };
    memory.grants.add(peer.membershipId);
    const peerHistory = await serviceFor(memory, peer).listHistory(peer.userId, org, created.caseId, null);
    expect(peerHistory.items.map((item) => item.message)).not.toContain("Private reviewer reasoning.");
    const assignedHistory = await serviceFor(memory, reviewer).listHistory(reviewer.userId, org, created.caseId, null);
    expect(assignedHistory.items.map((item) => item.message)).toContain("Private reviewer reasoning.");
    const admin = { userId: randomUUID(), organizationId: org, membershipId: randomUUID() };
    memory.admins.add(admin.membershipId);
    await expect(serviceFor(memory, admin).reassignCase(admin.userId, org, created.caseId,
      (resolved as { revision: number }).revision, peer.membershipId, "Coverage changed.", randomUUID()))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("related cases", () => {
  it("links a recurrence without changing either case", async () => {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    const first = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    const claimed = await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, first.caseId, 1, randomUUID());
    if (claimed.kind !== "assigned") throw new Error("expected an assigned case");
    await serviceFor(memory, reviewer).decideNoChange(reviewer.userId, org, first.caseId, claimed.revision,
      "Correct as published.", "Checked the source.", randomUUID());
    const second = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "The same step regressed.",
    }, randomUUID());
    await serviceFor(memory, reviewer).linkRelated(reviewer.userId, org, second.caseId, first.caseId, randomUUID());
    expect(memory.cases.find((item) => item.caseId === first.caseId)?.reporterStatus).toBe("Resolved");
    expect(memory.cases.find((item) => item.caseId === second.caseId)?.reporterStatus).toBe("Submitted");
    expect(memory.links).toEqual([[second.caseId, first.caseId]]);
    expect(await serviceFor(memory, reviewer).listRelated(reviewer.userId, org, second.caseId)).toEqual([
      { caseId: first.caseId, reporterStatus: "Resolved", title: "IT Support Guide" },
    ]);
    await expect(serviceFor(memory, reporter).listRelated(reporter.userId, org, second.caseId))
      .rejects.toMatchObject({ code: "DENIED" });
    await expect(serviceFor(memory, reviewer).linkRelated(reviewer.userId, org, second.caseId, randomUUID(), randomUUID()))
      .rejects.toMatchObject({ code: "DENIED" });
    const hiddenId = randomUUID();
    memory.cases.push({ ...memory.cases[0]!, caseId: hiddenId, authorMembershipId: reviewer.membershipId, reporterMembershipId: author.membershipId, assigneeMembershipId: null, reporterStatus: "Submitted", outcome: null });
    memory.links.push([second.caseId, hiddenId]);
    const visible = await serviceFor(memory, reviewer).listRelated(reviewer.userId, org, second.caseId);
    expect(visible.map((item) => item.caseId)).toEqual([first.caseId]);
    expect(Object.keys(visible[0] ?? {})).toEqual(["caseId", "reporterStatus", "title"]);
    const claimedSecond = await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, second.caseId, 1, randomUUID());
    if (claimedSecond.kind !== "assigned") throw new Error("expected an assigned case");
    await serviceFor(memory, reviewer).decideNoChange(reviewer.userId, org, second.caseId, claimedSecond.revision,
      "This recurrence needs no change.", "Checked separately.", randomUUID());
    expect(memory.cases.find((item) => item.caseId === first.caseId)).toMatchObject({ reporterStatus: "Resolved", outcome: "NO_CHANGE_NEEDED", reporterExplanation: "Correct as published." });
    expect(memory.cases.find((item) => item.caseId === second.caseId)).toMatchObject({ reporterStatus: "Resolved", outcome: "NO_CHANGE_NEEDED", reporterExplanation: "This recurrence needs no change." });
    await expect(serviceFor(memory, reporter).linkRelated(reporter.userId, org, second.caseId, first.caseId, randomUUID()))
      .rejects.toMatchObject({ code: "DENIED" });
  });
});

describe("maintenance questions", () => {
  it("keeps the case in progress while a question and reply are exchanged", async () => {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.grants.add(reviewer.membershipId);
    const created = await serviceFor(memory, reporter).createCase(reporter.userId, org, {
      origin: "READER_REPORT", documentId, publishedVersionId: versionId, description: "Step 3 is wrong.",
    }, randomUUID());
    const claimed = await serviceFor(memory, reviewer).claimCase(reviewer.userId, org, created.caseId, 1, randomUUID());
    if (claimed.kind !== "assigned") throw new Error("expected an assigned case");
    const asked = await serviceFor(memory, reviewer).postMessage(reviewer.userId, org, created.caseId, claimed.revision, "Which page?", randomUUID());
    const replied = await serviceFor(memory, reporter).postMessage(reporter.userId, org, created.caseId, claimed.revision, "Page 4.", randomUUID());
    expect(asked.reporterStatus).toBe("In Progress");
    expect(replied.reporterStatus).toBe("In Progress");
    const history = await serviceFor(memory, reviewer).listHistory(reviewer.userId, org, created.caseId, null);
    expect(history.items.map((item) => item.message)).toEqual(expect.arrayContaining(["Which page?", "Page 4."]));
    const before = memory.events.length;
    await expect(serviceFor(memory, reporter).postMessage(reporter.userId, org, created.caseId, claimed.revision + 1, "Too late.", randomUUID()))
      .rejects.toMatchObject({ code: "STALE" });
    expect(memory.events).toHaveLength(before);
    const resolved = await serviceFor(memory, reviewer).decideNoChange(reviewer.userId, org, created.caseId, claimed.revision,
      "The step is correct.", "Checked page 4.", randomUUID());
    expect(resolved.reporterStatus).toBe("Resolved");
  });
});

describe("maintenance report cutover", () => {
  function setup() {
    const memory = new MemoryMaintenance();
    memory.anchors.set(`${documentId}:${versionId}`, {
      organizationId: org, documentId, publishedVersionId: versionId, contentHash: "ab".repeat(32),
      title: "IT Support Guide", classification: "INTERNAL", departmentId: "dept", teamTag: null, projectTag: null,
      authorMembershipId: author.membershipId,
    });
    memory.admins.add(reviewer.membershipId);
    return memory;
  }

  it("keeps one open legacy report and imports an eligible row once", async () => {
    const memory = setup();
    const reader = serviceFor(memory, reporter);
    await reader.acceptLegacyReport(reporter.userId, org, {
      documentId, publishedVersionId: versionId, message: "Wrong figures",
    });
    await expect(reader.acceptLegacyReport(reporter.userId, org, {
      documentId, publishedVersionId: versionId, message: "Still wrong",
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.cases).toHaveLength(1);
    expect(memory.notices.filter((item) => item.logicalKey.startsWith("submitted:"))).toHaveLength(1);

    const openId = randomUUID();
    const closedId = randomUUID();
    const hiddenId = randomUUID();
    const reports = [
      { reportId: openId, documentId, publishedVersionId: versionId, reporterMembershipId: author.membershipId,
        message: "Old open report", createdAt: "2026-11-01T00:00:00.000Z", status: "OPEN" as const, verifiable: true },
      { reportId: closedId, documentId, publishedVersionId: versionId, reporterMembershipId: author.membershipId,
        message: "Already closed", createdAt: "2026-10-01T00:00:00.000Z", status: "CLOSED" as const, verifiable: true },
      { reportId: hiddenId, documentId, publishedVersionId: versionId, reporterMembershipId: author.membershipId,
        message: "Missing pin", createdAt: "2026-10-02T00:00:00.000Z", status: "OPEN" as const, verifiable: false },
    ];
    const admin = serviceFor(memory, reviewer);
    const imported = await admin.importReports(reviewer.userId, org, reports);
    const again = await admin.importReports(reviewer.userId, org, reports);
    expect(imported.retained).toEqual([closedId]);
    expect(imported.held).toEqual([hiddenId]);
    expect(imported.imported).toHaveLength(1);
    expect(again.imported).toEqual(imported.imported);
    expect(memory.cases).toHaveLength(2);
    expect(memory.events.filter((item) => item.eventType === "IMPORTED")).toHaveLength(1);
    expect(memory.notices.filter((item) => item.caseId === imported.imported[0]?.caseId)).toHaveLength(0);
    await expect(serviceFor(memory, reporter).importReports(reporter.userId, org, reports)).rejects.toMatchObject({ code: "DENIED" });
  });

  it("imports the unmapped open rows an operator can read, and the same wording after closure starts a new case", async () => {
    const memory = setup();
    const openId = randomUUID();
    memory.unmapped = [{
      reportId: openId, documentId, publishedVersionId: versionId, reporterMembershipId: author.membershipId,
      message: "Still listed", createdAt: "2026-11-02T00:00:00.000Z", status: "OPEN", verifiable: true,
    }];
    const admin = serviceFor(memory, reviewer);
    const imported = await admin.importOpenReports(reviewer.userId, org);
    const again = await admin.importOpenReports(reviewer.userId, org);
    expect(imported.imported).toEqual([{ reportId: openId, caseId: imported.imported[0]?.caseId }]);
    expect(again.imported).toEqual([]);
    expect(memory.cases).toHaveLength(1);
    await expect(serviceFor(memory, reporter).importOpenReports(reporter.userId, org)).rejects.toMatchObject({ code: "DENIED" });

    const reader = serviceFor(memory, reporter);
    const first = await reader.acceptLegacyReport(reporter.userId, org, {
      documentId, publishedVersionId: versionId, message: "Same wording",
    });
    const stored = memory.cases.find((item) => item.caseId === first.caseId);
    if (stored) stored.reporterStatus = "Resolved";
    const second = await reader.acceptLegacyReport(reporter.userId, org, {
      documentId, publishedVersionId: versionId, message: "Same wording",
    });
    expect(second.caseId).not.toBe(first.caseId);
    expect(memory.cases.filter((item) => item.description === "Same wording")).toHaveLength(2);
  });
});
