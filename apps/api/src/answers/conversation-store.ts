import type { PoolClient } from "pg";
import { GovernedAnswerError, parsePublicCitations, type EvidenceReference, type StoredAnswer, type VersionScope } from "./governed-contracts.js";

export type ConversationSummary = { id: string; title: string; revision: number; updatedAt: string };
export type ConversationTurn = StoredAnswer & { id: string; requestId: string; question: string; sequence: number;
  versionScope: VersionScope; evidence: EvidenceReference[] };
export type Conversation = ConversationSummary & { turns: ConversationTurn[] };
export interface ConversationStore {
  list(user: string, organization: string): Promise<ConversationSummary[]>;
  load(user: string, organization: string, id: string): Promise<Conversation | null>;
  ensure(user: string, organization: string, id: string, title: string): Promise<void>;
  append(user: string, organization: string, id: string, expectedRevision: number,
    turn: Omit<ConversationTurn, "sequence">): Promise<ConversationTurn>;
}
type ActorTransaction = <T>(user: string, organization: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;
type ConversationRow = { conversation_id: string; title: string; revision: number; updated_at: Date };
type TurnRow = { turn_id: string; request_id: string; sequence: number; question: string; answer: string;
  status: StoredAnswer["status"]; version_scope: VersionScope; citations: StoredAnswer["citations"] };
type EvidenceRow = { turn_id: string; generation_id: string; published_version_id: string;
  snapshot_version_id: string; snapshot_content_hash: string; chunk_id: string };
const summary = (row: ConversationRow): ConversationSummary => ({ id: row.conversation_id, title: row.title,
  revision: row.revision, updatedAt: row.updated_at.toISOString() });

export class PgConversationStore implements ConversationStore {
  constructor(private readonly transaction: ActorTransaction) {}

  list(user: string, organization: string): Promise<ConversationSummary[]> {
    return this.transaction(user, organization, async (client) => (await client.query<ConversationRow>(`
      SELECT conversation_id, title, revision, updated_at FROM ai_conversation
       WHERE organization_id = $1 ORDER BY updated_at DESC, conversation_id LIMIT 50`, [organization])).rows.map(summary));
  }

  load(user: string, organization: string, id: string): Promise<Conversation | null> {
    return this.transaction(user, organization, async (client) => {
      const conversation = (await client.query<ConversationRow>(`SELECT conversation_id, title, revision, updated_at
        FROM ai_conversation WHERE organization_id = $1 AND conversation_id = $2`, [organization, id])).rows[0];
      if (!conversation) return null;
      const rows = (await client.query<TurnRow>(`SELECT turn_id, request_id, sequence, question, answer, status,
          version_scope, citations FROM ai_conversation_turn WHERE organization_id = $1 AND conversation_id = $2
          ORDER BY sequence DESC LIMIT 50`, [organization, id])).rows.reverse();
      const references = (await client.query<EvidenceRow>(`SELECT e.* FROM ai_turn_evidence e
        WHERE organization_id = $1 AND turn_id = ANY($2::uuid[]) ORDER BY generation_id, chunk_id`,
      [organization, rows.map((row) => row.turn_id)])).rows;
      return { ...summary(conversation), turns: rows.map((row) => ({ id: row.turn_id, requestId: row.request_id,
        sequence: row.sequence, question: row.question, answer: row.answer, status: row.status,
        versionScope: row.version_scope, citations: parsePublicCitations(row.citations),
        evidence: references.filter((reference) => reference.turn_id === row.turn_id).map((reference) => ({
          generationId: reference.generation_id, publishedVersionId: reference.published_version_id,
          snapshotVersionId: reference.snapshot_version_id, snapshotContentHash: reference.snapshot_content_hash,
          chunkId: reference.chunk_id })) })) };
    });
  }

  ensure(user: string, organization: string, id: string, title: string): Promise<void> {
    return this.transaction(user, organization, async (client) => {
      await client.query(`INSERT INTO ai_conversation(conversation_id, organization_id, owner_membership_id, title)
        SELECT $1, $2, membership_id, $3 FROM organization_membership
         WHERE organization_id = $2 AND user_id = $4 AND status = 'ACTIVE'
        ON CONFLICT (conversation_id) DO NOTHING`, [id, organization, title.slice(0, 120), user]);
      const own = await client.query("SELECT 1 FROM ai_conversation WHERE conversation_id = $1 AND organization_id = $2", [id, organization]);
      if (!own.rowCount) throw new GovernedAnswerError("NOT_FOUND");
    });
  }

  append(user: string, organization: string, id: string, expectedRevision: number,
    turn: Omit<ConversationTurn, "sequence">): Promise<ConversationTurn> {
    return this.transaction(user, organization, async (client) => {
      await client.query("SELECT set_config('arden.ai_version_scope', $1, true)", [turn.versionScope]);
      const locked = (await client.query<{ revision: number }>(`SELECT revision FROM ai_conversation
        WHERE conversation_id = $1 AND organization_id = $2 FOR UPDATE`, [id, organization])).rows[0];
      if (!locked) throw new GovernedAnswerError("NOT_FOUND");
      const replay = (await client.query<TurnRow>(`SELECT turn_id, request_id, sequence, question, answer, status,
        version_scope, citations FROM ai_conversation_turn WHERE conversation_id = $1 AND request_id = $2`, [id, turn.requestId])).rows[0];
      if (replay) {
        if (replay.question !== turn.question || replay.version_scope !== turn.versionScope) throw new GovernedAnswerError("CONFLICT");
        // A concurrent identical request may have won: caller reloads/revalidates its persisted result.
        throw new GovernedAnswerError("CONFLICT");
      }
      if (locked.revision !== expectedRevision) throw new GovernedAnswerError("CONFLICT");
      for (const reference of turn.evidence) {
        const current = await client.query(`SELECT 1 FROM knowledge_index_generation g JOIN published_knowledge_version pv
          ON pv.submission_id = g.submission_id WHERE g.generation_id = $1 AND g.organization_id = $2
          AND g.status = 'READY' AND pv.published_version_id = $3 AND g.snapshot_version_id = $4
          AND g.snapshot_content_hash = $5 AND pv.published_version_id IN (SELECT eligible_ai_publications($7))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(g.manifest_json->'chunks') c WHERE c->>'chunkId' = $6)`,
        [reference.generationId, organization, reference.publishedVersionId, reference.snapshotVersionId,
          reference.snapshotContentHash, reference.chunkId, turn.versionScope]);
        if (!current.rowCount) throw new GovernedAnswerError("ACCESS_CHANGED");
      }
      const sequence = expectedRevision + 1;
      await client.query(`INSERT INTO ai_conversation_turn(turn_id, conversation_id, organization_id, sequence,
        request_id, question, answer, status, version_scope, citations) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [turn.id, id, organization, sequence, turn.requestId, turn.question, turn.answer, turn.status,
        turn.versionScope, JSON.stringify(turn.citations)]);
      for (const reference of turn.evidence) {
        await client.query(`INSERT INTO ai_turn_evidence(turn_id, organization_id, generation_id, published_version_id,
          snapshot_version_id, snapshot_content_hash, chunk_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [turn.id, organization, reference.generationId, reference.publishedVersionId,
          reference.snapshotVersionId, reference.snapshotContentHash, reference.chunkId]);
      }
      await client.query("UPDATE ai_conversation SET revision = $2, updated_at = now() WHERE conversation_id = $1", [id, sequence]);
      return { ...turn, sequence };
    });
  }
}
