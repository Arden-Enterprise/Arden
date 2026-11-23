SET search_path TO arden, public;

-- Personal and group share notifications are written only when reviewer approval changes the
-- current publication's reader selection. Publication activation is a separate event.
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_event_type;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_event_type CHECK (event_type IN (
    'REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'PUBLICATION_ACTIVE',
    'PUBLICATION_FAILED', 'DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP', 'PRIMARY_DEPARTMENT_CHANGED',
    'REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED'));

ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_resource;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_resource CHECK (
    (event_type IN ('REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED',
        'PUBLICATION_ACTIVE', 'PUBLICATION_FAILED') AND resource_type = 'SUBMISSION' AND resource_id IS NOT NULL)
    OR (event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
        AND resource_type = 'PUBLICATION' AND resource_id IS NOT NULL)
    OR (event_type = 'PRIMARY_DEPARTMENT_CHANGED' AND resource_type = 'DEPARTMENT' AND resource_id IS NOT NULL)
    OR (event_type IN ('REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED')
        AND resource_type = 'REVIEWER_GRANT' AND resource_id IS NOT NULL));

ALTER TABLE arden_notification ADD COLUMN publication_title text;
ALTER TABLE arden_notification ADD COLUMN shared_by_name text;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_share_details CHECK (
    (event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
        AND publication_title IS NOT NULL AND char_length(btrim(publication_title)) > 0
        AND shared_by_name IS NOT NULL AND char_length(btrim(shared_by_name)) > 0)
    OR (event_type NOT IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
        AND publication_title IS NULL AND shared_by_name IS NULL));

-- The Realtime dispatcher needs only routing IDs; share message details stay Core-only.
REVOKE SELECT ON arden_notification FROM arden_notification_worker;
GRANT SELECT (notification_id, organization_id, recipient_membership_id)
    ON arden_notification TO arden_notification_worker;

CREATE FUNCTION notify_arden_publication_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    share_submission_id uuid;
    author_membership_id uuid;
    publication_title text;
    shared_by_name text;
    share_notification_type text;
    recipient record;
    inserted_notification_id uuid;
BEGIN
    -- This function runs only for an existing publication whose approved reader selection changed.
    IF TG_OP <> 'UPDATE'
       OR OLD.published_version_id IS DISTINCT FROM NEW.published_version_id
       OR OLD.reader_selection_id IS NOT DISTINCT FROM NEW.reader_selection_id THEN
        RETURN NEW;
    END IF;

    -- apply_publication_change updates this pointer inside the review-decision transaction. Resolve
    -- the exact approved request. The new selection determines whether it is a personal or group share.
    SELECT s.submission_id, s.submitted_by_membership_id, pv.title,
           COALESCE(NULLIF(btrim(ua.full_name), ''), 'A colleague'),
           CASE WHEN rs.reader_mode = 'SELECTED_MEMBERS'
                THEN 'DOCUMENT_SHARED_PERSONAL' ELSE 'DOCUMENT_SHARED_GROUP' END
      INTO share_submission_id, author_membership_id, publication_title, shared_by_name, share_notification_type
      FROM shared_submission s
      JOIN shared_draft d ON d.shared_draft_id = s.shared_draft_id
                         AND d.author_membership_id = s.submitted_by_membership_id
      JOIN organization_membership author ON author.membership_id = s.submitted_by_membership_id
                                         AND author.organization_id = s.organization_id
      JOIN user_account ua ON ua.user_id = author.user_id
      JOIN published_knowledge_version pv ON pv.published_version_id = s.target_published_version_id
                                          AND pv.shared_draft_id = s.shared_draft_id
      JOIN reader_selection rs ON rs.selection_id = s.approved_selection_id
                               AND rs.organization_id = s.organization_id
     WHERE s.organization_id = NEW.organization_id
       AND s.shared_draft_id = NEW.shared_draft_id
       AND s.request_type = 'READER_CHANGE'
       AND s.status = 'APPROVED'
       AND s.target_published_version_id = NEW.published_version_id
       AND s.approved_selection_id = NEW.reader_selection_id
     ORDER BY s.submitted_at DESC, s.submission_id DESC
     LIMIT 1;
    IF NOT FOUND THEN RETURN NEW; END IF;

    FOR recipient IN
        SELECT om.membership_id
          FROM organization_membership om
          JOIN user_account recipient_account ON recipient_account.user_id = om.user_id
                                               AND recipient_account.status = 'ACTIVE'
          JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
         WHERE om.organization_id = NEW.organization_id
           AND om.status = 'ACTIVE'
           AND om.membership_id <> author_membership_id
           AND om.membership_id IN (
               SELECT audience_reader_memberships(NEW.organization_id, NEW.audience_role_ids,
                   NEW.target_scope_type, NEW.target_department_id))
           AND om.membership_id IN (
               SELECT reader_mode_memberships(NEW.organization_id, rs.reader_mode, rs.department_id, rs.selection_id)
                 FROM reader_selection rs
                WHERE rs.selection_id = NEW.reader_selection_id
                  AND rs.organization_id = NEW.organization_id)
         ORDER BY om.membership_id
    LOOP
        inserted_notification_id := NULL;
        INSERT INTO arden_notification (organization_id, recipient_membership_id, event_key,
            event_type, resource_type, resource_id, publication_title, shared_by_name)
        VALUES (NEW.organization_id, recipient.membership_id,
            'publication:' || NEW.published_version_id::text || ':shared:' || share_submission_id::text,
            share_notification_type, 'PUBLICATION', NEW.published_version_id, publication_title, shared_by_name)
        ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
        RETURNING notification_id INTO inserted_notification_id;
        IF inserted_notification_id IS NOT NULL THEN
            INSERT INTO arden_notification_outbox (notification_id, organization_id)
            VALUES (inserted_notification_id, NEW.organization_id);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION notify_arden_publication_share() FROM PUBLIC;

CREATE TRIGGER trg_notify_publication_shared_update AFTER UPDATE ON knowledge_current_publication
    FOR EACH ROW WHEN (OLD.published_version_id IS NOT DISTINCT FROM NEW.published_version_id
        AND OLD.reader_selection_id IS DISTINCT FROM NEW.reader_selection_id)
    EXECUTE FUNCTION notify_arden_publication_share();
