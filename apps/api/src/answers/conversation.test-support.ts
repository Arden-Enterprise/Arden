import { createHash } from "node:crypto";
import type {
  AnswerFeedback,
  Conversation,
  ConversationLoadOptions,
  ConversationStore,
  ConversationTurn,
} from "./conversation-store.js";
import { GovernedAnswerError } from "./governed-contracts.js";

export const evidenceText = "All team members must use MFA.";
export const evidenceManifest = { contentHash: createHash("sha256").update(evidenceText).digest("hex"),
  startOffset: 0, endOffset: evidenceText.length };

/** Test-only persistence port. Actual owner/RLS/atomic SQL is tested on disposable PostgreSQL. */
export class MemoryConversationStore implements ConversationStore {
  readonly records = new Map<string, { owner: string; organization: string; value: Conversation }>();
  failPersistence = false;
  async list(user: string, organization: string) {
    return [...this.records.values()].filter((record) => record.owner === user && record.organization === organization)
      .map(({ value: { turns: _turns, hasMore: _hasMore, ...summary } }) => summary);
  }
  async load(user: string, organization: string, id: string, options?: ConversationLoadOptions) {
    const record = this.records.get(id);
    if (record?.owner !== user || record.organization !== organization) return null;
    const limit = Math.max(1, Math.min(50, Math.trunc(options?.limit ?? 20)));
    const beforeSequence = options?.beforeSequence;
    const filtered = beforeSequence === undefined
      ? record.value.turns
      : record.value.turns.filter((turn) => turn.sequence < beforeSequence);
    const hasMore = filtered.length > limit;
    const page = filtered.slice(-limit);
    return structuredClone({ ...record.value, hasMore, turns: page });
  }
  async findTurnByRequestId(user: string, organization: string, id: string, requestId: string) {
    const record = this.records.get(id);
    if (record?.owner !== user || record.organization !== organization) return null;
    const found = record.value.turns.find((turn) => turn.requestId === requestId);
    return found ? structuredClone(found) : null;
  }
  async ensure(user: string, organization: string, id: string, title: string) {
    if (this.records.has(id)) {
      if (!await this.load(user, organization, id)) throw new GovernedAnswerError("NOT_FOUND");
      return;
    }
    this.records.set(id, { owner: user, organization, value: { id, title: title.slice(0, 120),
      revision: 0, updatedAt: new Date().toISOString(), turns: [] } });
  }
  async setFeedback(user: string, organization: string, id: string, turnId: string, feedback: AnswerFeedback) {
    const record = this.records.get(id);
    if (record?.owner !== user || record.organization !== organization) return false;
    const turn = record.value.turns.find(entry => entry.id === turnId);
    if (!turn) return false;
    turn.feedback = feedback;
    return true;
  }
  async append(user: string, organization: string, id: string, expectedRevision: number,
    turn: Omit<ConversationTurn, "sequence">) {
    if (this.failPersistence) throw new Error("Test persistence failure");
    const record = this.records.get(id);
    if (record?.owner !== user || record.organization !== organization) throw new GovernedAnswerError("NOT_FOUND");
    const current = record.value;
    if (current.turns.some((entry) => entry.requestId === turn.requestId)) throw new GovernedAnswerError("CONFLICT");
    if (current.revision !== expectedRevision) throw new GovernedAnswerError("CONFLICT");
    const saved: ConversationTurn = structuredClone({ ...turn, sequence: expectedRevision + 1 });
    current.turns.push(saved);
    current.revision++;
    return structuredClone(saved);
  }
}
