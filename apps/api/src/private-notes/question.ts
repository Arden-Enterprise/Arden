import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ArdenAiAnswerError, type AskArdenClient } from "../answers/ai-client.js";
import { parseGenerationResponse, type GenerationRequest, type StoredAnswer } from "../answers/governed-contracts.js";
import type { ArdenDataRepository, PrivateDraft } from "../db/repository.js";
import { ReaderAdmission } from "../reader-ai/admission.js";
import { insufficientDocumentEvidence } from "../reader-ai/question.js";
import { ReaderSummaryError } from "../reader-ai/summary-contracts.js";
import type { PrivateContentStorage } from "./content-storage.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const words = (text: string) => new Set(text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const insufficient: StoredAnswer = { status: "INSUFFICIENT_EVIDENCE", answer: insufficientDocumentEvidence, citations: [] };

/** Rank passages within one saved note. No shared index or other private notes are queried. */
function noteEvidence(note: PrivateDraft, body: string, query: string): GenerationRequest["evidence"] {
  const points = Array.from(body);
  const terms = words(query);
  const ranked = [];
  // Overlap keeps passages near a boundary available. Bound the bytes sent to inference.
  for (let start = 0; start < points.length; start += 720) {
    const content = points.slice(start, start + 900).join("");
    if (content.trim()) {
      const score = [...words(content)].filter(word => terms.has(word)).length;
      ranked.push({ start, content, score });
    }
    if (start + 900 >= points.length) break;
  }
  const selected = [];
  let remainingBytes = 8_000;
  for (const passage of ranked.sort((a, b) => b.score - a.score || a.start - b.start)) {
    const bytes = Buffer.byteLength(passage.content, "utf8");
    if (bytes > remainingBytes) continue;
    selected.push(passage);
    remainingBytes -= bytes;
    if (selected.length === 8) break;
  }
  return selected.sort((a, b) => a.start - b.start).map(({ start, content }) => ({
    generationId: note.versionId, snapshotVersionId: note.versionId, snapshotContentHash: note.contentHash,
    chunkId: hash(`${note.versionId}:${note.contentHash}:${start}`), contentHash: hash(content),
    startOffset: start, endOffset: start + Array.from(content).length, content,
    sourceBlockIds: ["note-body"], parentSectionBlockId: null, label: "Private note",
  }));
}

export function registerPrivateNoteQuestion(app: FastifyInstance, repository: Pick<ArdenDataRepository, "getDraft">,
  storage: Pick<PrivateContentStorage, "read">, ai: Pick<AskArdenClient, "generate"> | null,
  actor: (request: FastifyRequest, reply: FastifyReply) => Promise<{ userId: string } | null>, uuidPattern: string,
  enabledOrganizations: ReadonlySet<string>) {
  const admission = new ReaderAdmission(Date.now, 10_000);
  const uuid = { type: "string", pattern: uuidPattern };
  app.post<{ Params: { organizationId: string; draftId: string };
    Body: { requestId: string; query: string; expectedVersion: number } }>(
    "/api/v1/organizations/:organizationId/private-workspace/drafts/:draftId/questions", {
      onRequest: async (_request, reply) => { reply.header("Cache-Control", "no-store"); },
      schema: {
        params: { type: "object", required: ["organizationId", "draftId"], properties: { organizationId: uuid, draftId: uuid } },
        querystring: { type: "object", additionalProperties: false, properties: {} },
        body: { type: "object", additionalProperties: false, required: ["requestId", "query", "expectedVersion"], properties: {
          requestId: uuid, query: { type: "string", minLength: 1, maxLength: 4_000, pattern: "\\S" },
          expectedVersion: { type: "integer", minimum: 1, maximum: 2_147_483_647 },
        } },
      },
    }, async (request, reply) => {
      const context = await actor(request, reply);
      if (!context) return;
      const { organizationId, draftId } = request.params;
      const { requestId, query, expectedVersion } = request.body;
      const findNote = () => repository.getDraft(context.userId, organizationId, draftId, { forQuestion: true });
      const fail = (status: number, code: string, message: string) =>
        reply.code(status).send({ error: { code, message, requestId: request.id } });
      const unavailable = () => fail(404, "RESOURCE_NOT_AVAILABLE", "This note is unavailable.");
      const changed = () => fail(409, "NOTE_CHANGED", "This note changed. Open the current version and try again.");
      try {
        const note = await findNote();
        if (!note) return unavailable();
        if (note.currentVersion !== expectedVersion) return changed();
        if (!enabledOrganizations.has(organizationId)) {
          return fail(503, "PRIVATE_NOTE_AI_DISABLED", "AI for Private notes is not enabled for this organization.");
        }
        if (!ai) return fail(503, "DOCUMENT_QUESTION_UNAVAILABLE", "Private note Q&A is unavailable.");
        if (note.mimeType !== "text/plain") return fail(422, "DOCUMENT_QUESTION_UNSUPPORTED", "This note format is unsupported.");
        const lease = admission.reserve(context.userId, organizationId, draftId);
        try {
          const body = await storage.read(note.sourceUri, note.contentHash);
          const evidence = noteEvidence(note, body, query);
          const recheck = async () => {
            const current = await findNote();
            if (!current) return "missing";
            return current.currentVersion === expectedVersion && current.versionId === note.versionId
              && current.contentHash === note.contentHash ? "current" : "changed";
          };
          const before = await recheck();
          if (before !== "current") return before === "missing" ? unavailable() : changed();
          if (!evidence.length) return insufficient;
          lease.dispatch();
          const input: GenerationRequest = { contractVersion: 2, purpose: "READER_QUESTION", organizationId,
            requestId, query: query.trim(), history: [], evidence };
          const result = parseGenerationResponse(await ai.generate(structuredClone(input)), input);
          const after = await recheck();
          if (after !== "current") return after === "missing" ? unavailable() : changed();
          if (result.status === "INSUFFICIENT_EVIDENCE") return insufficient;
          return { status: result.status, answer: result.answer, citations: result.citations.map(({ chunkId, quote }) => {
            const passage = evidence.find(item => item.chunkId === chunkId)!;
            const startOffset = passage.startOffset + Array.from(passage.content.slice(0, passage.content.indexOf(quote))).length;
            return { documentId: draftId, versionId: note.versionId, title: note.title, version: `Version ${expectedVersion}`,
              scope: "Private note", classification: "INTERNAL", documentCode: null, excerpt: quote,
              startOffset, endOffset: startOffset + Array.from(quote).length };
          }) } satisfies StoredAnswer;
        } finally { lease.release(); }
      } catch (error) {
        if (error instanceof ReaderSummaryError && error.code === "BUSY") {
          reply.header("Retry-After", String(error.retryAfterSeconds ?? 10));
          return fail(429, "DOCUMENT_QUESTION_BUSY", "Please wait before trying again.");
        }
        if (error instanceof ArdenAiAnswerError && error.code === "AI_SERVICE_HTTP_422") {
          return fail(422, "DOCUMENT_QUESTION_UNSUPPORTED", "This question cannot be answered here.");
        }
        request.log.warn({ requestId: request.id, errorType: error instanceof Error ? error.name : "Unknown" }, "Private note question failed");
        return fail(503, "DOCUMENT_QUESTION_UNAVAILABLE", "Private note Q&A is unavailable.");
      }
    });
}
