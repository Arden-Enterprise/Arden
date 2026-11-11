SET search_path TO arden, public;

-- Flow 2 T2.1 (BM04 RF-03): a reviewer approves the proposed Target Readers (P) as they are or narrows
-- them (A), never widens them. The API decides P → A (TargetReaderPolicy narrowing); the database
-- records A once, at approval, and carries it into the publication. Audience-group behaviour and the
-- legacy (no proposed readers) review path are unchanged.
--
-- No new SECURITY DEFINER routine is added overall: publication_reader_selection_id (0024) is replaced
-- by publication columns, reader_selection_member_facts is redefined under the same name, and one
-- reviewer-only directory function is added. The reviewed postgres-owned inventory stays at 18.

-- ---------------------------------------------------------------------------
-- 1. The decision row carries A; approval copies it to the submission.
-- ---------------------------------------------------------------------------

ALTER TABLE review_decision ADD COLUMN approved_selection_id uuid;
ALTER TABLE review_decision ADD CONSTRAINT fk_review_decision_approved_selection
    FOREIGN KEY (approved_selection_id) REFERENCES reader_selection(selection_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_review_decision_approved_selection
    ON review_decision (approved_selection_id) WHERE approved_selection_id IS NOT NULL;

-- Runs as the deciding reviewer: the submission and the selection are visible to them under RLS.
CREATE FUNCTION validate_review_decision_readers()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; selection_row record;
BEGIN
    SELECT s.organization_id, s.proposed_selection_id INTO STRICT submission_row
      FROM shared_submission s WHERE s.submission_id = NEW.submission_id;
    IF NEW.approved_selection_id IS NULL THEN
        IF NEW.flow2 AND NEW.decision = 'APPROVED' AND submission_row.proposed_selection_id IS NOT NULL THEN
            RAISE EXCEPTION 'Approving proposed readers must record the approved readers' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT NEW.flow2 OR NEW.decision <> 'APPROVED' OR submission_row.proposed_selection_id IS NULL
       OR NEW.approved_selection_id = submission_row.proposed_selection_id THEN
        RAISE EXCEPTION 'Approved readers belong only to an approval of proposed readers, as their own selection'
            USING ERRCODE = '23514';
    END IF;
    SELECT organization_id, created_at INTO selection_row FROM reader_selection
     WHERE selection_id = NEW.approved_selection_id;
    -- A is created in the deciding transaction; it is never a reused selection.
    IF NOT FOUND OR selection_row.organization_id IS DISTINCT FROM submission_row.organization_id
       OR selection_row.created_at <> transaction_timestamp() THEN
        RAISE EXCEPTION 'Approved readers must be a new selection of the same organization' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_review_decision_readers() FROM PUBLIC;
CREATE TRIGGER trg_validate_review_decision_readers BEFORE INSERT ON review_decision
FOR EACH ROW EXECUTE FUNCTION validate_review_decision_readers();

-- Same body as 0019, plus the approved readers in the same status-changing UPDATE.
CREATE OR REPLACE FUNCTION apply_review_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE new_generation_id uuid;
BEGIN
    UPDATE shared_submission
       SET status = NEW.decision,
           publication_state = CASE WHEN NEW.decision = 'APPROVED' THEN 'PREPARING' ELSE 'NONE' END,
           approved_selection_id = COALESCE(NEW.approved_selection_id, approved_selection_id)
     WHERE submission_id = NEW.submission_id;

    IF NEW.flow2 AND NEW.decision = 'APPROVED' THEN
        new_generation_id := gen_random_uuid();
        INSERT INTO knowledge_index_generation (
            generation_id, organization_id, submission_id, shared_draft_id,
            snapshot_version_id, snapshot_content_hash)
        SELECT new_generation_id, organization_id, submission_id, shared_draft_id,
               shared_draft_version_id, content_hash
          FROM shared_submission
         WHERE submission_id = NEW.submission_id;

        INSERT INTO knowledge_index_job (generation_id) VALUES (new_generation_id);
    END IF;
    RETURN NEW;
END;
$$;

GRANT UPDATE (approved_selection_id) ON shared_submission TO arden_runtime;

-- Same frozen tuple as 0024. approved_selection_id may be set exactly once: in the update that moves a
-- submission with proposed readers from PENDING_REVIEW to APPROVED. Such an approval must set it.
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
    IF NEW.approved_selection_id IS DISTINCT FROM OLD.approved_selection_id
       AND (OLD.approved_selection_id IS NOT NULL OR NEW.approved_selection_id IS NULL
            OR OLD.proposed_selection_id IS NULL
            OR OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'APPROVED') THEN
        RAISE EXCEPTION 'Approved readers are recorded once, at approval' USING ERRCODE = '55000';
    END IF;
    IF OLD.proposed_selection_id IS NOT NULL AND OLD.status = 'PENDING_REVIEW' AND NEW.status = 'APPROVED'
       AND NEW.approved_selection_id IS NULL THEN
        RAISE EXCEPTION 'Approving proposed readers must record the approved readers' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The publication carries A. The activation functions (0019/0021) are unchanged: these triggers
--    derive the column on insert, so complete_knowledge_index_job keeps its SECURITY DEFINER identity,
--    search_path, grants and monotonic activation. Legacy rows get NULL and keep the audience path.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM published_knowledge_version pv JOIN shared_submission s USING (submission_id)
                WHERE s.approved_selection_id IS NOT NULL) THEN
        -- Published versions are immutable (0018); a backfill would need an operator decision.
        RAISE EXCEPTION 'Publications with approved readers predate 0025; review before migrating';
    END IF;
END;
$$;

ALTER TABLE published_knowledge_version ADD COLUMN reader_selection_id uuid;
ALTER TABLE published_knowledge_version ADD CONSTRAINT fk_published_version_reader_selection
    FOREIGN KEY (reader_selection_id) REFERENCES reader_selection(selection_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE knowledge_current_publication ADD COLUMN reader_selection_id uuid;
ALTER TABLE knowledge_current_publication ADD CONSTRAINT fk_current_publication_reader_selection
    FOREIGN KEY (reader_selection_id) REFERENCES reader_selection(selection_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

-- STRICT fails closed: a submission the inserting role cannot see never yields an unrestricted publication.
CREATE FUNCTION assign_published_version_readers()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    SELECT s.approved_selection_id INTO STRICT NEW.reader_selection_id
      FROM shared_submission s WHERE s.submission_id = NEW.submission_id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION assign_published_version_readers() FROM PUBLIC;
CREATE TRIGGER trg_assign_published_version_readers BEFORE INSERT ON published_knowledge_version
FOR EACH ROW EXECUTE FUNCTION assign_published_version_readers();

CREATE FUNCTION assign_current_publication_readers()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    SELECT pv.reader_selection_id INTO STRICT NEW.reader_selection_id
      FROM published_knowledge_version pv WHERE pv.published_version_id = NEW.published_version_id;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION assign_current_publication_readers() FROM PUBLIC;
CREATE TRIGGER trg_assign_current_publication_readers
BEFORE INSERT OR UPDATE ON knowledge_current_publication
FOR EACH ROW EXECUTE FUNCTION assign_current_publication_readers();

-- ---------------------------------------------------------------------------
-- 3. Reading: RLS evaluates A too. The restrictive policy narrows every arden_runtime read of the
--    current pointer, and therefore the published version, the Ask Arden generation allow-list and
--    citation rechecks that depend on it. The API also applies TargetReaderPolicy.canRead.
-- ---------------------------------------------------------------------------

-- Same rule as TargetReaderPolicy.canRead. Invoker rights: every table it reads is visible to the
-- actor for their own membership and their organization's selections.
CREATE FUNCTION actor_in_reader_selection(p_selection_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM reader_selection rs
          JOIN organization_membership om
            ON om.organization_id = rs.organization_id AND om.status = 'ACTIVE'
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
         WHERE rs.selection_id = p_selection_id
           AND rs.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND (rs.reader_mode = 'ORGANIZATION'
             OR (rs.reader_mode = 'DEPARTMENT' AND EXISTS (
                 SELECT 1 FROM department_membership dm
                   JOIN department d ON d.department_id = dm.department_id
                                    AND d.organization_id = rs.organization_id AND d.status = 'ACTIVE'
                  WHERE dm.membership_id = om.membership_id AND dm.department_id = rs.department_id
                    AND dm.status = 'ACTIVE'))
             OR (rs.reader_mode = 'SELECTED_MEMBERS' AND EXISTS (
                 SELECT 1 FROM selected_reader sr
                  WHERE sr.selection_id = rs.selection_id AND sr.membership_id = om.membership_id))));
$$;
REVOKE ALL ON FUNCTION actor_in_reader_selection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_in_reader_selection(uuid) TO arden_runtime;

CREATE POLICY target_readers_current_publication_read ON knowledge_current_publication
AS RESTRICTIVE FOR SELECT TO arden_runtime
USING (reader_selection_id IS NULL OR actor_in_reader_selection(reader_selection_id));

-- Replaced by published_knowledge_version.reader_selection_id.
DROP FUNCTION publication_reader_selection_id(uuid);

-- ---------------------------------------------------------------------------
-- 4. Reviewer facts. Same name and gate as 0024, now with each member's current departments for the
--    DEPARTMENT d → SELECTED_MEMBERS rule.
-- ---------------------------------------------------------------------------

DROP FUNCTION reader_selection_member_facts(uuid[]);
CREATE FUNCTION reader_selection_member_facts(p_membership_ids uuid[])
RETURNS TABLE (membership_id uuid, membership_status text, account_active boolean, department_ids uuid[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT om.membership_id, om.status, ua.status = 'ACTIVE',
           ARRAY(SELECT dm.department_id FROM department_membership dm
                   JOIN department d ON d.department_id = dm.department_id
                                    AND d.organization_id = om.organization_id AND d.status = 'ACTIVE'
                  WHERE dm.membership_id = om.membership_id AND dm.status = 'ACTIVE'
                  ORDER BY dm.department_id)
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

-- Names of the proposed readers of one pending submission, for its reviewers only (T2.2 narrowing UI).
-- Members cannot otherwise read each other's profiles. The API applies the exact review rule first;
-- this gate is the database backstop: an Org Admin, or a reviewer grant holder who is not the author.
CREATE FUNCTION submission_proposed_reader_directory(p_submission_id uuid)
RETURNS TABLE (membership_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT sr.membership_id, COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
      FROM shared_submission s
      JOIN selected_reader sr ON sr.selection_id = s.proposed_selection_id
      JOIN organization_membership om ON om.membership_id = sr.membership_id
      JOIN user_account ua ON ua.user_id = om.user_id
      JOIN organization_membership actor
        ON actor.organization_id = s.organization_id AND actor.status = 'ACTIVE'
       AND actor.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
     WHERE s.submission_id = p_submission_id
       AND s.status = 'PENDING_REVIEW'
       AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND (EXISTS (SELECT 1 FROM role_assignment ra
               JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
               JOIN access_scope scope ON scope.access_scope_id = ra.access_scope_id
                AND scope.organization_id = s.organization_id AND scope.scope_type = 'ORGANIZATION'
                AND scope.status = 'ACTIVE'
              WHERE ra.membership_id = actor.membership_id AND ra.status = 'ACTIVE'
                AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now()))
         OR (actor.membership_id <> s.submitted_by_membership_id
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)))
     ORDER BY sr.ordinal;
$$;
REVOKE ALL ON FUNCTION submission_proposed_reader_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission_proposed_reader_directory(uuid) TO arden_runtime;
