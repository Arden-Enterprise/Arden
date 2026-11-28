import type { PoolClient } from "pg";
import {
  documentRelationshipTypes,
  GRAPH_MAX_DOCUMENTS,
  GRAPH_MAX_RELATIONSHIPS,
  knowledgeTypes,
  knowledgeTypeToCode,
  validityStatus,
  type DocumentId,
  type DocumentRelationshipType,
  type GraphDocumentNode,
  type GraphOpenTarget,
  type GraphReaderScope,
  type GraphRelationshipEdge,
  type GraphValidityFilter,
  type GraphViewMode,
  type KnowledgeGraphPayload,
  type KnowledgeGraphQuery,
  type KnowledgeMetadata,
  type KnowledgeType,
  type PublishedVersionId,
} from "@arden/domain";
import { computeCanRenewByDocument } from "../knowledge/renewal-eligibility.js";
import { canRead, type ReaderActor, type ReaderMode, type ReaderSelection } from "../target-readers/policy.js";

const AUTHOR_NAME_BATCH_SIZE = 1_000;
const VERSION_UNAVAILABLE_LABEL = "Version unavailable";
const UNKNOWN_DEPARTMENT_LABEL = "Unknown department";

export interface GraphActorSnapshot extends ReaderActor {
  isOrgAdmin: boolean;
  hasAuthoredPublishedDoc: boolean;
}

export interface GraphRawCollection {
  id: string;
  name: string;
  allowedTypes: KnowledgeType[] | null;
  status: "ACTIVE" | "INACTIVE";
}

export interface GraphRawDocument {
  documentId: string;
  publishedVersionId: string;
  title: string;
  management: KnowledgeMetadata | null;
  ownerDepartmentId: string;
  ownerDepartmentName: string;
  authorDisplayName: string | null;
  publishedAt: Date;
  validUntil: string | null;
  targetReaders: ReaderSelection | null;
  knowledgeBaseScopeType: "ORGANIZATION" | "DEPARTMENT" | null;
  collection: GraphRawCollection | null;
  isAuthor: boolean;
  canRenew: boolean;
}

export interface GraphRawRelationship {
  relationshipId: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  relationshipType: DocumentRelationshipType;
  createdAt: Date;
}

export interface GraphSnapshot {
  organization: { id: string; name: string };
  actor: GraphActorSnapshot;
  utcToday: string;
  documents: GraphRawDocument[];
}

export interface GraphBundleEntry {
  raw: GraphRawDocument;
  isCurrentlyReadable: boolean;
  openTarget: GraphOpenTarget;
  monitorSignals: GraphDocumentNode["monitorSignals"];
}

export interface GraphLoadedBundle {
  organization: { id: string; name: string };
  actor: GraphActorSnapshot;
  utcToday: string;
  canUseMonitorMode: boolean;
  canIncludeExpired: boolean;
  monitorActive: boolean;
  includeExpiredActive: boolean;
  entries: GraphBundleEntry[];
  relationships: GraphRawRelationship[];
}

export interface GraphStore {
  loadReadableSnapshot(userId: string, organizationId: string): Promise<GraphSnapshot | null>;
  loadMonitorProjection?(
    userId: string,
    organizationId: string,
    input: {
      snapshot: GraphSnapshot;
      monitorRequested: boolean;
      includeExpired: boolean;
    },
  ): Promise<GraphMonitorProjection>;
  listRelationships(
    userId: string,
    organizationId: string,
    documentIds: readonly string[],
    relationshipTypes: readonly DocumentRelationshipType[] | null,
    limitPlusOne: number,
  ): Promise<GraphRawRelationship[]>;
  loadGraphBundle?(
    userId: string,
    organizationId: string,
    input: {
      monitorRequested: boolean;
      includeExpired: boolean;
      includeLinks: boolean;
      focusDocumentId?: string;
      limit: number;
      relationshipTypes: readonly DocumentRelationshipType[] | null;
      relationshipsLimitPlusOne: number;
      selectDocumentIdsForLinks: (
        loaded: Omit<GraphLoadedBundle, "relationships">,
        focusPeerDocumentIds?: readonly string[],
      ) => readonly string[];
    },
  ): Promise<GraphLoadedBundle | null>;
}

/** Seam for Monitor Mode projection (T-07) so GraphProjectionService remains unchanged when 0077 lands. */
export interface GraphMonitorDocumentEntry {
  raw: GraphRawDocument;
  isCurrentlyReadable: boolean;
  openTarget: GraphOpenTarget;
  monitorSignals: NonNullable<GraphDocumentNode["monitorSignals"]>;
}

export interface GraphMonitorProjection {
  canUseMonitorMode: boolean;
  canIncludeExpired: boolean;
  monitorActive: boolean;
  includeExpiredActive: boolean;
  documents: GraphMonitorDocumentEntry[];
}

export type GraphMonitorHandler = (input: {
  userId: string;
  organizationId: string;
  snapshot: GraphSnapshot;
  query: KnowledgeGraphQuery;
}) => Promise<GraphMonitorProjection>;

export interface GraphProjectionServiceOptions {
  monitorHandler?: GraphMonitorHandler;
}

type ActorTransaction = <T>(
  userId: string,
  organizationId: string,
  work: (client: PoolClient) => Promise<T>,
) => Promise<T>;

type PgActorRow = {
  membership_id: string;
  status: ReaderActor["status"];
  organization_name: string;
  department_ids: string[];
  is_org_admin: boolean;
  utc_today: string;
};

type PgGraphDocumentRow = {
  published_version_id: string;
  document_id: string;
  title: string;
  management: KnowledgeMetadata | null;
  owner_department_id: string | null;
  owner_department_name: string | null;
  published_at: Date;
  knowledge_base_scope_type: "ORGANIZATION" | "DEPARTMENT" | null;
  target_scope_type?: "ORGANIZATION" | "DEPARTMENT";
  index_status?: string;
  expiration_date: string | null;
  readers_selection_id: string | null;
  readers_mode: ReaderMode | null;
  readers_department_id: string | null;
  readers_member_ids: string[] | null;
  is_author: boolean;
  collection_id: string | null;
  collection_name: string | null;
  collection_allowed_types: string[] | null;
};

type PgGraphMonitorRow = PgGraphDocumentRow & {
  author_display_name: string | null;
  can_renew: boolean;
  is_currently_readable: boolean;
  open_target: string;
  open_maintenance_case_count: number | null;
  is_unassigned_org_doc: boolean;
  requires_audited_inspection: boolean;
  actor_accountable: boolean;
};

type PgRelationshipRow = {
  relationship_id: string;
  source_document_id: string;
  target_document_id: string;
  relationship_type: DocumentRelationshipType;
  created_at: Date;
};

function normalizeKnowledgeType(raw: unknown): KnowledgeType | null {
  return typeof raw === "string" && (knowledgeTypes as readonly string[]).includes(raw)
    ? (raw as KnowledgeType)
    : null;
}

function normalizeAllowedTypes(raw: readonly string[] | null | undefined): KnowledgeType[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((value): value is KnowledgeType => (knowledgeTypes as readonly string[]).includes(value));
}

function normalizeVersionLabel(raw: unknown): string {
  if (typeof raw !== "string") return VERSION_UNAVAILABLE_LABEL;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : VERSION_UNAVAILABLE_LABEL;
}

function mapGraphDocumentRow(
  row: PgGraphDocumentRow,
  input: {
    authorDisplayName: string | null;
    isAuthor: boolean;
    canRenew: boolean;
  },
): GraphRawDocument {
  const management: KnowledgeMetadata | null = row.management
    ? {
      type: normalizeKnowledgeType(row.management.type),
      version: typeof row.management.version === "string" ? row.management.version : "",
      expirationDate: row.expiration_date,
      changeNote: typeof row.management.changeNote === "string" ? row.management.changeNote : "",
    }
    : null;
  return {
    documentId: row.document_id,
    publishedVersionId: row.published_version_id,
    title: row.title,
    management,
    ownerDepartmentId: row.owner_department_id ?? "",
    ownerDepartmentName: row.owner_department_name ?? UNKNOWN_DEPARTMENT_LABEL,
    authorDisplayName: input.authorDisplayName,
    publishedAt: row.published_at,
    validUntil: row.expiration_date,
    targetReaders: mapReaderSelection(row),
    knowledgeBaseScopeType: row.knowledge_base_scope_type,
    collection: row.collection_id && row.collection_name
      ? {
        id: row.collection_id,
        name: row.collection_name,
        allowedTypes: normalizeAllowedTypes(row.collection_allowed_types),
        status: "ACTIVE",
      }
      : null,
    isAuthor: input.isAuthor,
    canRenew: input.canRenew,
  };
}

function normalizeOpenTarget(raw: string): GraphOpenTarget {
  switch (raw) {
    case "MY_CONTRIBUTIONS":
    case "RESPONSIBLE_VIEW":
    case "ADMIN_INSPECTION":
      return raw;
    default:
      return "READER";
  }
}

function mapReaderSelection(row: PgGraphDocumentRow): ReaderSelection | null {
  if (row.readers_selection_id === null) return null;
  // A referenced selection that cannot be resolved fails closed: nobody is a reader.
  if (row.readers_mode === null) return { mode: "SELECTED_MEMBERS", departmentId: null, memberIds: [] };
  return {
    mode: row.readers_mode,
    departmentId: row.readers_department_id,
    memberIds: row.readers_member_ids ?? [],
  };
}

export function resolveGraphReaderScope(
  targetReaders: ReaderSelection | null,
  knowledgeBaseScopeType: "ORGANIZATION" | "DEPARTMENT" | null,
): GraphReaderScope {
  if (targetReaders) {
    switch (targetReaders.mode) {
      case "ORGANIZATION":
        return "ORGANIZATION";
      case "DEPARTMENT":
        return "DEPARTMENT";
      case "SELECTED_MEMBERS":
        return "SELECTED_MEMBERS";
    }
  }
  if (knowledgeBaseScopeType === "ORGANIZATION") return "ORGANIZATION";
  if (knowledgeBaseScopeType === "DEPARTMENT") return "DEPARTMENT";
  return "LEGACY_AUDIENCE";
}

export function parseRelationshipTypesParam(raw: string | undefined): DocumentRelationshipType[] | null {
  if (!raw) return null;
  const allowed = new Set<string>(documentRelationshipTypes);
  const seen = new Set<DocumentRelationshipType>();
  const parsed: DocumentRelationshipType[] = [];
  for (const part of raw.split(",")) {
    if (!allowed.has(part)) return null;
    const typed = part as DocumentRelationshipType;
    if (!seen.has(typed)) {
      seen.add(typed);
      parsed.push(typed);
    }
  }
  return parsed.length > 0 ? parsed : null;
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function matchesValidityFilter(status: GraphDocumentNode["validityStatus"], filter: GraphValidityFilter): boolean {
  switch (filter) {
    case "CURRENT":
      return status === "Current";
    case "EXPIRING_SOON":
      return status === "Expiring soon";
    case "EXPIRED":
      return status === "Expired";
  }
}

export class PgGraphStore implements GraphStore {
  constructor(private readonly withActor: ActorTransaction) {}

  private async loadActorInTx(
    client: PoolClient,
    userId: string,
    organizationId: string,
  ): Promise<PgActorRow | null> {
    const actorResult = await client.query<PgActorRow>(`
      SELECT om.id AS membership_id,
             om.status,
             o.name AS organization_name,
             ARRAY(
               SELECT dm.department_id::text
                 FROM department_membership dm
                 JOIN department d
                   ON d.id = dm.department_id
                  AND d.organization_id = om.organization_id
                  AND d.status = 'ACTIVE'
                WHERE dm.membership_id = om.id
                  AND dm.status = 'ACTIVE'
                ORDER BY dm.department_id
             ) AS department_ids,
             EXISTS (
               SELECT 1
                 FROM role_assignment ra
                 JOIN role r
                   ON r.id = ra.role_id
                  AND r.code = 'ORG_ADMIN'
                  AND r.is_system
                  AND r.status = 'ACTIVE'
                 JOIN access_scope s
                   ON s.id = ra.access_scope_id
                  AND s.organization_id = om.organization_id
                  AND s.scope = 'ORGANIZATION'
                  AND s.status = 'ACTIVE'
                WHERE ra.membership_id = om.id
                  AND ra.status = 'ACTIVE'
                  AND ra.valid_from <= now()
                  AND (ra.valid_until IS NULL OR ra.valid_until > now())
             ) AS is_org_admin,
             to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS utc_today
        FROM membership om
        JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
       WHERE om.account_id = $1
         AND om.organization_id = $2
         AND om.status = 'ACTIVE'`, [userId, organizationId]);
    return actorResult.rows[0] ?? null;
  }

  private async hasAuthoredPublishedDocInTx(
    client: PoolClient,
    organizationId: string,
    membershipId: string,
  ): Promise<boolean> {
    const authoredCheck = await client.query<{ has_authored: boolean }>(`
      SELECT EXISTS (
        SELECT 1
          FROM current_publication cp
          JOIN company_document d
            ON d.id = cp.document_id
           AND d.organization_id = cp.organization_id
           AND d.status = 'ACTIVE'
         WHERE cp.organization_id = $1
           AND cp.valid_from <= now()
           AND (cp.valid_until IS NULL OR cp.valid_until > now())
           AND d.author_id = $2
      ) OR EXISTS (
        SELECT 1
          FROM company_document d
          JOIN review_submission s
            ON s.document_id = d.id
           AND s.organization_id = d.organization_id
         WHERE d.organization_id = $1
           AND d.author_id = $2
           AND d.status = 'ACTIVE'
           AND s.status = 'APPROVED'
           AND s.publication_state = 'ACTIVE'
      ) AS has_authored`, [organizationId, membershipId]);
    return authoredCheck.rows[0]?.has_authored === true;
  }

  private async hasActiveReviewerGrantInTx(
    client: PoolClient,
    organizationId: string,
    membershipId: string,
  ): Promise<boolean> {
    const grantCheck = await client.query<{ has_grant: boolean }>(`
      SELECT EXISTS (
        SELECT 1
          FROM reviewer_grant g
         WHERE g.organization_id = $1
           AND g.reviewer_id = $2
           AND g.status = 'ACTIVE'
           AND g.valid_from <= now()
           AND (g.valid_until IS NULL OR g.valid_until > now())
      ) AS has_grant`, [organizationId, membershipId]);
    return grantCheck.rows[0]?.has_grant === true;
  }

  private async loadReadableDocsInTx(
    client: PoolClient,
    organizationId: string,
    actorRow: PgActorRow,
  ): Promise<{ documents: GraphRawDocument[]; hasAuthoredPublishedDoc: boolean }> {
    // Materialize each RLS-filtered table read once before joining metadata so FORCE RLS
    // policies on renewals and reader selections are evaluated per query rather than per row.
    const docsResult = await client.query<PgGraphDocumentRow>(`
      WITH current_pointers AS MATERIALIZED (
        SELECT organization_id, document_id AS shared_draft_id, published_version_id, target_scope AS target_scope_type
          FROM current_publication
         WHERE organization_id = $1
           AND valid_from <= now()
           AND (valid_until IS NULL OR valid_until > now())
      ), current_versions AS MATERIALIZED (
        SELECT pv.id AS published_version_id, pv.document_id AS shared_draft_id, pv.knowledge_base_id,
               pv.title, pv.metadata AS management, pv.owner_department_id AS responsible_department_id, pv.published_at,
               pv.reader_policy_id AS reader_selection_id, pv.index_status
          FROM published_version pv
         WHERE pv.id = ANY (ARRAY(SELECT published_version_id FROM current_pointers))
           AND pv.published_at <= now()
      ), version_renewals AS MATERIALIZED (
        SELECT r.published_version_id, r.valid_until AS expiration_date
          FROM publication_renewal r
         WHERE r.organization_id = $1
           AND r.published_version_id = ANY (ARRAY(SELECT published_version_id FROM current_versions))
      ), resolved_versions AS (
        SELECT pv.*,
               CASE WHEN r.published_version_id IS NOT NULL THEN r.expiration_date
                    ELSE NULLIF(pv.management->>'expirationDate', '')::date END AS expiration_date
          FROM current_versions pv
          LEFT JOIN version_renewals r
            ON r.published_version_id = pv.published_version_id
      ), visible_selections AS MATERIALIZED (
        SELECT rs.id AS selection_id, rs.mode AS reader_mode, rs.department_id
          FROM reader_policy rs
         WHERE rs.id = ANY (ARRAY(
           SELECT DISTINCT reader_selection_id FROM current_versions WHERE reader_selection_id IS NOT NULL
         ))
      ), visible_selected_readers AS MATERIALIZED (
        SELECT sr.reader_policy_id AS selection_id,
               array_agg(sr.membership_id::text ORDER BY sr.position) AS member_ids
          FROM policy_reader sr
         WHERE sr.reader_policy_id = ANY (ARRAY(SELECT selection_id FROM visible_selections))
         GROUP BY sr.reader_policy_id
      ), visible_kbs AS MATERIALIZED (
        SELECT id AS knowledge_base_id, organization_id, scope AS scope_type
          FROM knowledge_base
         WHERE organization_id = $1
      ), visible_departments AS MATERIALIZED (
        SELECT id AS department_id, organization_id, name
          FROM department
         WHERE organization_id = $1
      ), own_drafts AS MATERIALIZED (
        SELECT id AS shared_draft_id, organization_id
          FROM company_document
         WHERE organization_id = $1
           AND author_id = $2
           AND status = 'ACTIVE'
      ), visible_placements AS MATERIALIZED (
        SELECT document_id AS shared_draft_id, organization_id, handbook_id AS collection_id
          FROM handbook_placement
         WHERE organization_id = $1
      ), visible_collections AS MATERIALIZED (
        SELECT id AS collection_id, organization_id, name, allowed_types
          FROM handbook
         WHERE organization_id = $1
           AND status = 'ACTIVE'
      )
      SELECT pv.published_version_id,
             pv.shared_draft_id AS document_id,
             pv.title,
             pv.management,
             pv.responsible_department_id AS owner_department_id,
             owner_department.name AS owner_department_name,
             pv.published_at,
             kb.scope_type AS knowledge_base_scope_type,
             cp.target_scope_type,
             pv.index_status,
             to_char(pv.expiration_date, 'YYYY-MM-DD') AS expiration_date,
             pv.reader_selection_id AS readers_selection_id,
             vs.reader_mode AS readers_mode,
             vs.department_id AS readers_department_id,
             COALESCE(vsr.member_ids, ARRAY[]::text[]) AS readers_member_ids,
             (own_draft.shared_draft_id IS NOT NULL) AS is_author,
             kc.collection_id,
             kc.name AS collection_name,
             kc.allowed_types AS collection_allowed_types
        FROM current_pointers cp
        JOIN resolved_versions pv
          ON pv.published_version_id = cp.published_version_id
         AND pv.shared_draft_id = cp.shared_draft_id
        JOIN visible_kbs kb
          ON kb.knowledge_base_id = pv.knowledge_base_id
         AND kb.organization_id = cp.organization_id
        LEFT JOIN visible_selections vs
          ON vs.selection_id = pv.reader_selection_id
        LEFT JOIN visible_selected_readers vsr
          ON vsr.selection_id = pv.reader_selection_id
        LEFT JOIN visible_departments owner_department
          ON owner_department.department_id = pv.responsible_department_id
         AND owner_department.organization_id = cp.organization_id
        LEFT JOIN own_drafts own_draft
          ON own_draft.shared_draft_id = cp.shared_draft_id
         AND own_draft.organization_id = cp.organization_id
        LEFT JOIN visible_placements kcp
          ON kcp.shared_draft_id = cp.shared_draft_id
         AND kcp.organization_id = cp.organization_id
        LEFT JOIN visible_collections kc
          ON kc.collection_id = kcp.collection_id
         AND kc.organization_id = cp.organization_id
       WHERE pv.expiration_date IS NULL OR pv.expiration_date >= (now() AT TIME ZONE 'UTC')::date
       ORDER BY pv.published_at DESC, cp.shared_draft_id ASC`, [organizationId, actorRow.membership_id]);

    const authorNames = new Map<string, string>();
    const versionIds = docsResult.rows.map((row) => row.published_version_id);
    for (let offset = 0; offset < versionIds.length; offset += AUTHOR_NAME_BATCH_SIZE) {
      const chunk = versionIds.slice(offset, offset + AUTHOR_NAME_BATCH_SIZE);
      const namesResult = await client.query<{ published_version_id: string; author_name: string }>(
        "SELECT published_version_id, author_name FROM list_publication_author_names($1::uuid[])",
        [chunk],
      );
      for (const nameRow of namesResult.rows) {
        authorNames.set(nameRow.published_version_id, nameRow.author_name);
      }
    }

    const canRenewByDocument = await computeCanRenewByDocument(client, {
      organizationId,
      actorMembershipId: actorRow.membership_id,
      isOrgAdmin: actorRow.is_org_admin,
      utcToday: actorRow.utc_today,
      candidates: docsResult.rows.map((row) => ({
        documentId: row.document_id,
        publishedVersionId: row.published_version_id,
        ownerDepartmentId: row.owner_department_id,
        expirationDate: row.expiration_date,
        governanceReaderMode: row.readers_mode
          ?? (row.target_scope_type === "ORGANIZATION" ? "ORGANIZATION" : "DEPARTMENT"),
        isAuthor: row.is_author,
        indexStatus: row.index_status ?? "INDEXED",
      })),
      activeAuthorVersionIds: new Set(authorNames.keys()),
    });

    const hasAuthoredPublishedDoc = docsResult.rows.some((row) => row.is_author)
      || await this.hasAuthoredPublishedDocInTx(client, organizationId, actorRow.membership_id);

    const documents: GraphRawDocument[] = docsResult.rows.map((row) =>
      mapGraphDocumentRow(row, {
        authorDisplayName: authorNames.get(row.published_version_id) ?? null,
        isAuthor: row.is_author,
        canRenew: canRenewByDocument.get(row.document_id) === true,
      }),
    );

    return { documents, hasAuthoredPublishedDoc };
  }

  private async listFocusPeerDocumentIdsInTx(
    client: PoolClient,
    organizationId: string,
    focusDocumentId: string,
    relationshipTypes: readonly DocumentRelationshipType[] | null,
    limit: number,
  ): Promise<string[]> {
    if (limit <= 0) return [];
    const result = await client.query<{ peer_id: string }>(`
      SELECT DISTINCT
             CASE
               WHEN r.source_document_id = $2 THEN r.target_document_id
               ELSE r.source_document_id
             END AS peer_id
        FROM document_relationship r
       WHERE r.organization_id = $1
         AND (r.source_document_id = $2 OR r.target_document_id = $2)
         AND ($3::text[] IS NULL OR r.type = ANY($3::text[]))
       LIMIT $4`, [organizationId, focusDocumentId, relationshipTypes, limit]);
    return result.rows.map((row) => row.peer_id);
  }

  private async listRelationshipsInTx(
    client: PoolClient,
    organizationId: string,
    documentIds: readonly string[],
    relationshipTypes: readonly DocumentRelationshipType[] | null,
    limitPlusOne: number,
  ): Promise<GraphRawRelationship[]> {
    if (documentIds.length === 0 || limitPlusOne <= 0) return [];
    const result = await client.query<PgRelationshipRow>(`
      SELECT r.id AS relationship_id,
             r.source_document_id,
             r.target_document_id,
             r.type AS relationship_type,
             r.created_at
        FROM document_relationship r
       WHERE r.organization_id = $1
         AND r.source_document_id = ANY($2::uuid[])
         AND r.target_document_id = ANY($2::uuid[])
         AND ($3::text[] IS NULL OR r.type = ANY($3::text[]))
       ORDER BY r.created_at DESC, r.id ASC
       LIMIT $4`, [organizationId, documentIds, relationshipTypes, limitPlusOne]);
    return result.rows.map((row) => ({
      relationshipId: row.relationship_id,
      sourceDocumentId: row.source_document_id,
      targetDocumentId: row.target_document_id,
      relationshipType: row.relationship_type,
      createdAt: row.created_at,
    }));
  }

  async loadReadableSnapshot(userId: string, organizationId: string): Promise<GraphSnapshot | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const actorRow = await this.loadActorInTx(client, userId, organizationId);
      if (!actorRow) return null;
      const { documents, hasAuthoredPublishedDoc } = await this.loadReadableDocsInTx(client, organizationId, actorRow);
      return {
        organization: { id: organizationId, name: actorRow.organization_name },
        actor: {
          membershipId: actorRow.membership_id,
          organizationId,
          status: actorRow.status,
          departmentIds: actorRow.department_ids,
          isOrgAdmin: actorRow.is_org_admin,
          hasAuthoredPublishedDoc,
        },
        utcToday: actorRow.utc_today,
        documents,
      };
    });
  }

  async loadMonitorProjection(
    userId: string,
    organizationId: string,
    input: {
      snapshot: GraphSnapshot;
      monitorRequested: boolean;
      includeExpired: boolean;
    },
  ): Promise<GraphMonitorProjection> {
    return this.withActor(userId, organizationId, async (client) => {
      // Always include expired rows inside the trusted routine. Capability derivation must
      // still see an expired-only author/reviewer document even when the current response
      // will filter expired entries out because includeExpired was not requested.
      const result = await client.query<PgGraphMonitorRow>(
        "SELECT * FROM list_graph_monitor_documents($1)",
        [true],
      );
      const documents: GraphMonitorDocumentEntry[] = result.rows.map((row) => ({
        raw: mapGraphDocumentRow(row, {
          authorDisplayName: row.author_display_name,
          isAuthor: row.is_author,
          canRenew: row.can_renew,
        }),
        isCurrentlyReadable: row.is_currently_readable,
        openTarget: normalizeOpenTarget(row.open_target),
        monitorSignals: {
          openMaintenanceCaseCount: row.open_maintenance_case_count,
          isUnassignedOrgDoc: row.is_unassigned_org_doc,
          requiresAuditedInspection: row.requires_audited_inspection,
        },
      }));
      const accountable = input.snapshot.actor.isOrgAdmin || result.rows.some((row) => row.actor_accountable);
      return {
        canUseMonitorMode: accountable,
        canIncludeExpired: accountable,
        monitorActive: input.monitorRequested && accountable,
        includeExpiredActive: input.includeExpired && accountable,
        documents,
      };
    });
  }

  async listRelationships(
    userId: string,
    organizationId: string,
    documentIds: readonly string[],
    relationshipTypes: readonly DocumentRelationshipType[] | null,
    limitPlusOne: number,
  ): Promise<GraphRawRelationship[]> {
    if (documentIds.length === 0 || limitPlusOne <= 0) return [];
    return this.withActor(userId, organizationId, (client) =>
      this.listRelationshipsInTx(client, organizationId, documentIds, relationshipTypes, limitPlusOne));
  }

  async loadGraphBundle(
    userId: string,
    organizationId: string,
    input: {
      monitorRequested: boolean;
      includeExpired: boolean;
      includeLinks: boolean;
      focusDocumentId?: string;
      limit: number;
      relationshipTypes: readonly DocumentRelationshipType[] | null;
      relationshipsLimitPlusOne: number;
      selectDocumentIdsForLinks: (
        loaded: Omit<GraphLoadedBundle, "relationships">,
        focusPeerDocumentIds?: readonly string[],
      ) => readonly string[];
    },
  ): Promise<GraphLoadedBundle | null> {
    return this.withActor(userId, organizationId, async (client) => {
      const actorRow = await this.loadActorInTx(client, userId, organizationId);
      if (!actorRow) return null;

      let loaded: Omit<GraphLoadedBundle, "relationships">;

      if (!input.monitorRequested) {
        // Default mode: never execute list_graph_monitor_documents(). Derive monitor capabilities
        // with lightweight indexed checks and load readable docs in the same transaction.
        const { documents, hasAuthoredPublishedDoc } = await this.loadReadableDocsInTx(client, organizationId, actorRow);
        const canUseMonitorMode = actorRow.is_org_admin
          || hasAuthoredPublishedDoc
          || await this.hasActiveReviewerGrantInTx(client, organizationId, actorRow.membership_id);

        loaded = {
          organization: { id: organizationId, name: actorRow.organization_name },
          actor: {
            membershipId: actorRow.membership_id,
            organizationId,
            status: actorRow.status,
            departmentIds: actorRow.department_ids,
            isOrgAdmin: actorRow.is_org_admin,
            hasAuthoredPublishedDoc,
          },
          utcToday: actorRow.utc_today,
          canUseMonitorMode,
          canIncludeExpired: canUseMonitorMode,
          monitorActive: false,
          includeExpiredActive: false,
          entries: documents.map((raw) => ({
            raw,
            isCurrentlyReadable: true,
            openTarget: "READER" as const,
            monitorSignals: null,
          })),
        };
      } else {
        // Monitor mode requested: call list_graph_monitor_documents ONCE with the requested expiry flag
        // and skip the redundant readable snapshot scan whenever the caller is accountable.
        const result = await client.query<PgGraphMonitorRow>(
          "SELECT * FROM list_graph_monitor_documents($1)",
          [input.includeExpired],
        );
        const hasAuthoredPublishedDoc = result.rows.some((row) => row.is_author)
          || await this.hasAuthoredPublishedDocInTx(client, organizationId, actorRow.membership_id);
        let accountable = actorRow.is_org_admin
          || hasAuthoredPublishedDoc
          || result.rows.some((row) => row.actor_accountable);

        if (!accountable && !input.includeExpired) {
          const hasGrant = await this.hasActiveReviewerGrantInTx(client, organizationId, actorRow.membership_id);
          if (hasGrant) {
            const expiredCheck = await client.query<{ accountable: boolean }>(
              "SELECT EXISTS (SELECT 1 FROM list_graph_monitor_documents(true) WHERE actor_accountable) AS accountable",
            );
            accountable = expiredCheck.rows[0]?.accountable === true;
          }
        }

        if (accountable) {
          loaded = {
            organization: { id: organizationId, name: actorRow.organization_name },
            actor: {
              membershipId: actorRow.membership_id,
              organizationId,
              status: actorRow.status,
              departmentIds: actorRow.department_ids,
              isOrgAdmin: actorRow.is_org_admin,
              hasAuthoredPublishedDoc,
            },
            utcToday: actorRow.utc_today,
            canUseMonitorMode: true,
            canIncludeExpired: true,
            monitorActive: true,
            includeExpiredActive: input.includeExpired,
            entries: result.rows.map((row) => ({
              raw: mapGraphDocumentRow(row, {
                authorDisplayName: row.author_display_name,
                isAuthor: row.is_author,
                canRenew: row.can_renew,
              }),
              isCurrentlyReadable: row.is_currently_readable,
              openTarget: normalizeOpenTarget(row.open_target),
              monitorSignals: {
                openMaintenanceCaseCount: row.open_maintenance_case_count,
                isUnassignedOrgDoc: row.is_unassigned_org_doc,
                requiresAuditedInspection: row.requires_audited_inspection,
              },
            })),
          };
        } else {
          // Non-accountable caller requested monitor=true: fail closed to readable snapshot inside same tx.
          const readable = await this.loadReadableDocsInTx(client, organizationId, actorRow);
          loaded = {
            organization: { id: organizationId, name: actorRow.organization_name },
            actor: {
              membershipId: actorRow.membership_id,
              organizationId,
              status: actorRow.status,
              departmentIds: actorRow.department_ids,
              isOrgAdmin: actorRow.is_org_admin,
              hasAuthoredPublishedDoc: readable.hasAuthoredPublishedDoc,
            },
            utcToday: actorRow.utc_today,
            canUseMonitorMode: false,
            canIncludeExpired: false,
            monitorActive: false,
            includeExpiredActive: false,
            entries: readable.documents.map((raw) => ({
              raw,
              isCurrentlyReadable: true,
              openTarget: "READER" as const,
              monitorSignals: null,
            })),
          };
        }
      }

      const focusPeerIds = input.includeLinks && input.focusDocumentId && loaded.entries.length > input.limit
        ? await this.listFocusPeerDocumentIdsInTx(
          client,
          organizationId,
          input.focusDocumentId,
          input.relationshipTypes,
          Math.max(1, input.limit - 1),
        )
        : undefined;
      const returnedIds = input.selectDocumentIdsForLinks(loaded, focusPeerIds);
      const relationships = input.includeLinks && returnedIds.length > 0
        ? await this.listRelationshipsInTx(
          client,
          organizationId,
          returnedIds,
          input.relationshipTypes,
          input.relationshipsLimitPlusOne,
        )
        : [];

      return { ...loaded, relationships };
    });
  }
}

type ProjectedEntry = {
  node: GraphDocumentNode;
  publishedAtMs: number;
  collectionMeta: { id: string; name: string; allowedTypes: KnowledgeType[] | null } | null;
};

function sortProjectedEntries(entries: ProjectedEntry[]): ProjectedEntry[] {
  return entries.sort((a, b) =>
    (b.publishedAtMs - a.publishedAtMs) || compareCodePoint(a.node.documentId, b.node.documentId));
}

type ProjectedGraphSelection = {
  truncated: boolean;
  departments: Array<{ id: string; name: string }>;
  collections: Array<{ id: string; name: string; allowedTypes: KnowledgeType[] | null }>;
  documents: GraphDocumentNode[];
};

function projectGraphSelection(
  loaded: Omit<GraphLoadedBundle, "relationships">,
  query: KnowledgeGraphQuery,
  limit: number,
  focusPeerDocumentIds?: readonly string[],
): ProjectedGraphSelection {
  const { organization, actor, utcToday, monitorActive, includeExpiredActive } = loaded;
  const rawEntries = monitorActive
    ? loaded.entries.filter((entry) =>
      includeExpiredActive || entry.raw.validUntil === null || entry.raw.validUntil >= utcToday)
    : loaded.entries.filter((entry) =>
      canRead(actor, { organizationId: organization.id, readers: entry.raw.targetReaders })
      && (entry.raw.validUntil === null || entry.raw.validUntil >= utcToday));

  const authorizedEntries: ProjectedEntry[] = sortProjectedEntries(rawEntries.map((entry) => {
    const { raw } = entry;
    const readerScope = resolveGraphReaderScope(raw.targetReaders, raw.knowledgeBaseScopeType);
    const activeOrgCollection = readerScope === "ORGANIZATION" && raw.collection?.status === "ACTIVE"
      ? raw.collection
      : null;
    const type = normalizeKnowledgeType(raw.management?.type ?? null);
    const version = normalizeVersionLabel(raw.management?.version);
    const validity = validityStatus(
      { type, version, expirationDate: raw.validUntil, changeNote: "" },
      utcToday,
    );

    const node: GraphDocumentNode = {
      documentId: raw.documentId as DocumentId,
      publishedVersionId: raw.publishedVersionId as PublishedVersionId,
      title: raw.title,
      type,
      version,
      ownerDepartmentId: raw.ownerDepartmentId,
      ownerDepartmentName: raw.ownerDepartmentName,
      authorDisplayName: raw.authorDisplayName,
      publishedAt: raw.publishedAt.toISOString(),
      validUntil: raw.validUntil,
      validityStatus: validity.status,
      daysUntilExpiry: validity.daysLeft,
      readerScope,
      collectionId: activeOrgCollection ? activeOrgCollection.id : null,
      openTarget: entry.openTarget,
      canEditRelationships: (actor.isOrgAdmin || raw.isAuthor) && entry.isCurrentlyReadable,
      canRenew: raw.canRenew,
      monitorSignals: monitorActive ? entry.monitorSignals : null,
    };

    return {
      node,
      publishedAtMs: raw.publishedAt.getTime(),
      collectionMeta: activeOrgCollection
        ? {
          id: activeOrgCollection.id,
          name: activeOrgCollection.name,
          allowedTypes: activeOrgCollection.allowedTypes ? [...activeOrgCollection.allowedTypes] : null,
        }
        : null,
    };
  }));

  const normalizedSearch = query.q?.trim().toLowerCase() ?? "";
  const matchingEntries = authorizedEntries.filter((entry) => {
    const { node, collectionMeta } = entry;
    if (query.ownerDepartmentId && node.ownerDepartmentId !== query.ownerDepartmentId) return false;
    if (query.typeCode && knowledgeTypeToCode(node.type) !== query.typeCode) return false;
    if (query.collectionId) {
      if (query.collectionId === "UNASSIGNED") {
        if (node.readerScope !== "ORGANIZATION" || node.collectionId !== null) return false;
      } else if (node.readerScope !== "ORGANIZATION" || node.collectionId !== query.collectionId) {
        return false;
      }
    }
    if (query.readerScope && node.readerScope !== query.readerScope) return false;
    if (query.validity && !matchesValidityFilter(node.validityStatus, query.validity)) return false;
    if (monitorActive && query.onlyOpenCases && (node.monitorSignals?.openMaintenanceCaseCount ?? 0) <= 0) {
      return false;
    }
    if (monitorActive && query.onlyUnassignedOrg && !node.monitorSignals?.isUnassignedOrgDoc) {
      return false;
    }
    if (normalizedSearch) {
      const haystack = [
        node.title,
        node.ownerDepartmentName,
        node.authorDisplayName ?? "",
        node.version,
        node.type ?? "Uncategorized",
        collectionMeta?.name ?? "",
      ].join("\n").toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }
    return true;
  });

  const truncated = matchingEntries.length > limit;
  const selectedEntries = matchingEntries.slice(0, limit);

  // F3G-05a: focusDocumentId is guaranteed to be included whenever authorized, even alongside
  // active facets or beyond the 500-document cap.
  let promoted = false;
  const protectedIds = new Set<string>();
  if (query.focusDocumentId) {
    protectedIds.add(query.focusDocumentId);
    if (!selectedEntries.some((entry) => entry.node.documentId === query.focusDocumentId)) {
      const focusEntry = authorizedEntries.find((entry) => entry.node.documentId === query.focusDocumentId);
      if (focusEntry) {
        if (selectedEntries.length >= limit) {
          selectedEntries[selectedEntries.length - 1] = focusEntry;
        } else {
          selectedEntries.push(focusEntry);
        }
        promoted = true;
      }
    }
    // When truncated with links enabled (e.g. Manage Links dialog in >500-doc orgs), promote
    // authorized 1-hop relationship peers of focusDocumentId into the bounded slice so outgoing
    // and incoming links stay visible with peer titles.
    if (truncated && focusPeerDocumentIds && focusPeerDocumentIds.length > 0) {
      const selectedIdSet = new Set<string>(selectedEntries.map((entry) => entry.node.documentId));
      const matchingById = new Map<string, ProjectedEntry>(
        matchingEntries.map((entry) => [entry.node.documentId, entry]),
      );
      for (const peerId of focusPeerDocumentIds) {
        protectedIds.add(peerId);
        if (selectedIdSet.has(peerId)) continue;
        const peerEntry = matchingById.get(peerId);
        if (!peerEntry) continue;
        if (selectedEntries.length < limit) {
          selectedEntries.push(peerEntry);
          selectedIdSet.add(peerId);
          promoted = true;
        } else {
          let replaceIdx = -1;
          for (let idx = selectedEntries.length - 1; idx >= 0; idx -= 1) {
            if (!protectedIds.has(selectedEntries[idx]!.node.documentId)) {
              replaceIdx = idx;
              break;
            }
          }
          if (replaceIdx === -1) break;
          selectedIdSet.delete(selectedEntries[replaceIdx]!.node.documentId);
          selectedEntries[replaceIdx] = peerEntry;
          selectedIdSet.add(peerId);
          promoted = true;
        }
      }
    }
    if (promoted) sortProjectedEntries(selectedEntries);
  }

  const departmentMap = new Map<string, string>();
  const collectionMap = new Map<string, { id: string; name: string; allowedTypes: KnowledgeType[] | null }>();
  for (const entry of selectedEntries) {
    if (entry.node.ownerDepartmentId && !departmentMap.has(entry.node.ownerDepartmentId)) {
      departmentMap.set(entry.node.ownerDepartmentId, entry.node.ownerDepartmentName);
    }
    if (entry.node.readerScope === "ORGANIZATION" && entry.node.collectionId !== null && entry.collectionMeta) {
      if (!collectionMap.has(entry.collectionMeta.id)) {
        collectionMap.set(entry.collectionMeta.id, {
          id: entry.collectionMeta.id,
          name: entry.collectionMeta.name,
          allowedTypes: entry.collectionMeta.allowedTypes ? [...entry.collectionMeta.allowedTypes] : null,
        });
      }
    }
  }

  const departments = [...departmentMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || compareCodePoint(a.id, b.id));
  const collections = [...collectionMap.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || compareCodePoint(a.id, b.id));
  const documents = selectedEntries.map((entry) => entry.node);

  return { truncated, departments, collections, documents };
}

function mapVisibleRelationships(
  documents: readonly GraphDocumentNode[],
  rawEdges: readonly GraphRawRelationship[],
  relationshipTypes: readonly DocumentRelationshipType[] | null,
): { relationships: GraphRelationshipEdge[]; relationshipsTruncated: boolean } {
  const returnedIdSet = new Set<string>(documents.map((doc) => doc.documentId));
  const allowedTypes = relationshipTypes ? new Set<DocumentRelationshipType>(relationshipTypes) : null;
  const filteredEdges = rawEdges.filter((edge) =>
    returnedIdSet.has(edge.sourceDocumentId)
    && returnedIdSet.has(edge.targetDocumentId)
    && (!allowedTypes || allowedTypes.has(edge.relationshipType)),
  );
  return {
    relationshipsTruncated: filteredEdges.length > GRAPH_MAX_RELATIONSHIPS,
    relationships: filteredEdges.slice(0, GRAPH_MAX_RELATIONSHIPS).map((edge) => ({
      relationshipId: edge.relationshipId,
      sourceDocumentId: edge.sourceDocumentId as DocumentId,
      targetDocumentId: edge.targetDocumentId as DocumentId,
      relationshipType: edge.relationshipType,
      createdAt: edge.createdAt.toISOString(),
    })),
  };
}

export class GraphProjectionService {
  private readonly monitorHandler?: GraphMonitorHandler;

  constructor(private readonly store: GraphStore, options: GraphProjectionServiceOptions = {}) {
    this.monitorHandler = options.monitorHandler;
  }

  async getGraph(
    userId: string,
    organizationId: string,
    query: KnowledgeGraphQuery,
  ): Promise<KnowledgeGraphPayload | null> {
    const view: GraphViewMode = query.view ?? "accountability";
    const requestedLimit = query.limit ?? GRAPH_MAX_DOCUMENTS;
    const limit = Math.max(1, Math.min(GRAPH_MAX_DOCUMENTS, Math.trunc(requestedLimit)));
    const includeLinks = query.includeLinks === true;
    const relationshipTypes = includeLinks ? parseRelationshipTypesParam(query.relationshipTypes) : null;

    if (!this.monitorHandler && this.store.loadGraphBundle) {
      let cachedProjection: ProjectedGraphSelection | null = null;
      const bundle = await this.store.loadGraphBundle(userId, organizationId, {
        monitorRequested: query.monitor === true,
        includeExpired: query.includeExpired === true,
        includeLinks,
        focusDocumentId: query.focusDocumentId,
        limit,
        relationshipTypes,
        relationshipsLimitPlusOne: GRAPH_MAX_RELATIONSHIPS + 1,
        selectDocumentIdsForLinks: (loaded, focusPeerDocumentIds) => {
          cachedProjection = projectGraphSelection(loaded, query, limit, focusPeerDocumentIds);
          return cachedProjection.documents.map((doc) => doc.documentId);
        },
      });
      if (!bundle) return null;
      const projected = cachedProjection ?? projectGraphSelection(bundle, query, limit);
      const { relationships, relationshipsTruncated } = includeLinks && projected.documents.length > 0
        ? mapVisibleRelationships(projected.documents, bundle.relationships, relationshipTypes)
        : { relationships: [], relationshipsTruncated: false };

      return {
        schemaVersion: 1,
        organization: { ...bundle.organization },
        capabilities: {
          canUseMonitorMode: bundle.canUseMonitorMode,
          canIncludeExpired: bundle.canIncludeExpired,
          canManageRelationships: bundle.actor.isOrgAdmin || bundle.actor.hasAuthoredPublishedDoc,
        },
        appliedMode: {
          view,
          monitorActive: bundle.monitorActive,
          includeExpiredActive: bundle.includeExpiredActive,
          includeLinksActive: includeLinks,
        },
        truncation: {
          limit,
          returnedCount: projected.documents.length,
          truncated: projected.truncated,
          relationshipsLimit: GRAPH_MAX_RELATIONSHIPS,
          relationshipsTruncated,
        },
        departments: projected.departments,
        collections: projected.collections,
        documents: projected.documents,
        relationships,
      };
    }

    const snapshot = await this.store.loadReadableSnapshot(userId, organizationId);
    if (!snapshot) return null;

    const monitorProjection = this.monitorHandler
      ? await this.monitorHandler({ userId, organizationId, snapshot, query })
      : this.store.loadMonitorProjection
        ? await this.store.loadMonitorProjection(userId, organizationId, {
          snapshot,
          monitorRequested: query.monitor === true,
          includeExpired: query.includeExpired === true,
        })
        : null;

    const canUseMonitorMode = monitorProjection?.canUseMonitorMode ?? false;
    const canIncludeExpired = monitorProjection?.canIncludeExpired ?? false;
    const monitorActive = Boolean(query.monitor && monitorProjection?.monitorActive && canUseMonitorMode);
    const includeExpiredActive = Boolean(
      monitorActive && query.includeExpired && monitorProjection?.includeExpiredActive && canIncludeExpired,
    );
    const canManageRelationships = snapshot.actor.isOrgAdmin || snapshot.actor.hasAuthoredPublishedDoc;

    const entries: GraphBundleEntry[] = monitorActive && monitorProjection
      ? monitorProjection.documents
      : snapshot.documents.map((raw) => ({
        raw,
        isCurrentlyReadable: true,
        openTarget: "READER" as const,
        monitorSignals: null,
      }));

    const projected = projectGraphSelection({
      organization: snapshot.organization,
      actor: snapshot.actor,
      utcToday: snapshot.utcToday,
      canUseMonitorMode,
      canIncludeExpired,
      monitorActive,
      includeExpiredActive,
      entries,
    }, query, limit);

    let relationships: GraphRelationshipEdge[] = [];
    let relationshipsTruncated = false;
    if (includeLinks && projected.documents.length > 0) {
      const returnedIds = projected.documents.map((doc) => doc.documentId);
      const rawEdges = await this.store.listRelationships(
        userId,
        organizationId,
        returnedIds,
        relationshipTypes,
        GRAPH_MAX_RELATIONSHIPS + 1,
      );
      const mapped = mapVisibleRelationships(projected.documents, rawEdges, relationshipTypes);
      relationships = mapped.relationships;
      relationshipsTruncated = mapped.relationshipsTruncated;
    }

    return {
      schemaVersion: 1,
      organization: { ...snapshot.organization },
      capabilities: {
        canUseMonitorMode,
        canIncludeExpired,
        canManageRelationships,
      },
      appliedMode: {
        view,
        monitorActive,
        includeExpiredActive,
        includeLinksActive: includeLinks,
      },
      truncation: {
        limit,
        returnedCount: projected.documents.length,
        truncated: projected.truncated,
        relationshipsLimit: GRAPH_MAX_RELATIONSHIPS,
        relationshipsTruncated,
      },
      departments: projected.departments,
      collections: projected.collections,
      documents: projected.documents,
      relationships,
    };
  }
}
