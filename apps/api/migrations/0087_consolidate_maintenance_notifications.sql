SET search_path TO arden, public;

LOCK TABLE maintenance_notification, maintenance_notification_receipt, arden_notification IN ACCESS EXCLUSIVE MODE;

ALTER TABLE arden_notification ADD COLUMN message text;
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_event_type;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_event_type CHECK (event_type IN (
    'REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'PUBLICATION_ACTIVE',
    'PUBLICATION_FAILED', 'DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP', 'PRIMARY_DEPARTMENT_CHANGED',
    'REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED', 'PUBLICATION_EXPIRING', 'PUBLICATION_RENEWAL_ON_BEHALF',
    'DOCUMENT_SHARED_DIRECT', 'MAINTENANCE_CASE_UPDATED'));
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_resource;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_resource CHECK (
    (event_type IN ('REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED',
        'PUBLICATION_ACTIVE', 'PUBLICATION_FAILED') AND resource_type = 'SUBMISSION' AND resource_id IS NOT NULL)
    OR (event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
        AND resource_type = 'PUBLICATION' AND resource_id IS NOT NULL)
    OR (event_type IN ('PUBLICATION_EXPIRING', 'PUBLICATION_RENEWAL_ON_BEHALF')
        AND resource_type = 'DOCUMENT' AND resource_id IS NOT NULL)
    OR (event_type = 'DOCUMENT_SHARED_DIRECT' AND resource_type = 'PRIVATE_ITEM' AND resource_id IS NOT NULL)
    OR (event_type = 'PRIMARY_DEPARTMENT_CHANGED' AND resource_type = 'DEPARTMENT' AND resource_id IS NOT NULL)
    OR (event_type IN ('REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED')
        AND resource_type = 'REVIEWER_GRANT' AND resource_id IS NOT NULL)
    OR (event_type = 'MAINTENANCE_CASE_UPDATED'
        AND resource_type IS NOT DISTINCT FROM 'MAINTENANCE_CASE' AND resource_id IS NOT NULL));
ALTER TABLE arden_notification ADD CONSTRAINT ck_maintenance_notification_message CHECK (
    (event_type = 'MAINTENANCE_CASE_UPDATED' AND message IS NOT NULL AND char_length(btrim(message)) BETWEEN 1 AND 200)
    OR (event_type <> 'MAINTENANCE_CASE_UPDATED' AND message IS NULL));

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM maintenance_notification_receipt r
          JOIN maintenance_notification n USING (notification_id)
         WHERE (r.organization_id, r.recipient_membership_id)
           IS DISTINCT FROM (n.organization_id, n.recipient_membership_id)
    ) THEN
        RAISE EXCEPTION 'Reconcile inconsistent legacy notification receipts before moving them' USING ERRCODE = '55000';
    END IF;
END;
$$;

-- Historical notices retain their original read state and are never requeued.
INSERT INTO arden_notification (notification_id, organization_id, recipient_membership_id,
    event_key, event_type, resource_type, resource_id, created_at, read_at, message)
SELECT n.notification_id, n.organization_id, n.recipient_membership_id,
       'maintenance:' || n.logical_key, 'MAINTENANCE_CASE_UPDATED', 'MAINTENANCE_CASE', n.case_id,
       n.created_at, r.read_at, n.message
  FROM maintenance_notification n
  LEFT JOIN maintenance_notification_receipt r USING (notification_id, organization_id, recipient_membership_id);

CREATE INDEX ix_arden_notification_maintenance_unread
    ON arden_notification (organization_id, recipient_membership_id, resource_id)
    WHERE event_type = 'MAINTENANCE_CASE_UPDATED' AND read_at IS NULL;

-- Called inside a case transaction. Derive tenant and current case authority
-- before writing the notice and enqueue that exact ID in the same statement.
CREATE FUNCTION enqueue_maintenance_case_notice(p_id uuid, p_case_id uuid, p_recipient uuid, p_key text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(org);
    notice_id uuid;
BEGIN
    IF actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM maintenance_case c
          JOIN organization_membership recipient ON recipient.membership_id = p_recipient
                AND recipient.organization_id = c.organization_id
          WHERE c.case_id = p_case_id AND c.organization_id = org
            AND (actor IN (c.reporter_membership_id, c.assignee_membership_id) OR governance_is_org_admin(actor, org))
            AND (p_recipient IN (c.reporter_membership_id, c.assignee_membership_id) OR governance_is_org_admin(actor, org))
    ) THEN
        RAISE EXCEPTION 'Maintenance notice is unavailable' USING ERRCODE = '42501';
    END IF;
    IF p_key IS NULL OR char_length(btrim(p_key)) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'Invalid maintenance notice key' USING ERRCODE = '22023';
    END IF;
    INSERT INTO arden_notification (notification_id, organization_id, recipient_membership_id,
        event_key, event_type, resource_type, resource_id, message)
    VALUES (p_id, org, p_recipient, 'maintenance:' || p_key, 'MAINTENANCE_CASE_UPDATED', 'MAINTENANCE_CASE',
        p_case_id, p_message)
    ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
    RETURNING notification_id INTO notice_id;
    IF notice_id IS NOT NULL THEN
        INSERT INTO arden_notification_outbox (notification_id, organization_id) VALUES (notice_id, org);
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_maintenance_case_notice(uuid, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_maintenance_case_notice(uuid, uuid, uuid, text, text) TO arden_runtime;

CREATE OR REPLACE FUNCTION enqueue_maintenance_submission_notices()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    submitted maintenance_case%ROWTYPE;
    actor uuid := governance_actor_membership(NEW.organization_id);
BEGIN
    IF actor IS NULL OR actor IS DISTINCT FROM NEW.actor_membership_id THEN RETURN NEW; END IF;
    -- Intake already verified the pin. A later publication must not suppress its notices.
    SELECT c.* INTO submitted FROM maintenance_case c
     WHERE c.organization_id = NEW.organization_id AND c.case_id = NEW.case_id
       AND c.reporter_status = 'Submitted'
       AND ((c.origin = 'READER_REPORT' AND c.reporter_membership_id = actor)
         OR (c.origin = 'REVIEWER_INTAKE' AND maintenance_reviewer_eligible(actor, c.published_version_id)));
    IF NOT FOUND THEN RETURN NEW; END IF;

    WITH active_members AS (
        SELECT m.membership_id FROM organization_membership m
          JOIN user_account u ON u.user_id = m.user_id AND u.status = 'ACTIVE'
         WHERE m.organization_id = submitted.organization_id AND m.status = 'ACTIVE'
    ), eligible AS (
        SELECT m.membership_id FROM active_members m
         WHERE m.membership_id IS DISTINCT FROM submitted.reporter_membership_id
           AND maintenance_reviewer_eligible(m.membership_id, submitted.published_version_id)
    ), targets AS (
        SELECT membership_id FROM eligible
        UNION ALL
        SELECT m.membership_id FROM active_members m
         WHERE NOT EXISTS (SELECT 1 FROM eligible)
           AND governance_is_org_admin(m.membership_id, submitted.organization_id)
    ), inserted AS (
        INSERT INTO arden_notification (organization_id, recipient_membership_id, event_key,
            event_type, resource_type, resource_id, message)
        SELECT submitted.organization_id, t.membership_id, 'maintenance:submitted:' || submitted.case_id,
               'MAINTENANCE_CASE_UPDATED', 'MAINTENANCE_CASE', submitted.case_id,
               'A maintenance case is waiting for review.'
          FROM targets t
        ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
        RETURNING notification_id, organization_id
    )
    INSERT INTO arden_notification_outbox (notification_id, organization_id)
    SELECT notification_id, organization_id FROM inserted;
    RETURN NEW;
END;
$$;

DROP TABLE maintenance_notification_receipt;
DROP TABLE maintenance_notification;
