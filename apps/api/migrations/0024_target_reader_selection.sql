SET search_path TO arden, public;

-- Flow 2 T1.1 (BM04 RF-03): Target Readers are the per-document reader model.
-- This migration is additive: audience groups, shared_draft_audience and the
-- audience-based publication RLS stay in place until T1.2/T1.6. A publication
-- whose approved submission has no selection keeps today's audience behaviour.
--
-- A selection is immutable once its transaction commits. Saving a draft with
-- new readers creates a new selection (revision + 1), so a submission that
-- freezes proposed_selection_id can never be widened afterwards.

CREATE TABLE reader_selection (
    selection_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    reader_mode      text NOT NULL,
    department_id    uuid,
    revision         integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_reader_selection_organization
        FOREIGN KEY (organization_id) REFERENCES organization(organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_reader_selection_department
        FOREIGN KEY (department_id, organization_id)
        REFERENCES department(department_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_reader_selection_id_org UNIQUE (selection_id, organization_id),
    CONSTRAINT ck_reader_selection_mode
        CHECK (reader_mode IN ('ORGANIZATION', 'DEPARTMENT', 'SELECTED_MEMBERS')),
    CONSTRAINT ck_reader_selection_department
        CHECK ((reader_mode = 'DEPARTMENT') = (department_id IS NOT NULL)),
    CONSTRAINT ck_reader_selection_revision CHECK (revision > 0)
);

CREATE INDEX ix_reader_selection_org ON reader_selection (organization_id);

CREATE TABLE selected_reader (
    selected_reader_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    selection_id        uuid NOT NULL,
    organization_id     uuid NOT NULL,
    membership_id       uuid NOT NULL,
    ordinal             smallint NOT NULL,
    selected_at         timestamptz NOT NULL DEFAULT now(),

    -- Both composite keys pin the reader and the selection to one organization.
    CONSTRAINT fk_selected_reader_selection
        FOREIGN KEY (selection_id, organization_id)
        REFERENCES reader_selection(selection_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_selected_reader_membership
        FOREIGN KEY (membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_selected_reader_selection_membership UNIQUE (selection_id, membership_id),
    CONSTRAINT uq_selected_reader_selection_ordinal UNIQUE (selection_id, ordinal),
    CONSTRAINT ck_selected_reader_ordinal CHECK (ordinal BETWEEN 1 AND 100)
);

CREATE INDEX ix_selected_reader_membership ON selected_reader (membership_id);

ALTER TABLE shared_draft ADD COLUMN draft_selection_id uuid;
ALTER TABLE shared_draft ADD CONSTRAINT fk_shared_draft_selection
    FOREIGN KEY (draft_selection_id, organization_id)
    REFERENCES reader_selection(selection_id, organization_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
GRANT UPDATE (draft_selection_id) ON shared_draft TO arden_runtime;

ALTER TABLE shared_submission ADD COLUMN proposed_selection_id uuid;
ALTER TABLE shared_submission ADD COLUMN approved_selection_id uuid;
ALTER TABLE shared_submission ADD CONSTRAINT fk_shared_submission_proposed_selection
    FOREIGN KEY (proposed_selection_id, organization_id)
    REFERENCES reader_selection(selection_id, organization_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE shared_submission ADD CONSTRAINT fk_shared_submission_approved_selection
    FOREIGN KEY (approved_selection_id, organization_id)
    REFERENCES reader_selection(selection_id, organization_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE INDEX ix_shared_submission_approved_selection
    ON shared_submission (approved_selection_id) WHERE approved_selection_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Integrity: active department, active members, 2-100 readers, immutability.
-- The API validates first (TargetReaderPolicy.validateSelection) and returns a
-- field error; these triggers are the database backstop.
-- ---------------------------------------------------------------------------

CREATE FUNCTION validate_reader_selection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organization o
        WHERE o.organization_id = NEW.organization_id AND o.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Reader selection organization is not active' USING ERRCODE = '23514';
    END IF;
    IF NEW.reader_mode = 'DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department d
        WHERE d.department_id = NEW.department_id
          AND d.organization_id = NEW.organization_id AND d.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Reader selection department is not active' USING ERRCODE = '23514';
    END IF;
    -- The creation time is the freeze marker used by validate_selected_reader.
    NEW.created_at := transaction_timestamp();
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_reader_selection() FROM PUBLIC;
CREATE TRIGGER trg_validate_reader_selection BEFORE INSERT ON reader_selection
FOR EACH ROW EXECUTE FUNCTION validate_reader_selection();

-- Runs at commit, after every selected_reader row of the transaction exists.
CREATE FUNCTION check_reader_selection_size()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE reader_count integer;
BEGIN
    SELECT count(*) INTO reader_count FROM selected_reader WHERE selection_id = NEW.selection_id;
    IF NEW.reader_mode = 'SELECTED_MEMBERS' AND reader_count NOT BETWEEN 2 AND 100 THEN
        RAISE EXCEPTION 'Selected Members needs 2 to 100 readers' USING ERRCODE = '23514';
    END IF;
    IF NEW.reader_mode <> 'SELECTED_MEMBERS' AND reader_count <> 0 THEN
        RAISE EXCEPTION 'Only Selected Members selections list readers' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION check_reader_selection_size() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER trg_check_reader_selection_size
AFTER INSERT ON reader_selection
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_reader_selection_size();

CREATE FUNCTION validate_selected_reader()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE selection_row record;
BEGIN
    SELECT reader_mode, created_at INTO selection_row FROM reader_selection
     WHERE selection_id = NEW.selection_id AND organization_id = NEW.organization_id;
    IF NOT FOUND OR selection_row.reader_mode <> 'SELECTED_MEMBERS' THEN
        RAISE EXCEPTION 'Readers can be listed only on a Selected Members selection' USING ERRCODE = '23514';
    END IF;
    -- A committed selection is frozen: readers may be added only in the
    -- transaction that created the selection.
    IF selection_row.created_at <> transaction_timestamp() THEN
        RAISE EXCEPTION 'reader_selection is immutable once saved' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM organization_membership om
        JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
        WHERE om.membership_id = NEW.membership_id
          AND om.organization_id = NEW.organization_id AND om.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Selected reader must be an active member of the organization' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_selected_reader() FROM PUBLIC;
CREATE TRIGGER trg_validate_selected_reader BEFORE INSERT ON selected_reader
FOR EACH ROW EXECUTE FUNCTION validate_selected_reader();

CREATE TRIGGER trg_reader_selection_immutable
BEFORE UPDATE OR DELETE ON reader_selection
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();
CREATE TRIGGER trg_selected_reader_immutable
BEFORE UPDATE OR DELETE ON selected_reader
FOR EACH ROW EXECUTE FUNCTION reject_row_mutation();

-- Submit freezes exactly the draft's current selection; approval is recorded
-- later (T2.1) and never at insert.
CREATE FUNCTION validate_submission_reader_selection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NEW.approved_selection_id IS NOT NULL THEN
        RAISE EXCEPTION 'A submission cannot be created with approved readers' USING ERRCODE = '23514';
    END IF;
    IF NEW.shared_draft_id IS NOT NULL AND NEW.proposed_selection_id IS DISTINCT FROM (
        SELECT d.draft_selection_id FROM shared_draft d WHERE d.shared_draft_id = NEW.shared_draft_id) THEN
        RAISE EXCEPTION 'Submission must freeze the draft reader selection' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_submission_reader_selection() FROM PUBLIC;
CREATE TRIGGER trg_validate_submission_reader_selection BEFORE INSERT ON shared_submission
FOR EACH ROW EXECUTE FUNCTION validate_submission_reader_selection();

-- Same frozen tuple as 0022, plus the proposed readers. Approved readers may be
-- recorded once and never changed afterwards.
CREATE OR REPLACE FUNCTION protect_flow2_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_version_id IS NOT NULL AND
       (NEW.shared_draft_version_id, NEW.shared_draft_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_membership_id,
        NEW.target_scope_type, NEW.target_department_id, NEW.responsible_department_id,
        NEW.title, NEW.classification, NEW.team_tag, NEW.project_tag,
        NEW.audience_role_ids, NEW.policy_version, NEW.review_rule, NEW.content_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id, NEW.proposed_selection_id)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id, OLD.proposed_selection_id) THEN
        RAISE EXCEPTION 'Submitted snapshot is immutable' USING ERRCODE = '55000';
    END IF;
    IF OLD.approved_selection_id IS NOT NULL
       AND NEW.approved_selection_id IS DISTINCT FROM OLD.approved_selection_id THEN
        RAISE EXCEPTION 'Approved readers are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Read helpers for the API. They expose only identifiers/status within the
-- caller's current organization; the authorization decision itself is made by
-- TargetReaderPolicy in the API.
-- ---------------------------------------------------------------------------

-- Readers cannot read shared_submission rows, so the published library asks
-- for the approved selection of a current-organization approved submission.
CREATE FUNCTION publication_reader_selection_id(p_submission_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT s.approved_selection_id
      FROM shared_submission s
     WHERE s.submission_id = p_submission_id
       AND s.status = 'APPROVED'
       AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM organization_membership om
           WHERE om.organization_id = s.organization_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE');
$$;
REVOKE ALL ON FUNCTION publication_reader_selection_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publication_reader_selection_id(uuid) TO arden_runtime;

-- Members cannot read each other's membership rows. Draft validation needs
-- only status facts for the requested IDs inside the caller's organization;
-- unknown or foreign IDs are simply absent.
CREATE FUNCTION reader_selection_member_facts(p_membership_ids uuid[])
RETURNS TABLE (membership_id uuid, membership_status text, account_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT om.membership_id, om.status, ua.status = 'ACTIVE'
      FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id
     WHERE om.membership_id = ANY(p_membership_ids)
       AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND cardinality(p_membership_ids) <= 500
       AND EXISTS (SELECT 1 FROM organization_membership actor
           WHERE actor.organization_id = om.organization_id
             AND actor.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND actor.status = 'ACTIVE');
$$;
REVOKE ALL ON FUNCTION reader_selection_member_facts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reader_selection_member_facts(uuid[]) TO arden_runtime;

-- ---------------------------------------------------------------------------
-- RLS: organization isolation, same pattern as the Flow 2 tables. Any active
-- member of the current organization may read and create selections; nobody
-- may update or delete them.
-- ---------------------------------------------------------------------------

ALTER TABLE reader_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE reader_selection FORCE ROW LEVEL SECURITY;
ALTER TABLE selected_reader ENABLE ROW LEVEL SECURITY;
ALTER TABLE selected_reader FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON reader_selection TO arden_runtime;
GRANT SELECT, INSERT ON selected_reader TO arden_runtime;

CREATE POLICY reader_selection_member_read ON reader_selection
FOR SELECT TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership om
       WHERE om.organization_id = reader_selection.organization_id
         AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'));
CREATE POLICY reader_selection_member_insert ON reader_selection
FOR INSERT TO arden_runtime
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership om
       WHERE om.organization_id = reader_selection.organization_id
         AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'));

CREATE POLICY selected_reader_member_read ON selected_reader
FOR SELECT TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership om
       WHERE om.organization_id = selected_reader.organization_id
         AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'));
CREATE POLICY selected_reader_member_insert ON selected_reader
FOR INSERT TO arden_runtime
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership om
       WHERE om.organization_id = selected_reader.organization_id
         AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
         AND om.status = 'ACTIVE'));
