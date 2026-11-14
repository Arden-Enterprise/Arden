import { randomUUID } from "node:crypto";
import type { ArdenDataRepository, AuthorizedAiSource } from "../db/repository.js";
import { canRead } from "../target-readers/policy.js";
import type { AskArdenClient } from "./ai-client.js";
import type { Conversation, ConversationStore, ConversationTurn } from "./conversation-store.js";
import { citationPage } from "./citation-page.js";
import { evidenceMatchesManifest, GovernedAnswerError, parseGenerationResponse, parseRetrievalResponse, sourceLabel,
  type DialogueTurn, type Evidence, type EvidenceReference, type PublicCitation, type StoredAnswer, type VersionScope } from "./governed-contracts.js";

type AnswerInput = { conversationId: string; requestId: string; expectedRevision: number; query: string; versionScope: VersionScope };
type AnswerRepository = Pick<ArdenDataRepository, "conversations" | "getTargetReaderActor" | "listAuthorizedAiSources">;
export type ConversationView = Omit<Conversation, "turns"> & { turns: Array<Omit<ConversationTurn, "evidence" | "status"> & {
  status: ConversationTurn["status"] | "UNAVAILABLE" }> };
const unavailable = () => new GovernedAnswerError("ACCESS_CHANGED");
const identity = (reference: EvidenceReference) => `${reference.generationId}:${reference.chunkId}`;
function uniqueReferences(references: EvidenceReference[]): EvidenceReference[] {
  const byId = new Map<string, EvidenceReference>();
  for (const reference of references) {
    const previous = byId.get(identity(reference));
    if (previous && (previous.publishedVersionId !== reference.publishedVersionId
      || previous.snapshotVersionId !== reference.snapshotVersionId
      || previous.snapshotContentHash !== reference.snapshotContentHash)) {
      throw new GovernedAnswerError("INVALID_EVIDENCE");
    }
    byId.set(identity(reference), reference);
  }
  return [...byId.values()];
}

/** Core owns every evidence handoff. The service never decides business access. */
export class GovernedAnswering {
  constructor(private readonly repository: AnswerRepository, private readonly ai: AskArdenClient | null) {}

  private get store(): ConversationStore {
    if (!this.repository.conversations) throw new Error("Conversation persistence is unavailable");
    return this.repository.conversations;
  }

  private async sources(user: string, organization: string, scope: VersionScope,
    references?: EvidenceReference[]): Promise<AuthorizedAiSource[]> {
    const actor = await this.repository.getTargetReaderActor(user, organization);
    if (!actor || actor.status !== "ACTIVE") throw new GovernedAnswerError("NOT_FOUND");
    const sources = await this.repository.listAuthorizedAiSources(user, organization,
      references ? [...new Set(references.map((reference) => reference.generationId))] : undefined,
      references ? [...new Set(references.map((reference) => reference.chunkId))] : undefined, scope);
    if (!sources) throw new GovernedAnswerError("NOT_FOUND");
    return sources.filter((source) => canRead(actor, { organizationId: organization, readers: source.targetReaders }));
  }

  async referencesAvailable(user: string, organization: string, references: EvidenceReference[], scope: VersionScope): Promise<boolean> {
    if (references.length > 64) return false;
    const sources = await this.sources(user, organization, scope, references);
    return references.every((reference) => sources.some((source) => source.generationId === reference.generationId
      && source.publishedVersionId === reference.publishedVersionId && source.snapshotVersionId === reference.snapshotVersionId
      && source.snapshotContentHash === reference.snapshotContentHash && Array.isArray(source.chunks)
      && source.chunks.some((chunk: unknown) => chunk && typeof chunk === "object" && "chunkId" in chunk && chunk.chunkId === reference.chunkId)));
  }

  async load(user: string, organization: string, id: string): Promise<ConversationView | null> {
    // Even an empty transcript needs a current organization membership.
    await this.sources(user, organization, "COMPARE", []);
    const conversation = await this.store.load(user, organization, id);
    if (!conversation) return null;
    const turns = [];
    for (const turn of conversation.turns) {
      const available = await this.referencesAvailable(user, organization, turn.evidence, "COMPARE");
      const { evidence: _references, ...visible } = turn;
      turns.push({ ...visible, status: available ? turn.status : "UNAVAILABLE" as const,
        answer: available ? turn.answer : "This answer is no longer available.", citations: available ? turn.citations : [] });
    }
    return { ...conversation, turns };
  }

  private async context(user: string, organization: string, conversation: Conversation, scope: VersionScope):
    Promise<{ history: DialogueTurn[]; references: EvidenceReference[] }> {
    const history: DialogueTurn[] = [], references: EvidenceReference[] = [];
    let characters = 0;
    for (const turn of conversation.turns.slice(-4).reverse()) {
      const combined = uniqueReferences([...references, ...turn.evidence]);
      if (characters + turn.question.length + turn.answer.length > 24_000 || combined.length > 48) continue;
      if (!await this.referencesAvailable(user, organization, turn.evidence, scope)) continue;
      history.unshift({ question: turn.question, answer: turn.answer });
      references.splice(0, references.length, ...combined);
      characters += turn.question.length + turn.answer.length;
    }
    return { history, references };
  }

  async answer(user: string, organization: string, input: AnswerInput): Promise<StoredAnswer & {
    conversationId: string; revision: number; turnId: string }> {
    const ai = this.ai;
    if (!ai) throw new Error("AI provider is unavailable");
    const before = await this.sources(user, organization, input.versionScope);
    await this.store.ensure(user, organization, input.conversationId, input.query);
    const conversation = await this.store.load(user, organization, input.conversationId);
    if (!conversation) throw new GovernedAnswerError("NOT_FOUND");
    const replay = conversation.turns.find((turn) => turn.requestId === input.requestId);
    if (replay) {
      if (replay.question !== input.query || replay.versionScope !== input.versionScope
        || replay.sequence !== input.expectedRevision + 1) throw new GovernedAnswerError("CONFLICT");
      if (!await this.referencesAvailable(user, organization, replay.evidence, "COMPARE")) throw unavailable();
      return { status: replay.status, answer: replay.answer, citations: replay.citations,
        conversationId: input.conversationId, revision: conversation.revision, turnId: replay.id };
    }
    if (conversation.revision !== input.expectedRevision) throw new GovernedAnswerError("CONFLICT");
    const context = await this.context(user, organization, conversation, input.versionScope);
    let answer: StoredAnswer = { status: "INSUFFICIENT_EVIDENCE",
      answer: "I could not find enough authorized knowledge in this scope to answer that question.", citations: [] };
    let allReferences = context.references;
    if (before.length) {
      // The adapter parses HTTP; parsing here also protects injected/local service ports.
      const retrieval = parseRetrievalResponse(await ai.retrieve({ contractVersion: 2, purpose: "PUBLISHED_CHAT",
        requestId: input.requestId, organizationId: organization, query: input.query,
        allowedGenerationIds: before.map((source) => source.generationId), history: context.history,
        sourceHints: before.map((source) => ({ generationId: source.generationId, label: sourceLabel(source) })) }), input.requestId);
      const references: EvidenceReference[] = retrieval.evidence.map((chunk) => {
        const source = before.find((source) => source.generationId === chunk.generationId);
        if (!source) throw unavailable();
        if (source.snapshotVersionId !== chunk.snapshotVersionId
          || source.snapshotContentHash !== chunk.snapshotContentHash) throw new GovernedAnswerError("INVALID_EVIDENCE");
        return { generationId: chunk.generationId, publishedVersionId: source.publishedVersionId,
          snapshotVersionId: chunk.snapshotVersionId, snapshotContentHash: chunk.snapshotContentHash, chunkId: chunk.chunkId };
      });
      allReferences = uniqueReferences([...context.references, ...references]);
      if (allReferences.length > 64 || !await this.referencesAvailable(user, organization, allReferences, input.versionScope)) throw unavailable();
      const current = await this.sources(user, organization, input.versionScope, references);
      const evidence = retrieval.evidence.map((chunk): Evidence => {
        const source = current.find((source) => source.generationId === chunk.generationId);
        if (!source || !evidenceMatchesManifest(chunk, source)) throw unavailable();
        return { ...chunk, label: sourceLabel(source) };
      });
      if (evidence.length) {
        const request = { contractVersion: 2 as const, purpose: "PUBLISHED_CHAT" as const,
          requestId: input.requestId, organizationId: organization, query: retrieval.standaloneQuery,
          history: context.history, evidence };
        const generated = parseGenerationResponse(await ai.generate(request), request);
        if (!await this.referencesAvailable(user, organization, allReferences, input.versionScope)) throw unavailable();
        const citations: PublicCitation[] = generated.citations.map((citation) => {
          const chunk = evidence.find((chunk) => chunk.chunkId === citation.chunkId)!;
          const source = current.find((source) => source.generationId === chunk.generationId)!;
          const startOffset = chunk.startOffset + Array.from(chunk.content.slice(0, chunk.content.indexOf(citation.quote))).length;
          return { documentId: source.draftId, versionId: source.publishedVersionId, blockId: chunk.sourceBlockIds[0],
            page: citationPage(chunk.sourceBlockIds, chunk.parentSectionBlockId), excerpt: citation.quote,
            title: source.title, version: source.management?.version ?? "Version unavailable",
            documentCode: source.documentCode ?? null, startOffset, endOffset: startOffset + Array.from(citation.quote).length,
            scope: source.targetReaders?.mode === "SELECTED_MEMBERS" ? "Selected readers"
              : source.targetScopeType === "ORGANIZATION" ? "Company-wide" : "Department", classification: source.classification };
        });
        answer = { status: generated.status, answer: generated.answer, citations };
      }
    }
    if (!await this.referencesAvailable(user, organization, allReferences, input.versionScope)) throw unavailable();
    const saved = await this.store.append(user, organization, input.conversationId, input.expectedRevision,
      { ...answer, id: randomUUID(), requestId: input.requestId, question: input.query, versionScope: input.versionScope, evidence: allReferences });
    if (!await this.referencesAvailable(user, organization, allReferences, input.versionScope)) throw unavailable();
    return { ...answer, conversationId: input.conversationId, revision: saved.sequence, turnId: saved.id };
  }
}
