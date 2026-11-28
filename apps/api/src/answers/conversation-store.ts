import type { PoolClient } from "pg";
import type { BoundUiSurface } from "@arden/domain";
import { GovernedAnswerError, parsePublicCitations, type EvidenceReference, type StoredAnswer } from "./governed-contracts.js";

export type ConversationSummary = { id: string; title: string; revision: number; updatedAt: string };
export type AnswerFeedback = "GOOD" | "BAD" | null;
export type SurfaceBinding = { documentId: string; publishedVersionId: string };
export type ConversationLoadOptions = { limit?: number; beforeSequence?: number };
export type ConversationTurn = StoredAnswer & {
  id: string;
  requestId: string;
  question: string;
  sequence: number;
  evidence: EvidenceReference[];
  feedback?: AnswerFeedback;
  uiSurface?: BoundUiSurface | null;
  surfaceBindings?: SurfaceBinding[];
  scopeFilterHash?: string | null;
};
export type Conversation = ConversationSummary & { turns: ConversationTurn[]; hasMore?: boolean };
export interface ConversationStore {
  list(user: string, organization: string): Promise<ConversationSummary[]>;
  load(user: string, organization: string, id: string, options?: ConversationLoadOptions): Promise<Conversation | null>;
  findTurnByRequestId?(user: string, organization: string, id: string, requestId: string): Promise<ConversationTurn | null>;
  ensure(user: string, organization: string, id: string, title: string): Promise<void>;
  setFeedback(user: string, organization: string, conversationId: string, turnId: string, feedback: AnswerFeedback): Promise<boolean>;
  append(user: string, organization: string, id: string, expectedRevision: number,
    turn: Omit<ConversationTurn, "sequence">): Promise<ConversationTurn>;
}
type ActorTransaction = <T>(user: string, organization: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;
type ConversationRow = { conversation_id: string; title: string; revision: number; updated_at: Date };
type TurnRow = {
  turn_id: string;
  request_id: string;
  sequence: number;
  question: string;
  answer: string;
  status: StoredAnswer["status"];
  citations: StoredAnswer["citations"];
  feedback: AnswerFeedback;
  ui_surface: unknown;
  scope_filter_hash: string | null;
};
type EvidenceRow = { turn_id: string; generation_id: string; published_version_id: string;
  snapshot_version_id: string; snapshot_content_hash: string; chunk_id: string };
type SurfaceBindingRow = { turn_id: string; document_id: string; published_version_id: string };
const DEFAULT_LOAD_LIMIT = 20;
const MAX_LOAD_LIMIT = 50;
const summary = (row: ConversationRow): ConversationSummary => ({ id: row.conversation_id, title: row.title,
  revision: row.revision, updatedAt: row.updated_at.toISOString() });

function clampLoadLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LOAD_LIMIT;
  return Math.max(1, Math.min(MAX_LOAD_LIMIT, Math.trunc(limit)));
}

function sqlStateOf(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : null;
}

function mapTurn(
  row: TurnRow,
  references: readonly EvidenceRow[],
  bindings: readonly SurfaceBindingRow[],
): ConversationTurn {
  return {
    id: row.turn_id,
    requestId: row.request_id,
    sequence: row.sequence,
    question: row.question,
    answer: row.answer,
    status: row.status,
    citations: parsePublicCitations(row.citations),
    feedback: row.feedback,
    uiSurface: row.ui_surface === undefined || row.ui_surface === null ? null : (row.ui_surface as BoundUiSurface),
    scopeFilterHash: row.scope_filter_hash ?? null,
    evidence: references
      .filter((reference) => reference.turn_id === row.turn_id)
      .map((reference) => ({
        generationId: reference.generation_id,
        publishedVersionId: reference.published_version_id,
        snapshotVersionId: reference.snapshot_version_id,
        snapshotContentHash: reference.snapshot_content_hash,
        chunkId: reference.chunk_id,
      })),
    surfaceBindings: bindings
      .filter((binding) => binding.turn_id === row.turn_id)
      .map((binding) => ({
        documentId: binding.document_id,
        publishedVersionId: binding.published_version_id,
      })),
  };
}

export class PgConversationStore implements ConversationStore {
  constructor(private readonly transaction: ActorTransaction) {}

  list(user: string, organization: string): Promise<ConversationSummary[]> {
    return this.transaction(user, organization, async (client) => (await client.query<ConversationRow>(`
      SELECT id AS conversation_id, title, revision, updated_at FROM conversation
       WHERE organization_id = $1 ORDER BY updated_at DESC, conversation_id LIMIT 50`, [organization])).rows.map(summary));
  }

  load(user: string, organization: string, id: string, options?: ConversationLoadOptions): Promise<Conversation | null> {
    const limit = clampLoadLimit(options?.limit);
    const beforeSequence = options?.beforeSequence ?? null;
    return this.transaction(user, organization, async (client) => {
      const conversation = (await client.query<ConversationRow>(`SELECT id AS conversation_id, title, revision, updated_at
        FROM conversation WHERE organization_id = $1 AND id = $2`, [organization, id])).rows[0];
      if (!conversation) return null;
      const fetched = (await client.query<TurnRow>(`SELECT id AS turn_id, request_id, sequence, question, answer, status,
          citations, feedback, surface AS ui_surface, scope_filter_hash
        FROM conversation_turn
       WHERE organization_id = $1 AND conversation_id = $2
         AND ($3::int IS NULL OR sequence < $3)
       ORDER BY sequence DESC LIMIT $4`, [organization, id, beforeSequence, limit + 1])).rows;
      const hasMore = fetched.length > limit;
      const rows = fetched.slice(0, limit).reverse();
      const turnIds = rows.map((row) => row.turn_id);
      const references = turnIds.length === 0 ? [] : (await client.query<EvidenceRow>(`SELECT e.* FROM turn_evidence e
        WHERE organization_id = $1 AND turn_id = ANY($2::uuid[]) ORDER BY generation_id, chunk_id`,
      [organization, turnIds])).rows;
      const bindings = turnIds.length === 0 ? [] : (await client.query<SurfaceBindingRow>(`
        SELECT turn_id, document_id, published_version_id
          FROM turn_display_source
         WHERE organization_id = $1 AND turn_id = ANY($2::uuid[])
         ORDER BY document_id, published_version_id`,
      [organization, turnIds])).rows;
      return {
        ...summary(conversation),
        hasMore,
        turns: rows.map((row) => mapTurn(row, references, bindings)),
      };
    });
  }

  findTurnByRequestId(user: string, organization: string, id: string, requestId: string): Promise<ConversationTurn | null> {
    return this.transaction(user, organization, async (client) => {
      const row = (await client.query<TurnRow>(`SELECT id AS turn_id, request_id, sequence, question, answer, status,
          citations, feedback, surface AS ui_surface, scope_filter_hash
        FROM conversation_turn
       WHERE organization_id = $1 AND conversation_id = $2 AND request_id = $3`, [organization, id, requestId])).rows[0];
      if (!row) return null;
      const references = (await client.query<EvidenceRow>(`SELECT e.* FROM turn_evidence e
        WHERE organization_id = $1 AND turn_id = $2 ORDER BY generation_id, chunk_id`,
      [organization, row.turn_id])).rows;
      const bindings = (await client.query<SurfaceBindingRow>(`
        SELECT turn_id, document_id, published_version_id
          FROM turn_display_source
         WHERE organization_id = $1 AND turn_id = $2
         ORDER BY document_id, published_version_id`,
      [organization, row.turn_id])).rows;
      return mapTurn(row, references, bindings);
    });
  }

  setFeedback(user: string, organization: string, conversationId: string, turnId: string, feedback: AnswerFeedback): Promise<boolean> {
    return this.transaction(user, organization, async (client) => {
      const result = await client.query(`UPDATE conversation_turn SET feedback = $4
        WHERE organization_id = $1 AND conversation_id = $2 AND id = $3`,
      [organization, conversationId, turnId, feedback]);
      return result.rowCount === 1;
    });
  }

  ensure(user: string, organization: string, id: string, title: string): Promise<void> {
    return this.transaction(user, organization, async (client) => {
      await client.query(`INSERT INTO conversation(id, organization_id, owner_id, title)
        SELECT $1, $2, id, $3 FROM membership
         WHERE organization_id = $2 AND account_id = $4 AND status = 'ACTIVE'
        ON CONFLICT (id) DO NOTHING`, [id, organization, title.slice(0, 120), user]);
      const own = await client.query("SELECT 1 FROM conversation WHERE id = $1 AND organization_id = $2", [id, organization]);
      if (!own.rowCount) throw new GovernedAnswerError("NOT_FOUND");
    });
  }

  append(user: string, organization: string, id: string, expectedRevision: number,
    turn: Omit<ConversationTurn, "sequence">): Promise<ConversationTurn> {
    return this.transaction(user, organization, async (client) => {
      const locked = (await client.query<{ revision: number }>(`SELECT revision FROM conversation
        WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [id, organization])).rows[0];
      if (!locked) throw new GovernedAnswerError("NOT_FOUND");
      const replay = (await client.query<{ turn_id: string; question: string; scope_filter_hash: string | null }>(`
        SELECT id AS turn_id, question, scope_filter_hash FROM conversation_turn
         WHERE conversation_id = $1 AND request_id = $2`, [id, turn.requestId])).rows[0];
      if (replay) {
        if (replay.question !== turn.question || (replay.scope_filter_hash ?? null) !== (turn.scopeFilterHash ?? null)) {
          throw new GovernedAnswerError("CONFLICT");
        }
        // A concurrent identical request may have won: caller reloads/revalidates its persisted result.
        throw new GovernedAnswerError("CONFLICT");
      }
      if (locked.revision !== expectedRevision) throw new GovernedAnswerError("CONFLICT");
      for (const reference of turn.evidence) {
        const current = await client.query(`SELECT 1 FROM index_generation g JOIN published_version pv
          ON pv.review_submission_id = g.review_submission_id WHERE g.id = $1 AND g.organization_id = $2
          AND g.status = 'READY' AND pv.id = $3 AND g.snapshot_version_id = $4
          AND g.snapshot_content_hash = $5 AND pv.id IN (SELECT eligible_ai_publications())
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(g.manifest->'chunks') c WHERE c->>'chunkId' = $6)`,
        [reference.generationId, organization, reference.publishedVersionId, reference.snapshotVersionId,
          reference.snapshotContentHash, reference.chunkId]);
        if (!current.rowCount) throw new GovernedAnswerError("ACCESS_CHANGED");
      }
      const surfaceBindings = turn.surfaceBindings ?? [];
      for (const binding of surfaceBindings) {
        const current = await client.query(`SELECT 1 FROM current_publication cp
          JOIN published_version pv
            ON pv.id = cp.published_version_id
           AND pv.document_id = cp.document_id
         WHERE cp.organization_id = $1
           AND cp.document_id = $2
           AND pv.id = $3
           AND pv.id IN (SELECT eligible_ai_publications())`,
        [organization, binding.documentId, binding.publishedVersionId]);
        if (!current.rowCount) throw new GovernedAnswerError("ACCESS_CHANGED");
      }
      const sequence = expectedRevision + 1;
      await client.query(`INSERT INTO conversation_turn(id, conversation_id, organization_id, sequence,
        request_id, question, answer, status, citations, surface, scope_filter_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
      [turn.id, id, organization, sequence, turn.requestId, turn.question, turn.answer, turn.status,
        JSON.stringify(turn.citations), turn.uiSurface ? JSON.stringify(turn.uiSurface) : null,
        turn.scopeFilterHash ?? null]);
      for (const reference of turn.evidence) {
        await client.query(`INSERT INTO turn_evidence(turn_id, organization_id, generation_id, published_version_id,
          snapshot_version_id, snapshot_content_hash, chunk_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [turn.id, organization, reference.generationId, reference.publishedVersionId,
          reference.snapshotVersionId, reference.snapshotContentHash, reference.chunkId]);
      }
      for (const binding of surfaceBindings) {
        try {
          await client.query(`INSERT INTO turn_display_source(turn_id, organization_id, document_id, published_version_id)
            VALUES ($1,$2,$3,$4)`, [turn.id, organization, binding.documentId, binding.publishedVersionId]);
        } catch (error) {
          if (sqlStateOf(error) === "42501") throw new GovernedAnswerError("ACCESS_CHANGED");
          throw error;
        }
      }
      await client.query("UPDATE conversation SET revision = $2, updated_at = now() WHERE id = $1", [id, sequence]);
      return { ...turn, sequence };
    });
  }
}
