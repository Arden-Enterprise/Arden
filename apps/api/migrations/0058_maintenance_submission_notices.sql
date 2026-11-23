SET search_path TO arden, public;

-- Route the first Submitted event inside its transaction. The caller receives
-- no grant rows, membership ids, or recipient count.
CREATE FUNCTION enqueue_maintenance_submission_notices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    submitted maintenance_case%ROWTYPE;
    actor uuid := maintenance_actor_membership(NEW.organization_id);
BEGIN
    IF actor IS NULL OR actor IS DISTINCT FROM NEW.actor_membership_id THEN RETURN NEW; END IF;
    SELECT c.* INTO submitted FROM maintenance_case c
      JOIN knowledge_current_publication cp ON cp.organization_id = c.organization_id
        AND cp.shared_draft_id = c.document_id AND cp.published_version_id = c.published_version_id
     WHERE c.organization_id = NEW.organization_id AND c.case_id = NEW.case_id
       AND c.reporter_status = 'Submitted'
       AND ((c.origin = 'READER_REPORT' AND c.reporter_membership_id = actor)
         OR (c.origin = 'REVIEWER_INTAKE' AND c.author_membership_id IS DISTINCT FROM actor
             AND actor_has_reviewer_grant(c.organization_id, c.route_department_id,
                  c.classification, c.team_tag, c.project_tag)));
    IF NOT FOUND THEN RETURN NEW; END IF;

    WITH active_members AS (
        SELECT m.membership_id FROM organization_membership m
          JOIN user_account u ON u.user_id = m.user_id AND u.status = 'ACTIVE'
         WHERE m.organization_id = submitted.organization_id AND m.status = 'ACTIVE'
    ), eligible AS (
        SELECT DISTINCT g.reviewer_membership_id AS membership_id
          FROM reviewer_grant g
          JOIN active_members m ON m.membership_id = g.reviewer_membership_id
          LEFT JOIN department d ON d.department_id = g.department_id AND d.organization_id = g.organization_id
         WHERE g.organization_id = submitted.organization_id AND g.status = 'ACTIVE'
           AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
           AND (g.scope = 'ORGANIZATION' OR
                (g.scope = 'DEPARTMENT' AND g.department_id = submitted.route_department_id AND d.status = 'ACTIVE'))
           AND submitted.classification = ANY(g.classifications)
           AND (submitted.classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))
           AND g.reviewer_membership_id <> submitted.author_membership_id
           AND (g.team_tag IS NULL OR g.team_tag IS NOT DISTINCT FROM submitted.team_tag)
           AND (g.project_tag IS NULL OR g.project_tag IS NOT DISTINCT FROM submitted.project_tag)
    ), targets AS (
        SELECT membership_id FROM eligible
        UNION ALL
        SELECT m.membership_id FROM active_members m
         WHERE NOT EXISTS (SELECT 1 FROM eligible)
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

CREATE TRIGGER trg_enqueue_maintenance_submission_notices
    AFTER INSERT ON maintenance_case_event
    FOR EACH ROW WHEN (NEW.event_type = 'SUBMITTED' AND NEW.sequence = 1)
    EXECUTE FUNCTION enqueue_maintenance_submission_notices();
