import { createHash } from "node:crypto";
import type { Conversation, ConversationStore, ConversationTurn } from "./conversation-store.js";
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
      .map(({ value: { turns: _turns, ...summary } }) => summary);
  }
  async load(user: string, organization: string, id: string) {
    const record = this.records.get(id);
    return record?.owner === user && record.organization === organization ? structuredClone(record.value) : null;
  }
  async ensure(user: string, organization: string, id: string, title: string) {
    if (this.records.has(id)) {
      if (!await this.load(user, organization, id)) throw new GovernedAnswerError("NOT_FOUND");
      return;
    }
    this.records.set(id, { owner: user, organization, value: { id, title: title.slice(0, 120),
      revision: 0, updatedAt: new Date().toISOString(), turns: [] } });
  }
  async append(user: string, organization: string, id: string, expectedRevision: number,
    turn: Omit<ConversationTurn, "sequence">) {
    if (this.failPersistence) throw new Error("Test persistence failure");
    const current = await this.load(user, organization, id);
    if (!current) throw new GovernedAnswerError("NOT_FOUND");
    if (current.revision !== expectedRevision) throw new GovernedAnswerError("CONFLICT");
    const saved = { ...turn, sequence: expectedRevision + 1 };
    current.turns.push(saved);
    current.revision++;
    this.records.get(id)!.value = current;
    return saved;
  }
}
