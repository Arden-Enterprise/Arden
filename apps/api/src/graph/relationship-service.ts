import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  DocumentId,
  DocumentRelationshipType,
  GraphRelationshipEdge,
} from "@arden/domain";

type ActorTransaction = <T>(
  userId: string,
  organizationId: string,
  work: (client: PoolClient) => Promise<T>,
) => Promise<T>;

export type RelationshipOperation = "CREATE" | "REMOVE";

export interface CreateRelationshipInput {
  targetDocumentId: string;
  relationshipType: DocumentRelationshipType;
}

export interface StoredRelationshipRow {
  relationshipId: string;
  organizationId: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  relationshipType: DocumentRelationshipType;
  createdByMembershipId: string;
  createdAt: Date;
}

export interface RemovedRelationshipRow {
  relationshipId: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  relationshipType: DocumentRelationshipType;
}

export interface RelationshipIdempotencyRecord {
  organizationId: string;
  actorMembershipId: string;
  idempotencyKey: string;
  operation: RelationshipOperation;
  requestHash: string;
  statusCode: number;
  responseJson: Record<string, unknown>;
}

export interface RelationshipAuditDetails {
  relationshipId: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  relationshipType: DocumentRelationshipType;
}

export interface RelationshipAuditRecord {
  organizationId: string;
  actorMembershipId: string;
  eventType: "DOCUMENT_RELATIONSHIP_CREATED" | "DOCUMENT_RELATIONSHIP_DELETED";
  outcome: "SUCCESS";
  details: RelationshipAuditDetails;
}

export interface RelationshipTx {
  resolveActiveMembership(): Promise<string | null>;
  lockIdempotencyKey(actorMembershipId: string, idempotencyKey: string): Promise<void>;
  findIdempotency(
    actorMembershipId: string,
    idempotencyKey: string,
  ): Promise<Pick<RelationshipIdempotencyRecord, "operation" | "requestHash" | "statusCode" | "responseJson"> | null>;
  saveIdempotency(record: RelationshipIdempotencyRecord): Promise<void>;
  canCreateRelationship(sourceDocumentId: string, targetDocumentId: string): Promise<boolean>;
  insertRelationship(input: {
    sourceDocumentId: string;
    targetDocumentId: string;
    relationshipType: DocumentRelationshipType;
    createdByMembershipId: string;
  }): Promise<StoredRelationshipRow>;
  removeRelationship(
    sourceDocumentId: string,
    relationshipId: string,
  ): Promise<RemovedRelationshipRow | null>;
  writeAuditEvent(record: RelationshipAuditRecord): Promise<void>;
}

export interface DocumentRelationshipStore {
  withTransaction<T>(
    userId: string,
    organizationId: string,
    work: (tx: RelationshipTx) => Promise<T>,
  ): Promise<T>;
}

export type CreateRelationshipResult =
  | { kind: "created"; statusCode: 201; edge: GraphRelationshipEdge }
  | { kind: "replayed"; statusCode: number; response: Record<string, unknown> }
  | { kind: "invalid-request"; message: string }
  | { kind: "not-available" }
  | { kind: "idempotency-conflict" }
  | { kind: "relationship-exists" }
  | { kind: "relationship-cycle" };

export type RemoveRelationshipResult =
  | { kind: "removed"; statusCode: 200; response: { removed: true } }
  | { kind: "replayed"; statusCode: number; response: Record<string, unknown> }
  | { kind: "not-available" }
  | { kind: "idempotency-conflict" };

export function hashCreateRelationshipRequest(
  sourceDocumentId: string,
  targetDocumentId: string,
  relationshipType: DocumentRelationshipType,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ op: "CREATE", sourceDocumentId, targetDocumentId, relationshipType }))
    .digest("hex");
}

export function hashRemoveRelationshipRequest(
  sourceDocumentId: string,
  relationshipId: string,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ op: "REMOVE", sourceDocumentId, relationshipId }))
    .digest("hex");
}

type PgErrorLike = {
  code?: string;
  constraint?: string;
};

function readPgError(error: unknown): PgErrorLike | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as PgErrorLike;
  return typeof candidate.code === "string" ? candidate : null;
}

type PgIdempotencyRow = {
  operation: RelationshipOperation;
  request_hash: string;
  status_code: number;
  response_json: Record<string, unknown>;
};

type PgInsertedRelationshipRow = {
  relationship_id: string;
  organization_id: string;
  source_document_id: string;
  target_document_id: string;
  relationship_type: DocumentRelationshipType;
  created_by_membership_id: string;
  created_at: Date;
};

type PgRemovedRelationshipRow = {
  relationship_id: string;
  source_document_id: string;
  target_document_id: string;
  relationship_type: DocumentRelationshipType;
};

export class PgDocumentRelationshipStore implements DocumentRelationshipStore {
  constructor(private readonly withActor: ActorTransaction) {}

  async withTransaction<T>(
    userId: string,
    organizationId: string,
    work: (tx: RelationshipTx) => Promise<T>,
  ): Promise<T> {
    return this.withActor(userId, organizationId, async (client) => {
      const tx: RelationshipTx = {
        resolveActiveMembership: async () => {
          const result = await client.query<{ membership_id: string }>(`
            SELECT om.membership_id
              FROM organization_membership om
              JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
              JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
             WHERE om.user_id = $1
               AND om.organization_id = $2
               AND om.status = 'ACTIVE'`, [userId, organizationId]);
          return result.rows[0]?.membership_id ?? null;
        },

        lockIdempotencyKey: async (actorMembershipId, idempotencyKey) => {
          await client.query(`
            SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
              concat_ws(':', 'doc-rel-idem', $1::uuid::text, $2::uuid::text, $3::uuid::text), 0))`,
          [organizationId, actorMembershipId, idempotencyKey]);
        },

        findIdempotency: async (actorMembershipId, idempotencyKey) => {
          const result = await client.query<PgIdempotencyRow>(`
            SELECT operation, request_hash, status_code, response_json
              FROM document_relationship_idempotency
             WHERE organization_id = $1
               AND actor_membership_id = $2
               AND idempotency_key = $3`,
          [organizationId, actorMembershipId, idempotencyKey]);
          const row = result.rows[0];
          if (!row) return null;
          return {
            operation: row.operation,
            requestHash: row.request_hash,
            statusCode: Number(row.status_code),
            responseJson: row.response_json,
          };
        },

        saveIdempotency: async (record) => {
          await client.query(`
            INSERT INTO document_relationship_idempotency (
              organization_id,
              actor_membership_id,
              idempotency_key,
              operation,
              request_hash,
              status_code,
              response_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`, [
            record.organizationId,
            record.actorMembershipId,
            record.idempotencyKey,
            record.operation,
            record.requestHash,
            record.statusCode,
            JSON.stringify(record.responseJson),
          ]);
        },

        canCreateRelationship: async (sourceDocumentId, targetDocumentId) => {
          const result = await client.query<{
            can_manage: boolean;
            source_readable: boolean;
            target_readable: boolean;
          }>(`
            SELECT actor_can_manage_relationship_source($1, $2) AS can_manage,
                   ($2 IN (SELECT current_readable_document_ids())) AS source_readable,
                   ($3 IN (SELECT current_readable_document_ids())) AS target_readable`,
          [organizationId, sourceDocumentId, targetDocumentId]);
          const row = result.rows[0];
          return Boolean(row?.can_manage && row.source_readable && row.target_readable);
        },

        insertRelationship: async (input) => {
          const result = await client.query<PgInsertedRelationshipRow>(`
            INSERT INTO document_relationship (
              organization_id,
              source_document_id,
              target_document_id,
              relationship_type,
              created_by_membership_id
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING relationship_id,
                      organization_id,
                      source_document_id,
                      target_document_id,
                      relationship_type,
                      created_by_membership_id,
                      created_at`, [
            organizationId,
            input.sourceDocumentId,
            input.targetDocumentId,
            input.relationshipType,
            input.createdByMembershipId,
          ]);
          const row = result.rows[0]!;
          return {
            relationshipId: row.relationship_id,
            organizationId: row.organization_id,
            sourceDocumentId: row.source_document_id,
            targetDocumentId: row.target_document_id,
            relationshipType: row.relationship_type,
            createdByMembershipId: row.created_by_membership_id,
            createdAt: row.created_at,
          };
        },

        removeRelationship: async (sourceDocumentId, relationshipId) => {
          const result = await client.query<PgRemovedRelationshipRow>(`
            SELECT relationship_id,
                   source_document_id,
                   target_document_id,
                   relationship_type
              FROM remove_governed_document_relationship($1, $2)`,
          [sourceDocumentId, relationshipId]);
          const row = result.rows[0];
          if (!row) return null;
          return {
            relationshipId: row.relationship_id,
            sourceDocumentId: row.source_document_id,
            targetDocumentId: row.target_document_id,
            relationshipType: row.relationship_type,
          };
        },

        writeAuditEvent: async (record) => {
          await client.query(`
            INSERT INTO audit_event (
              organization_id,
              actor_membership_id,
              event_type,
              outcome,
              details_json
            ) VALUES ($1, $2, $3, $4, $5::jsonb)`, [
            record.organizationId,
            record.actorMembershipId,
            record.eventType,
            record.outcome,
            JSON.stringify({
              relationshipId: record.details.relationshipId,
              sourceDocumentId: record.details.sourceDocumentId,
              targetDocumentId: record.details.targetDocumentId,
              relationshipType: record.details.relationshipType,
            }),
          ]);
        },
      };

      return work(tx);
    });
  }
}

export class DocumentRelationshipService {
  constructor(private readonly store: DocumentRelationshipStore) {}

  canManageLinks(userId: string, organizationId: string, documentId: string): Promise<boolean> {
    return this.store.withTransaction(userId, organizationId, (tx) => tx.canCreateRelationship(documentId, documentId));
  }

  async createRelationship(
    userId: string,
    organizationId: string,
    sourceDocumentId: string,
    input: CreateRelationshipInput,
    idempotencyKey: string,
  ): Promise<CreateRelationshipResult> {
    const requestHash = hashCreateRelationshipRequest(
      sourceDocumentId,
      input.targetDocumentId,
      input.relationshipType,
    );

    try {
      return await this.store.withTransaction(userId, organizationId, async (tx) => {
        const actorMembershipId = await tx.resolveActiveMembership();
        if (!actorMembershipId) return { kind: "not-available" };

        await tx.lockIdempotencyKey(actorMembershipId, idempotencyKey);
        const existing = await tx.findIdempotency(actorMembershipId, idempotencyKey);
        if (existing) {
          if (existing.operation === "CREATE" && existing.requestHash === requestHash) {
            if (!await tx.canCreateRelationship(sourceDocumentId, input.targetDocumentId)) return { kind: "not-available" };
            return {
              kind: "replayed",
              statusCode: existing.statusCode,
              response: existing.responseJson,
            };
          }
          return { kind: "idempotency-conflict" };
        }

        if (sourceDocumentId === input.targetDocumentId) {
          return { kind: "invalid-request", message: "A document cannot link to itself." };
        }

        const allowed = await tx.canCreateRelationship(sourceDocumentId, input.targetDocumentId);
        if (!allowed) return { kind: "not-available" };

        const inserted = await tx.insertRelationship({
          sourceDocumentId,
          targetDocumentId: input.targetDocumentId,
          relationshipType: input.relationshipType,
          createdByMembershipId: actorMembershipId,
        });

        const edge: GraphRelationshipEdge = {
          relationshipId: inserted.relationshipId,
          sourceDocumentId: inserted.sourceDocumentId as DocumentId,
          targetDocumentId: inserted.targetDocumentId as DocumentId,
          relationshipType: inserted.relationshipType,
          createdAt: inserted.createdAt.toISOString(),
        };

        await tx.writeAuditEvent({
          organizationId,
          actorMembershipId,
          eventType: "DOCUMENT_RELATIONSHIP_CREATED",
          outcome: "SUCCESS",
          details: {
            relationshipId: inserted.relationshipId,
            sourceDocumentId: inserted.sourceDocumentId,
            targetDocumentId: inserted.targetDocumentId,
            relationshipType: inserted.relationshipType,
          },
        });

        await tx.saveIdempotency({
          organizationId,
          actorMembershipId,
          idempotencyKey,
          operation: "CREATE",
          requestHash,
          statusCode: 201,
          responseJson: { ...edge },
        });

        return { kind: "created", statusCode: 201, edge };
      });
    } catch (error) {
      const pgError = readPgError(error);
      if (pgError?.code === "42501" || pgError?.code === "23503") {
        return { kind: "not-available" };
      }
      if (pgError?.code === "23505") {
        if (pgError.constraint === "document_relationship_idempotency_pkey") {
          return { kind: "idempotency-conflict" };
        }
        return { kind: "relationship-exists" };
      }
      if (pgError?.code === "23514") {
        if (pgError.constraint === "ck_document_relationship_supersedes_acyclic") {
          return { kind: "relationship-cycle" };
        }
        if (pgError.constraint === "ck_document_relationship_not_self") {
          return { kind: "invalid-request", message: "A document cannot link to itself." };
        }
      }
      throw error;
    }
  }

  async removeRelationship(
    userId: string,
    organizationId: string,
    sourceDocumentId: string,
    relationshipId: string,
    idempotencyKey: string,
  ): Promise<RemoveRelationshipResult> {
    const requestHash = hashRemoveRelationshipRequest(sourceDocumentId, relationshipId);

    try {
      return await this.store.withTransaction(userId, organizationId, async (tx) => {
        const actorMembershipId = await tx.resolveActiveMembership();
        if (!actorMembershipId) return { kind: "not-available" };

        await tx.lockIdempotencyKey(actorMembershipId, idempotencyKey);
        const existing = await tx.findIdempotency(actorMembershipId, idempotencyKey);
        if (existing) {
          if (existing.operation === "REMOVE" && existing.requestHash === requestHash) {
            return {
              kind: "replayed",
              statusCode: existing.statusCode,
              response: existing.responseJson,
            };
          }
          return { kind: "idempotency-conflict" };
        }

        const removed = await tx.removeRelationship(sourceDocumentId, relationshipId);
        if (!removed) return { kind: "not-available" };

        await tx.writeAuditEvent({
          organizationId,
          actorMembershipId,
          eventType: "DOCUMENT_RELATIONSHIP_DELETED",
          outcome: "SUCCESS",
          details: {
            relationshipId: removed.relationshipId,
            sourceDocumentId: removed.sourceDocumentId,
            targetDocumentId: removed.targetDocumentId,
            relationshipType: removed.relationshipType,
          },
        });

        const response = { removed: true as const };
        await tx.saveIdempotency({
          organizationId,
          actorMembershipId,
          idempotencyKey,
          operation: "REMOVE",
          requestHash,
          statusCode: 200,
          responseJson: response,
        });

        return { kind: "removed", statusCode: 200, response };
      });
    } catch (error) {
      const pgError = readPgError(error);
      if (pgError?.code === "42501") {
        return { kind: "not-available" };
      }
      if (pgError?.code === "23505" && pgError.constraint === "document_relationship_idempotency_pkey") {
        return { kind: "idempotency-conflict" };
      }
      throw error;
    }
  }
}
