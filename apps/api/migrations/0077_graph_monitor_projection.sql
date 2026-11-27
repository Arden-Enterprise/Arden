SET search_path TO arden, public;

-- Decision 0036 (Knowledge Graph T-07): role-gated ISO/IEC 38505-1:2026 Governance
-- Monitor Mode projection. One reviewed trusted routine intentionally crosses the
-- publication/readership boundary only far enough to return bounded metadata:
-- titles, ownership/type/validity, Target Readers mode (never selected-member
-- identities beyond the same metadata shape already exposed to authorized graph
-- callers), accountability open-target, and a strictly role-scoped nullable count
-- of current-version open maintenance cases. It never returns content, excerpts,
-- report text, reporter identities, or selected reader identities for hidden rows.
--   * Ordinary readers may execute the routine but receive only the same currently
--     readable, unexpired rows they can already read; Core keeps Monitor Mode off
--     because none of those rows carries author/reviewer/admin accountability.
--   * Authors keep accountability across current AND expired publications, so an
--     author whose only publication just expired can still enter Monitor Mode and
--     reach My Contributions for renewal/withdrawal.
--   * Responsible-reviewer rows use 0060's disjoint maintenance_reviewer_eligible
--     exact-version grant test; Org Admin rows are metadata-only and open through
--     decision 0023 audited inspection rather than becoming reader/AI sources.
--
-- Operator rollout: adds two reviewed SECURITY DEFINER routines
-- (list_graph_monitor_documents, get_publication_renewal_state; 63 in the owner
-- inventory). Apply as the trusted superuser so they keep their postgres owner;
-- register them in release-policy.json and deploy/release/security-definer-owner-repair.sql
-- in the same change.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION '0077 must be applied by the trusted operator role (superuser or BYPASSRLS)'
            USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE FUNCTION list_graph_monitor_documents(p_include_expired boolean)
RETURNS TABLE (
    document_id uuid,
    published_version_id uuid,
    title text,
    management jsonb,
    owner_department_id uuid,
    owner_department_name text,
    author_display_name text,
    published_at timestamptz,
    expiration_date text,
    readers_selection_id uuid,
    readers_mode text,
    readers_department_id uuid,
    readers_member_ids uuid[],
    knowledge_base_scope_type text,
    collection_id uuid,
    collection_name text,
    collection_allowed_types text[],
    is_author boolean,
    can_renew boolean,
    is_currently_readable boolean,
    open_target text,
    open_maintenance_case_count integer,
    is_unassigned_org_doc boolean,
    requires_audited_inspection boolean,
    actor_accountable boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    WITH base_context AS (
        SELECT NULLIF(current_setting('arden.organization_id', true), '')::uuid AS org_id,
               (now() AT TIME ZONE 'UTC')::date AS today
    ), actor_context AS (
        SELECT base.org_id,
               base.today,
               governance_actor_membership(base.org_id) AS actor_membership_id
          FROM base_context base
    ), context AS (
        SELECT actor.*,
               governance_is_org_admin(actor.actor_membership_id, actor.org_id) AS is_admin
          FROM actor_context actor
    ), readable_ids AS MATERIALIZED (
        SELECT current_readable_document_ids() AS document_id
    ), actor_grants AS MATERIALIZED (
        SELECT g.scope,
               g.department_id,
               g.classifications,
               g.level,
               g.team_tag,
               g.project_tag,
               COALESCE(dep.status = 'ACTIVE', false) AS department_active
          FROM context ctx
          JOIN reviewer_grant g
            ON g.reviewer_membership_id = ctx.actor_membership_id
           AND g.organization_id = ctx.org_id
          LEFT JOIN department dep
            ON dep.department_id = g.department_id
           AND dep.organization_id = g.organization_id
         WHERE ctx.actor_membership_id IS NOT NULL
           AND g.status = 'ACTIVE'
           AND g.valid_from <= now()
           AND (g.valid_until IS NULL OR g.valid_until > now())
    ), current_docs AS (
        SELECT cp.shared_draft_id AS document_id,
               pv.published_version_id,
               pv.title,
               pv.management,
               pv.classification,
               pv.team_tag,
               pv.project_tag,
               pv.responsible_department_id AS owner_department_id,
               owner_department.name AS owner_department_name,
               pv.published_at,
               kb.scope_type AS knowledge_base_scope_type,
               publication_expiration_date(pv.published_version_id, pv.management) AS expiration_on,
               COALESCE(cp.reader_selection_id, pv.reader_selection_id) AS readers_selection_id,
               rs.reader_mode AS readers_mode,
               rs.department_id AS readers_department_id,
               version_rs.reader_mode AS review_reader_mode,
               ARRAY(
                   SELECT sr.membership_id
                     FROM selected_reader sr
                    WHERE sr.selection_id = COALESCE(cp.reader_selection_id, pv.reader_selection_id)
                    ORDER BY sr.ordinal
               ) AS readers_member_ids,
               cp.target_scope_type,
               d.author_membership_id,
               kc.collection_id,
               kc.name AS collection_name,
               kc.allowed_types AS collection_allowed_types
          FROM context ctx
          JOIN knowledge_current_publication cp
            ON cp.organization_id = ctx.org_id
          JOIN shared_draft d
            ON d.shared_draft_id = cp.shared_draft_id
           AND d.organization_id = cp.organization_id
           AND d.status = 'ACTIVE'
          JOIN published_knowledge_version pv
            ON pv.published_version_id = cp.published_version_id
           AND pv.shared_draft_id = cp.shared_draft_id
          JOIN knowledge_base kb
            ON kb.knowledge_base_id = pv.knowledge_base_id
           AND kb.organization_id = cp.organization_id
          LEFT JOIN department owner_department
            ON owner_department.department_id = pv.responsible_department_id
           AND owner_department.organization_id = cp.organization_id
          LEFT JOIN reader_selection rs
            ON rs.selection_id = COALESCE(cp.reader_selection_id, pv.reader_selection_id)
          LEFT JOIN reader_selection version_rs
            ON version_rs.selection_id = pv.reader_selection_id
          LEFT JOIN knowledge_collection_placement kcp
            ON kcp.shared_draft_id = cp.shared_draft_id
           AND kcp.organization_id = cp.organization_id
          LEFT JOIN knowledge_collection kc
            ON kc.collection_id = kcp.collection_id
           AND kc.organization_id = cp.organization_id
           AND kc.status = 'ACTIVE'
         WHERE ctx.actor_membership_id IS NOT NULL
           AND cp.valid_from <= now()
           AND (cp.valid_until IS NULL OR cp.valid_until > now())
           AND pv.published_at <= now()
    ), scoped AS (
        SELECT c.*,
               ctx.today,
               ctx.is_admin,
               (c.author_membership_id = ctx.actor_membership_id) AS is_author,
               (c.document_id IN (SELECT document_id FROM readable_ids)) AS is_currently_readable,
               (EXISTS (
                   SELECT 1
                     FROM actor_grants ag
                    WHERE c.classification = ANY(ag.classifications)
                      AND (c.classification <> 'RESTRICTED' OR ag.level IN ('SPECIALIST', 'SENIOR'))
                      AND (ag.team_tag IS NULL OR ag.team_tag IS NOT DISTINCT FROM c.team_tag)
                      AND (ag.project_tag IS NULL OR ag.project_tag IS NOT DISTINCT FROM c.project_tag)
                      AND CASE WHEN COALESCE(c.review_reader_mode,
                              CASE c.target_scope_type WHEN 'DEPARTMENT' THEN 'DEPARTMENT' ELSE 'ORGANIZATION' END
                          ) = 'ORGANIZATION'
                          THEN ag.scope = 'ORGANIZATION'
                          ELSE ag.scope = 'DEPARTMENT'
                               AND ag.department_id = c.owner_department_id
                               AND ag.department_active
                      END
               ) AND c.author_membership_id IS DISTINCT FROM ctx.actor_membership_id) AS is_disjoint_reviewer,
               (c.expiration_on IS NOT NULL AND c.expiration_on < ctx.today) AS is_expired,
               COALESCE(c.readers_mode,
                   CASE c.target_scope_type WHEN 'ORGANIZATION' THEN 'ORGANIZATION' ELSE 'DEPARTMENT' END
               ) AS governance_reader_mode
          FROM current_docs c
          CROSS JOIN context ctx
    ), visible AS (
        SELECT s.*
          FROM scoped s
         WHERE (s.is_currently_readable OR s.is_author OR s.is_disjoint_reviewer OR s.is_admin)
           AND (p_include_expired IS TRUE OR NOT s.is_expired)
    ), routed AS (
        SELECT v.*,
               (v.is_author OR v.is_disjoint_reviewer OR v.is_admin) AS actor_accountable,
               CASE
                   WHEN v.is_currently_readable AND NOT v.is_expired THEN 'READER'
                   WHEN v.is_author THEN 'MY_CONTRIBUTIONS'
                   WHEN v.is_disjoint_reviewer THEN 'RESPONSIBLE_VIEW'
                   WHEN v.is_admin THEN 'ADMIN_INSPECTION'
                   ELSE 'READER'
               END AS open_target
          FROM visible v
    ), renewal_pending AS (
        SELECT s.shared_draft_id AS document_id
          FROM shared_submission s
          JOIN context ctx ON ctx.org_id = s.organization_id
         WHERE s.request_type = 'RENEWAL'
           AND s.status = 'PENDING_REVIEW'
         GROUP BY s.shared_draft_id
    ), open_case_counts AS (
        SELECT mc.document_id,
               mc.published_version_id,
               count(*)::integer AS open_count
          FROM maintenance_case mc
          JOIN context ctx ON ctx.org_id = mc.organization_id
         WHERE mc.reporter_status <> 'Resolved'
           AND EXISTS (
               SELECT 1
                 FROM visible v
                WHERE v.is_admin OR v.is_disjoint_reviewer
           )
         GROUP BY mc.document_id, mc.published_version_id
    ), visible_ids AS (
        SELECT array_agg(r.published_version_id) AS ids
          FROM routed r
    ), author_chunks AS (
        SELECT ids[starts.start_index:starts.start_index + 999] AS chunk
          FROM visible_ids
          CROSS JOIN LATERAL generate_series(1, COALESCE(cardinality(ids), 0), 1000) AS starts(start_index)
    ), author_names AS (
        SELECT names.published_version_id,
               names.author_name
          FROM author_chunks chunks
          CROSS JOIN LATERAL list_publication_author_names(chunks.chunk) AS names
    )
    SELECT r.document_id,
           r.published_version_id,
           r.title,
           r.management,
           r.owner_department_id,
           COALESCE(r.owner_department_name, 'Unknown department') AS owner_department_name,
           an.author_name AS author_display_name,
           r.published_at,
           to_char(r.expiration_on, 'YYYY-MM-DD') AS expiration_date,
           r.readers_selection_id,
           r.readers_mode,
           r.readers_department_id,
           CASE WHEN r.is_currently_readable THEN r.readers_member_ids ELSE ARRAY[]::uuid[] END AS readers_member_ids,
           r.knowledge_base_scope_type,
           r.collection_id,
           r.collection_name,
           r.collection_allowed_types,
           r.is_author,
           (
               r.expiration_on IS NOT NULL
               AND rp.document_id IS NULL
               AND (
                   r.is_author
                   OR NOT renewal_member_active(r.author_membership_id)
                   OR r.expiration_on <= r.today + 7
               )
               AND (
                   r.is_author
                   OR r.is_admin
                   OR EXISTS (
                       SELECT 1
                         FROM actor_grants ag
                        WHERE (r.governance_reader_mode = 'ORGANIZATION' AND ag.scope = 'ORGANIZATION')
                           OR (r.governance_reader_mode <> 'ORGANIZATION'
                               AND ag.scope = 'DEPARTMENT'
                               AND ag.department_id = r.owner_department_id)
                   )
               )
           ) AS can_renew,
           r.is_currently_readable,
           r.open_target,
           CASE
               WHEN r.is_admin OR r.is_disjoint_reviewer THEN COALESCE(occ.open_count, 0)
               ELSE NULL
           END AS open_maintenance_case_count,
           (
               COALESCE(r.readers_mode,
                   CASE WHEN r.knowledge_base_scope_type = 'ORGANIZATION' THEN 'ORGANIZATION' ELSE 'DEPARTMENT' END
               ) = 'ORGANIZATION'
               AND r.collection_id IS NULL
           ) AS is_unassigned_org_doc,
           (r.open_target = 'ADMIN_INSPECTION') AS requires_audited_inspection,
           r.actor_accountable
      FROM routed r
      LEFT JOIN renewal_pending rp ON rp.document_id = r.document_id
      LEFT JOIN open_case_counts occ
        ON occ.document_id = r.document_id
       AND occ.published_version_id = r.published_version_id
      LEFT JOIN author_names an ON an.published_version_id = r.published_version_id
     ORDER BY r.published_at DESC, r.document_id ASC;
$$;
REVOKE ALL ON FUNCTION list_graph_monitor_documents(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_graph_monitor_documents(boolean) TO arden_runtime;

-- Decision 0032 / 0036: exact single-document renewal state lookup without
-- list_publication_renewal_state()'s 1,000-row cap, preserving identical
-- authorization (author, Org Admin, or responsible reviewer) and metadata-only projection.
CREATE FUNCTION get_publication_renewal_state(p_document_id uuid)
RETURNS TABLE (document_id uuid, published_version_id uuid, title text, responsible_department_id uuid,
    expiration_date date, renewal_pending boolean, author_active boolean, is_author boolean, can_renew boolean,
    pending_submission_id uuid, pending_snapshot_version_id uuid, pending_content_hash text,
    pending_on_behalf boolean, pending_requested_by text, pending_reason text, pending_expiration_date date,
    pending_requested_at timestamptz, author_window_until timestamptz, can_decide boolean, author_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    admin boolean;
    today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    IF actor IS NULL OR p_document_id IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    WITH visible AS (
        SELECT g.shared_draft_id, g.published_version_id, g.title, g.responsible_department_id,
               publication_expiration_date(g.published_version_id, pv.management) AS expires_on,
               renewal_member_active(g.submitted_by_membership_id) AS author_is_active,
               g.submitted_by_membership_id = actor AS mine,
               CASE WHEN renewal_member_active(g.submitted_by_membership_id)
                    THEN renewal_member_name(g.submitted_by_membership_id) END AS author_display_name
          FROM governance_current_publication g
          JOIN published_knowledge_version pv ON pv.published_version_id = g.published_version_id
         WHERE g.organization_id = org
           AND g.shared_draft_id = p_document_id
           AND (g.submitted_by_membership_id = actor OR admin
             OR governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
    SELECT v.shared_draft_id, v.published_version_id, v.title, v.responsible_department_id, v.expires_on,
           p.submission_id IS NOT NULL, v.author_is_active, v.mine,
           v.expires_on IS NOT NULL AND p.submission_id IS NULL
             AND (v.mine OR NOT v.author_is_active OR v.expires_on <= today + 7),
           p.submission_id, p.shared_draft_version_id, p.content_hash, p.on_behalf_of_author,
           CASE WHEN p.submission_id IS NOT NULL THEN renewal_member_name(p.submitted_by_membership_id) END,
           p.request_reason, p.renewal_expiration_date, p.submitted_at,
           (SELECT w.window_until FROM renewal_author_window(p.submission_id) w WHERE w.author_active),
           COALESCE(p.on_behalf_of_author AND v.mine, false), v.author_display_name
      FROM visible v
      LEFT JOIN LATERAL (SELECT c.* FROM shared_submission c WHERE c.shared_draft_id = v.shared_draft_id
                           AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW' LIMIT 1) p ON true;
END;
$$;
REVOKE ALL ON FUNCTION get_publication_renewal_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_publication_renewal_state(uuid) TO arden_runtime;
