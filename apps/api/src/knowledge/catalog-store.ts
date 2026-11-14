import type { PoolClient } from "pg";
import { canRead, type ReaderSelection } from "../target-readers/policy.js";

export type CatalogEntry = { id: string; name: string; description: string; status: "ACTIVE" | "INACTIVE"; version: number };
export type CollectionEntry = CatalogEntry & { cover: "handbook" | "production"; documentIds: string[] };
export type CatalogWrite = { name: string; description: string; status: "ACTIVE" | "INACTIVE";
  cover?: "handbook" | "production"; documentIds?: string[] };
export type KnowledgeCatalog = { canManage: boolean; topics: CatalogEntry[]; collections: CollectionEntry[] };
export type CatalogKind = "topics" | "collections";
export class CatalogError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "INVALID" | "CONFLICT" | "DUPLICATE") { super(code); }
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
}

/** Apply the same Target Readers check as Library, including for Org Admin. */
async function readablePublications(client: PoolClient, userId: string, organizationId: string): Promise<Set<string>> {
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
  return new Set(sources.rows.filter(source => canRead({ membershipId: actor.membership_id,
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
      const readable = await readablePublications(client, userId, organizationId);
      const admin = await client.query(`SELECT 1 FROM role_assignment ra JOIN role r USING (role_id)
        JOIN access_scope scope USING (access_scope_id) JOIN organization_membership om USING (membership_id)
        WHERE om.user_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE'
          AND ra.status = 'ACTIVE' AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
          AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
          AND scope.organization_id = $2 AND scope.scope_type = 'ORGANIZATION' AND scope.status = 'ACTIVE'`, [userId, organizationId]);
      const canManage = Boolean(admin.rowCount);
      const topics = await client.query<CatalogEntry>(`SELECT topic_id AS id, name, description, status,
        configuration_version AS version FROM knowledge_topic WHERE organization_id = $1
        AND ($2 OR status = 'ACTIVE') ORDER BY name, topic_id`, [organizationId, canManage]);
      const collections = await client.query<CollectionEntry>(`SELECT c.collection_id AS id, c.name,
        c.description, c.status, c.configuration_version AS version, c.cover,
        ARRAY(SELECT cd.published_version_id::text FROM knowledge_collection_document cd
          WHERE cd.collection_id = c.collection_id ORDER BY cd.ordinal) AS "documentIds"
        FROM knowledge_collection c WHERE c.organization_id = $1 AND ($2 OR c.status = 'ACTIVE')
        ORDER BY c.name, c.collection_id`, [organizationId, canManage]);
      return { canManage, topics: topics.rows, collections: collections.rows.flatMap(collection => {
        const documentIds = collection.documentIds.filter(id => readable.has(id));
        // Empty configuration shells are editable; an entirely unreadable bundle
        // is not a discovery result, even for an admin.
        return documentIds.length || (canManage && collection.documentIds.length === 0) ? [{ ...collection, documentIds }] : [];
      }) };
    });
  }

  async write(userId: string, organizationId: string, kind: CatalogKind, id: string | null, version: number | null,
    input: CatalogWrite, requestId: string): Promise<CatalogEntry> {
    const name = input.name.normalize("NFKC").trim();
    if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name) || input.description.length > 300
      || !["ACTIVE", "INACTIVE"].includes(input.status)
      || (kind === "topics" && (input.documentIds !== undefined || input.cover !== undefined))) throw new CatalogError("INVALID");
    try {
      const result = await this.withAdmin(userId, organizationId, async (client, actor) => {
        // Serialize catalog writes, source-list replacement and optimistic versions per organization.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`arden:knowledge-catalog:${organizationId}`]);
        const table = kind === "topics" ? "knowledge_topic" : "knowledge_collection";
        const key = kind === "topics" ? "topic_id" : "collection_id";
        if (id) {
          const previous = await client.query<{ version: number }>(`SELECT configuration_version AS version FROM ${table}
            WHERE organization_id = $1 AND ${key} = $2 FOR UPDATE`, [organizationId, id]);
          if (!previous.rows[0]) throw new CatalogError("UNAVAILABLE");
          if (previous.rows[0].version !== version) throw new CatalogError("CONFLICT");
        }
        const ids = [...(input.documentIds ?? [])];
        if (kind === "collections") {
          if (ids.length > 200 || new Set(ids).size !== ids.length) throw new CatalogError("INVALID");
          const readable = await readablePublications(client, userId, organizationId);
          if (ids.some(source => !readable.has(source))) throw new CatalogError("UNAVAILABLE");
          if (id) {
            const previous = await client.query<{ id: string }>(`SELECT published_version_id::text AS id
              FROM knowledge_collection_document WHERE collection_id = $1 ORDER BY ordinal`, [id]);
            // A curator cannot see/remove sources whose readership was revoked.
            ids.push(...previous.rows.map(row => row.id).filter(source => !readable.has(source)));
            if (ids.length > 200) throw new CatalogError("INVALID");
          }
        }
        const columns = kind === "collections" ? ", cover" : "";
        const values: unknown[] = [organizationId, name, input.description.trim(), input.status];
        if (kind === "collections") values.push(input.cover ?? "handbook");
        const saved = id
          ? await client.query<CatalogEntry>(`UPDATE ${table} SET name = $2, description = $3, status = $4,
              configuration_version = configuration_version + 1 ${kind === "collections" ? ", cover = $5" : ""}
              WHERE organization_id = $1 AND ${key} = $${values.length + 1}
              RETURNING ${key} AS id, name, description, status, configuration_version AS version`, [...values, id])
          : await client.query<CatalogEntry>(`INSERT INTO ${table} (organization_id, name, description, status${columns})
              VALUES ($1, $2, $3, $4${kind === "collections" ? ", $5" : ""})
              RETURNING ${key} AS id, name, description, status, configuration_version AS version`, values);
        const entry = saved.rows[0];
        if (!entry) throw new CatalogError("UNAVAILABLE");
        if (kind === "collections") {
          await client.query("DELETE FROM knowledge_collection_document WHERE collection_id = $1", [entry.id]);
          if (ids.length) await client.query(`INSERT INTO knowledge_collection_document
            (collection_id, organization_id, published_version_id, ordinal)
            SELECT $1, $2, item.id, item.ordinality - 1 FROM unnest($3::uuid[]) WITH ORDINALITY AS item(id, ordinality)`,
          [entry.id, organizationId, ids]);
        }
        await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
          VALUES ($1, $2, 'KNOWLEDGE_CATALOG_CHANGED', 'SUCCESS', $3::jsonb)`, [organizationId, actor,
          JSON.stringify({ kind, catalogId: entry.id, version: entry.version, requestId })]);
        return entry;
      });
      if (!result) throw new CatalogError("UNAVAILABLE");
      return result;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new CatalogError("DUPLICATE");
      throw error;
    }
  }
}
