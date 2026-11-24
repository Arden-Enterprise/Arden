SET search_path TO arden, public;

-- Decision 0032: expired publications are hidden from ordinary readers but never auto-withdrawn, and a
-- reviewed RENEWAL request changes only their validity.
--   * Expiry is the publication's Valid until, inclusive through its UTC day (0030). A renewal approved for the
--     current published version records the new date (or no expiry) in publication_validity_renewal; the
--     frozen snapshot metadata is never rewritten. A newer content version uses its own Valid until.
--   * RENEWAL is a change request beside READER_CHANGE and WITHDRAWAL. The author may ask at any time; an
--     Organization Admin or a responsible reviewer may ask on the author's behalf from 7 days before expiry,
--     or at once when the author's membership is no longer active. Decision 0033 (as amended into 0032): an
--     active author decides a renewal asked on their behalf, alone during a priority window (3 days or until
--     expiry); a reviewer whose current grant matches may decide their own submissions of every type.
--   * In-app reminders at 30 days (author; responsible reviewers when the author is inactive) and 7 days
--     (responsible reviewers, when no renewal is waiting) are written idempotently by a periodic Core job.
--
-- Operator rollout: replaces six reviewed SECURITY DEFINER routines in place (validate_shared_submission,
-- validate_review_decision, apply_publication_change, eligible_ai_publications, review_submission_authors,
-- submission_proposed_reader_directory; owners unchanged) and adds five (request_publication_renewal,
-- list_publication_renewal_state, enqueue_publication_expiry_reminders, list_publication_author_names,
-- decide_on_behalf_renewal; 52 in the owner inventory). Apply as the trusted superuser. The review-decision
-- insert policy no longer excludes the submitter (decision 0033); authority still needs a current grant or
-- Organization Admin, and the author's own decision on an on-behalf renewal runs only through the reviewed routine.

ALTER TABLE shared_submission ADD COLUMN renewal_expiration_date date;
ALTER TABLE shared_submission ADD COLUMN on_behalf_of_author boolean NOT NULL DEFAULT false;
-- Set when someone asks on behalf of an active author: until then only that author may decide (0032).
ALTER TABLE shared_submission ADD COLUMN author_decides_until timestamptz;
ALTER TABLE shared_submission DROP CONSTRAINT ck_shared_submission_request_type;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_request_type
    CHECK (request_type IN ('CONTENT', 'READER_CHANGE', 'WITHDRAWAL', 'RENEWAL'));
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_renewal_shape CHECK (
    (request_type = 'RENEWAL' AND proposed_selection_id IS NULL)
    OR (request_type <> 'RENEWAL' AND renewal_expiration_date IS NULL AND NOT on_behalf_of_author));
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_author_window
    CHECK (author_decides_until IS NULL OR (request_type = 'RENEWAL' AND on_behalf_of_author));
-- Serializes concurrent requests from the author and from someone acting on their behalf.
CREATE UNIQUE INDEX uq_pending_publication_renewal ON shared_submission (shared_draft_id)
    WHERE request_type = 'RENEWAL' AND status = 'PENDING_REVIEW';

CREATE TABLE publication_validity_renewal (
    published_version_id  uuid PRIMARY KEY REFERENCES published_knowledge_version(published_version_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    organization_id       uuid NOT NULL REFERENCES organization(organization_id),
    shared_draft_id       uuid NOT NULL REFERENCES shared_draft(shared_draft_id),
    expiration_date       date,
    renewal_submission_id uuid NOT NULL UNIQUE REFERENCES shared_submission(submission_id),
    renewed_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE publication_validity_renewal ENABLE ROW LEVEL SECURITY;
ALTER TABLE publication_validity_renewal FORCE ROW LEVEL SECURITY;
GRANT SELECT ON publication_validity_renewal TO arden_runtime;
-- A renewed date is visible only with a publication the caller can already read (publication RLS applies).
CREATE POLICY publication_validity_renewal_reader ON publication_validity_renewal FOR SELECT TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM published_knowledge_version pv
        WHERE pv.published_version_id = publication_validity_renewal.published_version_id));

-- Effective Valid until of one published version: an approved renewal, otherwise the frozen snapshot date.
CREATE FUNCTION publication_expiration_date(p_published_version_id uuid, p_management jsonb)
RETURNS date LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT CASE WHEN r.published_version_id IS NOT NULL THEN r.expiration_date
                ELSE NULLIF(p_management->>'expirationDate', '')::date END
      FROM (SELECT 1) AS one
      LEFT JOIN publication_validity_renewal r ON r.published_version_id = p_published_version_id
$$;
REVOKE ALL ON FUNCTION publication_expiration_date(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publication_expiration_date(uuid, jsonb) TO arden_runtime;

-- 0034 tuple plus the renewal columns.
CREATE OR REPLACE FUNCTION protect_flow2_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_version_id IS NOT NULL AND
       (NEW.shared_draft_version_id, NEW.shared_draft_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_membership_id,
        NEW.target_scope_type, NEW.target_department_id, NEW.responsible_department_id,
        NEW.title, NEW.classification, NEW.team_tag, NEW.project_tag,
        NEW.audience_role_ids, NEW.policy_version, NEW.review_rule, NEW.content_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id, NEW.proposed_selection_id,
        NEW.category_id, NEW.keywords, NEW.change_description,
        NEW.request_type, NEW.request_reason, NEW.target_published_version_id,
        NEW.renewal_expiration_date, NEW.on_behalf_of_author, NEW.author_decides_until)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id, OLD.proposed_selection_id,
        OLD.category_id, OLD.keywords, OLD.change_description,
        OLD.request_type, OLD.request_reason, OLD.target_published_version_id,
        OLD.renewal_expiration_date, OLD.on_behalf_of_author, OLD.author_decides_until) THEN
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

-- 0034 rules for content and other change requests, unchanged; RENEWAL is validated first.
CREATE OR REPLACE FUNCTION validate_shared_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE source_org uuid; submitter_org uuid; department_org uuid; source_row record; published_row record;
    renewal_row record; author_active boolean;
BEGIN
    SELECT organization_id INTO STRICT submitter_org FROM organization_membership
     WHERE membership_id = NEW.submitted_by_membership_id;
    -- Decision 0032: a renewal changes only validity. The author may ask at any time; an Organization Admin
    -- or a responsible reviewer may ask on the author's behalf from 7 days before expiry (or after it), or at
    -- once when the author's membership is no longer active. One renewal request may wait at a time.
    IF NEW.request_type = 'RENEWAL' THEN
        SELECT g.*, publication_expiration_date(g.published_version_id, pv.management) AS expires_on,
               d.status AS draft_status
          INTO renewal_row
          FROM governance_current_publication g
          JOIN published_knowledge_version pv ON pv.published_version_id = g.published_version_id
          JOIN shared_draft d ON d.shared_draft_id = g.shared_draft_id
         WHERE g.shared_draft_id = NEW.shared_draft_id AND g.organization_id = NEW.organization_id
           AND g.published_version_id = NEW.target_published_version_id;
        IF NOT FOUND OR renewal_row.draft_status <> 'ACTIVE'
            OR submitter_org IS DISTINCT FROM NEW.organization_id
            OR renewal_row.submission_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM shared_submission released
                 WHERE released.submission_id = renewal_row.submission_id
                   AND released.shared_draft_version_id IS NOT DISTINCT FROM NEW.shared_draft_version_id
                   AND released.content_hash IS NOT DISTINCT FROM NEW.content_hash
                   AND released.snapshot_version_no IS NOT DISTINCT FROM NEW.snapshot_version_no) THEN
            RAISE EXCEPTION 'A renewal request must name the current publication' USING ERRCODE = '23514';
        END IF;
        IF renewal_row.expires_on IS NULL THEN
            RAISE EXCEPTION 'This publication has no expiry to renew' USING ERRCODE = '23514';
        END IF;
        IF NEW.renewal_expiration_date IS NOT NULL
           AND NEW.renewal_expiration_date <= (now() AT TIME ZONE 'UTC')::date THEN
            RAISE EXCEPTION 'A renewal must end after today or have no expiry' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM shared_submission other WHERE other.shared_draft_id = NEW.shared_draft_id
                     AND other.request_type = 'RENEWAL' AND other.status = 'PENDING_REVIEW'
                     AND other.submission_id <> NEW.submission_id) THEN
            RAISE EXCEPTION 'A renewal request is already waiting for review' USING ERRCODE = '23505';
        END IF;
        author_active := EXISTS (SELECT 1 FROM organization_membership om
            JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
            WHERE om.membership_id = renewal_row.submitted_by_membership_id AND om.status = 'ACTIVE');
        IF NEW.submitted_by_membership_id = renewal_row.submitted_by_membership_id THEN
            IF NEW.on_behalf_of_author THEN
                RAISE EXCEPTION 'The author renews in their own name' USING ERRCODE = '23514';
            END IF;
        ELSIF NOT NEW.on_behalf_of_author
            OR NOT (governance_is_org_admin(NEW.submitted_by_membership_id, NEW.organization_id)
                 OR governance_is_responsible_reviewer(NEW.submitted_by_membership_id, NEW.organization_id,
                        renewal_row.responsible_department_id, renewal_row.reader_mode))
            OR NOT EXISTS (SELECT 1 FROM organization_membership om
                 JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
                 WHERE om.membership_id = NEW.submitted_by_membership_id AND om.status = 'ACTIVE')
            OR (author_active AND renewal_row.expires_on > (now() AT TIME ZONE 'UTC')::date + 7) THEN
            RAISE EXCEPTION 'Renewal on behalf of the author is not available' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.request_type <> 'CONTENT' THEN
        SELECT s.shared_draft_version_id, s.content_hash, s.snapshot_version_no, d.author_membership_id,
               d.organization_id, d.status
          INTO published_row
          FROM knowledge_current_publication cp
          JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
          JOIN shared_submission s ON s.submission_id = pv.submission_id
          JOIN shared_draft d ON d.shared_draft_id = cp.shared_draft_id
         WHERE cp.shared_draft_id = NEW.shared_draft_id
           AND cp.published_version_id = NEW.target_published_version_id;
        IF NOT FOUND
            OR published_row.status <> 'ACTIVE'
            OR published_row.organization_id IS DISTINCT FROM NEW.organization_id
            OR published_row.organization_id IS DISTINCT FROM submitter_org
            OR published_row.author_membership_id IS DISTINCT FROM NEW.submitted_by_membership_id
            OR published_row.shared_draft_version_id IS DISTINCT FROM NEW.shared_draft_version_id
            OR published_row.content_hash IS DISTINCT FROM NEW.content_hash
            OR published_row.snapshot_version_no IS DISTINCT FROM NEW.snapshot_version_no THEN
            RAISE EXCEPTION 'A change request must come from the author and name the current publication'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.shared_draft_version_id IS NOT NULL THEN
        SELECT d.shared_draft_id, d.organization_id, d.author_membership_id, d.status,
               d.responsible_department_id,
               d.target_scope_type, d.title, d.classification, d.team_tag, d.project_tag,
               d.current_version_no, v.version_no, v.content_uri, v.mime_type, v.content_hash,
               ARRAY(SELECT a.role_id FROM shared_draft_audience a
                     WHERE a.shared_draft_id = d.shared_draft_id ORDER BY a.role_id) AS audience_ids
          INTO STRICT source_row
          FROM shared_draft_version v JOIN shared_draft d ON d.shared_draft_id = v.shared_draft_id
         WHERE v.shared_draft_version_id = NEW.shared_draft_version_id;
        IF source_row.status <> 'ACTIVE'
            OR source_row.shared_draft_id IS DISTINCT FROM NEW.shared_draft_id
            OR source_row.organization_id IS DISTINCT FROM submitter_org
            OR source_row.organization_id IS DISTINCT FROM NEW.organization_id
            OR source_row.author_membership_id IS DISTINCT FROM NEW.submitted_by_membership_id
            OR source_row.current_version_no IS DISTINCT FROM source_row.version_no
            OR source_row.version_no IS DISTINCT FROM NEW.snapshot_version_no
            OR source_row.responsible_department_id IS DISTINCT FROM NEW.responsible_department_id
            OR source_row.target_scope_type IS DISTINCT FROM NEW.target_scope_type
            OR source_row.title IS DISTINCT FROM NEW.title
            OR source_row.classification IS DISTINCT FROM NEW.classification
            OR source_row.team_tag IS DISTINCT FROM NEW.team_tag
            OR source_row.project_tag IS DISTINCT FROM NEW.project_tag
            OR source_row.content_uri IS DISTINCT FROM NEW.content_uri
            OR source_row.mime_type IS DISTINCT FROM NEW.mime_type
            OR source_row.content_hash IS DISTINCT FROM NEW.content_hash
            OR source_row.audience_ids IS DISTINCT FROM NEW.audience_role_ids THEN
            RAISE EXCEPTION 'Submission must freeze the author-owned current shared draft snapshot'
                USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(NEW.audience_role_ids) AS audience(role_id)
            LEFT JOIN role r ON r.role_id = audience.role_id
            WHERE r.role_id IS NULL OR r.organization_id IS DISTINCT FROM NEW.organization_id
               OR r.status <> 'ACTIVE' OR r.is_system
               OR NOT EXISTS (SELECT 1 FROM role_permission rp JOIN permission p
                   ON p.permission_id = rp.permission_id
                   WHERE rp.role_id = r.role_id AND p.code = 'PUBLISHED_CONTENT_VIEW')) THEN
            RAISE EXCEPTION 'Submission audience is not enforceable' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM department d
            WHERE d.department_id = NEW.responsible_department_id
              AND d.organization_id = NEW.organization_id AND d.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'Responsible department is not active' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT owner_membership.organization_id INTO STRICT source_org
          FROM draft_version v
          JOIN draft_document d ON d.draft_id = v.draft_id
          JOIN private_workspace w ON w.workspace_id = d.workspace_id
          JOIN organization_membership owner_membership ON owner_membership.membership_id = w.membership_id
         WHERE v.draft_version_id = NEW.draft_version_id;
        IF source_org <> submitter_org THEN
            RAISE EXCEPTION 'Submission cannot cross organization boundaries' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.target_department_id IS NOT NULL THEN
        SELECT organization_id INTO STRICT department_org FROM department WHERE department_id = NEW.target_department_id;
        IF department_org <> submitter_org THEN
            RAISE EXCEPTION 'Target department belongs to another organization' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;


-- 0035 behaviour for reader changes and withdrawals, plus RENEWAL.
CREATE OR REPLACE FUNCTION apply_publication_change(p_submission_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE request record; current_version uuid;
BEGIN
    -- Only the review_decision trigger may apply an approval. Direct runtime calls could otherwise
    -- replay an older reader change after a later approval and restore readers that were removed.
    IF pg_trigger_depth() <> 1 THEN
        RAISE EXCEPTION 'Publication changes apply only inside a review decision' USING ERRCODE = '55000';
    END IF;
    SELECT s.request_type, s.shared_draft_id, s.target_published_version_id, s.approved_selection_id, s.status,
           s.organization_id, s.renewal_expiration_date, s.on_behalf_of_author, s.submitted_by_membership_id
      INTO request FROM shared_submission s WHERE s.submission_id = p_submission_id;
    IF NOT FOUND OR request.status <> 'APPROVED' OR request.request_type = 'CONTENT' THEN
        RAISE EXCEPTION 'Only an approved change request can be applied' USING ERRCODE = '55000';
    END IF;
    -- Same lock as activation (0021), so a pointer change and an activation of this document serialize.
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = request.shared_draft_id FOR UPDATE;
    SELECT cp.published_version_id INTO current_version
      FROM knowledge_current_publication cp WHERE cp.shared_draft_id = request.shared_draft_id FOR UPDATE;
    IF current_version IS DISTINCT FROM request.target_published_version_id THEN
        RAISE EXCEPTION 'The publication changed after the request was made' USING ERRCODE = '40001';
    END IF;

    IF request.request_type = 'RENEWAL' THEN
        -- Only validity changes: content, readers, owner, history and reports stay as they are.
        INSERT INTO publication_validity_renewal (published_version_id, organization_id, shared_draft_id,
            expiration_date, renewal_submission_id)
        VALUES (current_version, request.organization_id, request.shared_draft_id,
            request.renewal_expiration_date, p_submission_id)
        ON CONFLICT (published_version_id) DO UPDATE
           SET expiration_date = EXCLUDED.expiration_date,
               renewal_submission_id = EXCLUDED.renewal_submission_id, renewed_at = now();
        INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
        VALUES (request.organization_id, request.submitted_by_membership_id, 'KNOWLEDGE_PUBLICATION_RENEWED',
            'SUCCESS', jsonb_build_object('documentId', request.shared_draft_id, 'publishedVersionId', current_version,
                'submissionId', p_submission_id, 'expirationDate', request.renewal_expiration_date,
                'onBehalfOfAuthor', request.on_behalf_of_author));
    ELSIF request.request_type = 'READER_CHANGE' THEN
        IF request.approved_selection_id IS NULL THEN
            RAISE EXCEPTION 'A reader change needs approved readers' USING ERRCODE = '23514';
        END IF;
        UPDATE published_knowledge_version SET reader_selection_id = request.approved_selection_id
         WHERE published_version_id = current_version;
        -- assign_current_publication_readers copies the published version's readers to the pointer.
        UPDATE knowledge_current_publication SET updated_at = now() WHERE shared_draft_id = request.shared_draft_id;
    ELSE
        IF EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = request.shared_draft_id
                     AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING') THEN
            RAISE EXCEPTION 'A newer version is being prepared; withdraw after it finishes' USING ERRCODE = '40001';
        END IF;
        UPDATE shared_submission SET publication_state = 'WITHDRAWN'
         WHERE submission_id = (SELECT pv.submission_id FROM published_knowledge_version pv
                                 WHERE pv.published_version_id = current_version);
        DELETE FROM knowledge_current_publication WHERE shared_draft_id = request.shared_draft_id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION apply_publication_change(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_publication_change(uuid) TO arden_runtime;

-- 0063 eligibility with the effective (renewed) Valid until.
CREATE OR REPLACE FUNCTION eligible_ai_publications() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT pv.published_version_id
      FROM knowledge_current_publication cp
      JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
           AND pv.shared_draft_id = cp.shared_draft_id
      JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
     WHERE cp.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND kb.organization_id = cp.organization_id
       AND cp.valid_from <= now() AND (cp.valid_until IS NULL OR cp.valid_until > now())
       AND pv.published_at <= now() AND pv.index_status = 'INDEXED'
       AND (publication_expiration_date(pv.published_version_id, pv.management) IS NULL
            OR publication_expiration_date(pv.published_version_id, pv.management) >= (now() AT TIME ZONE 'UTC')::date)
       AND EXISTS (
           SELECT 1 FROM organization_membership m
             JOIN user_account u USING (user_id) JOIN organization o USING (organization_id)
            WHERE m.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND m.organization_id = cp.organization_id
              AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
              AND CASE WHEN pv.reader_selection_id IS NOT NULL
                  THEN actor_in_reader_selection(pv.reader_selection_id)
                  ELSE m.membership_id IN (
                      SELECT audience_reader_memberships(cp.organization_id, pv.audience_role_ids,
                          kb.scope_type, kb.department_id))
                  END
       );
$$;
REVOKE ALL ON FUNCTION eligible_ai_publications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eligible_ai_publications() TO arden_runtime;

-- In-app notices (0025): expiry reminders and renewals asked for on the author's behalf.
ALTER TABLE arden_notification ADD COLUMN expires_on date;
ALTER TABLE arden_notification ADD COLUMN request_reason text;
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_event_type;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_event_type CHECK (event_type IN (
    'REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED', 'PUBLICATION_ACTIVE',
    'PUBLICATION_FAILED', 'DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP', 'PRIMARY_DEPARTMENT_CHANGED',
    'REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED', 'PUBLICATION_EXPIRING', 'PUBLICATION_RENEWAL_ON_BEHALF'));
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_resource;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_resource CHECK (
    (event_type IN ('REVIEW_REQUESTED', 'REVIEW_APPROVED', 'REVIEW_REJECTED',
        'PUBLICATION_ACTIVE', 'PUBLICATION_FAILED') AND resource_type = 'SUBMISSION' AND resource_id IS NOT NULL)
    OR (event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
        AND resource_type = 'PUBLICATION' AND resource_id IS NOT NULL)
    OR (event_type IN ('PUBLICATION_EXPIRING', 'PUBLICATION_RENEWAL_ON_BEHALF')
        AND resource_type = 'DOCUMENT' AND resource_id IS NOT NULL)
    OR (event_type = 'PRIMARY_DEPARTMENT_CHANGED' AND resource_type = 'DEPARTMENT' AND resource_id IS NOT NULL)
    OR (event_type IN ('REVIEWER_GRANT_CREATED', 'REVIEWER_GRANT_REVOKED')
        AND resource_type = 'REVIEWER_GRANT' AND resource_id IS NOT NULL));
ALTER TABLE arden_notification DROP CONSTRAINT ck_arden_notification_share_details;
ALTER TABLE arden_notification ADD CONSTRAINT ck_arden_notification_share_details CHECK (
    (event_type IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP')
        AND char_length(btrim(publication_title)) > 0 AND char_length(btrim(shared_by_name)) > 0
        AND expires_on IS NULL AND request_reason IS NULL)
    OR (event_type = 'PUBLICATION_EXPIRING'
        AND char_length(btrim(publication_title)) > 0 AND expires_on IS NOT NULL
        AND shared_by_name IS NULL AND request_reason IS NULL)
    OR (event_type = 'PUBLICATION_RENEWAL_ON_BEHALF'
        AND char_length(btrim(publication_title)) > 0 AND char_length(btrim(shared_by_name)) > 0
        AND char_length(btrim(request_reason)) BETWEEN 1 AND 1000 AND expires_on IS NULL)
    OR (event_type NOT IN ('DOCUMENT_SHARED_PERSONAL', 'DOCUMENT_SHARED_GROUP', 'PUBLICATION_EXPIRING',
            'PUBLICATION_RENEWAL_ON_BEHALF')
        AND publication_title IS NULL AND shared_by_name IS NULL AND expires_on IS NULL AND request_reason IS NULL));

-- Owner-context helper: active member display name (never an email fallback for other members).
CREATE FUNCTION renewal_member_name(p_membership_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT COALESCE(NULLIF(btrim(ua.full_name), ''), 'A colleague')
      FROM organization_membership om JOIN user_account ua ON ua.user_id = om.user_id
     WHERE om.membership_id = p_membership_id
$$;
REVOKE ALL ON FUNCTION renewal_member_name(uuid) FROM PUBLIC;

-- Owner-context helper: whether a membership and its account are active.
CREATE FUNCTION renewal_member_active(p_membership_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM organization_membership om
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
     WHERE om.membership_id = p_membership_id AND om.status = 'ACTIVE')
$$;
REVOKE ALL ON FUNCTION renewal_member_active(uuid) FROM PUBLIC;

-- Requests a renewal of the current publication as the calling member. Authority is re-derived here and
-- again by validate_shared_submission. Returns REQUESTED/REPLAYED with the submission, or NOT_FOUND,
-- NOT_RENEWABLE (no expiry), NOT_YET (on-behalf window not open), PENDING, INVALID_DATE, INVALID_REASON.
CREATE FUNCTION request_publication_renewal(p_document_id uuid, p_expiration_date date, p_reason text,
    p_request_id uuid)
RETURNS TABLE (outcome text, submission_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row record;
    released shared_submission%ROWTYPE;
    replay shared_submission%ROWTYPE;
    on_behalf boolean;
    created uuid;
    today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    IF actor IS NULL OR p_request_id IS NULL THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid; RETURN; END IF;
    SELECT * INTO replay FROM shared_submission s
     WHERE s.submitted_by_membership_id = actor AND s.submit_request_id = p_request_id;
    IF FOUND THEN
        RETURN QUERY SELECT CASE WHEN replay.shared_draft_id = p_document_id AND replay.request_type = 'RENEWAL'
            THEN 'REPLAYED' ELSE 'PENDING' END, replay.submission_id;
        RETURN;
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RETURN QUERY SELECT 'INVALID_REASON'::text, NULL::uuid; RETURN;
    END IF;
    -- Same lock as activation, withdrawal and approved changes (0021/0035/0038).
    PERFORM 1 FROM shared_draft d WHERE d.shared_draft_id = p_document_id AND d.organization_id = org
        AND d.status = 'ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid; RETURN; END IF;
    SELECT g.*, publication_expiration_date(g.published_version_id, pv.management) AS expires_on
      INTO current_row
      FROM governance_current_publication g
      JOIN published_knowledge_version pv ON pv.published_version_id = g.published_version_id
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org;
    IF NOT FOUND OR current_row.submission_id IS NULL THEN
        RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid; RETURN;
    END IF;
    on_behalf := current_row.submitted_by_membership_id IS DISTINCT FROM actor;
    IF on_behalf AND NOT (governance_is_org_admin(actor, org)
        OR governance_is_responsible_reviewer(actor, org, current_row.responsible_department_id, current_row.reader_mode)) THEN
        RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid; RETURN;
    END IF;
    IF current_row.expires_on IS NULL THEN RETURN QUERY SELECT 'NOT_RENEWABLE'::text, NULL::uuid; RETURN; END IF;
    IF on_behalf AND renewal_member_active(current_row.submitted_by_membership_id)
       AND current_row.expires_on > today + 7 THEN
        RETURN QUERY SELECT 'NOT_YET'::text, NULL::uuid; RETURN;
    END IF;
    IF p_expiration_date IS NOT NULL AND p_expiration_date <= today THEN
        RETURN QUERY SELECT 'INVALID_DATE'::text, NULL::uuid; RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = p_document_id
                 AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW') THEN
        RETURN QUERY SELECT 'PENDING'::text, NULL::uuid; RETURN;
    END IF;
    SELECT * INTO STRICT released FROM shared_submission s WHERE s.submission_id = current_row.submission_id;
    -- Repeats the released snapshot so the request routes to the same reviewers (0013/0015).
    INSERT INTO shared_submission (organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no,
        submitted_by_membership_id, target_scope_type, target_department_id, responsible_department_id, title,
        classification, team_tag, project_tag, audience_role_ids, policy_version, review_rule, content_uri, mime_type,
        content_hash, submit_request_id, request_type, request_reason, target_published_version_id,
        renewal_expiration_date, on_behalf_of_author, author_decides_until)
    VALUES (released.organization_id, released.shared_draft_id, released.shared_draft_version_id,
        released.snapshot_version_no, actor, released.target_scope_type, released.target_department_id,
        released.responsible_department_id, released.title, released.classification, released.team_tag,
        released.project_tag, released.audience_role_ids, released.policy_version, released.review_rule,
        released.content_uri, released.mime_type, released.content_hash, p_request_id, 'RENEWAL', btrim(p_reason),
        current_row.published_version_id, p_expiration_date, on_behalf,
        -- The active author's priority window: 3 days, or until the end of the Valid until day if earlier.
        CASE WHEN on_behalf AND renewal_member_active(current_row.submitted_by_membership_id)
             THEN LEAST(now() + interval '3 days', ((current_row.expires_on + 1)::timestamp AT TIME ZONE 'UTC')) END)
    RETURNING shared_submission.submission_id INTO created;
    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (org, actor, 'KNOWLEDGE_CHANGE_REQUESTED', 'SUCCESS', jsonb_build_object('submissionId', created,
        'draftId', p_document_id, 'requestType', 'RENEWAL', 'publishedVersionId', current_row.published_version_id,
        'expirationDate', p_expiration_date, 'onBehalfOfAuthor', on_behalf, 'requestedBy', actor));
    -- Someone else renewed: tell the active author who asked and why (0032 B4).
    IF on_behalf AND renewal_member_active(current_row.submitted_by_membership_id) THEN
        WITH notice AS (
            INSERT INTO arden_notification (organization_id, recipient_membership_id, event_key, event_type,
                resource_type, resource_id, publication_title, shared_by_name, request_reason)
            VALUES (org, current_row.submitted_by_membership_id, 'renewal:' || created::text || ':author',
                'PUBLICATION_RENEWAL_ON_BEHALF', 'DOCUMENT', p_document_id, current_row.title,
                renewal_member_name(actor), btrim(p_reason))
            ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
            RETURNING notification_id)
        INSERT INTO arden_notification_outbox (notification_id, organization_id)
        SELECT notice.notification_id, org FROM notice;
    END IF;
    RETURN QUERY SELECT 'REQUESTED'::text, created;
END;
$$;
REVOKE ALL ON FUNCTION request_publication_renewal(uuid, date, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_publication_renewal(uuid, date, text, uuid) TO arden_runtime;

-- Periodic, idempotent reminder fan-out (decision 0032 C). One notice per recipient, published version,
-- Valid until and threshold; a renewal changes the date, so the next cycle can remind again.
CREATE FUNCTION enqueue_publication_expiry_reminders()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    today date := (now() AT TIME ZONE 'UTC')::date;
    written integer;
BEGIN
    WITH due AS (
        SELECT g.organization_id, g.shared_draft_id, g.published_version_id, g.title, g.responsible_department_id,
               g.reader_mode, g.submitted_by_membership_id AS author_id, e.expires_on,
               renewal_member_active(g.submitted_by_membership_id) AS author_is_active,
               EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = g.shared_draft_id
                         AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW') AS pending
          FROM governance_current_publication g
          JOIN published_knowledge_version pv ON pv.published_version_id = g.published_version_id
          JOIN organization o ON o.organization_id = g.organization_id AND o.status = 'ACTIVE'
          CROSS JOIN LATERAL (SELECT publication_expiration_date(g.published_version_id, pv.management) AS expires_on) e
         WHERE e.expires_on BETWEEN today AND today + 30
    ), recipients AS (
        SELECT d.*, d.author_id AS recipient, '30' AS threshold FROM due d WHERE d.author_is_active
        UNION ALL
        SELECT d.*, om.membership_id, CASE WHEN d.author_is_active THEN '7' ELSE '30' END
          FROM due d
          JOIN organization_membership om ON om.organization_id = d.organization_id
         WHERE om.membership_id <> d.author_id AND renewal_member_active(om.membership_id)
           AND governance_is_responsible_reviewer(om.membership_id, d.organization_id,
                   d.responsible_department_id, d.reader_mode)
           AND (NOT d.author_is_active OR (d.expires_on <= today + 7 AND NOT d.pending))
    ), notices AS (
        INSERT INTO arden_notification (organization_id, recipient_membership_id, event_key, event_type,
            resource_type, resource_id, publication_title, expires_on)
        SELECT r.organization_id, r.recipient,
               'expiry:' || r.published_version_id::text || ':' || r.expires_on::text || ':' || r.threshold,
               'PUBLICATION_EXPIRING', 'DOCUMENT', r.shared_draft_id, r.title, r.expires_on
          FROM recipients r
        ON CONFLICT (event_key, recipient_membership_id) DO NOTHING
        RETURNING notification_id, organization_id)
    INSERT INTO arden_notification_outbox (notification_id, organization_id)
    SELECT notification_id, organization_id FROM notices;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_publication_expiry_reminders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_publication_expiry_reminders() TO arden_runtime;

-- Home AUTHOR column (decision 0032 E): the display name of an active author, only for current publications
-- the caller may read now (same eligibility as Company AI). Never an email, reviewer or inactive member.
CREATE FUNCTION list_publication_author_names(p_published_version_ids uuid[])
RETURNS TABLE (published_version_id uuid, author_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT g.published_version_id, NULLIF(btrim(ua.full_name), '')
      FROM governance_current_publication g
      JOIN organization_membership om ON om.membership_id = g.submitted_by_membership_id AND om.status = 'ACTIVE'
      JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
     WHERE g.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND cardinality(p_published_version_ids) <= 1000
       AND g.published_version_id = ANY(p_published_version_ids)
       AND g.published_version_id IN (SELECT eligible_ai_publications())
       AND NULLIF(btrim(ua.full_name), '') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION list_publication_author_names(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_publication_author_names(uuid[]) TO arden_runtime;

-- ---------------------------------------------------------------------------------------------------------
-- Decision 0033 (reviewer self-approval) and the 0032 renewal decision order.

-- Owner-context helper: who decides an on-behalf renewal first, and until when. The window is fixed when the
-- request is made (author_decides_until), so the renewal's own effect cannot move it; the author must still be
-- active when the decision is made.
CREATE FUNCTION renewal_author_window(p_submission_id uuid)
RETURNS TABLE (author_membership_id uuid, author_active boolean, window_until timestamptz)
LANGUAGE sql STABLE SET search_path = arden, pg_temp AS $$
    SELECT d.author_membership_id, renewal_member_active(d.author_membership_id), s.author_decides_until
      FROM shared_submission s
      JOIN shared_draft d ON d.shared_draft_id = s.shared_draft_id
     WHERE s.submission_id = p_submission_id AND s.request_type = 'RENEWAL' AND s.on_behalf_of_author
$$;
REVOKE ALL ON FUNCTION renewal_author_window(uuid) FROM PUBLIC;

-- 0018 rules without the submitter exclusion (0033: a matching current grant may decide its own submission),
-- plus the 0032 order for renewals asked on the author's behalf. SQLSTATE AR032 = the author's window.
CREATE OR REPLACE FUNCTION validate_review_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; reviewer_org uuid; is_org_admin boolean; author_window record; author_decides boolean;
BEGIN
    SELECT s.submitted_by_membership_id, s.organization_id, s.shared_draft_version_id,
           s.content_hash, s.responsible_department_id, s.classification,
           s.team_tag, s.project_tag, s.audience_role_ids, s.status, s.request_type
      INTO STRICT submission_row FROM shared_submission s WHERE s.submission_id = NEW.submission_id;
    SELECT organization_id INTO STRICT reviewer_org FROM organization_membership
     WHERE membership_id = NEW.reviewer_membership_id;
    is_org_admin := COALESCE(current_setting('arden.org_admin', true), 'false') = 'true';
    IF reviewer_org IS DISTINCT FROM submission_row.organization_id THEN
        RAISE EXCEPTION 'Reviewer authority does not cover this submission' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO author_window FROM renewal_author_window(NEW.submission_id);
    author_decides := FOUND AND author_window.author_active
        AND author_window.author_membership_id = NEW.reviewer_membership_id;
    IF FOUND AND author_window.author_active AND NOT author_decides AND now() < author_window.window_until THEN
        RAISE EXCEPTION 'The author decides this renewal first' USING ERRCODE = 'AR032';
    END IF;
    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NOT NEW.flow2
            OR NEW.snapshot_version_id IS DISTINCT FROM submission_row.shared_draft_version_id
            OR NEW.content_hash IS DISTINCT FROM submission_row.content_hash
            OR (NOT is_org_admin AND NOT author_decides AND NOT actor_has_reviewer_grant(submission_row.organization_id,
                submission_row.responsible_department_id, submission_row.classification,
                submission_row.team_tag, submission_row.project_tag)) THEN
            RAISE EXCEPTION 'Review decision does not match a live authorized snapshot' USING ERRCODE = '23514';
        END IF;
        IF NEW.decision = 'APPROVED' AND NOT audience_snapshot_enforceable(
            submission_row.organization_id, submission_row.audience_role_ids,
            (SELECT target_scope_type FROM shared_submission WHERE submission_id = NEW.submission_id),
            (SELECT target_department_id FROM shared_submission WHERE submission_id = NEW.submission_id)) THEN
            RAISE EXCEPTION 'Approval audience is no longer enforceable' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 0035 rule, plus the author exception above.
CREATE OR REPLACE FUNCTION enforce_flow2_review_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; publication_count integer;
BEGIN
    IF NOT NEW.flow2 THEN RETURN NEW; END IF;
    SELECT status, publication_state, organization_id, responsible_department_id,
           classification, team_tag, project_tag, request_type
      INTO STRICT submission_row FROM shared_submission WHERE submission_id = NEW.submission_id;
    IF submission_row.status IS DISTINCT FROM NEW.decision THEN
        RAISE EXCEPTION 'Review decision and submission status diverged' USING ERRCODE = '23514';
    END IF;
    -- Decision 0032: the active author decides a renewal asked on their behalf without a reviewer grant.
    IF COALESCE(current_setting('arden.org_admin', true), 'false') <> 'true'
       -- (validate_review_decision also requires that author to be active; this invoker check reads only rows
       -- the caller can see, which for the author is decide_on_behalf_renewal's owner context.)
       AND NOT EXISTS (SELECT 1 FROM shared_submission rs JOIN shared_draft d ON d.shared_draft_id = rs.shared_draft_id
            WHERE rs.submission_id = NEW.submission_id AND rs.request_type = 'RENEWAL' AND rs.on_behalf_of_author
              AND d.author_membership_id = NEW.reviewer_membership_id)
       AND NOT actor_has_reviewer_grant(submission_row.organization_id,
           submission_row.responsible_department_id, submission_row.classification,
           submission_row.team_tag, submission_row.project_tag) THEN
        RAISE EXCEPTION 'Review decision lacks current reviewer authority' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO publication_count FROM published_knowledge_version
     WHERE submission_id = NEW.submission_id;
    IF NEW.decision = 'APPROVED' THEN
        IF publication_count <> 0
           OR (submission_row.request_type = 'CONTENT' AND submission_row.publication_state <> 'PREPARING')
           OR (submission_row.request_type <> 'CONTENT' AND submission_row.publication_state <> 'NONE') THEN
            RAISE EXCEPTION 'Approval must enter PREPARING without activating a publication'
                USING ERRCODE = '23514';
        END IF;
    ELSIF publication_count <> 0 THEN
        RAISE EXCEPTION 'Rejected submission cannot be published' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.review_decision_id = NEW.review_decision_id
        AND a.event_type = 'KNOWLEDGE_REVIEW_DECIDED' AND a.outcome = 'SUCCESS') THEN
        RAISE EXCEPTION 'Review decision needs a separate audit record' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;


-- 0018 insert policy without the submitter exclusion (0033). The author's own decision on an on-behalf renewal
-- is written only by decide_on_behalf_renewal, so it needs no runtime policy.
DROP POLICY flow3_review_decision_insert ON review_decision;
CREATE POLICY review_decision_insert_0033 ON review_decision FOR INSERT TO arden_runtime
  WITH CHECK (flow2 AND EXISTS (SELECT 1 FROM shared_submission s
      WHERE s.submission_id = review_decision.submission_id AND s.status = 'PENDING_REVIEW'
        AND ((current_setting('arden.org_admin', true) = 'true')
          OR actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                s.classification, s.team_tag, s.project_tag)))
     AND EXISTS (SELECT 1 FROM organization_membership om
         WHERE om.membership_id = review_decision.reviewer_membership_id
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
           AND om.status = 'ACTIVE'));

-- The active author reads renewal requests made on their behalf, to decide them (0032).
CREATE POLICY renewal_author_read ON shared_submission FOR SELECT TO arden_runtime
  USING (request_type = 'RENEWAL' AND on_behalf_of_author
     AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
     AND EXISTS (SELECT 1 FROM shared_draft d JOIN organization_membership om ON om.membership_id = d.author_membership_id
          WHERE d.shared_draft_id = shared_submission.shared_draft_id AND om.status = 'ACTIVE'
            AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid));

-- 0026 without the submitter exclusion: a reviewer sees the author name on their own pending submission too.
CREATE OR REPLACE FUNCTION review_submission_authors(p_submission_ids uuid[])
RETURNS TABLE (submission_id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT s.submission_id, COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
      FROM shared_submission s
      JOIN organization_membership author ON author.membership_id = s.submitted_by_membership_id
      JOIN user_account ua ON ua.user_id = author.user_id
      JOIN organization_membership actor
        ON actor.organization_id = s.organization_id AND actor.status = 'ACTIVE'
       AND actor.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
     WHERE s.submission_id = ANY(p_submission_ids)
       AND cardinality(p_submission_ids) <= 200
       AND s.shared_draft_version_id IS NOT NULL
       AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND (EXISTS (SELECT 1 FROM role_assignment ra
               JOIN role r ON r.role_id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
               JOIN access_scope scope ON scope.access_scope_id = ra.access_scope_id
                AND scope.organization_id = s.organization_id AND scope.scope_type = 'ORGANIZATION'
                AND scope.status = 'ACTIVE'
              WHERE ra.membership_id = actor.membership_id AND ra.status = 'ACTIVE'
                AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now()))
         OR EXISTS (SELECT 1 FROM review_decision rd
              WHERE rd.submission_id = s.submission_id AND rd.flow2
                AND rd.reviewer_membership_id = actor.membership_id)
         OR (s.status = 'PENDING_REVIEW'
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)));
$$;
REVOKE ALL ON FUNCTION review_submission_authors(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION review_submission_authors(uuid[]) TO arden_runtime;

-- 0025 without the submitter exclusion, for the same reason.
CREATE OR REPLACE FUNCTION submission_proposed_reader_directory(p_submission_id uuid)
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
         OR actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag))
     ORDER BY sr.ordinal;
$$;
REVOKE ALL ON FUNCTION submission_proposed_reader_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submission_proposed_reader_directory(uuid) TO arden_runtime;

-- The active author approves or rejects a renewal asked on their behalf, with no reviewer grant (0032).
-- Returns DECIDED, REPLAYED, CONFLICT (no longer pending or stale snapshot), COMMENT_REQUIRED, or
-- NOT_APPLICABLE when the caller is not that author (the regular review path then applies).
CREATE FUNCTION decide_on_behalf_renewal(p_submission_id uuid, p_decision text, p_snapshot_version_id uuid,
    p_content_hash text, p_comment text, p_request_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    request shared_submission%ROWTYPE;
    previous review_decision%ROWTYPE;
    decided uuid := gen_random_uuid();
    note text := NULLIF(btrim(COALESCE(p_comment, '')), '');
BEGIN
    IF actor IS NULL OR p_decision NOT IN ('APPROVED', 'REJECTED') OR p_request_id IS NULL THEN
        RETURN 'NOT_APPLICABLE';
    END IF;
    SELECT s.* INTO request FROM shared_submission s
      JOIN shared_draft d ON d.shared_draft_id = s.shared_draft_id AND d.author_membership_id = actor
     WHERE s.submission_id = p_submission_id AND s.organization_id = org
       AND s.request_type = 'RENEWAL' AND s.on_behalf_of_author
     FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN 'NOT_APPLICABLE'; END IF;
    SELECT * INTO previous FROM review_decision rd
     WHERE rd.reviewer_membership_id = actor AND rd.decision_request_id = p_request_id AND rd.flow2;
    IF FOUND THEN
        RETURN CASE WHEN previous.submission_id = p_submission_id AND previous.decision = p_decision
            THEN 'REPLAYED' ELSE 'CONFLICT' END;
    END IF;
    IF request.status <> 'PENDING_REVIEW'
       OR request.shared_draft_version_id IS DISTINCT FROM p_snapshot_version_id
       OR request.content_hash IS DISTINCT FROM p_content_hash THEN
        RETURN 'CONFLICT';
    END IF;
    IF p_decision = 'REJECTED' AND note IS NULL THEN RETURN 'COMMENT_REQUIRED'; END IF;
    IF note IS NOT NULL AND char_length(note) > 2000 THEN RETURN 'CONFLICT'; END IF;
    INSERT INTO review_decision (review_decision_id, submission_id, reviewer_membership_id, decision, comment, flow2,
        decision_request_id, snapshot_version_id, content_hash)
    VALUES (decided, p_submission_id, actor, p_decision, note, true, p_request_id,
        request.shared_draft_version_id, request.content_hash);
    INSERT INTO audit_event (organization_id, actor_membership_id, review_decision_id, event_type, outcome, details_json)
    VALUES (org, actor, decided, 'KNOWLEDGE_REVIEW_DECIDED', 'SUCCESS', jsonb_build_object(
        'submissionId', p_submission_id, 'snapshotVersionId', request.shared_draft_version_id, 'decision', p_decision,
        'requestType', 'RENEWAL', 'publishedVersionId', request.target_published_version_id,
        'decidedAs', 'AUTHOR', 'selfApproved', false, 'requestId', p_request_id));
    RETURN 'DECIDED';
END;
$$;
REVOKE ALL ON FUNCTION decide_on_behalf_renewal(uuid, text, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION decide_on_behalf_renewal(uuid, text, uuid, text, text, uuid) TO arden_runtime;

-- Validity of current publications the caller is responsible for: their own documents, every document for
-- an Organization Admin, and the responsible reviewer's documents. Metadata only; no content or readers.
-- A pending renewal is described so the author can decide one asked on their behalf.
CREATE FUNCTION list_publication_renewal_state()
RETURNS TABLE (document_id uuid, published_version_id uuid, title text, responsible_department_id uuid,
    expiration_date date, renewal_pending boolean, author_active boolean, is_author boolean, can_renew boolean,
    pending_submission_id uuid, pending_snapshot_version_id uuid, pending_content_hash text,
    pending_on_behalf boolean, pending_requested_by text, pending_reason text, pending_expiration_date date,
    pending_requested_at timestamptz, author_window_until timestamptz, can_decide boolean, author_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    admin boolean;
    today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    WITH visible AS (
        SELECT g.shared_draft_id, g.published_version_id, g.title, g.responsible_department_id,
               publication_expiration_date(g.published_version_id, pv.management) AS expires_on,
               renewal_member_active(g.submitted_by_membership_id) AS author_is_active,
               g.submitted_by_membership_id = actor AS mine,
               CASE WHEN renewal_member_active(g.submitted_by_membership_id)
                    THEN renewal_member_name(g.submitted_by_membership_id) END AS author_display_name
          FROM governance_current_publication g
          JOIN published_knowledge_version pv ON pv.published_version_id = g.published_version_id
         WHERE g.organization_id = org
           AND (g.submitted_by_membership_id = actor OR admin
             OR governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
    SELECT v.shared_draft_id, v.published_version_id, v.title, v.responsible_department_id, v.expires_on,
           p.submission_id IS NOT NULL, v.author_is_active, v.mine,
           v.expires_on IS NOT NULL AND p.submission_id IS NULL
             AND (v.mine OR NOT v.author_is_active OR v.expires_on <= today + 7),
           p.submission_id, p.shared_draft_version_id, p.content_hash, p.on_behalf_of_author,
           CASE WHEN p.submission_id IS NOT NULL THEN renewal_member_name(p.submitted_by_membership_id) END,
           p.request_reason, p.renewal_expiration_date, p.submitted_at,
           (SELECT w.window_until FROM renewal_author_window(p.submission_id) w WHERE w.author_active),
           COALESCE(p.on_behalf_of_author AND v.mine, false), v.author_display_name
      FROM visible v
      LEFT JOIN LATERAL (SELECT c.* FROM shared_submission c WHERE c.shared_draft_id = v.shared_draft_id
                           AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW' LIMIT 1) p ON true
     ORDER BY v.expires_on NULLS LAST, v.shared_draft_id
     LIMIT 1000;
END;
$$;
REVOKE ALL ON FUNCTION list_publication_renewal_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_publication_renewal_state() TO arden_runtime;
