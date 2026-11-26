import { ARDEN_DOCUMENT_PREFIX, serializeSemanticDocument } from "@arden/domain";
import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationRequest, GenerationResponse } from "../answers/governed-contracts.js";
import type { PrivateDraft } from "../db/repository.js";
import { registerPrivateNoteQuestion } from "./question.js";
import { privateFeedbackTickets, registerPrivateFeedbackRoute } from "./feedback.js";

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

function harness(body = "# Handover\nReturn the badge on Friday.", enabled = true) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
  apps.push(app);
  const userId = randomUUID(), organizationId = randomUUID(), id = randomUUID();
  const note: PrivateDraft = { id, organizationId, title: "Handover", versionId: randomUUID(),
    sourceUri: `arden-private-object://${randomUUID()}`, mimeType: "text/plain",
    contentHash: createHash("sha256").update(body).digest("hex"), currentVersion: 2, createdAt: new Date(0),
    updatedAt: new Date(0), collectionId: null, favoritedAt: null, position: null };
  const getDraft = vi.fn(async (actor: string, org: string, draft: string): Promise<PrivateDraft | null> =>
    actor === userId && org === organizationId && draft === id ? { ...note } : null);
  const read = vi.fn(async () => body);
  const generate = vi.fn(async (input: GenerationRequest): Promise<GenerationResponse> => ({
    contractVersion: 2, requestId: input.requestId, status: "ANSWERED", answer: "Return the badge on Friday.",
    citations: [{ chunkId: input.evidence[0].chunkId, quote: "Return the badge on Friday." }],
    usedEvidence: input.evidence.map(passage => passage.chunkId),
    usageContractVersion: 1,
    usageEvents: [],
  }));
  const actor = async (request: import("fastify").FastifyRequest) => ({
    userId: request.headers["x-other-member"] ? randomUUID() : userId,
  });
  const organizations = new Set(enabled ? [organizationId] : []);
  let now = 1_795_500_000_000;
  const tickets = privateFeedbackTickets(Buffer.alloc(32, 9), () => now);
  const write = vi.fn(async () => true);
  registerPrivateNoteQuestion(app, { getDraft }, { read }, { generate }, actor, "^[0-9a-f-]{36}$", organizations, tickets.issue);
  registerPrivateFeedbackRoute(app, write, actor, "^[0-9a-f-]{36}$", organizations, tickets);
  const path = `/api/v1/organizations/${organizationId}/private-workspace/drafts/${id}/questions`;
  const feedbackUrl = `/api/v1/organizations/${organizationId}/ai/private-feedback`;
  const payload = { requestId: randomUUID(), query: "When do I return the badge?", expectedVersion: 2 };
  const ask = (options = {}) => app.inject({ method: "POST", url: path, payload, ...options });
  const rate = (token: string, feedback: unknown, options = {}) => app.inject({ method: "PUT", url: feedbackUrl,
    payload: { token, feedback }, ...options });
  return { note, getDraft, generate, read, ask, path, payload, userId, rate, write,
    expireTicket: () => { now += 24 * 60 * 60 * 1_000; } };
}

describe("exact private note questions", () => {
  it("authorizes and reads only the requested saved copy, and quotes that note", async () => {
    const h = harness();
    const response = await h.ask();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(h.getDraft.mock.calls).toEqual(Array(3).fill([h.userId, h.note.organizationId, h.note.id, { forQuestion: true }]));
    expect(h.read.mock.calls).toEqual([[h.note.sourceUri, h.note.contentHash]]);
    expect(h.generate).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "READER_QUESTION", history: [],
      evidence: [expect.objectContaining({ snapshotVersionId: h.note.versionId, snapshotContentHash: h.note.contentHash,
        content: "# Handover\nReturn the badge on Friday." })],
    }));
    expect(response.json()).toMatchObject({ status: "ANSWERED", citations: [{ documentId: h.note.id, versionId: h.note.versionId,
      startOffset: 11, excerpt: "Return the badge on Friday." }], noteCoverage: "FULL" });
  });

  it("answers a PDF item from its extracted text and refuses a PDF without text (decision 0034)", async () => {
    const h = harness();
    const text = { sourceUri: `arden-private-object://${randomUUID()}`, contentHash: h.note.contentHash };
    Object.assign(h.note, { mimeType: "application/pdf", sourceUri: `arden-private-object://${randomUUID()}.pdf`, text });
    const answered = await h.ask();
    expect(answered.statusCode).toBe(200);
    expect(h.read.mock.calls).toEqual([[text.sourceUri, text.contentHash]]);

    Object.assign(h.note, { text: null });
    const refused = await h.ask({ payload: { ...h.payload, requestId: randomUUID() } });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.message).toBe("AI is unavailable for this file because it has no text.");
    expect(h.read).toHaveBeenCalledTimes(1);
  });

  it("reports partial coverage when a long note has text outside the selected passages", async () => {
    const h = harness("Return the badge on Friday. " + "🟣".repeat(9000) + " Final decision.");
    const result = await h.ask();
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ status: "ANSWERED", noteCoverage: "PARTIAL" });
    expect(h.generate.mock.calls[0][0].evidence.length).toBeLessThanOrEqual(8);
  });

  it("does not count unselected whitespace as omitted content", async () => {
    const h = harness("Return the badge on Friday." + " ".repeat(10000));
    const result = await h.ask();
    expect(result.statusCode).toBe(200);
    expect(result.json().noteCoverage).toBe("FULL");
  });

  it("answers a rich note from its text, never from the stored document encoding", async () => {
    const body = serializeSemanticDocument({ schemaVersion: 1, blocks: [
      { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Handover", styles: {} }], children: [] },
      { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "Return the badge on ", styles: {} },
        { type: "text", text: "Friday", styles: { bold: true } }, { type: "text", text: ".", styles: {} }], children: [] }] });
    const h = harness(body);
    const response = await h.ask();
    expect(response.statusCode).toBe(200);
    expect(h.generate.mock.calls[0][0].evidence.map(passage => passage.content).join("")).toBe("Handover\nReturn the badge on Friday.");
  });

  it("refuses a malformed rich note without inference", async () => {
    const h = harness(`${ARDEN_DOCUMENT_PREFIX}{broken`);
    const response = await h.ask();
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("DOCUMENT_QUESTION_UNSUPPORTED");
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("supplies a complete note for an overview when its UTF-8 text fits the budget", async () => {
    const body = "Return the badge on Friday. " + "Biên bản bàn giao. ".repeat(310) + "Final decision.";
    const h = harness(body);
    const result = await h.ask({ payload: { ...h.payload, query: "Summarize this note" } });
    expect(result.statusCode).toBe(200);
    expect(result.json().noteCoverage).toBe("FULL");
    expect(h.generate.mock.calls[0][0].evidence.map(passage => passage.content).join("")).toBe(body);
    expect(h.generate).toHaveBeenCalledTimes(1);
  });

  it.each(["Summarize this note", "What are the key points?", "Tóm tắt ghi chú này.", "What action items are listed?"])(
    "samples the beginning, middle and end for %s without exceeding the budget",
    async query => {
      const opening = "Return the badge on Friday.";
      const middle = "The access review found two exceptions.";
      const closing = "Transfer the records by 30 June.";
      const paragraphs = [
        opening
          + " The team met to review operational changes and discuss outstanding work.\n\n".repeat(50),
        "Hệ thống quản lý tài liệu đã được cập nhật. Nội dung được rà soát theo từng phòng ban. 🟣\n".repeat(17)
          + middle
          + "Hệ thống quản lý tài liệu đã được cập nhật. Nội dung được rà soát theo từng phòng ban. 🟣\n".repeat(17),
        "The weekly operations report contains progress updates from participating teams.\n".repeat(50)
          + closing,
      ];
      const body = paragraphs.join("\n\n");
      const h = harness(body);
      const generate = h.generate.getMockImplementation()!;
      h.generate.mockImplementationOnce(async input => {
        const response = await generate(input);
        response.citations = [{ chunkId: input.evidence.at(-1)!.chunkId, quote: closing }];
        return response;
      });
      const result = await h.ask({ payload: { ...h.payload, query } });
      expect(result.statusCode).toBe(200);
      expect(result.json().noteCoverage).toBe("PARTIAL");
      const evidence = h.generate.mock.calls[0][0].evidence;
      const contents = evidence.map(passage => passage.content).join("\n");
      for (const fact of [opening, middle, closing]) expect(contents.includes(fact), fact).toBe(true);
      expect(evidence.length).toBeLessThanOrEqual(8);
      expect(evidence.reduce((bytes, passage) => bytes + Buffer.byteLength(passage.content), 0))
        .toBeLessThanOrEqual(8_000);
      const points = Array.from(body);
      for (const passage of evidence) {
        expect(points.slice(passage.startOffset, passage.endOffset).join("")).toBe(passage.content);
      }
      const [citation] = result.json().citations;
      expect(points.slice(citation.startOffset, citation.endOffset).join("")).toBe(closing);
      expect(h.generate).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps text in a sparse section when its centered sample contains only whitespace", async () => {
    const section = "Return the badge on Friday." + " ".repeat(2_000) + "Archive the handover log.";
    const h = harness(section.repeat(7));
    const result = await h.ask({ payload: { ...h.payload, query: "Summarize this note" } });
    expect(result.statusCode).toBe(200);
    expect(result.json().noteCoverage).toBe("PARTIAL");
    const evidence = h.generate.mock.calls[0][0].evidence;
    expect(evidence.filter(passage => passage.content.trim()).length).toBe(7);
  });

  it("still ranks passages by relevance when a summary request names a specific subject", async () => {
    const h = harness("Return the badge on Friday.\n" + "General operations update.\n".repeat(280)
      + "The offboarding coordinator owns access revocation.\n" + "General operations update.\n".repeat(400));
    const result = await h.ask({ payload: { ...h.payload, query: "Summarize offboarding access revocation in this note" } });
    expect(result.statusCode).toBe(200);
    expect(h.generate.mock.calls[0][0].evidence.some(passage =>
      passage.content.includes("The offboarding coordinator owns access revocation."),
    )).toBe(true);
  });

  it("rejects cross-owner and cross-organization requests before reading storage", async () => {
    const h = harness();
    expect((await h.ask({ headers: { "x-other-member": "1" } })).statusCode).toBe(404);
    expect((await h.ask({ url: h.path.replace(h.note.organizationId, randomUUID()) })).statusCode).toBe(404);
    expect(h.read).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("never reads or sends private content without organization opt-in", async () => {
    const h = harness(undefined, false);
    expect((await h.ask()).json()).toMatchObject({ error: { code: "PRIVATE_NOTE_AI_DISABLED" } });
    expect(h.read).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("rejects client-supplied scope, history and stale note revisions", async () => {
    const h = harness();
    for (const override of [{ source: "company" }, { history: [] }]) {
      expect((await h.ask({ payload: { ...h.payload, ...override } })).statusCode).toBe(400);
    }
    expect((await h.ask({ url: `${h.path}?all=true` })).statusCode).toBe(400);
    expect((await h.ask({ payload: { ...h.payload, expectedVersion: 1 } })).statusCode).toBe(409);
    expect(h.read).not.toHaveBeenCalled();
  });

  it.each(["changed", "removed"])("withholds a response if the note is %s during generation", async (change) => {
    const h = harness();
    const generate = h.generate.getMockImplementation()!;
    h.generate.mockImplementationOnce(async input => {
      if (change === "changed") h.note.currentVersion += 1;
      else h.getDraft.mockResolvedValue(null);
      return generate(input);
    });
    const result = await h.ask();
    expect(result.statusCode).toBe(change === "changed" ? 409 : 404);
    expect(result.json().answer).toBeUndefined();
  });

  it("returns insufficient evidence without inference for empty notes, and rejects forged quotes", async () => {
    const blank = harness("\n  ");
    expect((await blank.ask()).json()).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", citations: [] });
    expect(blank.generate).not.toHaveBeenCalled();
    const forged = harness();
    const generate = forged.generate.getMockImplementation()!;
    forged.generate.mockImplementationOnce(async input => {
      const output = await generate(input);
      output.citations[0].quote = "Return it on Wednesday.";
      return output;
    });
    expect((await forged.ask()).statusCode).toBe(503);
  });

  it("accepts one private rating capability per answer and blocks foreign, expired, or expanded requests", async () => {
    const h = harness();
    const token: string = (await h.ask()).json().feedbackToken;
    const voteKey = token.split(".")[0];
    expect(token).not.toContain(h.userId);
    expect(token).not.toContain(h.note.id);
    expect(token).not.toContain(h.note.organizationId);
    expect(h.write).not.toHaveBeenCalled();
    expect((await h.rate(token, "GOOD", { headers: { "x-other-member": "1" } })).statusCode).toBe(404);
    expect((await h.rate(token, "GOOD", { payload: { token, feedback: "GOOD", documentId: h.note.id } })).statusCode).toBe(400);
    expect((await h.rate(token.replace(voteKey, randomUUID()), "GOOD")).statusCode).toBe(404);
    expect(h.write).not.toHaveBeenCalled();
    for (const feedback of ["GOOD", "BAD", null]) {
      const response = await h.rate(token, feedback);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual({ feedback });
      expect(h.write).toHaveBeenLastCalledWith(h.userId, h.note.organizationId, voteKey, feedback);
    }
    h.write.mockResolvedValueOnce(false);
    expect((await h.rate(token, "BAD")).statusCode).toBe(404);
    h.expireTicket();
    expect((await h.rate(token, "GOOD")).statusCode).toBe(404);
    expect(h.write).toHaveBeenCalledTimes(4);
  });
});
