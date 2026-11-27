import { createHash, randomUUID } from "node:crypto";
import {
  normalizeAndValidateSurface,
  validateStoredBoundSurface,
  type AnswerScopeFilter,
  type BoundUiSurface,
  type HydratedDocumentSummary,
  type SurfaceDocumentHandle,
  type TurnHydration,
} from "@arden/domain";
import type { ArdenDataRepository, AuthorizedAiSource } from "../db/repository.js";
import { canRead } from "../target-readers/policy.js";
import type { AskArdenClient } from "./ai-client.js";
import type {
  AnswerFeedback,
  Conversation,
  ConversationLoadOptions,
  ConversationStore,
  ConversationTurn,
  SurfaceBinding,
} from "./conversation-store.js";
import { citationPage } from "./citation-page.js";
import { recordUsageBestEffort, type ProviderUsageEvent, type UsageTelemetryFailure } from "./usage-contracts.js";
import {
  evidenceMatchesManifest,
  GovernedAnswerError,
  parseGenerationResponse,
  parseGenerationV3Response,
  parseRetrievalResponse,
  sourceLabel,
  type DialogueTurn,
  type Evidence,
  type EvidenceReference,
  type GenerationV3Request,
  type PublicCitation,
  type StoredAnswer,
} from "./governed-contracts.js";
import {
  buildSourceCatalogAndHandleMap,
  computeTurnHydration,
  stripUnauthorizedHandoffs,
  synthesizeFallbackSurface,
  type TurnSurfaceInput,
} from "./ui-surface-hydrator.js";

export type AnswerInput = {
  conversationId: string;
  requestId: string;
  expectedRevision: number;
  query: string;
  scopeFilter?: AnswerScopeFilter;
};

type AnswerRepository = Pick<
  ArdenDataRepository, "conversations" | "getTargetReaderActor" | "listAuthorizedAiSources" | "recordAiUsageEvents"
> & Partial<Pick<ArdenDataRepository, "arePublishedVersionsAvailable" | "uiSurfaceHydrator" | "recordAiAnswerResult">>;

export type PublicConversationTurn = Omit<
  ConversationTurn,
  "evidence" | "status" | "surfaceBindings" | "scopeFilterHash"
> & {
  status: ConversationTurn["status"] | "UNAVAILABLE";
  uiSurface: BoundUiSurface | null;
  turnHydration: TurnHydration | null;
};

export type ConversationView = Omit<Conversation, "turns" | "hasMore"> & {
  hasMore: boolean;
  hydratedDocuments: Record<string, HydratedDocumentSummary>;
  turns: PublicConversationTurn[];
};

export type AnswerResult = StoredAnswer & {
  conversationId: string;
  revision: number;
  turnId: string;
  feedback?: AnswerFeedback;
  uiSurface: BoundUiSurface | null;
  hydratedDocuments: Record<string, HydratedDocumentSummary>;
  turnHydration: TurnHydration | null;
};

export interface GovernedAnsweringOptions {
  /** Whether `/v3/generations` modular UiSurface emission is enabled (parsed once at startup). Defaults to true. */
  useUiSurfaceV3?: boolean;
  /** Privacy-safe fallback counter/logger hook (receives closed reason codes only, never content or UUIDs). */
  onSurfaceFallback?: (reasonCode: string) => void;
  onUsageFailure?: UsageTelemetryFailure;
  onResultFailure?: UsageTelemetryFailure;
}

const unavailable = () => new GovernedAnswerError("ACCESS_CHANGED");
const MAX_EVIDENCE_LOCATIONS = 64;
const CONVERSATION_RESPONSE_BYTES = 2 * 1024 * 1024;
const identity = (reference: EvidenceReference) => `${reference.generationId}:${reference.chunkId}`;
const evidenceKey = (reference: EvidenceReference) =>
  `${identity(reference)}:${reference.publishedVersionId}:${reference.snapshotVersionId}:${reference.snapshotContentHash}`;
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

function collectTurnBindingVersionIds(turn: Pick<ConversationTurn, "surfaceBindings" | "uiSurface">): string[] {
  const ids = new Set<string>();
  for (const binding of turn.surfaceBindings ?? []) {
    ids.add(binding.publishedVersionId);
  }
  const rawDocs = turn.uiSurface && typeof turn.uiSurface === "object"
    && "bindings" in turn.uiSurface && turn.uiSurface.bindings && typeof turn.uiSurface.bindings === "object"
    && "documents" in turn.uiSurface.bindings && Array.isArray(turn.uiSurface.bindings.documents)
    ? turn.uiSurface.bindings.documents
    : [];
  for (const entry of rawDocs) {
    if (entry && typeof entry === "object" && "publishedVersionId" in entry && typeof entry.publishedVersionId === "string") {
      ids.add(entry.publishedVersionId);
    }
  }
  return [...ids];
}

function validateStoredOrNull(raw: unknown, citationCount: number): BoundUiSurface | null {
  if (raw === null || raw === undefined) return null;
  const checked = validateStoredBoundSurface(raw, { citationCount });
  return checked.ok ? checked.surface : null;
}

function conversationPage(
  conversation: Conversation,
  turns: PublicConversationTurn[],
  summaries: Readonly<Record<string, HydratedDocumentSummary>>,
): ConversationView {
  const pageFrom = (start: number): ConversationView => {
    const visible = turns.slice(start);
    const hydratedDocuments: Record<string, HydratedDocumentSummary> = {};
    for (const turn of visible) {
      for (const { publishedVersionId } of turn.uiSurface?.bindings.documents ?? []) {
        const summary = summaries[publishedVersionId];
        if (summary) hydratedDocuments[publishedVersionId] = summary;
      }
    }
    return {
      id: conversation.id,
      title: conversation.title,
      revision: conversation.revision,
      updatedAt: conversation.updatedAt,
      hasMore: start > 0 || conversation.hasMore === true,
      hydratedDocuments,
      turns: visible,
    };
  };
  const fits = (page: ConversationView) => Buffer.byteLength(JSON.stringify(page)) <= CONVERSATION_RESPONSE_BYTES;
  const full = pageFrom(0);
  if (fits(full)) return full;

  // Keep the newest whole turns. The first retained sequence remains a valid cursor for everything omitted.
  let start = 1;
  let end = turns.length - 1;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (fits(pageFrom(middle))) end = middle;
    else start = middle + 1;
  }
  const bounded = pageFrom(Math.min(start, turns.length - 1));
  if (!fits(bounded)) throw new Error("A saved turn exceeded the conversation response budget");
  return bounded;
}

/** Core owns every evidence handoff. The service never decides business access. */
export class GovernedAnswering {
  constructor(
    private readonly repository: AnswerRepository,
    private readonly ai: AskArdenClient | null,
    private readonly options?: GovernedAnsweringOptions,
  ) {}

  /** Record provider usage before any subsequent access check can withhold the answer. */
  private recordUsage(user: string, organization: string, requestId: string, events: ProviderUsageEvent[]) {
    return recordUsageBestEffort(() => this.repository.recordAiUsageEvents(user, organization, requestId, events),
      this.options?.onUsageFailure);
  }

  private recordAnswer(user: string, organization: string, turn: ConversationTurn) {
    return recordUsageBestEffort(() => this.repository.recordAiAnswerResult?.(
      user, organization, turn.requestId, "CHAT", turn.status, turn.citations.length,
    ) ?? Promise.resolve(), this.options?.onResultFailure);
  }

  private get store(): ConversationStore {
    if (!this.repository.conversations) throw new Error("Conversation persistence is unavailable");
    return this.repository.conversations;
  }

  private async sources(user: string, organization: string,
    references?: EvidenceReference[], scopeDocumentIds?: readonly string[]): Promise<AuthorizedAiSource[]> {
    const actor = await this.repository.getTargetReaderActor(user, organization);
    if (!actor || actor.status !== "ACTIVE") throw new GovernedAnswerError("NOT_FOUND");
    const sources = await this.repository.listAuthorizedAiSources(user, organization,
      references ? [...new Set(references.map((reference) => reference.generationId))] : undefined,
      references ? [...new Set(references.map((reference) => reference.chunkId))] : undefined,
      scopeDocumentIds);
    if (!sources) throw new GovernedAnswerError("NOT_FOUND");
    return sources.filter((source) => canRead(actor, { organizationId: organization, readers: source.targetReaders }));
  }

  async referencesAvailable(user: string, organization: string, references: EvidenceReference[]): Promise<boolean> {
    if (references.length > MAX_EVIDENCE_LOCATIONS) return false;
    const allowed = await this.availableEvidence(user, organization, references);
    return references.every((reference) => allowed.has(evidenceKey(reference)));
  }

  private async availableEvidence(user: string, organization: string, references: EvidenceReference[]): Promise<Set<string>> {
    const locations = [...new Map(references.map((reference) => [identity(reference), reference])).values()];
    const allowed = new Set<string>();
    for (let start = 0; start < Math.max(1, locations.length); start += MAX_EVIDENCE_LOCATIONS) {
      const sources = await this.sources(user, organization, locations.slice(start, start + MAX_EVIDENCE_LOCATIONS));
      for (const source of sources) {
        if (!Array.isArray(source.chunks)) continue;
        for (const chunk of source.chunks as unknown[]) {
          if (chunk && typeof chunk === "object" && "chunkId" in chunk && typeof chunk.chunkId === "string") {
            allowed.add(evidenceKey({ ...source, chunkId: chunk.chunkId }));
          }
        }
      }
    }
    return allowed;
  }

  async publishedVersionsAvailable(
    user: string,
    organization: string,
    publishedVersionIds: readonly string[],
  ): Promise<boolean> {
    const uniqueIds = [...new Set(publishedVersionIds)];
    if (uniqueIds.length === 0) return true;
    if (this.repository.arePublishedVersionsAvailable) {
      return this.repository.arePublishedVersionsAvailable(user, organization, uniqueIds);
    }
    const sources = await this.sources(user, organization);
    const available = new Set(sources.map((source) => source.publishedVersionId));
    return uniqueIds.every((id) => available.has(id));
  }

  private async turnAvailable(user: string, organization: string, turn: ConversationTurn): Promise<boolean> {
    if (!await this.referencesAvailable(user, organization, turn.evidence)) return false;
    const bindingVersionIds = collectTurnBindingVersionIds(turn);
    if (bindingVersionIds.length > 0 && !await this.publishedVersionsAvailable(user, organization, bindingVersionIds)) {
      return false;
    }
    return true;
  }

  private async availableTurns(user: string, organization: string, turns: ConversationTurn[]): Promise<Set<string>> {
    const bounded = turns.filter((turn) => turn.evidence.length <= MAX_EVIDENCE_LOCATIONS);
    const evidence = await this.availableEvidence(user, organization, bounded.flatMap((turn) => turn.evidence));
    const candidates = bounded.filter((turn) => turn.evidence.every((reference) => evidence.has(evidenceKey(reference))));
    const versionsByTurn = candidates.map((turn) => collectTurnBindingVersionIds(turn).sort());
    const versions = [...new Set(versionsByTurn.flat())];
    if (await this.publishedVersionsAvailable(user, organization, versions)) {
      return new Set(candidates.map((turn) => turn.id));
    }
    // Resolve mixed visibility without withholding unrelated turns or rechecking the same set of bindings twice.
    const checked = new Map<string, boolean>();
    const allowed = new Set<string>();
    for (const [index, turn] of candidates.entries()) {
      const ids = versionsByTurn[index]!;
      const key = ids.join(",");
      const available = checked.get(key) ?? await this.publishedVersionsAvailable(user, organization, ids);
      checked.set(key, available);
      if (available) allowed.add(turn.id);
    }
    return allowed;
  }

  private async hydrateSurfaces(
    user: string,
    organization: string,
    inputs: readonly TurnSurfaceInput[],
  ): Promise<{
    hydratedDocuments: Record<string, HydratedDocumentSummary>;
    turnsById: Map<string, { surface: BoundUiSurface; turnHydration: TurnHydration }>;
  }> {
    if (inputs.length === 0) {
      return { hydratedDocuments: {}, turnsById: new Map() };
    }
    if (this.repository.uiSurfaceHydrator) {
      return this.repository.uiSurfaceHydrator.hydrateConversationSurfaces(user, organization, inputs);
    }
    // Fail-closed fallback when no hydrator is wired (e.g. lightweight unit test fakes).
    const turnsById = new Map<string, { surface: BoundUiSurface; turnHydration: TurnHydration }>();
    const emptyDocs: Record<string, HydratedDocumentSummary> = {};
    const emptyLineages = new Map();
    for (const input of inputs) {
      const stripped = stripUnauthorizedHandoffs(input, emptyDocs);
      turnsById.set(input.id, {
        surface: stripped,
        turnHydration: computeTurnHydration(stripped, emptyDocs, emptyLineages),
      });
    }
    return { hydratedDocuments: emptyDocs, turnsById };
  }

  async load(
    user: string,
    organization: string,
    id: string,
    options?: ConversationLoadOptions,
  ): Promise<ConversationView | null> {
    // Even an empty transcript needs a current organization membership.
    await this.sources(user, organization, []);
    const conversation = await this.store.load(user, organization, id, options);
    if (!conversation) return null;

    const initiallyAvailable = await this.availableTurns(user, organization, conversation.turns);
    const hydrationInputs: TurnSurfaceInput[] = [];

    for (const turn of conversation.turns) {
      if (!initiallyAvailable.has(turn.id)) continue;
      const validatedSurface = validateStoredOrNull(turn.uiSurface, turn.citations.length);
      if (validatedSurface) {
        hydrationInputs.push({
          id: turn.id,
          status: turn.status,
          answer: turn.answer,
          citations: turn.citations,
          surface: validatedSurface,
        });
      }
    }

    const hydrated = await this.hydrateSurfaces(user, organization, hydrationInputs);
    const stillAvailable = await this.availableTurns(
      user, organization, conversation.turns.filter((turn) => initiallyAvailable.has(turn.id)),
    );
    const turns: PublicConversationTurn[] = conversation.turns.map((turn) => {
      const {
        evidence: _evidence,
        surfaceBindings: _surfaceBindings,
        scopeFilterHash: _scopeFilterHash,
        uiSurface: _rawSurface,
        ...visible
      } = turn;
      if (!stillAvailable.has(turn.id)) {
        return {
          ...visible,
          status: "UNAVAILABLE" as const,
          answer: "This answer is no longer available.",
          citations: [],
          uiSurface: null,
          turnHydration: null,
        };
      }
      const hydratedTurn = hydrated.turnsById.get(turn.id);
      return {
        ...visible,
        status: turn.status,
        answer: turn.answer,
        citations: turn.citations,
        uiSurface: hydratedTurn?.surface ?? null,
        turnHydration: hydratedTurn?.turnHydration ?? null,
      };
    });

    return conversationPage(conversation, turns, hydrated.hydratedDocuments);
  }

  private async context(user: string, organization: string, conversation: Conversation,
    allowedVersions?: ReadonlySet<string>):
    Promise<{ history: DialogueTurn[]; references: EvidenceReference[] }> {
    const history: DialogueTurn[] = [], references: EvidenceReference[] = [];
    let characters = 0;
    for (const turn of conversation.turns.slice(-4).reverse()) {
      if (allowedVersions && (turn.evidence.length === 0
        || turn.evidence.some((reference) => !allowedVersions.has(reference.publishedVersionId))
        || collectTurnBindingVersionIds(turn).some((versionId) => !allowedVersions.has(versionId)))) continue;
      const combined = uniqueReferences([...references, ...turn.evidence]);
      if (characters + turn.question.length + turn.answer.length > 24_000 || combined.length > 48) continue;
      if (!await this.turnAvailable(user, organization, turn)) continue;
      history.unshift({ question: turn.question, answer: turn.answer });
      references.splice(0, references.length, ...combined);
      characters += turn.question.length + turn.answer.length;
    }
    return { history, references };
  }

  private buildCitations(
    rawCitations: ReadonlyArray<{ chunkId: string; quote: string }>,
    evidence: readonly Evidence[],
    current: readonly AuthorizedAiSource[],
  ): PublicCitation[] {
    return rawCitations.map((citation) => {
      const chunk = evidence.find((entry) => entry.chunkId === citation.chunkId)!;
      const source = current.find((entry) => entry.generationId === chunk.generationId)!;
      const startOffset = chunk.startOffset + Array.from(chunk.content.slice(0, chunk.content.indexOf(citation.quote))).length;
      return {
        documentId: source.draftId,
        versionId: source.publishedVersionId,
        blockId: chunk.sourceBlockIds[0],
        page: citationPage(chunk.sourceBlockIds, chunk.parentSectionBlockId),
        excerpt: citation.quote,
        title: source.title,
        version: source.management?.version ?? "Version unavailable",
        documentCode: null,
        startOffset,
        endOffset: startOffset + Array.from(citation.quote).length,
        scope: source.targetReaders?.mode === "SELECTED_MEMBERS" ? "Selected readers"
          : source.targetScopeType === "ORGANIZATION" ? "Company-wide" : "Department",
        classification: source.classification,
      };
    });
  }

  async answer(user: string, organization: string, input: AnswerInput): Promise<AnswerResult> {
    const ai = this.ai;
    if (!ai && !input.scopeFilter) throw new Error("AI provider is unavailable");
    const scopeDocumentIds = input.scopeFilter
      ? [...new Set(input.scopeFilter.documentIds)].sort()
      : undefined;
    const currentScopeHash = scopeDocumentIds
      ? createHash("sha256").update(scopeDocumentIds.join(",")).digest("hex")
      : null;
    await this.store.ensure(user, organization, input.conversationId, input.query);
    const conversation = await this.store.load(user, organization, input.conversationId);
    if (!conversation) throw new GovernedAnswerError("NOT_FOUND");
    const replay = conversation.turns.find((turn) => turn.requestId === input.requestId)
      ?? (this.store.findTurnByRequestId
        ? await this.store.findTurnByRequestId(user, organization, input.conversationId, input.requestId)
        : null);
    if (replay) {
      if (replay.question !== input.query
        || (replay.scopeFilterHash ?? null) !== currentScopeHash
        || replay.sequence !== input.expectedRevision + 1) throw new GovernedAnswerError("CONFLICT");
      if (!await this.turnAvailable(user, organization, replay)) throw unavailable();
      await this.recordAnswer(user, organization, replay);
      const validatedSurface = validateStoredOrNull(replay.uiSurface, replay.citations.length);
      const hydrated = validatedSurface
        ? await this.hydrateSurfaces(user, organization, [{
          id: replay.id,
          status: replay.status,
          answer: replay.answer,
          citations: replay.citations,
          surface: validatedSurface,
        }])
        : { hydratedDocuments: {}, turnsById: new Map<string, { surface: BoundUiSurface; turnHydration: TurnHydration }>() };
      if (!await this.turnAvailable(user, organization, replay)) throw unavailable();
      const hydratedTurn = hydrated.turnsById.get(replay.id);
      return {
        status: replay.status,
        answer: replay.answer,
        citations: replay.citations,
        conversationId: input.conversationId,
        revision: conversation.revision,
        turnId: replay.id,
        feedback: replay.feedback,
        uiSurface: hydratedTurn?.surface ?? null,
        hydratedDocuments: hydrated.hydratedDocuments,
        turnHydration: hydratedTurn?.turnHydration ?? null,
      };
    }
    if (conversation.revision !== input.expectedRevision) throw new GovernedAnswerError("CONFLICT");
    const before = await this.sources(user, organization, undefined, scopeDocumentIds);
    const context = scopeDocumentIds && before.length === 0
      ? { history: [], references: [] }
      : await this.context(user, organization, conversation,
        scopeDocumentIds ? new Set(before.map((source) => source.publishedVersionId)) : undefined);
    let answer: StoredAnswer = {
      status: "INSUFFICIENT_EVIDENCE",
      answer: scopeDocumentIds && before.length === 0
        ? "None of the selected documents are currently eligible for Ask Arden in this scope."
        : "I could not find enough authorized knowledge in this scope to answer that question.",
      citations: [],
    };
    let boundSurface: BoundUiSurface = synthesizeFallbackSurface(answer.status, answer.answer, [], []);
    let allReferences = context.references;
    if (before.length) {
      if (!ai) throw new Error("AI provider is unavailable");
      // The adapter parses HTTP; parsing here also protects injected/local service ports.
      const retrieval = parseRetrievalResponse(await ai.retrieve({
        contractVersion: 2,
        purpose: "PUBLISHED_CHAT",
        requestId: input.requestId,
        organizationId: organization,
        query: input.query,
        allowedGenerationIds: before.map((source) => source.generationId),
        history: context.history,
        sourceHints: before.map((source) => ({ generationId: source.generationId, label: sourceLabel(source) })),
      }), input.requestId);
      await this.recordUsage(user, organization, input.requestId, retrieval.usageEvents);
      const references: EvidenceReference[] = retrieval.evidence.map((chunk) => {
        const source = before.find((entry) => entry.generationId === chunk.generationId);
        if (!source) throw unavailable();
        if (source.snapshotVersionId !== chunk.snapshotVersionId
          || source.snapshotContentHash !== chunk.snapshotContentHash) throw new GovernedAnswerError("INVALID_EVIDENCE");
        return {
          generationId: chunk.generationId,
          publishedVersionId: source.publishedVersionId,
          snapshotVersionId: chunk.snapshotVersionId,
          snapshotContentHash: chunk.snapshotContentHash,
          chunkId: chunk.chunkId,
        };
      });
      allReferences = uniqueReferences([...context.references, ...references]);
      if (allReferences.length > 64 || !await this.referencesAvailable(user, organization, allReferences)) throw unavailable();
      const current = await this.sources(user, organization, references);
      const evidence = retrieval.evidence.map((chunk): Evidence => {
        const source = current.find((entry) => entry.generationId === chunk.generationId);
        if (!source || !evidenceMatchesManifest(chunk, source)) throw unavailable();
        return { ...chunk, label: sourceLabel(source) };
      });
      if (evidence.length) {
        const orderedEvidenceSources: AuthorizedAiSource[] = [];
        const seenEvidenceDrafts = new Set<string>();
        for (const chunk of evidence) {
          const source = current.find((entry) => entry.generationId === chunk.generationId);
          if (source && !seenEvidenceDrafts.has(source.draftId)) {
            seenEvidenceDrafts.add(source.draftId);
            orderedEvidenceSources.push(source);
          }
        }
        const evidenceDocs: SurfaceDocumentHandle[] = orderedEvidenceSources.map((source) => ({
          documentId: source.draftId,
          publishedVersionId: source.publishedVersionId,
        }));
        const allowedEvidenceKeys = new Set(evidenceDocs.map((d) => `${d.documentId}:${d.publishedVersionId}`));

        const useV3 = typeof ai.generateV3 === "function" && this.options?.useUiSurfaceV3 !== false;
        if (useV3) {
          const catalogMetadata = this.repository.uiSurfaceHydrator
            ? await this.repository.uiSurfaceHydrator.loadCatalogMetadata(
              user,
              organization,
              orderedEvidenceSources.map((s) => s.publishedVersionId),
            )
            : new Map();
          const { sourceCatalog, handleMap } = buildSourceCatalogAndHandleMap(orderedEvidenceSources, catalogMetadata);
          const v3Request: GenerationV3Request = {
            contractVersion: 3,
            purpose: "PUBLISHED_CHAT",
            requestId: input.requestId,
            organizationId: organization,
            query: retrieval.standaloneQuery,
            history: context.history,
            evidence,
            sourceCatalog,
            uiSurfaceMode: "AUTO",
          };
          const generatedV3 = parseGenerationV3Response(await ai.generateV3!(v3Request), v3Request);
          await this.recordUsage(user, organization, input.requestId, generatedV3.usageEvents);
          if (!await this.referencesAvailable(user, organization, allReferences)) throw unavailable();
          const citations = this.buildCitations(generatedV3.citations, evidence, current);
          answer = { status: generatedV3.status, answer: generatedV3.answer, citations };

          if (generatedV3.status === "INSUFFICIENT_EVIDENCE") {
            boundSurface = synthesizeFallbackSurface("INSUFFICIENT_EVIDENCE", generatedV3.answer, [], []);
          } else if (generatedV3.uiSurfaceStatus === "GENERATED" && generatedV3.uiSurface !== null) {
            const normalized = normalizeAndValidateSurface(generatedV3.uiSurface, handleMap, citations.length);
            const bindingsWithinEvidence = normalized.ok && normalized.surface.bindings.documents.every(
              (doc) => allowedEvidenceKeys.has(`${doc.documentId}:${doc.publishedVersionId}`),
            );
            if (normalized.ok && bindingsWithinEvidence) {
              boundSurface = normalized.surface;
            } else {
              this.options?.onSurfaceFallback?.(normalized.ok ? "BINDINGS_OUTSIDE_EVIDENCE" : normalized.error.code);
              boundSurface = synthesizeFallbackSurface("ANSWERED", generatedV3.answer, citations, evidenceDocs);
            }
          } else {
            this.options?.onSurfaceFallback?.(generatedV3.uiSurfaceStatus);
            boundSurface = synthesizeFallbackSurface("ANSWERED", generatedV3.answer, citations, evidenceDocs);
          }
        } else {
          const request = {
            contractVersion: 2 as const,
            purpose: "PUBLISHED_CHAT" as const,
            requestId: input.requestId,
            organizationId: organization,
            query: retrieval.standaloneQuery,
            history: context.history,
            evidence,
          };
          const generated = parseGenerationResponse(await ai.generate(request), request);
          await this.recordUsage(user, organization, input.requestId, generated.usageEvents);
          if (!await this.referencesAvailable(user, organization, allReferences)) throw unavailable();
          const citations = this.buildCitations(generated.citations, evidence, current);
          answer = { status: generated.status, answer: generated.answer, citations };
          boundSurface = synthesizeFallbackSurface(generated.status, generated.answer, citations, evidenceDocs);
        }
      }
    }

    const surfaceBindings: SurfaceBinding[] = boundSurface.bindings.documents.map((doc) => ({
      documentId: doc.documentId,
      publishedVersionId: doc.publishedVersionId,
    }));
    const bindingVersionIds = surfaceBindings.map((b) => b.publishedVersionId);

    if (!await this.referencesAvailable(user, organization, allReferences)) throw unavailable();
    if (bindingVersionIds.length > 0 && !await this.publishedVersionsAvailable(user, organization, bindingVersionIds)) {
      throw unavailable();
    }

    const saved = await this.store.append(user, organization, input.conversationId, input.expectedRevision, {
      ...answer,
      id: randomUUID(),
      requestId: input.requestId,
      question: input.query,
      evidence: allReferences,
      uiSurface: boundSurface,
      surfaceBindings,
      scopeFilterHash: currentScopeHash,
    });
    await this.recordAnswer(user, organization, saved);

    const hydrated = await this.hydrateSurfaces(user, organization, [{
      id: saved.id,
      status: answer.status,
      answer: answer.answer,
      citations: answer.citations,
      surface: boundSurface,
    }]);
    if (!await this.turnAvailable(user, organization, saved)) throw unavailable();
    const hydratedTurn = hydrated.turnsById.get(saved.id);

    return {
      ...answer,
      conversationId: input.conversationId,
      revision: saved.sequence,
      turnId: saved.id,
      uiSurface: hydratedTurn?.surface ?? boundSurface,
      hydratedDocuments: hydrated.hydratedDocuments,
      turnHydration: hydratedTurn?.turnHydration ?? null,
    };
  }
}
