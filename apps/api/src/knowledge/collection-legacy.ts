import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { knowledgeTypes, type KnowledgeType } from "@arden/domain";

type LegacyCollection = { id: string; version: number; status: string; allowedTypes: KnowledgeType[] | null };
type LegacyLink = { collectionId: string; publicationId: string; documentId: string;
  sourceOrganizationId: string; currentPublicationId: string | null; type: string | null; common: boolean };
type ExistingPlacement = { documentId: string; collectionId: string | null; revision: string };
export type CollectionLegacyInventory = { organizationId: string; collections: LegacyCollection[]; links: LegacyLink[];
  placements: ExistingPlacement[]; retainedTopics: number; fingerprint: string };
export type CollectionLegacyPlan = { organizationId: string; fingerprint: string;
  collections: { id: string; allowedTypes: KnowledgeType[] }[];
  documents: { documentId: string; collectionId: string | null }[] };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const typeValue = (value: unknown): value is KnowledgeType => knowledgeTypes.some(type => value === type);
export function parseCollectionLegacyPlan(value: unknown): CollectionLegacyPlan {
  if (!record(value) || Object.keys(value).sort().join() !== "collections,documents,fingerprint,organizationId"
    || typeof value.organizationId !== "string" || !uuid.test(value.organizationId)
    || typeof value.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(value.fingerprint)
    || !Array.isArray(value.collections) || !Array.isArray(value.documents)
    || value.collections.length > 10000 || value.documents.length > 100000) throw new Error("Invalid legacy plan shape");
  const collections = value.collections.map((item: unknown) => {
    if (!record(item) || Object.keys(item).sort().join() !== "allowedTypes,id" || typeof item.id !== "string" || !uuid.test(item.id)
      || !Array.isArray(item.allowedTypes) || !item.allowedTypes.every(typeValue) || !validTypes(item.allowedTypes)) throw new Error("Invalid collection plan");
    return { id: item.id, allowedTypes: item.allowedTypes };
  });
  const documents = value.documents.map((item: unknown) => {
    if (!record(item) || Object.keys(item).sort().join() !== "collectionId,documentId"
      || typeof item.documentId !== "string" || !uuid.test(item.documentId)
      || !(item.collectionId === null || (typeof item.collectionId === "string" && uuid.test(item.collectionId)))) throw new Error("Invalid document plan");
    return { documentId: item.documentId, collectionId: item.collectionId };
  });
  return { organizationId: value.organizationId, fingerprint: value.fingerprint, collections, documents };
}

/** Metadata/identifiers only. Call in one repeatable-read transaction; keep output private. */
export async function inventoryCollectionLegacy(client: PoolClient, organizationId: string): Promise<CollectionLegacyInventory> {
  const collections = (await client.query<LegacyCollection>(`SELECT collection_id AS id, configuration_version AS version,
    status, allowed_types AS "allowedTypes" FROM arden.knowledge_collection WHERE organization_id = $1 ORDER BY collection_id`, [organizationId])).rows;
  const links = (await client.query<LegacyLink>(`SELECT legacy.collection_id AS "collectionId", legacy.published_version_id AS "publicationId",
    old.shared_draft_id AS "documentId", source.organization_id AS "sourceOrganizationId",
    cp.published_version_id AS "currentPublicationId", current.management->>'type' AS type,
    arden.collection_source_eligible($1, old.shared_draft_id, NULL) AS common
    FROM arden.knowledge_collection_document legacy JOIN arden.published_knowledge_version old USING (published_version_id)
    JOIN arden.shared_draft source ON source.shared_draft_id = old.shared_draft_id
    LEFT JOIN arden.knowledge_current_publication cp ON cp.shared_draft_id = old.shared_draft_id AND cp.organization_id = $1
    LEFT JOIN arden.published_knowledge_version current ON current.published_version_id = cp.published_version_id
    WHERE legacy.organization_id = $1 ORDER BY legacy.collection_id, legacy.published_version_id`, [organizationId])).rows;
  const placements = (await client.query<ExistingPlacement>(`SELECT shared_draft_id AS "documentId", collection_id AS "collectionId",
    placement_revision::text AS revision FROM arden.knowledge_collection_placement WHERE organization_id = $1 ORDER BY shared_draft_id`, [organizationId])).rows;
  // Topic storage is removed by 0042; frozen JSON is outside this link conversion.
  const retainedTopics = 0;
  const snapshot = { organizationId, collections, links, placements, retainedTopics };
  return { ...snapshot, fingerprint: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") };
}

function validTypes(types: KnowledgeType[]): boolean {
  return types.length > 0 && types.length <= knowledgeTypes.length && new Set(types).size === types.length
    && types.every(type => knowledgeTypes.includes(type));
}

/** All destinations, including deliberate Unassigned, must be explicit. Never guess a primary folder. */
export function validateCollectionLegacyPlan(inventory: CollectionLegacyInventory, plan: CollectionLegacyPlan): void {
  if (plan.organizationId !== inventory.organizationId || plan.fingerprint !== inventory.fingerprint) throw new Error("Legacy inventory changed; review a fresh plan");
  const unconfigured = inventory.collections.filter(folder => folder.allowedTypes === null);
  if (new Set(plan.collections.map(folder => folder.id)).size !== plan.collections.length
    || plan.collections.length !== unconfigured.length
    || unconfigured.some(folder => !plan.collections.some(item => item.id === folder.id))
    || plan.collections.some(folder => !validTypes(folder.allowedTypes))) throw new Error("Configure every legacy Collection with explicit allowed Types");
  const documentIds = new Set(inventory.links.map(link => link.documentId));
  if (plan.documents.length !== documentIds.size || new Set(plan.documents.map(item => item.documentId)).size !== plan.documents.length
    || plan.documents.some(item => !documentIds.has(item.documentId))) throw new Error("Resolve every legacy logical document exactly once");
  for (const item of plan.documents) {
    const existing = inventory.placements.find(row => row.documentId === item.documentId);
    if (existing && existing.collectionId !== item.collectionId) throw new Error("Legacy migration cannot overwrite a newer placement");
    if (item.collectionId === null) continue;
    const folder = inventory.collections.find(row => row.id === item.collectionId);
    const types = folder?.allowedTypes ?? plan.collections.find(row => row.id === item.collectionId)?.allowedTypes;
    const links = inventory.links.filter(link => link.documentId === item.documentId);
    if (!folder || folder.status !== "ACTIVE" || (!existing && !links.some(link => link.collectionId === folder.id))
      || links.some(link => link.sourceOrganizationId !== inventory.organizationId || !link.common || !types?.some(type => type === link.type))) {
      throw new Error("Destination must be an eligible existing legacy folder; use Unassigned for ineligible sources");
    }
  }
}

/** Local rehearsal ONLY. Owns one transaction. No table/schema drop, Topic or snapshot rewrite. */
export async function migrateCollectionLegacy(client: PoolClient, plan: CollectionLegacyPlan, actorMembershipId: string) {
  const target = (await client.query<{ database: string; superuser: boolean }>(`SELECT current_database() AS database,
    rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`)).rows[0];
  if (!target?.superuser || !/^arden_test_[a-z0-9_]+$/.test(target.database)) throw new Error("Disposable arden_test_ operator database required");
  // Re-read after acquiring all table locks. A repeatable/serializable snapshot
  // taken by the advisory-lock SELECT could miss links committed while waiting.
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
  try {
    await client.query("SET LOCAL search_path TO arden, public");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`arden:knowledge-catalog:${plan.organizationId}`]);
    // Operator maintenance window: freeze eligibility/configuration while comparing,
    // converting and removing only this organization's exact legacy associations.
    await client.query(`LOCK TABLE knowledge_collection, knowledge_collection_document, knowledge_collection_placement,
      knowledge_current_publication, published_knowledge_version, reader_selection IN SHARE ROW EXCLUSIVE MODE`);
    const actor = await client.query(`SELECT 1 FROM organization_membership om JOIN user_account ua USING (user_id)
      JOIN organization o USING (organization_id) JOIN role_assignment ra USING (membership_id)
      JOIN role r USING (role_id) JOIN access_scope scope USING (access_scope_id)
      WHERE om.membership_id = $1 AND om.organization_id = $2 AND om.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE'
        AND ra.status = 'ACTIVE' AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
        AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
        AND scope.organization_id = $2 AND scope.scope_type = 'ORGANIZATION' AND scope.status = 'ACTIVE'`, [actorMembershipId, plan.organizationId]);
    if (!actor.rowCount) throw new Error("Current Organization Admin attribution required");
    const inventory = await inventoryCollectionLegacy(client, plan.organizationId);
    validateCollectionLegacyPlan(inventory, plan);
    for (const folder of plan.collections) await client.query(`UPDATE knowledge_collection SET allowed_types = $2,
      configuration_version = configuration_version + 1 WHERE collection_id = $1 AND organization_id = $3`, [folder.id, folder.allowedTypes, plan.organizationId]);
    for (const item of plan.documents) {
      if (inventory.placements.some(row => row.documentId === item.documentId)) continue;
      // A corrupt cross-org historical link is removed but never creates a local
      // placement for the foreign document. Normal sources retain explicit Unassigned.
      if (inventory.links.some(link => link.documentId === item.documentId && link.sourceOrganizationId !== plan.organizationId)) continue;
      await client.query(`INSERT INTO knowledge_collection_placement (organization_id, shared_draft_id, collection_id)
        VALUES ($1, $2, $3)`, [plan.organizationId, item.documentId, item.collectionId]);
    }
    const removed = await client.query("DELETE FROM knowledge_collection_document WHERE organization_id = $1", [plan.organizationId]);
    if (removed.rowCount !== inventory.links.length) throw new Error("Legacy cleanup count mismatch");
    const details = { inventoryFingerprint: inventory.fingerprint, removedLinks: removed.rowCount,
      mappedDocuments: plan.documents.length, configuredCollections: plan.collections.length, retainedTopics: inventory.retainedTopics };
    await client.query(`INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
      VALUES ($1, $2, 'KNOWLEDGE_COLLECTION_LEGACY_MIGRATED', 'SUCCESS', $3::jsonb)`, [plan.organizationId, actorMembershipId, JSON.stringify(details)]);
    await client.query("COMMIT"); return details;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}
