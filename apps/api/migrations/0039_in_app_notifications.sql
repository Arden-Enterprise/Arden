SET search_path TO arden, public;

CREATE TABLE arden_notification (
    notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE CASCADE,
    recipient_membership_id uuid NOT NULL REFERENCES organization_membership(membership_id) ON DELETE CASCADE,
    event_key text NOT NULL,
    event_type text NOT NULL,
    resource_type text,
    resource_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    CONSTRAINT ck_arden_notification_event_key CHECK (char_length(event_key) BETWEEN 1 AND 300),
    CONSTRAINT ck_arden_notification_event_type CHECK (event_type IN (
        'REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'PUBLICATION_ACTIVE',
        'PUBLICATION_FAILED', 'PRIMARY_DEPARTMENT_CHANGED', 'REVIEWER_GRANT_CREATED',
        'REVIEWER_GRANT_REVOKED')),
    CONSTRAINT ck_arden_notification_resource CHECK (
        (event_type IN ('REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED',
            'PUBLICATION_ACTIVE', 'PUBLICATION_FAILED') AND resource_type = 'SUBMISSION' AND resource_id IS NOT NULL)
        OR (event_type = 'PRIMARY_DEPARTMENT_CHANGED' AND resource_type = 'DEPARTMENT' AND resource_id IS NOT NULL)
        OR (event_type IN ('REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED')
            AND resource_type = 'REVIEWER_GRANT' AND resource_id IS NOT NULL)),
    CONSTRAINT uq_arden_notification_recipient_event UNIQUE (event_key, recipient_membership_id),
    CONSTRAINT uq_arden_notification_org_id UNIQUE (notification_id, organization_id)
);
CREATE INDEX ix_arden_notification_recipient_page
    ON arden_notification (organization_id, recipient_membership_id, created_at DESC, notification_id DESC);
CREATE INDEX ix_arden_notification_unread
    ON arden_notification (organization_id, recipient_membership_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE TABLE arden_notification_outbox (
    outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id uuid NOT NULL UNIQUE,
    organization_id uuid NOT NULL REFERENCES organization(organization_id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'PENDING',
    attempt_count integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner uuid,
    lease_expires_at timestamptz,
    delivered_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_arden_notification_outbox_notification FOREIGN KEY (notification_id, organization_id)
        REFERENCES arden_notification(notification_id, organization_id) ON DELETE CASCADE,
    CONSTRAINT ck_arden_notification_outbox_status CHECK (status IN ('PENDING', 'LEASED', 'SENT', 'FAILED')),
    CONSTRAINT ck_arden_notification_outbox_attempts CHECK (attempt_count BETWEEN 0 AND 8),
    CONSTRAINT ck_arden_notification_outbox_lease CHECK (
        (status = 'LEASED' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'LEASED' AND lease_owner IS NULL AND lease_expires_at IS NULL)),
    CONSTRAINT ck_arden_notification_outbox_delivery CHECK (
        (status = 'SENT') = (delivered_at IS NOT NULL)),
    CONSTRAINT ck_arden_notification_outbox_error CHECK (
        last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,40}$')
);
CREATE INDEX ix_arden_notification_outbox_claim
    ON arden_notification_outbox (available_at, created_at, outbox_id)
    WHERE status IN ('PENDING', 'LEASED');

ALTER TABLE arden_notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE arden_notification FORCE ROW LEVEL SECURITY;
ALTER TABLE arden_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE arden_notification_outbox FORCE ROW LEVEL SECURITY;

DO $notification_worker_role$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'arden_notification_worker') THEN
        CREATE ROLE arden_notification_worker NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$notification_worker_role$;
ALTER ROLE arden_notification_worker NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA arden TO arden_notification_worker;

GRANT SELECT ON arden_notification TO arden_runtime;
GRANT UPDATE (read_at) ON arden_notification TO arden_runtime;
CREATE POLICY arden_notification_recipient_read ON arden_notification
    FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.membership_id = arden_notification.recipient_membership_id
              AND om.organization_id = arden_notification.organization_id
              AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE'));
CREATE POLICY arden_notification_recipient_mark_read ON arden_notification
    FOR UPDATE TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.membership_id = arden_notification.recipient_membership_id
              AND om.organization_id = arden_notification.organization_id
              AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE'))
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.membership_id = arden_notification.recipient_membership_id
              AND om.organization_id = arden_notification.organization_id
              AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE'));

-- Inserts are available to the trusted trigger executor only. Its exact owner is
-- restored by the reviewed operator procedure; the release migration role can
-- run the trigger during local rehearsal while it still owns the table.
CREATE POLICY arden_notification_trigger_insert ON arden_notification
    FOR INSERT TO PUBLIC
    WITH CHECK (current_user = pg_catalog.pg_get_userbyid((
        SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'arden.arden_notification'::regclass)));
GRANT SELECT ON arden_notification TO arden_notification_worker;
CREATE POLICY arden_notification_worker_read ON arden_notification
    FOR SELECT TO arden_notification_worker USING (true);
GRANT SELECT ON arden_notification_outbox TO arden_notification_worker;
GRANT UPDATE (status, attempt_count, available_at, lease_owner, lease_expires_at,
    delivered_at, last_error_code) ON arden_notification_outbox TO arden_notification_worker;
CREATE POLICY arden_notification_outbox_worker_read ON arden_notification_outbox
    FOR SELECT TO arden_notification_worker USING (true);
CREATE POLICY arden_notification_outbox_worker_update ON arden_notification_outbox
    FOR UPDATE TO arden_notification_worker USING (true) WITH CHECK (true);
CREATE POLICY arden_notification_outbox_trigger_insert ON arden_notification_outbox
    FOR INSERT TO PUBLIC
    WITH CHECK (current_user = pg_catalog.pg_get_userbyid((
        SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid = 'arden.arden_notification_outbox'::regclass)));

CREATE FUNCTION notify_arden_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    has_organization_audience boolean;
    recipient record;
    v_recipient_membership_id uuid;
    v_organization_id uuid;
    v_resource_id uuid;
    v_event_key text;
    v_event_type text;
    v_resource_type text;
    v_event_at timestamptz;
    inserted_notification_id uuid;
    actor_id uuid := NULLIF(current_setting('arden.actor_id', true), '')::uuid;
    is_current_org_admin boolean;
BEGIN
    IF TG_TABLE_NAME = 'shared_submission' AND TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING_REVIEW' OR NEW.policy_version <> 1 THEN RETURN NEW; END IF;
        SELECT EXISTS (SELECT 1 FROM audience a WHERE NEW.target_scope_type = 'ORGANIZATION'
            AND a.organization_id = NEW.organization_id
            AND a.audience_id = ANY(NEW.audience_role_ids) AND a.kind = 'ORGANIZATION_ALL')
          INTO has_organization_audience;

        FOR recipient IN
            SELECT om.membership_id
              FROM organization_membership om
              JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
             WHERE om.organization_id = NEW.organization_id AND om.status = 'ACTIVE'
               AND (EXISTS (SELECT 1 FROM role_assignment ra
                    JOIN role r ON r.role_id = ra.role_id AND r.organization_id IS NULL
                      AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
                    JOIN access_scope s ON s.access_scope_id = ra.access_scope_id
                      AND s.organization_id = NEW.organization_id AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
                    WHERE ra.membership_id = om.membership_id AND ra.status = 'ACTIVE' AND ra.valid_from <= now()
                      AND (ra.valid_until IS NULL OR ra.valid_until > now()))
                 OR (om.membership_id <> NEW.submitted_by_membership_id AND EXISTS (SELECT 1 FROM reviewer_grant g
                    LEFT JOIN department d ON d.department_id = g.department_id AND d.organization_id = g.organization_id
                    WHERE g.organization_id = NEW.organization_id AND g.reviewer_membership_id = om.membership_id
                      AND g.status = 'ACTIVE' AND g.valid_from <= now()
                      AND (g.valid_until IS NULL OR g.valid_until > now())
                      AND NEW.classification = ANY(g.classifications)
                      AND (NEW.classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))
                      AND (g.team_tag IS NULL OR g.team_tag IS NOT DISTINCT FROM NEW.team_tag)
                      AND (g.project_tag IS NULL OR g.project_tag IS NOT DISTINCT FROM NEW.project_tag)
                      AND (
                        (has_organization_audience
                          AND (g.scope = 'ORGANIZATION'
                            OR (NEW.review_rule = 'LEGACY' AND g.scope = 'DEPARTMENT'
                              AND g.department_id = NEW.responsible_department_id
                              AND g.level IN ('SPECIALIST', 'SENIOR'))))
                        OR (NOT has_organization_audience AND g.scope = 'DEPARTMENT'
                          AND g.department_id = NEW.responsible_department_id AND d.status = 'ACTIVE')
                      )
                    )
                  )
               )
        LOOP
            INSERT INTO arden_notification (organization_id, recipient_membership_id, event_key, event_type, resource_type, resource_id)
            VALUES (NEW.organization_id, recipient.membership_id,
                'submission:' || NEW.submission_id::text || ':review-request', 'REVIEW_REQUESTED', 'SUBMISSION', NEW.submission_id)
            ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
            RETURNING notification_id INTO inserted_notification_id;
            IF inserted_notification_id IS NOT NULL THEN
                INSERT INTO arden_notification_outbox (notification_id, organization_id)
                VALUES (inserted_notification_id, NEW.organization_id);
            END IF;
            inserted_notification_id := NULL;
        END LOOP;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'review_decision' THEN
        IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
        IF NOT NEW.flow2 THEN RETURN NEW; END IF;
        SELECT s.organization_id, s.submitted_by_membership_id INTO v_organization_id, v_recipient_membership_id
          FROM shared_submission s WHERE s.submission_id = NEW.submission_id;
        v_event_key := 'review:' || NEW.review_decision_id::text || ':author-outcome';
        v_event_type := CASE WHEN NEW.decision = 'APPROVED' THEN 'REVIEW_APPROVED' ELSE 'REVIEW_REJECTED' END;
        v_resource_type := 'SUBMISSION'; v_resource_id := NEW.submission_id;
    ELSIF TG_TABLE_NAME = 'shared_submission' THEN
        IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
        IF NEW.publication_state IS NOT DISTINCT FROM OLD.publication_state
            OR NEW.publication_state NOT IN ('ACTIVE', 'FAILED') THEN RETURN NEW; END IF;
        v_organization_id := NEW.organization_id; v_recipient_membership_id := NEW.submitted_by_membership_id;
        SELECT g.completed_at INTO v_event_at
          FROM knowledge_index_generation g
         WHERE g.submission_id = NEW.submission_id
         ORDER BY g.created_at DESC, g.generation_id DESC LIMIT 1;
        v_event_at := COALESCE(v_event_at, clock_timestamp());
        v_event_key := 'publication:' || NEW.submission_id::text || ':' || NEW.publication_state || ':'
            || to_char(v_event_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS.US');
        v_event_type := CASE WHEN NEW.publication_state = 'ACTIVE' THEN 'PUBLICATION_ACTIVE' ELSE 'PUBLICATION_FAILED' END;
        v_resource_type := 'SUBMISSION'; v_resource_id := NEW.submission_id;
    ELSIF TG_TABLE_NAME = 'reviewer_grant' THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.status <> 'ACTIVE' THEN RETURN NEW; END IF;
            v_organization_id := NEW.organization_id; v_recipient_membership_id := NEW.reviewer_membership_id;
            v_event_key := 'reviewer-grant:' || NEW.reviewer_grant_id::text || ':created';
            v_event_type := 'REVIEWER_GRANT_CREATED';
        ELSIF TG_OP = 'UPDATE' THEN
            IF OLD.status <> 'ACTIVE' OR NEW.status = 'ACTIVE' THEN RETURN NEW; END IF;
            v_organization_id := NEW.organization_id; v_recipient_membership_id := NEW.reviewer_membership_id;
            v_event_key := 'reviewer-grant:' || NEW.reviewer_grant_id::text || ':revoked';
            v_event_type := 'REVIEWER_GRANT_REVOKED';
        ELSE
            RETURN NEW;
        END IF;
        v_resource_type := 'REVIEWER_GRANT'; v_resource_id := NEW.reviewer_grant_id;
        SELECT EXISTS (SELECT 1 FROM organization_membership om
            JOIN role_assignment ra ON ra.membership_id = om.membership_id AND ra.status = 'ACTIVE'
              AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
            JOIN role r ON r.role_id = ra.role_id AND r.organization_id IS NULL
              AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
            JOIN access_scope s ON s.access_scope_id = ra.access_scope_id AND s.organization_id = v_organization_id
              AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.user_id = actor_id AND om.organization_id = v_organization_id AND om.status = 'ACTIVE')
          INTO is_current_org_admin;
        IF NOT COALESCE(is_current_org_admin, false) THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'department_membership' THEN
        IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN RETURN NEW; END IF;
        IF NEW.is_primary IS DISTINCT FROM true OR NEW.status IS DISTINCT FROM 'ACTIVE' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.is_primary IS NOT DISTINCT FROM NEW.is_primary
            AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
        SELECT om.organization_id INTO v_organization_id
          FROM organization_membership om WHERE om.membership_id = NEW.membership_id;
        v_recipient_membership_id := NEW.membership_id;
        v_event_key := 'department:' || NEW.membership_id::text || ':' || NEW.department_id::text || ':' || NEW.assigned_at::text;
        v_event_type := 'PRIMARY_DEPARTMENT_CHANGED'; v_resource_type := 'DEPARTMENT'; v_resource_id := NEW.department_id;
        SELECT EXISTS (SELECT 1 FROM organization_membership om
            JOIN role_assignment ra ON ra.membership_id = om.membership_id AND ra.status = 'ACTIVE'
              AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
            JOIN role r ON r.role_id = ra.role_id AND r.organization_id IS NULL
              AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
            JOIN access_scope s ON s.access_scope_id = ra.access_scope_id AND s.organization_id = v_organization_id
              AND s.scope_type = 'ORGANIZATION' AND s.status = 'ACTIVE'
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.user_id = actor_id AND om.organization_id = v_organization_id AND om.status = 'ACTIVE')
          INTO is_current_org_admin;
        IF NOT COALESCE(is_current_org_admin, false) THEN RETURN NEW; END IF;
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO arden_notification (organization_id, recipient_membership_id, event_key, event_type, resource_type, resource_id)
    SELECT v_organization_id, v_recipient_membership_id, v_event_key, v_event_type, v_resource_type, v_resource_id
     WHERE EXISTS (SELECT 1 FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
        WHERE om.membership_id = v_recipient_membership_id AND om.organization_id = v_organization_id AND om.status = 'ACTIVE')
    ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
    RETURNING notification_id INTO inserted_notification_id;
    IF inserted_notification_id IS NOT NULL THEN
        INSERT INTO arden_notification_outbox (notification_id, organization_id)
        VALUES (inserted_notification_id, v_organization_id);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION notify_arden_notification() FROM PUBLIC;

CREATE TRIGGER trg_notify_submission_reviewers AFTER INSERT ON shared_submission
    FOR EACH ROW EXECUTE FUNCTION notify_arden_notification();
CREATE TRIGGER trg_notify_review_outcome AFTER INSERT ON review_decision
    FOR EACH ROW EXECUTE FUNCTION notify_arden_notification();
CREATE TRIGGER trg_notify_publication_state AFTER UPDATE OF publication_state ON shared_submission
    FOR EACH ROW EXECUTE FUNCTION notify_arden_notification();
CREATE TRIGGER trg_notify_reviewer_grant AFTER INSERT OR UPDATE OF status ON reviewer_grant
    FOR EACH ROW EXECUTE FUNCTION notify_arden_notification();
CREATE TRIGGER trg_notify_primary_department AFTER INSERT OR UPDATE OF is_primary, status ON department_membership
    FOR EACH ROW EXECUTE FUNCTION notify_arden_notification();
