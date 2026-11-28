SET search_path TO arden, public;

LOCK TABLE publication_report, maintenance_report_import, maintenance_case, maintenance_case_event
    IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM publication_report r
        LEFT JOIN published_knowledge_version pv ON pv.published_version_id = r.published_version_id
        LEFT JOIN shared_draft d ON d.shared_draft_id = r.shared_draft_id
        LEFT JOIN organization_membership reporter ON reporter.membership_id = r.reporter_membership_id
        LEFT JOIN organization_membership closer ON closer.membership_id = r.closed_by_membership_id
         WHERE pv.shared_draft_id IS DISTINCT FROM r.shared_draft_id
            OR d.organization_id IS DISTINCT FROM r.organization_id
            OR reporter.organization_id IS DISTINCT FROM r.organization_id
            OR (r.status = 'CLOSED' AND closer.organization_id IS DISTINCT FROM r.organization_id)
            OR pv.author_membership_id IS NULL OR pv.responsible_department_id IS NULL
            OR pv.classification IS NULL OR pv.content_hash !~ '^[0-9a-f]{64}$'
    ) OR EXISTS (
        SELECT 1 FROM maintenance_report_import i JOIN publication_report r USING (report_id)
        LEFT JOIN maintenance_case c ON c.case_id = i.case_id AND c.organization_id = i.organization_id
         WHERE (c.organization_id, c.document_id, c.published_version_id, c.reporter_membership_id)
               IS DISTINCT FROM (r.organization_id, r.shared_draft_id, r.published_version_id, r.reporter_membership_id)
            OR btrim(c.description) IS DISTINCT FROM btrim(r.message)
            OR (SELECT count(*) FROM maintenance_case_event e WHERE e.case_id = c.case_id
                  AND e.organization_id = c.organization_id AND e.event_type = 'IMPORTED') <> 1
    ) OR EXISTS (
        SELECT 1 FROM publication_report r
         WHERE r.status = 'OPEN' AND NOT EXISTS (
             SELECT 1 FROM maintenance_report_import i WHERE i.report_id = r.report_id AND i.organization_id = r.organization_id)
           AND EXISTS (
             SELECT 1 FROM maintenance_case c WHERE c.organization_id = r.organization_id
              AND c.document_id = r.shared_draft_id AND c.reporter_membership_id = r.reporter_membership_id
              AND c.origin = 'READER_REPORT' AND c.reporter_status <> 'Resolved')
    ) THEN
        RAISE EXCEPTION 'Reconcile legacy report provenance and open-case duplicates before merging' USING ERRCODE = '55000';
    END IF;
END;
$$;

ALTER TABLE maintenance_case_event ADD COLUMN source_report_id uuid;
ALTER TABLE maintenance_case_event ADD CONSTRAINT ck_maintenance_import_report_event
    CHECK (source_report_id IS NULL OR event_type = 'IMPORTED');
CREATE UNIQUE INDEX uq_maintenance_import_source_report
    ON maintenance_case_event (organization_id, source_report_id) WHERE source_report_id IS NOT NULL;

ALTER TABLE maintenance_case_event DISABLE TRIGGER trg_maintenance_event_append_only;
UPDATE maintenance_case_event e SET source_report_id = i.report_id
  FROM maintenance_report_import i
 WHERE e.case_id = i.case_id AND e.organization_id = i.organization_id AND e.event_type = 'IMPORTED';
ALTER TABLE maintenance_case_event ENABLE TRIGGER trg_maintenance_event_append_only;

-- Reports that were never imported receive their original ID as a case ID.
-- Preserve original close actions for cases already handled by Maintenance in
-- the event history, without overwriting the current case's decision.
INSERT INTO maintenance_case (case_id, organization_id, origin, reporter_membership_id, document_id,
    published_version_id, content_hash, title, description, route_department_id, classification, team_tag, project_tag,
    author_membership_id, assignee_membership_id, reporter_status, outcome, reporter_explanation,
    publication_link_version_id, publication_link_reason, first_claimed_at, created_at, resolved_at)
SELECT r.report_id, r.organization_id, 'READER_REPORT', r.reporter_membership_id, r.shared_draft_id,
       r.published_version_id, pv.content_hash, pv.title, r.message, pv.responsible_department_id,
       pv.classification, pv.team_tag, pv.project_tag, pv.author_membership_id, r.closed_by_membership_id,
       CASE WHEN r.status = 'CLOSED' THEN 'Resolved' ELSE 'Submitted' END,
       CASE r.resolution WHEN 'DISMISSED' THEN 'NO_CHANGE_NEEDED' WHEN 'WITHDRAWN' THEN 'WITHDRAWN' END,
       CASE r.resolution WHEN 'DISMISSED' THEN 'The historical report was dismissed.'
                         WHEN 'WITHDRAWN' THEN 'The document was withdrawn.' END,
       CASE WHEN r.resolution = 'WITHDRAWN' THEN r.published_version_id END,
       CASE WHEN r.resolution = 'WITHDRAWN' THEN 'Recorded on the original publication report.' END,
       r.closed_at, r.created_at, r.closed_at
  FROM publication_report r JOIN published_knowledge_version pv USING (published_version_id)
 WHERE NOT EXISTS (SELECT 1 FROM maintenance_report_import i
     WHERE i.report_id = r.report_id AND i.organization_id = r.organization_id);

INSERT INTO maintenance_case_event (organization_id, case_id, sequence, actor_membership_id,
    event_type, audience, message, occurred_at, source_report_id)
SELECT r.organization_id, r.report_id, 1, r.reporter_membership_id, 'IMPORTED', 'PUBLIC',
       'Imported from an existing report.', r.created_at, r.report_id
  FROM publication_report r
 WHERE NOT EXISTS (SELECT 1 FROM maintenance_report_import i
     WHERE i.report_id = r.report_id AND i.organization_id = r.organization_id);

-- The archived close event carries the original report UUID. This preserves
-- the closed-history cursor, resolver and disposition even for mapped cases.
INSERT INTO maintenance_case_event (event_id, organization_id, case_id, sequence,
    actor_membership_id, event_type, audience, message, occurred_at)
SELECT r.report_id, r.organization_id, imported.case_id,
       1 + (SELECT max(e.sequence) FROM maintenance_case_event e WHERE e.case_id = imported.case_id),
       r.closed_by_membership_id, 'RESOLVED',
       CASE WHEN i.case_id IS NULL THEN 'PUBLIC' ELSE 'REVIEWER' END,
       CASE r.resolution WHEN 'DISMISSED' THEN 'The historical report was dismissed.'
                         WHEN 'WITHDRAWN' THEN 'The document was withdrawn.' END, r.closed_at
  FROM publication_report r
  JOIN maintenance_case_event imported ON imported.organization_id = r.organization_id
    AND imported.source_report_id = r.report_id
  LEFT JOIN maintenance_report_import i ON i.report_id = r.report_id AND i.organization_id = r.organization_id
 WHERE r.status = 'CLOSED';

REVOKE INSERT ON maintenance_case_event FROM arden_runtime;
GRANT INSERT (event_id, organization_id, case_id, sequence, actor_membership_id,
    event_type, audience, message, occurred_at) ON maintenance_case_event TO arden_runtime;

CREATE OR REPLACE FUNCTION list_closed_publication_reports(p_after uuid)
RETURNS TABLE (report_id uuid, document_id uuid, published_version_id uuid, title text, message text,
    reporter_name text, created_at timestamptz, still_current boolean, can_view boolean, resolution text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(org);
    admin boolean;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    WITH visible AS NOT MATERIALIZED (
        SELECT imported.source_report_id AS report_id, c.document_id, c.published_version_id, c.title, c.description,
               c.reporter_membership_id, c.created_at, closed.occurred_at AS closed_at,
               g.published_version_id AS current_version_id,
               CASE closed.message WHEN 'The historical report was dismissed.' THEN 'DISMISSED'
                                   WHEN 'The document was withdrawn.' THEN 'WITHDRAWN' END AS resolution
          FROM maintenance_case_event imported
          JOIN maintenance_case_event closed ON closed.event_id = imported.source_report_id
               AND closed.organization_id = imported.organization_id AND closed.case_id = imported.case_id
               AND closed.event_type = 'RESOLVED'
          JOIN maintenance_case c ON c.case_id = imported.case_id AND c.organization_id = imported.organization_id
          LEFT JOIN governance_current_publication g ON g.shared_draft_id = c.document_id
         WHERE imported.organization_id = org AND imported.source_report_id IS NOT NULL
           AND (admin OR closed.actor_membership_id = actor
                OR (g.shared_draft_id IS NOT NULL AND g.submitted_by_membership_id IS DISTINCT FROM actor
                    AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
    ), boundary AS (
        SELECT a.closed_at, a.created_at, a.report_id FROM visible a WHERE a.report_id = p_after
    )
    SELECT r.report_id, r.document_id, r.published_version_id, r.title, r.description,
           COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email), r.created_at,
           r.current_version_id IS NOT DISTINCT FROM r.published_version_id, false, r.resolution
      FROM visible r
      JOIN organization_membership om ON om.membership_id = r.reporter_membership_id AND om.organization_id = org
      JOIN user_account ua ON ua.user_id = om.user_id
     WHERE p_after IS NULL OR EXISTS (
        SELECT 1 FROM boundary b
         WHERE (r.closed_at, r.created_at, r.report_id) < (b.closed_at, b.created_at, b.report_id))
     ORDER BY r.closed_at DESC, r.created_at DESC, r.report_id DESC
     LIMIT 201;
END;
$$;

CREATE OR REPLACE FUNCTION withdraw_publication_directly(p_document_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row governance_current_publication%ROWTYPE;
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN RETURN 'NOT_FOUND'; END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Give a reason of 1 to 1000 characters' USING ERRCODE = '22023';
    END IF;
    -- Serialize against activation and approved publication changes (0021/0035).
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = p_document_id AND organization_id = org FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    SELECT * INTO current_row FROM governance_current_publication g
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = p_document_id
                 AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING') THEN
        RETURN 'PREPARING';
    END IF;
    IF current_row.submission_id IS NOT NULL THEN
        UPDATE shared_submission
           SET publication_state = 'WITHDRAWN', withdrawn_by = 'ORGANIZATION_ADMIN',
               withdrawn_reason = btrim(p_reason), withdrawn_at = now()
         WHERE submission_id = current_row.submission_id;
    END IF;
    DELETE FROM knowledge_current_publication WHERE shared_draft_id = p_document_id;
    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (org, actor, 'KNOWLEDGE_PUBLICATION_WITHDRAWN', 'SUCCESS',
        jsonb_build_object('documentId', p_document_id, 'publishedVersionId', current_row.published_version_id,
            'submissionId', current_row.submission_id, 'withdrawnBy', 'ORGANIZATION_ADMIN',
            'reason', btrim(p_reason)));
    RETURN 'WITHDRAWN';
END;
$$;

DROP FUNCTION list_unmapped_open_publication_reports(timestamptz, uuid);
DROP FUNCTION maintenance_has_unmapped_open_reader_report(uuid);
DROP FUNCTION list_publication_reports();
DROP FUNCTION close_publication_report(uuid);
DROP TABLE maintenance_report_import;
DROP TABLE publication_report;

CREATE OR REPLACE FUNCTION list_governance_publications()
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
           (SELECT count(*)::integer FROM maintenance_case r
             WHERE r.organization_id = g.organization_id AND r.document_id = g.shared_draft_id
               AND r.origin = 'READER_REPORT' AND r.reporter_status <> 'Resolved')
      FROM governance_current_publication g
     WHERE g.organization_id = org
     ORDER BY g.published_at DESC, g.shared_draft_id
     LIMIT 1000;
END;
$$;
