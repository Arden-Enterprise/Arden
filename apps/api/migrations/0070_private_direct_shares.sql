SET search_path TO arden, public;

-- Decision 0034 (spec F03-SHR): the owner of a private note or PDF item may give
-- named active members of the same organization view-only access to its current
-- saved content, without review. A direct share is never official, is never
-- indexed for organization AI and ends on revocation, trash, purge, either
-- member leaving, or the organization turning direct sharing off. Reaching a
-- department, a group or the organization still needs contribution and review.

CREATE TABLE organization_direct_share_setting (
    organization_id          uuid PRIMARY KEY REFERENCES organization (organization_id)
                                 ON UPDATE RESTRICT ON DELETE RESTRICT,
    enabled                  boolean NOT NULL DEFAULT true,
    recipient_limit          integer NOT NULL DEFAULT 10,
    updated_by_membership_id uuid NOT NULL REFERENCES organization_membership (membership_id)
                                 ON UPDATE RESTRICT ON DELETE RESTRICT,
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_direct_share_recipient_limit CHECK (recipient_limit BETWEEN 1 AND 100)
);

COMMENT ON TABLE organization_direct_share_setting IS
    'Decision 0034: Organization Admin switch and per-item recipient limit for direct sharing; no row means enabled with 10';

CREATE TABLE private_item_share (
    share_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          uuid NOT NULL REFERENCES organization (organization_id)
                                 ON UPDATE RESTRICT ON DELETE RESTRICT,
    draft_id                 uuid NOT NULL REFERENCES draft_document (draft_id)
                                 ON UPDATE RESTRICT ON DELETE RESTRICT,
    owner_membership_id      uuid NOT NULL REFERENCES organization_membership (membership_id)
                                 ON UPDATE RESTRICT ON DELETE RESTRICT,
    recipient_membership_id  uuid NOT NULL REFERENCES organization_membership (membership_id)
                                 ON UPDATE RESTRICT ON DELETE RESTRICT,
    created_at               timestamptz NOT NULL DEFAULT now(),
    revoked_at               timestamptz,
    revoked_by_membership_id uuid REFERENCES organization_membership (membership_id)
                                 ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_private_item_share_not_self CHECK (owner_membership_id <> recipient_membership_id),
    CONSTRAINT ck_private_item_share_revocation CHECK ((revoked_at IS NULL) = (revoked_by_membership_id IS NULL))
);

CREATE UNIQUE INDEX uq_private_item_share_active ON private_item_share (draft_id, recipient_membership_id)
    WHERE revoked_at IS NULL;
CREATE INDEX ix_private_item_share_recipient ON private_item_share (recipient_membership_id, created_at DESC)
    WHERE revoked_at IS NULL;

COMMENT ON TABLE private_item_share IS
    'Decision 0034: unreviewed, view-only access to one private item for one named member; rows are revoked, never deleted';

-- A share keeps its identity; it can only be revoked, once.
CREATE FUNCTION protect_private_item_share()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    IF (NEW.share_id, NEW.organization_id, NEW.draft_id, NEW.owner_membership_id, NEW.recipient_membership_id, NEW.created_at)
       IS DISTINCT FROM (OLD.share_id, OLD.organization_id, OLD.draft_id, OLD.owner_membership_id, OLD.recipient_membership_id, OLD.created_at)
       OR OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'A direct share can only be revoked' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION protect_private_item_share() FROM PUBLIC;
CREATE TRIGGER trg_private_item_share_immutable BEFORE UPDATE ON private_item_share
    FOR EACH ROW EXECUTE FUNCTION protect_private_item_share();

-- Whether direct sharing is on for the current organization (missing settings mean on).
CREATE FUNCTION direct_sharing_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT COALESCE((SELECT s.enabled FROM organization_direct_share_setting s
        WHERE s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid), true)
$$;
REVOKE ALL ON FUNCTION direct_sharing_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION direct_sharing_enabled() TO arden_runtime;

-- The actor is an active recipient of an active share of this item, its owner is
-- still an active member (the reviewed reader directory only lists active members of
-- the current organization) and direct sharing is on.
CREATE FUNCTION actor_can_read_direct_share(p_draft_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT direct_sharing_enabled() AND EXISTS (
        SELECT 1 FROM private_item_share s
         WHERE s.draft_id = p_draft_id AND s.revoked_at IS NULL
           AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND actor_owns_private_membership(s.recipient_membership_id)
           AND EXISTS (SELECT 1 FROM knowledge_reader_directory('', ARRAY[s.owner_membership_id])))
$$;
REVOKE ALL ON FUNCTION actor_can_read_direct_share(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_can_read_direct_share(uuid) TO arden_runtime;

ALTER TABLE organization_direct_share_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_direct_share_setting FORCE ROW LEVEL SECURITY;
ALTER TABLE private_item_share ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_item_share FORCE ROW LEVEL SECURITY;

-- Every active member reads the setting of the current organization; only an
-- Organization Admin context (set after the role check) writes it.
CREATE POLICY direct_share_setting_member_read ON organization_direct_share_setting FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid);
CREATE POLICY direct_share_setting_admin_insert ON organization_direct_share_setting FOR INSERT TO arden_runtime
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND current_setting('arden.org_admin', true) = 'true'
        AND actor_owns_private_membership(updated_by_membership_id));
CREATE POLICY direct_share_setting_admin_update ON organization_direct_share_setting FOR UPDATE TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND current_setting('arden.org_admin', true) = 'true'
        AND actor_owns_private_membership(updated_by_membership_id));

-- The owner sees and revokes their shares; a recipient sees only the shares made to them.
CREATE POLICY private_item_share_owner_read ON private_item_share FOR SELECT TO arden_runtime
    USING (actor_owns_private_membership(owner_membership_id));
CREATE POLICY private_item_share_recipient_read ON private_item_share FOR SELECT TO arden_runtime
    USING (actor_owns_private_membership(recipient_membership_id));
CREATE POLICY private_item_share_owner_insert ON private_item_share FOR INSERT TO arden_runtime
    WITH CHECK (revoked_at IS NULL
        AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND actor_owns_private_membership(owner_membership_id)
        AND direct_sharing_enabled()
        AND EXISTS (SELECT 1 FROM draft_document d JOIN private_workspace w ON w.workspace_id = d.workspace_id
                     WHERE d.draft_id = private_item_share.draft_id AND w.membership_id = private_item_share.owner_membership_id
                       AND d.status = 'ACTIVE' AND d.trashed_at IS NULL)
        AND EXISTS (SELECT 1 FROM knowledge_reader_directory('', ARRAY[recipient_membership_id])));
CREATE POLICY private_item_share_owner_revoke ON private_item_share FOR UPDATE TO arden_runtime
    USING (actor_owns_private_membership(owner_membership_id))
    WITH CHECK (actor_owns_private_membership(owner_membership_id) AND revoked_by_membership_id = owner_membership_id);

GRANT SELECT, INSERT ON private_item_share TO arden_runtime;
GRANT UPDATE (revoked_at, revoked_by_membership_id) ON private_item_share TO arden_runtime;
GRANT SELECT, INSERT ON organization_direct_share_setting TO arden_runtime;
GRANT UPDATE (enabled, recipient_limit, updated_by_membership_id, updated_at) ON organization_direct_share_setting TO arden_runtime;

-- Recipients read the shared item and only its current version. Writes stay owner-only.
CREATE POLICY draft_document_direct_share_read ON draft_document FOR SELECT TO arden_runtime
    USING (status = 'ACTIVE' AND trashed_at IS NULL AND actor_can_read_direct_share(draft_id));
CREATE POLICY draft_version_direct_share_read ON draft_version FOR SELECT TO arden_runtime
    USING (EXISTS (SELECT 1 FROM draft_document d
                    WHERE d.draft_id = draft_version.draft_id AND d.current_version_no = draft_version.version_no
                      AND d.status = 'ACTIVE' AND d.trashed_at IS NULL AND actor_can_read_direct_share(d.draft_id)));

-- In-app notice for each new share (decision 0025): the item title and the owner's
-- name, never content. Core shows them only while the recipient can still read it.
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_event_type;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_event_type CHECK (event_type IN (
    'REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'PUBLICATION_ACTIVE',
    'PUBLICATION_FAILED', 'DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP', 'PRIMARY_DEPARTMENT_CHANGED',
    'REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED', 'PUBLICATION_EXPIRING', 'PUBLICATION_RENEWAL_ON_BEHALF',
    'DOCUMENT_SHARED_DIRECT'));
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
        AND resource_type = 'REVIEWER_GRANT' AND resource_id IS NOT NULL));
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_share_details;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_share_details CHECK (
    (event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP', 'DOCUMENT_SHARED_DIRECT')
        AND char_length(btrim(publication_title)) > 0 AND char_length(btrim(shared_by_name)) > 0
        AND expires_on IS NULL AND request_reason IS NULL)
    OR (event_type = 'PUBLICATION_EXPIRING'
        AND char_length(btrim(publication_title)) > 0 AND expires_on IS NOT NULL
        AND shared_by_name IS NULL AND request_reason IS NULL)
    OR (event_type = 'PUBLICATION_RENEWAL_ON_BEHALF'
        AND char_length(btrim(publication_title)) > 0 AND char_length(btrim(shared_by_name)) > 0
        AND char_length(btrim(request_reason)) BETWEEN 1 AND 1000 AND expires_on IS NULL)
    OR (event_type NOT IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP', 'DOCUMENT_SHARED_DIRECT',
            'PUBLICATION_EXPIRING', 'PUBLICATION_RENEWAL_ON_BEHALF')
        AND publication_title IS NULL AND shared_by_name IS NULL AND expires_on IS NULL AND request_reason IS NULL));

-- Trigger executor: the runtime cannot write notifications, and the owner context
-- cannot read the recipient's membership. It reads only the new share's own item
-- title and owner name and writes one notice for that share's recipient.
CREATE FUNCTION notify_private_item_share()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    item_title text;
    owner_name text;
    inserted_notification_id uuid;
BEGIN
    SELECT d.title, COALESCE(NULLIF(btrim(ua.full_name), ''), 'A colleague')
      INTO item_title, owner_name
      FROM draft_document d
      JOIN private_workspace w ON w.workspace_id = d.workspace_id AND w.membership_id = NEW.owner_membership_id
      JOIN organization_membership om ON om.membership_id = NEW.owner_membership_id
                                     AND om.organization_id = NEW.organization_id
      JOIN user_account ua ON ua.user_id = om.user_id
     WHERE d.draft_id = NEW.draft_id;
    IF NOT FOUND OR char_length(btrim(item_title)) = 0 THEN RETURN NEW; END IF;
    INSERT INTO arden_notification (organization_id, recipient_membership_id, event_key,
        event_type, resource_type, resource_id, publication_title, shared_by_name)
    VALUES (NEW.organization_id, NEW.recipient_membership_id, 'private-share:' || NEW.share_id::text,
        'DOCUMENT_SHARED_DIRECT', 'PRIVATE_ITEM', NEW.draft_id, item_title, owner_name)
    ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
    RETURNING notification_id INTO inserted_notification_id;
    IF inserted_notification_id IS NOT NULL THEN
        INSERT INTO arden_notification_outbox (notification_id, organization_id)
        VALUES (inserted_notification_id, NEW.organization_id);
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION notify_private_item_share() FROM PUBLIC;

CREATE TRIGGER trg_notify_private_item_share AFTER INSERT ON private_item_share
    FOR EACH ROW EXECUTE FUNCTION notify_private_item_share();
