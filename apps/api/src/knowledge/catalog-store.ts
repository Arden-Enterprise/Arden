import type { PoolClient } from "pg";
import { knowledgeTypes, matchesPublicationScope, type KnowledgeType } from "@arden/domain";
import { canRead, type ReaderSelection } from "../target-readers/policy.js";

export type CatalogEntry = { id: string; name: string; description: string; status: "ACTIVE" | "INACTIVE"; version: number };
export type CollectionEntry = CatalogEntry & { cover: "handbook" | "production"; documentIds: string[]; allowedTypes: KnowledgeType[] | null };
export type CatalogWrite = { name: string; description?: string; status: "ACTIVE" | "INACTIVE";
  cover?: "handbook" | "production"; allowedTypes?: KnowledgeType[]; documentIds?: string[] };
export type CollectionPlacement = { documentId: string; collectionId: string | null; revision: number };
export type KnowledgeCatalog = { canManage: boolean; collections: CollectionEntry[] };
export type CatalogKind = "collections";
export class CatalogError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID" | "CONFLICT" | "DUPLICATE" | "UPGRADE_REQUIRED") { super(code); }
}
type MemberTransaction = <T>(userId: string, organizationId: string, work: (client: PoolClient) => Promise<T>) => Promise<T>;
type AdminTransaction = <T>(userId: string, organizationId: string,
  work: (client: PoolClient, membershipId: string) => Promise<T>) => Promise<T | null>;
export type KnowledgeReaderMatch = { id: string; name: string; email: string; department: string | null };

export interface KnowledgeCatalogStore {
  /** Decision 0021: active members of the caller's organization by name or email, with email and department. */
  readers(userId: string, organizationId: string, query: string, ids: string[]): Promise<KnowledgeReaderMatch[]>;
  list(userId: string, organizationId: string): Promise<KnowledgeCatalog>;
  write(userId: string, organizationId: string, kind: CatalogKind, id: string | null, version: number | null,
    input: CatalogWrite, requestId: string): Promise<CatalogEntry>;
  getPlacement(userId: string, organizationId: string, documentId: string): Promise<CollectionPlacement>;
  place(userId: string, organizationId: string, documentId: string, revision: number,
    collectionId: string | null, requestId: string): Promise<CollectionPlacement>;
}

function catalogDatabaseError(error: unknown): never {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  const constraint = error && typeof error === "object" && "constraint" in error ? error.constraint : null;
  if (code === "23505") throw new CatalogError("DUPLICATE");
  if (code === "23514" && error instanceof Error && error.message === "Document is not eligible for this collection") throw new CatalogError("UNAVAILABLE");
  if (code === "23503" && typeof constraint === "string" && constraint.startsWith("knowledge_collection_placement_")) throw new CatalogError("UNAVAILABLE");
  // Unrelated constraint/audit failures stay server failures, not an apparent
  // user eligibility error. The outer transaction rolls back either way.
  if (code === "40P01" || code === "40001" || code === "55P03") throw new CatalogError("CONFLICT");
  throw error;
}

function placement(row: { documentId: string; collectionId: string | null; revision: string }): CollectionPlacement {
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new CatalogError("CONFLICT");
  return { ...row, revision };
}

/** Collections organize common knowledge, not every source an Admin can read. */
async function organizationPublications(client: PoolClient, userId: string, organizationId: string): Promise<Set<string>> {
  const actors = await client.query<{ membership_id: string; department_ids: string[] }>(`
    SELECT om.membership_id, ARRAY(SELECT dm.department_id::text FROM department_membership dm
      JOIN department d USING (department_id) WHERE dm.membership_id = om.membership_id
      AND dm.status = 'ACTIVE' AND d.status = 'ACTIVE') AS department_ids
    FROM organization_membership om JOIN user_account ua USING (user_id)
    JOIN organization o USING (organization_id)
    WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
      AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE'`, [userId, organizationId]);
  const actor = actors.rows[0];
  if (!actor) throw new CatalogError("UNAVAILABLE");
  const sources = await client.query<{ id: string; selection_id: string | null; mode: ReaderSelection["mode"] | null;
    department_id: string | null; member_ids: string[] }>(`
    SELECT pv.published_version_id AS id, pv.reader_selection_id AS selection_id,
      rs.reader_mode AS mode, rs.department_id,
      ARRAY(SELECT sr.membership_id::text FROM selected_reader sr WHERE sr.selection_id = rs.selection_id) AS member_ids
    FROM knowledge_current_publication cp JOIN published_knowledge_version pv USING (published_version_id)
    LEFT JOIN reader_selection rs ON rs.selection_id = pv.reader_selection_id
    WHERE cp.organization_id = $1 AND cp.valid_from <= now()
      AND (cp.valid_until IS NULL OR cp.valid_until > now())`, [organizationId]);
  return new Set(sources.rows.filter(source => matchesPublicationScope(source.mode, "ORGANIZATION")
    && canRead({ membershipId: actor.membership_id,
    organizationId, status: "ACTIVE", departmentIds: actor.department_ids }, { organizationId,
    readers: source.selection_id === null ? null : { mode: source.mode ?? "SELECTED_MEMBERS",
      departmentId: source.department_id, memberIds: source.member_ids } })).map(source => source.id));
}

export class PgKnowledgeCatalogStore implements KnowledgeCatalogStore {
  constructor(private readonly withMember: MemberTransaction, private readonly withAdmin: AdminTransaction) {}

  async readers(userId: string, organizationId: string, query: string, ids: string[]) {
    return this.withMember(userId, organizationId, async client => (await client.query<KnowledgeReaderMatch>(`
      SELECT membership_id AS id, display_name AS name, email, department_name AS department
        FROM knowledge_reader_directory($1, $2::uuid[])`, [query, ids])).rows);
  }

  async list(userId: string, organizationId: string): Promise<KnowledgeCatalog> {
    return this.withMember(userId, organizationId, async client => {
      const eligible = await organizationPublications(client, userId, organizationId);
      const admin = await client.query(`SELECT 1 FROM role_assignment ra JOIN role r USING (role_id)
        JOIN access_scope scope USING (access_scope_id) JOIN organization_membership om USING (membership_id)
        WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
          AND ra.status = 'ACTIVE' AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
          AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
          AND scope.organization_id = $2 AND scope.scope_type = 'ORGANIZATION' AND scope.status = 'ACTIVE'`, [userId, organizationId]);
      const canManage = Boolean(admin.rowCount);
      const collections = await client.query<CollectionEntry>(`SELECT c.collection_id AS id, c.name,
        c.description, c.status, c.configuration_version AS version, c.cover, c.allowed_types AS "allowedTypes",
        ARRAY(SELECT cp.published_version_id::text FROM knowledge_collection_placement p
          JOIN knowledge_current_publication cp USING (shared_draft_id, organization_id)
          WHERE p.collection_id = c.collection_id
            AND collection_source_eligible(p.organization_id, p.shared_draft_id, p.collection_id)
          ORDER BY p.shared_draft_id) AS "documentIds"
        FROM knowledge_collection c WHERE c.organization_id = $1 AND ($2 OR c.status = 'ACTIVE')
        ORDER BY c.name, c.collection_id`, [organizationId, canManage]);
      return { canManage, collections: collections.rows.flatMap(collection => {
        const documentIds = collection.documentIds.filter(id => eligible.has(id));
        // Admin can repair empty/unconfigured shells; members discover only
        // folders with currently eligible common sources, never legacy counts.
        return documentIds.length || canManage ? [{ ...collection, documentIds }] : [];
      }) };
    });
  }

  async write(userId: string, organizationId: string, kind: CatalogKind, id: string | null, version: number | null,
    input: CatalogWrite, requestId: string): Promise<CatalogEntry> {
    const name = input.name.normalize("NFKC").trim();
    const description = input.description ?? "";
    if (input.documentIds !== undefined) throw new CatalogError("UPGRADE_REQUIRED");
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name) || description.length > 300
      || !["ACTIVE", "INACTIVE"].includes(input.status)
      || kind !== "collections"
      || (kind === "collections" && (!input.allowedTypes?.length || input.allowedTypes.length > knowledgeTypes.length
        || new Set(input.allowedTypes).size !== input.allowedTypes.length
        || input.allowedTypes.some(type => !knowledgeTypes.includes(type))))) throw new CatalogError("INVALID");
    try {
      const result = await this.withAdmin(userId, organizationId, async (client, actor) => {
        // Shared with placement mutations; DB triggers also serialize worker eligibility changes.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`arden:knowledge-catalog:${organizationId}`]);
        const table = "knowledge_collection";
        const key = "collection_id";
        if (id) {
          const previous = await client.query<{ version: number }>(`SELECT configuration_version AS version FROM ${table}
            WHERE organization_id = $1 AND ${key} = $2 FOR UPDATE`, [organizationId, id]);
          if (!previous.rows[0]) throw new CatalogError("UNAVAILABLE");
          if (previous.rows[0].version !== version) throw new CatalogError("CONFLICT");
        }
        const columns = kind === "collections" ? ", cover, allowed_types" : "";
        const values: unknown[] = [organizationId, name, description.trim(), input.status];
        if (kind === "collections") values.push(input.cover ?? "handbook", input.allowedTypes);
        const saved = id
          ? await client.query<CatalogEntry>(`UPDATE ${table} SET name = $2, description = $3, status = $4,
              configuration_version = configuration_version + 1 ${kind === "collections" ? ", cover = $5, allowed_types = $6" : ""}
              WHERE organization_id = $1 AND ${key} = $${values.length + 1}
              RETURNING ${key} AS id, name, description, status, configuration_version AS version`, [...values, id])
          : await client.query<CatalogEntry>(`INSERT INTO ${table} (organization_id, name, description, status${columns})
              VALUES ($1, $2, $3, $4${kind === "collections" ? ", $5, $6" : ""})
              RETURNING ${key} AS id, name, description, status, configuration_version AS version`, values);
        const entry = saved.rows[0];
        if (!entry) throw new CatalogError("UNAVAILABLE");
        await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
          VALUES ($1, $2, 'KNOWLEDGE_CATALOG_CHANGED', 'SUCCESS', $3::jsonb)`, [organizationId, actor,
          JSON.stringify({ kind, catalogId: entry.id, version: entry.version, requestId })]);
        return entry;
      });
      if (!result) throw new CatalogError("UNAVAILABLE");
      return result;
    } catch (error) {
      return catalogDatabaseError(error);
    }
  }

  async getPlacement(userId: string, organizationId: string, documentId: string): Promise<CollectionPlacement> {
    const result = await this.withAdmin(userId, organizationId, async client => {
      const source = await client.query<{ eligible: boolean }>("SELECT collection_source_eligible($1, $2, NULL) AS eligible", [organizationId, documentId]);
      if (!source.rows[0]?.eligible) throw new CatalogError("UNAVAILABLE");
      const current = await client.query<{ documentId: string; collectionId: string | null; revision: string }>(`
        SELECT shared_draft_id AS "documentId", collection_id AS "collectionId", placement_revision::text AS revision
        FROM knowledge_collection_placement WHERE organization_id = $1 AND shared_draft_id = $2`, [organizationId, documentId]);
      return current.rows[0] ? placement(current.rows[0]) : { documentId, collectionId: null, revision: 0 };
    });
    if (!result) throw new CatalogError("UNAVAILABLE");
    return result;
  }

  async place(userId: string, organizationId: string, documentId: string, revision: number,
    collectionId: string | null, requestId: string): Promise<CollectionPlacement> {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new CatalogError("INVALID");
    try {
      const result = await this.withAdmin(userId, organizationId, async (client, actor) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`arden:knowledge-catalog:${organizationId}`]);
        const source = await client.query<{ eligible: boolean }>("SELECT collection_source_eligible($1, $2, NULL) AS eligible", [organizationId, documentId]);
        if (!source.rows[0]?.eligible) throw new CatalogError("UNAVAILABLE");
        const saved = revision === 0
          ? await client.query<{ documentId: string; collectionId: string | null; revision: string }>(`
              INSERT INTO knowledge_collection_placement (organization_id, shared_draft_id, collection_id)
              VALUES ($1, $2, $3) ON CONFLICT (shared_draft_id) DO NOTHING
              RETURNING shared_draft_id AS "documentId", collection_id AS "collectionId", placement_revision::text AS revision`,
            [organizationId, documentId, collectionId])
          : await client.query<{ documentId: string; collectionId: string | null; revision: string }>(`
              UPDATE knowledge_collection_placement SET collection_id = $3
              WHERE organization_id = $1 AND shared_draft_id = $2 AND placement_revision = $4
              RETURNING shared_draft_id AS "documentId", collection_id AS "collectionId", placement_revision::text AS revision`,
            [organizationId, documentId, collectionId, revision]);
        if (!saved.rows[0]) throw new CatalogError("CONFLICT");
        const entry = placement(saved.rows[0]);
        await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
          VALUES ($1, $2, 'KNOWLEDGE_COLLECTION_PLACED', 'SUCCESS', $3::jsonb)`, [organizationId, actor,
          JSON.stringify({ ...entry, requestId })]);
        return entry;
      });
      if (!result) throw new CatalogError("UNAVAILABLE");
      return result;
    } catch (error) { return catalogDatabaseError(error); }
  }
}
