SET search_path TO arden, public;

-- Decision 0023 (Flow 2 T6.3 governance): Organization Admin governance catalog and audited inspection,
-- direct withdrawal by the responsible reviewer or an Organization Admin, the responsible reviewer's view
-- of the current publication, and member problem reports.
--   * Authority is re-derived here from the actor context and current tables; the app's arden.org_admin
--     setting is not trusted. A responsible reviewer holds a current grant for the publication's scope:
--     an Organization grant for an organization-wide publication, otherwise a Department grant for its
--     responsible department (decisions 0013-0015). Authors act on their own documents through T6.1.
--   * Inspection grants one administrator one published version for at most 2 hours and 15 minutes idle.
--     The audit event is committed with the inspection before any content route can use it; inspected
--     content is never a reader, search or AI source.
--   * No notifications are sent (decision 0023): audit and reports are pulled.
--
-- Operator rollout: adds seven reviewed SECURITY DEFINER routines (32 in total); apply as the trusted
-- superuser so they keep their postgres owner.

-- Withdrawal provenance shown to the author. A withdrawal approved from an author's request leaves these
-- empty (the request carries its own reason).
ALTER TABLE shared_submission ADD COLUMN withdrawn_by text, ADD COLUMN withdrawn_reason text,
    ADD COLUMN withdrawn_at timestamptz;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_direct_withdrawal CHECK (
    (withdrawn_by IS NULL AND withdrawn_reason IS NULL AND withdrawn_at IS NULL)
    OR (withdrawn_by IN ('REVIEWER', 'ORGANIZATION_ADMIN') AND publication_state = 'WITHDRAWN'
        AND char_length(btrim(withdrawn_reason)) BETWEEN 1 AND 1000 AND withdrawn_at IS NOT NULL));

CREATE TABLE governance_inspection (
    inspection_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      uuid NOT NULL REFERENCES organization(organization_id),
    admin_membership_id  uuid NOT NULL REFERENCES organization_membership(membership_id),
    shared_draft_id      uuid NOT NULL REFERENCES shared_draft(shared_draft_id),
    published_version_id uuid NOT NULL REFERENCES published_knowledge_version(published_version_id),
    reason               text NOT NULL,
    opened_at            timestamptz NOT NULL DEFAULT now(),
    last_used_at         timestamptz NOT NULL DEFAULT now(),
    expires_at           timestamptz NOT NULL,
    CONSTRAINT ck_governance_inspection_reason CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_governance_inspection_window CHECK (expires_at = opened_at + interval '2 hours'
        AND last_used_at >= opened_at)
);
CREATE INDEX ix_governance_inspection_admin ON governance_inspection (admin_membership_id, opened_at DESC);
ALTER TABLE governance_inspection ENABLE ROW LEVEL SECURITY;

CREATE TABLE publication_report (
    report_id               uuid PRIMARY KEY,
    organization_id         uuid NOT NULL REFERENCES organization(organization_id),
    shared_draft_id         uuid NOT NULL REFERENCES shared_draft(shared_draft_id),
    published_version_id    uuid NOT NULL REFERENCES published_knowledge_version(published_version_id),
    reporter_membership_id  uuid NOT NULL REFERENCES organization_membership(membership_id),
    message                 text NOT NULL,
    status                  text NOT NULL DEFAULT 'OPEN',
    created_at              timestamptz NOT NULL DEFAULT now(),
    closed_by_membership_id uuid REFERENCES organization_membership(membership_id),
    closed_at               timestamptz,
    resolution              text,
    CONSTRAINT ck_publication_report_message CHECK (char_length(btrim(message)) BETWEEN 1 AND 1000),
    CONSTRAINT ck_publication_report_state CHECK (
        (status = 'OPEN' AND closed_by_membership_id IS NULL AND closed_at IS NULL AND resolution IS NULL)
        OR (status = 'CLOSED' AND closed_by_membership_id IS NOT NULL AND closed_at IS NOT NULL
            AND resolution IN ('WITHDRAWN', 'DISMISSED')))
);
-- One open report per member and document; a member cannot flood the responsible reviewers.
CREATE UNIQUE INDEX uq_publication_report_open ON publication_report (shared_draft_id, reporter_membership_id)
    WHERE status = 'OPEN';
CREATE INDEX ix_publication_report_open ON publication_report (organization_id, created_at DESC) WHERE status = 'OPEN';
ALTER TABLE publication_report ENABLE ROW LEVEL SECURITY;

-- A reader reports the current publication they can read: the subquery runs under the runtime's own
-- publication RLS, so a member who cannot read the document cannot report it. Members never read reports.
GRANT INSERT (report_id, organization_id, shared_draft_id, published_version_id, reporter_membership_id, message)
    ON publication_report TO arden_runtime;
CREATE POLICY publication_report_reader_insert ON publication_report FOR INSERT TO arden_runtime WITH CHECK (
    status = 'OPEN'
    AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM organization_membership om
         WHERE om.membership_id = publication_report.reporter_membership_id
           AND om.organization_id = publication_report.organization_id AND om.status = 'ACTIVE'
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
    AND EXISTS (SELECT 1 FROM knowledge_current_publication cp
         WHERE cp.shared_draft_id = publication_report.shared_draft_id
           AND cp.published_version_id = publication_report.published_version_id
           AND cp.organization_id = publication_report.organization_id));

-- Helpers called only inside the reviewed routines below (owner context); not executable by the runtime.
CREATE FUNCTION governance_actor_membership(p_organization_id uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT om.membership_id FROM organization_membership om
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
     WHERE om.organization_id = p_organization_id AND om.status = 'ACTIVE'
       AND p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION governance_actor_membership(uuid) FROM PUBLIC;

CREATE FUNCTION governance_is_org_admin(p_membership_id uuid, p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT p_membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM role_assignment ra
      JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
      JOIN access_scope scope ON scope.access_scope_id = ra.access_scope_id
       AND scope.organization_id = p_organization_id AND scope.scope_type = 'ORGANIZATION' AND scope.status = 'ACTIVE'
     WHERE ra.membership_id = p_membership_id AND ra.status = 'ACTIVE'
       AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now()))
$$;
REVOKE ALL ON FUNCTION governance_is_org_admin(uuid, uuid) FROM PUBLIC;

-- Exact current scope (0015): Organization grants for organization-wide readers, Department grants for the
-- responsible department otherwise. Classification and tags are legacy and not part of this authority.
CREATE FUNCTION governance_is_responsible_reviewer(p_membership_id uuid, p_organization_id uuid,
    p_department_id uuid, p_reader_mode text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT p_membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM reviewer_grant g
     WHERE g.organization_id = p_organization_id AND g.reviewer_membership_id = p_membership_id
       AND g.status = 'ACTIVE' AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
       AND ((p_reader_mode = 'ORGANIZATION' AND g.scope = 'ORGANIZATION')
         OR (p_reader_mode <> 'ORGANIZATION' AND g.scope = 'DEPARTMENT' AND g.department_id = p_department_id)))
$$;
REVOKE ALL ON FUNCTION governance_is_responsible_reviewer(uuid, uuid, uuid, text) FROM PUBLIC;

-- The current publication of each document with the fields governance needs. security_invoker: the release
-- ownership handoff gives this view to the restricted migration role, and a view otherwise reads its FORCE RLS
-- tables as its owner (no rows). Checked as the caller instead, which is only the postgres-owned routines below;
-- the runtime has no privilege on the view.
CREATE VIEW governance_current_publication WITH (security_barrier, security_invoker = true) AS
SELECT cp.shared_draft_id, cp.organization_id, pv.published_version_id, pv.title, pv.content_uri,
       pv.content_hash, pv.published_at, s.submission_id, s.mime_type, s.snapshot_version_no,
       s.management ->> 'version' AS version_label, s.submitted_by_membership_id,
       COALESCE(s.responsible_department_id, pv.responsible_department_id) AS responsible_department_id,
       COALESCE(rs.reader_mode, CASE cp.target_scope_type WHEN 'ORGANIZATION' THEN 'ORGANIZATION' ELSE 'DEPARTMENT' END)
           AS reader_mode,
       COALESCE(rs.department_id, cp.target_department_id) AS reader_department_id,
       cp.reader_selection_id
  FROM knowledge_current_publication cp
  JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
  LEFT JOIN shared_submission s ON s.submission_id = pv.submission_id
  LEFT JOIN reader_selection rs ON rs.selection_id = cp.reader_selection_id;
REVOKE ALL ON governance_current_publication FROM PUBLIC;

-- Catalog: metadata only. No reader count, names, content or AI output.
CREATE FUNCTION list_governance_publications()
RETURNS TABLE (document_id uuid, published_version_id uuid, title text, responsible_department_id uuid,
    reader_mode text, reader_department_id uuid, version_label text, snapshot_version_no integer,
    published_at timestamptz, open_reports integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN
        RAISE EXCEPTION 'Organization administration required' USING ERRCODE = '42501';
    END IF;
    RETURN QUERY
    SELECT g.shared_draft_id, g.published_version_id, g.title, g.responsible_department_id, g.reader_mode,
           g.reader_department_id, g.version_label, g.snapshot_version_no, g.published_at,
           (SELECT count(*)::integer FROM publication_report r
             WHERE r.shared_draft_id = g.shared_draft_id AND r.status = 'OPEN')
      FROM governance_current_publication g
     WHERE g.organization_id = org
     ORDER BY g.published_at DESC, g.shared_draft_id
     LIMIT 1000;
END;
$$;
REVOKE ALL ON FUNCTION list_governance_publications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_governance_publications() TO arden_runtime;

-- Opens one inspection and commits its audit event; returns NULL for an unknown or foreign document.
CREATE FUNCTION open_governance_inspection(p_document_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row governance_current_publication%ROWTYPE;
    opened uuid;
    started timestamptz := now();
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN
        RAISE EXCEPTION 'Organization administration required' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Give a reason of 1 to 1000 characters' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO current_row FROM governance_current_publication g
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org;
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO governance_inspection (organization_id, admin_membership_id, shared_draft_id, published_version_id,
        reason, opened_at, last_used_at, expires_at)
    VALUES (org, actor, p_document_id, current_row.published_version_id, btrim(p_reason), started, started,
        started + interval '2 hours')
    RETURNING inspection_id INTO opened;
    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (org, actor, 'KNOWLEDGE_GOVERNANCE_INSPECTION_OPENED', 'SUCCESS',
        jsonb_build_object('inspectionId', opened, 'documentId', p_document_id,
            'publishedVersionId', current_row.published_version_id, 'reason', btrim(p_reason)));
    RETURN opened;
END;
$$;
REVOKE ALL ON FUNCTION open_governance_inspection(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_governance_inspection(uuid, text) TO arden_runtime;

-- Uses a live inspection: same administrator, still an Organization Admin, within 2 hours and 15 minutes of
-- the last use, and the inspected version is still current. Returns no row otherwise.
CREATE FUNCTION use_governance_inspection(p_inspection_id uuid)
RETURNS TABLE (document_id uuid, published_version_id uuid, title text, content_uri text, content_hash text,
    mime_type text, responsible_department_id uuid, reader_mode text, reader_department_id uuid,
    reader_names text[], reason text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    inspection governance_inspection%ROWTYPE;
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN RETURN; END IF;
    SELECT * INTO inspection FROM governance_inspection i
     WHERE i.inspection_id = p_inspection_id AND i.organization_id = org AND i.admin_membership_id = actor
       AND now() < i.expires_at AND now() < i.last_used_at + interval '15 minutes'
     FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE governance_inspection SET last_used_at = now() WHERE inspection_id = p_inspection_id;
    RETURN QUERY
    SELECT g.shared_draft_id, g.published_version_id, g.title, g.content_uri, g.content_hash,
           COALESCE(g.mime_type, CASE WHEN g.content_uri LIKE '%.pdf' THEN 'application/pdf' ELSE 'text/plain' END),
           g.responsible_department_id, g.reader_mode, g.reader_department_id,
           CASE WHEN g.reader_mode = 'SELECTED_MEMBERS' THEN ARRAY(
               SELECT COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
                 FROM selected_reader sr
                 JOIN organization_membership om ON om.membership_id = sr.membership_id
                 JOIN user_account ua ON ua.user_id = om.user_id
                WHERE sr.selection_id = g.reader_selection_id ORDER BY sr.ordinal)
             ELSE ARRAY[]::text[] END,
           inspection.reason, LEAST(inspection.expires_at, now() + interval '15 minutes')
      FROM governance_current_publication g
     WHERE g.shared_draft_id = inspection.shared_draft_id AND g.organization_id = org
       AND g.published_version_id = inspection.published_version_id;
END;
$$;
REVOKE ALL ON FUNCTION use_governance_inspection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION use_governance_inspection(uuid) TO arden_runtime;

-- The responsible reviewer's read-only view of the current publication (no reader names, not a reader
-- source). An author does not reach their own document here.
CREATE FUNCTION responsible_publication_view(p_document_id uuid)
RETURNS TABLE (document_id uuid, published_version_id uuid, title text, content_uri text, content_hash text,
    mime_type text, responsible_department_id uuid, reader_mode text, reader_department_id uuid,
    published_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    RETURN QUERY
    SELECT g.shared_draft_id, g.published_version_id, g.title, g.content_uri, g.content_hash,
           COALESCE(g.mime_type, CASE WHEN g.content_uri LIKE '%.pdf' THEN 'application/pdf' ELSE 'text/plain' END),
           g.responsible_department_id, g.reader_mode, g.reader_department_id, g.published_at
      FROM governance_current_publication g
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org
       AND g.submitted_by_membership_id IS DISTINCT FROM actor
       AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode);
END;
$$;
REVOKE ALL ON FUNCTION responsible_publication_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION responsible_publication_view(uuid) TO arden_runtime;

-- Direct withdrawal (same effect as an approved WITHDRAWAL request, 0035). Returns WITHDRAWN, NOT_FOUND
-- (unknown, not current, or no authority) or PREPARING (a newer approved version is still being prepared).
CREATE FUNCTION withdraw_publication_directly(p_document_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row governance_current_publication%ROWTYPE;
    responsible boolean;
    admin boolean;
BEGIN
    IF actor IS NULL THEN RETURN 'NOT_FOUND'; END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Give a reason of 1 to 1000 characters' USING ERRCODE = '22023';
    END IF;
    -- Same lock as activation (0021) and approved publication changes (0035).
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = p_document_id AND organization_id = org FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    SELECT * INTO current_row FROM governance_current_publication g
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    responsible := current_row.submitted_by_membership_id IS DISTINCT FROM actor
        AND governance_is_responsible_reviewer(actor, org, current_row.responsible_department_id, current_row.reader_mode);
    admin := governance_is_org_admin(actor, org);
    IF NOT responsible AND NOT admin THEN RETURN 'NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = p_document_id
                 AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING') THEN
        RETURN 'PREPARING';
    END IF;
    IF current_row.submission_id IS NOT NULL THEN
        UPDATE shared_submission
           SET publication_state = 'WITHDRAWN',
               withdrawn_by = CASE WHEN responsible THEN 'REVIEWER' ELSE 'ORGANIZATION_ADMIN' END,
               withdrawn_reason = btrim(p_reason), withdrawn_at = now()
         WHERE submission_id = current_row.submission_id;
    END IF;
    DELETE FROM knowledge_current_publication WHERE shared_draft_id = p_document_id;
    UPDATE publication_report SET status = 'CLOSED', closed_by_membership_id = actor, closed_at = now(),
           resolution = 'WITHDRAWN'
     WHERE shared_draft_id = p_document_id AND status = 'OPEN';
    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (org, actor, 'KNOWLEDGE_PUBLICATION_WITHDRAWN', 'SUCCESS',
        jsonb_build_object('documentId', p_document_id, 'publishedVersionId', current_row.published_version_id,
            'submissionId', current_row.submission_id,
            'withdrawnBy', CASE WHEN responsible THEN 'REVIEWER' ELSE 'ORGANIZATION_ADMIN' END,
            'reason', btrim(p_reason)));
    RETURN 'WITHDRAWN';
END;
$$;
REVOKE ALL ON FUNCTION withdraw_publication_directly(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION withdraw_publication_directly(uuid, text) TO arden_runtime;

-- Open reports for the documents the actor is responsible for, or all of them for an Organization Admin.
CREATE FUNCTION list_publication_reports()
RETURNS TABLE (report_id uuid, document_id uuid, published_version_id uuid, title text, message text,
    reporter_name text, created_at timestamptz, still_current boolean, can_view boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    admin boolean;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    SELECT r.report_id, r.shared_draft_id, r.published_version_id, pv.title, r.message,
           COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email), r.created_at,
           g.published_version_id IS NOT DISTINCT FROM r.published_version_id,
           g.shared_draft_id IS NOT NULL AND g.submitted_by_membership_id IS DISTINCT FROM actor
             AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)
      FROM publication_report r
      JOIN published_knowledge_version pv ON pv.published_version_id = r.published_version_id
      JOIN organization_membership om ON om.membership_id = r.reporter_membership_id
      JOIN user_account ua ON ua.user_id = om.user_id
      LEFT JOIN governance_current_publication g ON g.shared_draft_id = r.shared_draft_id
     WHERE r.organization_id = org AND r.status = 'OPEN'
       AND (admin OR (g.shared_draft_id IS NOT NULL AND g.submitted_by_membership_id IS DISTINCT FROM actor
            AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
     ORDER BY r.created_at DESC
     LIMIT 200;
END;
$$;
REVOKE ALL ON FUNCTION list_publication_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_publication_reports() TO arden_runtime;

-- Dismisses an open report the actor may see. Returns CLOSED, or NOT_FOUND.
CREATE FUNCTION close_publication_report(p_report_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    report publication_report%ROWTYPE;
    current_row governance_current_publication%ROWTYPE;
BEGIN
    IF actor IS NULL THEN RETURN 'NOT_FOUND'; END IF;
    SELECT * INTO report FROM publication_report r
     WHERE r.report_id = p_report_id AND r.organization_id = org AND r.status = 'OPEN' FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    SELECT * INTO current_row FROM governance_current_publication g WHERE g.shared_draft_id = report.shared_draft_id;
    IF NOT governance_is_org_admin(actor, org)
       AND NOT (FOUND AND current_row.submitted_by_membership_id IS DISTINCT FROM actor
                AND governance_is_responsible_reviewer(actor, org, current_row.responsible_department_id,
                    current_row.reader_mode)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    UPDATE publication_report SET status = 'CLOSED', closed_by_membership_id = actor, closed_at = now(),
           resolution = 'DISMISSED'
     WHERE publication_report.report_id = p_report_id;
    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (org, actor, 'KNOWLEDGE_PUBLICATION_REPORT_DISMISSED', 'SUCCESS',
        jsonb_build_object('reportId', p_report_id, 'documentId', report.shared_draft_id));
    RETURN 'CLOSED';
END;
$$;
REVOKE ALL ON FUNCTION close_publication_report(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_publication_report(uuid) TO arden_runtime;
