SET search_path TO arden, public;

-- Review corrections for Flow 4 before its first shared rollout. 0043-0059 stay unchanged.
-- Reviewer authority follows decision 0015 for the exact pinned version, source access is
-- checked per version inside the caller's organization, and Org Admin keeps metadata only
-- (decisions 0010 and 0023).

-- Internal helpers, executed only inside the reviewed SECURITY DEFINER routines below.
CREATE FUNCTION maintenance_version_reader_mode(p_version_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    -- Anything other than an explicit limited audience follows the organization-wide branch.
    SELECT CASE
        WHEN rs.reader_mode IS NOT NULL THEN rs.reader_mode
        WHEN COALESCE(cp.target_scope_type, s.target_scope_type) = 'DEPARTMENT' THEN 'DEPARTMENT'
        ELSE 'ORGANIZATION' END
      FROM published_knowledge_version pv
      LEFT JOIN reader_selection rs ON rs.selection_id = pv.reader_selection_id
      LEFT JOIN knowledge_current_publication cp ON cp.published_version_id = pv.published_version_id
      LEFT JOIN shared_submission s ON s.submission_id = pv.submission_id
     WHERE pv.published_version_id = p_version_id
$$;
REVOKE ALL ON FUNCTION maintenance_version_reader_mode(uuid) FROM PUBLIC;

-- Grant coverage of one exact version. Decisions add independence from the pinned version's author.
CREATE FUNCTION maintenance_reviewer_covers(p_membership_id uuid, p_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT p_membership_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM published_knowledge_version pv
          JOIN shared_draft d ON d.shared_draft_id = pv.shared_draft_id
           AND d.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
          JOIN organization_membership om ON om.membership_id = p_membership_id
           AND om.organization_id = d.organization_id AND om.status = 'ACTIVE'
          JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
          JOIN reviewer_grant g ON g.reviewer_membership_id = om.membership_id AND g.organization_id = d.organization_id
          LEFT JOIN department dep ON dep.department_id = g.department_id AND dep.organization_id = g.organization_id
         WHERE pv.published_version_id = p_version_id
           AND g.status = 'ACTIVE' AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
           AND pv.classification = ANY(g.classifications)
           AND (pv.classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))
           AND (g.team_tag IS NULL OR g.team_tag IS NOT DISTINCT FROM pv.team_tag)
           AND (g.project_tag IS NULL OR g.project_tag IS NOT DISTINCT FROM pv.project_tag)
           AND CASE WHEN maintenance_version_reader_mode(pv.published_version_id) = 'ORGANIZATION'
                    THEN g.scope = 'ORGANIZATION'
                    ELSE g.scope = 'DEPARTMENT' AND g.department_id = pv.responsible_department_id
                         AND dep.status = 'ACTIVE' END);
$$;
REVOKE ALL ON FUNCTION maintenance_reviewer_covers(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION maintenance_reviewer_eligible(p_membership_id uuid, p_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT maintenance_reviewer_covers(p_membership_id, p_version_id)
       AND NOT EXISTS (SELECT 1 FROM published_knowledge_version pv
            WHERE pv.published_version_id = p_version_id AND pv.author_membership_id = p_membership_id);
$$;
REVOKE ALL ON FUNCTION maintenance_reviewer_eligible(uuid, uuid) FROM PUBLIC;

-- The calling member may review this exact version.
CREATE FUNCTION maintenance_actor_can_review_version(p_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT maintenance_reviewer_eligible(
        governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid), p_version_id);
$$;
REVOKE ALL ON FUNCTION maintenance_actor_can_review_version(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_actor_can_review_version(uuid) TO arden_runtime;

-- Org Admin assignment uses the same rule for the picker and the write.
CREATE FUNCTION maintenance_membership_can_review_version(p_membership_id uuid, p_version_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT governance_is_org_admin(governance_actor_membership(org), org) THEN RETURN false; END IF;
    RETURN maintenance_reviewer_eligible(p_membership_id, p_version_id);
END;
$$;
REVOKE ALL ON FUNCTION maintenance_membership_can_review_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_membership_can_review_version(uuid, uuid) TO arden_runtime;

CREATE FUNCTION list_maintenance_eligible_reviewers(p_version_id uuid)
RETURNS TABLE (membership_id uuid, display_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT governance_is_org_admin(governance_actor_membership(org), org) THEN RETURN; END IF;
    RETURN QUERY
    SELECT om.membership_id, COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
      FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id
     WHERE om.organization_id = org
       AND EXISTS (SELECT 1 FROM reviewer_grant g WHERE g.reviewer_membership_id = om.membership_id AND g.organization_id = org)
       AND maintenance_reviewer_eligible(om.membership_id, p_version_id)
     ORDER BY 2, 1;
END;
$$;
REVOKE ALL ON FUNCTION list_maintenance_eligible_reviewers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_maintenance_eligible_reviewers(uuid) TO arden_runtime;

-- Event numbers come from every event of a case, not the caller's audience-filtered view.
CREATE FUNCTION maintenance_next_event_sequence(p_case_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM maintenance_case c
         WHERE c.case_id = p_case_id AND c.organization_id = org
           AND maintenance_case_visible(c.organization_id, c.reporter_membership_id, c.assignee_membership_id,
                c.author_membership_id, c.route_department_id, c.classification, c.team_tag, c.project_tag)) THEN
        RAISE EXCEPTION 'maintenance case is unavailable' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT COALESCE(MAX(e.sequence), 0) + 1 FROM maintenance_case_event e WHERE e.case_id = p_case_id);
END;
$$;
REVOKE ALL ON FUNCTION maintenance_next_event_sequence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_next_event_sequence(uuid) TO arden_runtime;

-- Shares Flow 2's document lock so activation or withdrawal cannot change proof mid-decision.
CREATE FUNCTION maintenance_lock_document(p_document_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF governance_actor_membership(org) IS NULL THEN RETURN false; END IF;
    PERFORM 1 FROM shared_draft d WHERE d.shared_draft_id = p_document_id AND d.organization_id = org FOR SHARE;
    RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION maintenance_lock_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_lock_document(uuid) TO arden_runtime;

-- Source access is per exact version inside the caller's organization: a reviewer whose grant covers that
-- version, or its author. Independence is enforced on the case's pinned version, not on comparison versions.
DROP FUNCTION list_maintenance_document_versions(uuid);
DROP FUNCTION maintenance_publication_proof(uuid, uuid);
DROP FUNCTION maintenance_can_read_document_versions(uuid);

CREATE OR REPLACE FUNCTION maintenance_version_source(p_published_version_id uuid)
RETURNS TABLE (document_id uuid, content_uri text, content_hash text, mime_type text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT maintenance_reviewer_covers(governance_actor_membership(org), p_published_version_id)
       AND NOT EXISTS (SELECT 1 FROM published_knowledge_version pv
            WHERE pv.published_version_id = p_published_version_id
              AND pv.author_membership_id = governance_actor_membership(org)) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT pv.shared_draft_id, pv.content_uri, pv.content_hash, COALESCE(s.mime_type, 'text/plain')
      FROM published_knowledge_version pv
      JOIN shared_draft d ON d.shared_draft_id = pv.shared_draft_id AND d.organization_id = org
      LEFT JOIN shared_submission s ON s.submission_id = pv.submission_id
     WHERE pv.published_version_id = p_published_version_id;
END;
$$;
REVOKE ALL ON FUNCTION maintenance_version_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_version_source(uuid) TO arden_runtime;

-- Version metadata for the case's document: an eligible reviewer of the pin, or Org Admin
-- (governance metadata only). Returns the pin plus the newest 49 versions, oldest first.
CREATE FUNCTION list_maintenance_document_versions(p_document_id uuid, p_pinned_version_id uuid)
RETURNS TABLE (published_version_id uuid, version_no integer, published_at timestamptz, is_current boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
BEGIN
    IF actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM published_knowledge_version pv
          JOIN shared_draft d ON d.shared_draft_id = pv.shared_draft_id AND d.organization_id = org
         WHERE pv.published_version_id = p_pinned_version_id AND pv.shared_draft_id = p_document_id) THEN
        RETURN;
    END IF;
    IF NOT governance_is_org_admin(actor, org) AND NOT maintenance_reviewer_eligible(actor, p_pinned_version_id) THEN
        RETURN;
    END IF;
    RETURN QUERY
    WITH chosen AS (
        (SELECT pv.published_version_id FROM published_knowledge_version pv
          WHERE pv.shared_draft_id = p_document_id ORDER BY pv.version_no DESC, pv.published_at DESC LIMIT 49)
        UNION
        SELECT p_pinned_version_id)
    SELECT pv.published_version_id, pv.version_no, pv.published_at,
           EXISTS (SELECT 1 FROM knowledge_current_publication cp
             WHERE cp.published_version_id = pv.published_version_id AND cp.shared_draft_id = p_document_id
               AND cp.organization_id = org)
      FROM published_knowledge_version pv
      JOIN chosen ON chosen.published_version_id = pv.published_version_id
     ORDER BY pv.version_no, pv.published_at;
END;
$$;
REVOKE ALL ON FUNCTION list_maintenance_document_versions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_maintenance_document_versions(uuid, uuid) TO arden_runtime;

-- Publication metadata for the pin. A withdrawn document names the exact version that was taken down.
CREATE FUNCTION maintenance_publication_proof(p_document_id uuid, p_reported_version_id uuid)
RETURNS TABLE (
    current_version_id uuid,
    current_version_no integer,
    reported_version_no integer,
    valid_from timestamptz,
    valid_until timestamptz,
    status text,
    request_type text,
    publication_state text,
    rejected boolean,
    withdrawn_version_id uuid
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    reported published_knowledge_version%ROWTYPE;
    current_row record;
    was_rejected boolean;
    taken_down uuid;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    SELECT pv.* INTO reported FROM published_knowledge_version pv
      JOIN shared_draft d ON d.shared_draft_id = pv.shared_draft_id AND d.organization_id = org
     WHERE pv.published_version_id = p_reported_version_id AND pv.shared_draft_id = p_document_id;
    IF NOT FOUND THEN RETURN; END IF;
    IF NOT governance_is_org_admin(actor, org) AND NOT maintenance_reviewer_eligible(actor, p_reported_version_id) THEN
        RETURN;
    END IF;
    was_rejected := EXISTS (
        SELECT 1 FROM shared_submission rejected_submission
         WHERE rejected_submission.shared_draft_id = p_document_id AND rejected_submission.organization_id = org
           AND rejected_submission.status = 'REJECTED'
           AND rejected_submission.request_type IN ('CONTENT', 'WITHDRAWAL'));
    SELECT pv.published_version_id, pv.version_no,
           GREATEST(pv.valid_from, (COALESCE(NULLIF(pv.management ->> 'effectiveDate', '')::date,
               (pv.published_at AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC')) AS valid_from,
           pv.valid_until, s.status, s.request_type, s.publication_state
      INTO current_row
      FROM knowledge_current_publication cp
      JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
      JOIN shared_submission s ON s.submission_id = pv.submission_id
     WHERE cp.shared_draft_id = p_document_id AND cp.organization_id = org;
    IF NOT FOUND THEN
        SELECT pv.published_version_id INTO taken_down
          FROM published_knowledge_version pv
          JOIN shared_submission s ON s.submission_id = pv.submission_id
         WHERE pv.shared_draft_id = p_document_id AND s.organization_id = org
           AND s.publication_state = 'WITHDRAWN' AND pv.version_no >= reported.version_no
         ORDER BY pv.version_no DESC LIMIT 1;
        RETURN QUERY SELECT NULL::uuid, NULL::integer, reported.version_no, NULL::timestamptz, NULL::timestamptz,
            NULL::text, NULL::text, NULL::text, was_rejected, taken_down;
        RETURN;
    END IF;
    RETURN QUERY SELECT current_row.published_version_id, current_row.version_no, reported.version_no,
        current_row.valid_from, current_row.valid_until, current_row.status, current_row.request_type,
        current_row.publication_state, was_rejected, NULL::uuid;
END;
$$;
REVOKE ALL ON FUNCTION maintenance_publication_proof(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_publication_proof(uuid, uuid) TO arden_runtime;

-- Legacy import pages past held rows, locks each source report against concurrent dismissal,
-- and verifies the original pin without requiring it to remain current.
DROP FUNCTION list_unmapped_open_publication_reports();
CREATE FUNCTION list_unmapped_open_publication_reports(p_after_created_at timestamptz, p_after_report_id uuid)
RETURNS TABLE (report_id uuid, shared_draft_id uuid, published_version_id uuid, reporter_membership_id uuid,
    message text, created_at timestamptz, verifiable boolean, title text, content_hash text, classification text,
    responsible_department_id uuid, team_tag text, project_tag text, author_membership_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
BEGIN
    IF actor IS NULL OR NOT governance_is_org_admin(actor, org) THEN RETURN; END IF;
    RETURN QUERY
    SELECT r.report_id, r.shared_draft_id, r.published_version_id, r.reporter_membership_id, r.message, r.created_at,
           pv.published_version_id IS NOT NULL AND pv.classification IS NOT NULL
             AND pv.responsible_department_id IS NOT NULL AND pv.author_membership_id IS NOT NULL,
           pv.title, pv.content_hash, pv.classification, pv.responsible_department_id, pv.team_tag, pv.project_tag,
           pv.author_membership_id
      FROM publication_report r
      LEFT JOIN published_knowledge_version pv ON pv.published_version_id = r.published_version_id
       AND pv.shared_draft_id = r.shared_draft_id
     WHERE r.organization_id = org AND r.status = 'OPEN'
       AND (p_after_created_at IS NULL OR (r.created_at, r.report_id) > (p_after_created_at, p_after_report_id))
       AND NOT EXISTS (SELECT 1 FROM maintenance_report_import i
         WHERE i.organization_id = r.organization_id AND i.report_id = r.report_id)
     ORDER BY r.created_at, r.report_id
     LIMIT 200
       FOR UPDATE OF r;
END;
$$;
REVOKE ALL ON FUNCTION list_unmapped_open_publication_reports(timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_unmapped_open_publication_reports(timestamptz, uuid) TO arden_runtime;

-- After import, Maintenance owns the decision: the source report leaves independent triage.
CREATE OR REPLACE FUNCTION list_publication_reports()
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
       AND NOT EXISTS (SELECT 1 FROM maintenance_report_import i
         WHERE i.organization_id = r.organization_id AND i.report_id = r.report_id)
       AND (admin OR (g.shared_draft_id IS NOT NULL AND g.submitted_by_membership_id IS DISTINCT FROM actor
            AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
     ORDER BY r.created_at DESC
     LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION close_publication_report(p_report_id uuid)
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
    IF NOT FOUND OR EXISTS (SELECT 1 FROM maintenance_report_import i
        WHERE i.organization_id = org AND i.report_id = p_report_id) THEN
        RETURN 'NOT_FOUND';
    END IF;
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

-- New-case notices reach reviewers who may review this exact version (decision 0015).
CREATE OR REPLACE FUNCTION enqueue_maintenance_submission_notices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    submitted maintenance_case%ROWTYPE;
    actor uuid := maintenance_actor_membership(NEW.organization_id);
BEGIN
    IF actor IS NULL OR actor IS DISTINCT FROM NEW.actor_membership_id THEN RETURN NEW; END IF;
    -- The case was verified at intake; a replacement activating meanwhile must not drop its notices.
    SELECT c.* INTO submitted FROM maintenance_case c
     WHERE c.organization_id = NEW.organization_id AND c.case_id = NEW.case_id
       AND c.reporter_status = 'Submitted'
       AND ((c.origin = 'READER_REPORT' AND c.reporter_membership_id = actor)
         OR (c.origin = 'REVIEWER_INTAKE' AND maintenance_reviewer_eligible(actor, c.published_version_id)));
    IF NOT FOUND THEN RETURN NEW; END IF;

    WITH eligible AS (
        SELECT DISTINCT g.reviewer_membership_id AS membership_id
          FROM reviewer_grant g
         WHERE g.organization_id = submitted.organization_id
           AND maintenance_reviewer_eligible(g.reviewer_membership_id, submitted.published_version_id)
    ), targets AS (
        SELECT membership_id FROM eligible
        UNION ALL
        SELECT m.membership_id FROM organization_membership m
          JOIN user_account u ON u.user_id = m.user_id AND u.status = 'ACTIVE'
         WHERE m.organization_id = submitted.organization_id AND m.status = 'ACTIVE'
           AND NOT EXISTS (SELECT 1 FROM eligible)
           AND governance_is_org_admin(m.membership_id, submitted.organization_id)
    )
    INSERT INTO maintenance_notification (organization_id, case_id, recipient_membership_id, logical_key, message)
    SELECT submitted.organization_id, submitted.case_id, t.membership_id,
           'submitted:' || submitted.case_id, 'A maintenance case is waiting for review.'
      FROM targets t
    ON CONFLICT (organization_id, recipient_membership_id, logical_key) DO NOTHING;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_maintenance_submission_notices() FROM PUBLIC;
