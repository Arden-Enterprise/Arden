SET search_path TO arden, public;

-- Flow 4 Milestone 1. One case pins one published version. History and idempotency
-- records are append-only. Existing audit_event single-subject rules stay unchanged;
-- case history is a tenant-scoped association, not a new audit subject.
-- Operator rollout: invoker helpers only. No SECURITY DEFINER owner is added.

CREATE FUNCTION maintenance_actor_membership(p_organization_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT om.membership_id
      FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
     WHERE om.organization_id = p_organization_id
       AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
       AND om.status = 'ACTIVE';
$$;
REVOKE ALL ON FUNCTION maintenance_actor_membership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_actor_membership(uuid) TO arden_runtime;

CREATE FUNCTION maintenance_actor_is_admin(p_organization_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1
          FROM organization_membership om
          JOIN role_assignment ra ON ra.membership_id = om.membership_id
          JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
          JOIN access_scope s ON s.access_scope_id = ra.access_scope_id
           AND s.organization_id = om.organization_id AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
         WHERE om.membership_id = maintenance_actor_membership(p_organization_id)
           AND ra.status = 'ACTIVE'
           AND ra.valid_from <= now()
           AND (ra.valid_until IS NULL OR ra.valid_until > now()));
$$;
REVOKE ALL ON FUNCTION maintenance_actor_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_actor_is_admin(uuid) TO arden_runtime;

CREATE TABLE maintenance_case (
    case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization (organization_id),
    origin text NOT NULL CHECK (origin IN ('READER_REPORT', 'REVIEWER_INTAKE')),
    reporter_membership_id uuid,
    document_id uuid NOT NULL,
    published_version_id uuid NOT NULL REFERENCES published_knowledge_version (published_version_id),
    content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    title text NOT NULL CHECK (length(btrim(title)) > 0),
    description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
    anchor_page integer CHECK (anchor_page IS NULL OR anchor_page BETWEEN 1 AND 10000),
    anchor_passage text CHECK (anchor_passage IS NULL OR length(anchor_passage) <= 500),
    route_department_id uuid NOT NULL,
    classification text NOT NULL CHECK (classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    team_tag text,
    project_tag text,
    author_membership_id uuid NOT NULL,
    assignee_membership_id uuid,
    reporter_status text NOT NULL DEFAULT 'Submitted'
        CHECK (reporter_status IN ('Submitted', 'In Progress', 'Resolved')),
    outcome text CHECK (outcome IS NULL OR outcome = 'NO_CHANGE_NEEDED'),
    reporter_explanation text CHECK (reporter_explanation IS NULL OR length(btrim(reporter_explanation)) BETWEEN 1 AND 2000),
    reviewer_rationale text CHECK (reviewer_rationale IS NULL OR length(btrim(reviewer_rationale)) BETWEEN 1 AND 2000),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    first_claimed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    CONSTRAINT fk_maintenance_case_document FOREIGN KEY (document_id, organization_id)
        REFERENCES shared_draft (shared_draft_id, organization_id),
    CONSTRAINT fk_maintenance_case_reporter FOREIGN KEY (reporter_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id),
    CONSTRAINT fk_maintenance_case_author FOREIGN KEY (author_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id),
    CONSTRAINT fk_maintenance_case_assignee FOREIGN KEY (assignee_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id),
    CONSTRAINT fk_maintenance_case_department FOREIGN KEY (route_department_id, organization_id)
        REFERENCES department (department_id, organization_id),
    CONSTRAINT ck_maintenance_case_origin_reporter CHECK (
        (origin = 'READER_REPORT' AND reporter_membership_id IS NOT NULL)
        OR (origin = 'REVIEWER_INTAKE' AND reporter_membership_id IS NULL)),
    CONSTRAINT ck_maintenance_case_resolution CHECK (
        (reporter_status <> 'Resolved' AND outcome IS NULL AND reporter_explanation IS NULL AND resolved_at IS NULL)
        OR (reporter_status = 'Resolved' AND outcome IS NOT NULL AND reporter_explanation IS NOT NULL AND resolved_at IS NOT NULL)),
    CONSTRAINT ck_maintenance_case_claim CHECK (
        (assignee_membership_id IS NULL AND first_claimed_at IS NULL AND reporter_status = 'Submitted')
        OR (assignee_membership_id IS NOT NULL AND first_claimed_at IS NOT NULL AND reporter_status <> 'Submitted')),
    CONSTRAINT uq_maintenance_case_org UNIQUE (case_id, organization_id)
);

CREATE INDEX ix_maintenance_case_reporter ON maintenance_case (organization_id, reporter_membership_id, created_at DESC);
CREATE INDEX ix_maintenance_case_assignee ON maintenance_case (organization_id, assignee_membership_id, created_at DESC);
CREATE INDEX ix_maintenance_case_route ON maintenance_case (organization_id, route_department_id, reporter_status);

CREATE TABLE maintenance_idempotency (
    organization_id uuid NOT NULL,
    actor_membership_id uuid NOT NULL,
    request_key uuid NOT NULL,
    payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    case_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, actor_membership_id, request_key),
    CONSTRAINT fk_maintenance_idempotency_actor FOREIGN KEY (actor_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id),
    CONSTRAINT fk_maintenance_idempotency_case FOREIGN KEY (case_id, organization_id)
        REFERENCES maintenance_case (case_id, organization_id)
);

CREATE TABLE maintenance_case_event (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    sequence bigint NOT NULL CHECK (sequence > 0),
    actor_membership_id uuid,
    event_type text NOT NULL CHECK (event_type IN (
        'SUBMITTED', 'CLAIMED', 'REASSIGNED', 'RESOLVED')),
    audience text NOT NULL CHECK (audience IN ('PUBLIC', 'REVIEWER')),
    message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (case_id, sequence),
    CONSTRAINT fk_maintenance_event_case FOREIGN KEY (case_id, organization_id)
        REFERENCES maintenance_case (case_id, organization_id),
    CONSTRAINT fk_maintenance_event_actor FOREIGN KEY (actor_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id)
);
CREATE INDEX ix_maintenance_case_event_order ON maintenance_case_event (case_id, sequence);

CREATE TABLE maintenance_notification (
    notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    recipient_membership_id uuid NOT NULL,
    logical_key text NOT NULL CHECK (length(btrim(logical_key)) BETWEEN 1 AND 160),
    message text NOT NULL CHECK (length(btrim(message)) BETWEEN 1 AND 200),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, recipient_membership_id, logical_key),
    CONSTRAINT fk_maintenance_notification_case FOREIGN KEY (case_id, organization_id)
        REFERENCES maintenance_case (case_id, organization_id),
    CONSTRAINT fk_maintenance_notification_recipient FOREIGN KEY (recipient_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id)
);

CREATE FUNCTION reject_maintenance_case_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.reporter_membership_id IS DISTINCT FROM OLD.reporter_membership_id
        OR NEW.document_id IS DISTINCT FROM OLD.document_id
        OR NEW.published_version_id IS DISTINCT FROM OLD.published_version_id
        OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.author_membership_id IS DISTINCT FROM OLD.author_membership_id
        OR NEW.route_department_id IS DISTINCT FROM OLD.route_department_id
        OR NEW.classification IS DISTINCT FROM OLD.classification
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.revision <= OLD.revision THEN
        RAISE EXCEPTION 'maintenance case identity and revision are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_maintenance_case_immutable
    BEFORE UPDATE ON maintenance_case
    FOR EACH ROW EXECUTE FUNCTION reject_maintenance_case_rewrite();

CREATE FUNCTION reject_maintenance_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'maintenance history is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER trg_maintenance_idempotency_append_only
    BEFORE UPDATE OR DELETE ON maintenance_idempotency
    FOR EACH ROW EXECUTE FUNCTION reject_maintenance_append_only();
CREATE TRIGGER trg_maintenance_event_append_only
    BEFORE UPDATE OR DELETE ON maintenance_case_event
    FOR EACH ROW EXECUTE FUNCTION reject_maintenance_append_only();
CREATE TRIGGER trg_maintenance_notification_append_only
    BEFORE UPDATE OR DELETE ON maintenance_notification
    FOR EACH ROW EXECUTE FUNCTION reject_maintenance_append_only();
CREATE TRIGGER trg_maintenance_case_no_delete
    BEFORE DELETE ON maintenance_case
    FOR EACH ROW EXECUTE FUNCTION reject_maintenance_append_only();

CREATE FUNCTION maintenance_case_visible(p_organization_id uuid, p_reporter uuid, p_assignee uuid,
    p_author uuid, p_department_id uuid, p_classification text, p_team_tag text, p_project_tag text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT maintenance_actor_membership(p_organization_id) IS NOT NULL
       AND (
            maintenance_actor_membership(p_organization_id) = p_reporter
            OR maintenance_actor_membership(p_organization_id) = p_assignee
            OR maintenance_actor_is_admin(p_organization_id)
            OR (
                maintenance_actor_membership(p_organization_id) IS DISTINCT FROM p_author
                AND actor_has_reviewer_grant(p_organization_id, p_department_id, p_classification, p_team_tag, p_project_tag)
            ));
$$;
REVOKE ALL ON FUNCTION maintenance_case_visible(uuid, uuid, uuid, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_case_visible(uuid, uuid, uuid, uuid, uuid, text, text, text) TO arden_runtime;

ALTER TABLE maintenance_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_case FORCE ROW LEVEL SECURITY;
ALTER TABLE maintenance_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_idempotency FORCE ROW LEVEL SECURITY;
ALTER TABLE maintenance_case_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_case_event FORCE ROW LEVEL SECURITY;
ALTER TABLE maintenance_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_notification FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON maintenance_case TO arden_runtime;
GRANT SELECT, INSERT ON maintenance_idempotency TO arden_runtime;
GRANT SELECT, INSERT ON maintenance_case_event TO arden_runtime;
GRANT SELECT, INSERT ON maintenance_notification TO arden_runtime;

CREATE POLICY maintenance_case_read ON maintenance_case FOR SELECT TO arden_runtime
    USING (maintenance_case_visible(organization_id, reporter_membership_id, assignee_membership_id,
        author_membership_id, route_department_id, classification, team_tag, project_tag));
CREATE POLICY maintenance_case_insert ON maintenance_case FOR INSERT TO arden_runtime
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND maintenance_actor_membership(organization_id) IS NOT NULL
        AND (
            (origin = 'READER_REPORT' AND reporter_membership_id = maintenance_actor_membership(organization_id))
            OR (origin = 'REVIEWER_INTAKE'
                AND maintenance_actor_membership(organization_id) IS DISTINCT FROM author_membership_id
                AND actor_has_reviewer_grant(organization_id, route_department_id, classification, team_tag, project_tag))));
CREATE POLICY maintenance_case_update ON maintenance_case FOR UPDATE TO arden_runtime
    USING (maintenance_case_visible(organization_id, reporter_membership_id, assignee_membership_id,
        author_membership_id, route_department_id, classification, team_tag, project_tag))
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND (maintenance_actor_membership(organization_id) = assignee_membership_id
            OR maintenance_actor_is_admin(organization_id)));

CREATE POLICY maintenance_idempotency_actor ON maintenance_idempotency FOR ALL TO arden_runtime
    USING (actor_membership_id = maintenance_actor_membership(organization_id))
    WITH CHECK (actor_membership_id = maintenance_actor_membership(organization_id));

CREATE POLICY maintenance_event_read ON maintenance_case_event FOR SELECT TO arden_runtime
    USING (EXISTS (
        SELECT 1 FROM maintenance_case c
         WHERE c.case_id = maintenance_case_event.case_id
           AND c.organization_id = maintenance_case_event.organization_id
           AND maintenance_case_visible(c.organization_id, c.reporter_membership_id, c.assignee_membership_id,
                c.author_membership_id, c.route_department_id, c.classification, c.team_tag, c.project_tag)
           AND (audience = 'PUBLIC'
                OR maintenance_actor_membership(c.organization_id) IS DISTINCT FROM c.reporter_membership_id)));
CREATE POLICY maintenance_event_insert ON maintenance_case_event FOR INSERT TO arden_runtime
    WITH CHECK (EXISTS (
        SELECT 1 FROM maintenance_case c
         WHERE c.case_id = maintenance_case_event.case_id
           AND c.organization_id = maintenance_case_event.organization_id
           AND maintenance_case_visible(c.organization_id, c.reporter_membership_id, c.assignee_membership_id,
                c.author_membership_id, c.route_department_id, c.classification, c.team_tag, c.project_tag)));

CREATE POLICY maintenance_notification_read ON maintenance_notification FOR SELECT TO arden_runtime
    USING (recipient_membership_id = maintenance_actor_membership(organization_id));
CREATE POLICY maintenance_notification_insert ON maintenance_notification FOR INSERT TO arden_runtime
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND maintenance_actor_membership(organization_id) IS NOT NULL);
