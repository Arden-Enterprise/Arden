SET search_path TO arden, public;

LOCK TABLE reviewer_grant, shared_draft, shared_submission, published_knowledge_version, maintenance_case
    IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    -- Working draft tags are retired metadata. Review, publication and grant
    -- tags may encode historical decisions and require separate reconciliation.
    IF EXISTS (SELECT 1 FROM reviewer_grant WHERE team_tag IS NOT NULL OR project_tag IS NOT NULL)
       OR EXISTS (SELECT 1 FROM shared_submission WHERE team_tag IS NOT NULL OR project_tag IS NOT NULL)
       OR EXISTS (SELECT 1 FROM published_knowledge_version WHERE team_tag IS NOT NULL OR project_tag IS NOT NULL)
       OR EXISTS (SELECT 1 FROM maintenance_case WHERE team_tag IS NOT NULL OR project_tag IS NOT NULL) THEN
        RAISE EXCEPTION 'Reconcile historical Team and Project values before retirement' USING ERRCODE = '55000';
    END IF;
END;
$$;

-- Match the same frozen reviewer scope used by Core. The narrower, legacy
-- specialist exception still applies only to historical LEGACY review rules.
CREATE FUNCTION actor_has_review_scope(p_organization_id uuid, p_department_id uuid,
    p_classification text, p_target_scope text, p_review_rule text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
           SELECT 1 FROM reviewer_grant g
             JOIN organization_membership om ON om.membership_id = g.reviewer_membership_id
             JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
             JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
             LEFT JOIN department d ON d.department_id = g.department_id AND d.organization_id = g.organization_id
            WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.status = 'ACTIVE' AND om.organization_id = p_organization_id
              AND g.organization_id = p_organization_id
              AND g.status = 'ACTIVE' AND g.valid_from <= now()
              AND (g.valid_until IS NULL OR g.valid_until > now())
              AND p_classification = ANY(g.classifications)
              AND (p_classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))
              AND (
                (g.scope = 'ORGANIZATION' AND (p_target_scope = 'ORGANIZATION' OR p_target_scope IS NULL))
                OR (g.scope = 'DEPARTMENT' AND g.department_id = p_department_id AND d.status = 'ACTIVE'
                    AND (p_target_scope = 'DEPARTMENT' OR p_target_scope IS NULL
                         OR (p_target_scope = 'ORGANIZATION' AND p_review_rule = 'LEGACY'
                             AND g.level IN ('SPECIALIST', 'SENIOR'))))
              )
       );
$$;
REVOKE ALL ON FUNCTION actor_has_review_scope(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_has_review_scope(uuid, uuid, text, text, text) TO arden_runtime;

CREATE FUNCTION maintenance_case_visible(p_organization_id uuid, p_reporter uuid, p_assignee uuid,
    p_author uuid, p_version_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT maintenance_actor_membership(p_organization_id) IS NOT NULL
       AND (
            maintenance_actor_membership(p_organization_id) = p_reporter
            OR maintenance_actor_membership(p_organization_id) = p_assignee
            OR maintenance_actor_is_admin(p_organization_id)
            OR (maintenance_actor_membership(p_organization_id) IS DISTINCT FROM p_author
                AND maintenance_actor_can_review_version(p_version_id)));
$$;
REVOKE ALL ON FUNCTION maintenance_case_visible(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION maintenance_case_visible(uuid, uuid, uuid, uuid, uuid) TO arden_runtime;

ALTER POLICY flow2_submission_reviewer_read ON shared_submission USING (
    shared_draft_version_id IS NOT NULL
    AND actor_has_review_scope(organization_id, responsible_department_id, classification, target_scope_type, review_rule)
    AND submitted_by_membership_id <> (
        SELECT om.membership_id FROM organization_membership om
         WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
           AND om.organization_id = shared_submission.organization_id));

ALTER POLICY flow3_submission_reviewer_update ON shared_submission
USING (shared_draft_version_id IS NOT NULL AND status = 'PENDING_REVIEW'
    AND (current_setting('arden.org_admin', true) = 'true'
         OR actor_has_review_scope(organization_id, responsible_department_id, classification, target_scope_type, review_rule)))
WITH CHECK (shared_draft_version_id IS NOT NULL AND status IN ('APPROVED', 'REJECTED')
    AND (current_setting('arden.org_admin', true) = 'true'
         OR actor_has_review_scope(organization_id, responsible_department_id, classification, target_scope_type, review_rule)));

ALTER POLICY review_decision_insert_0033 ON review_decision WITH CHECK (
    flow2 AND EXISTS (SELECT 1 FROM shared_submission s
        WHERE s.submission_id = review_decision.submission_id AND s.status = 'PENDING_REVIEW'
          AND (current_setting('arden.org_admin', true) = 'true'
               OR actor_has_review_scope(s.organization_id, s.responsible_department_id, s.classification,
                   s.target_scope_type, s.review_rule)))
    AND EXISTS (SELECT 1 FROM organization_membership om
        WHERE om.membership_id = review_decision.reviewer_membership_id
          AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.status = 'ACTIVE'));

ALTER POLICY maintenance_case_read ON maintenance_case
    USING (maintenance_case_visible(organization_id, reporter_membership_id, assignee_membership_id,
        author_membership_id, published_version_id));
ALTER POLICY maintenance_case_update ON maintenance_case
    USING (maintenance_case_visible(organization_id, reporter_membership_id, assignee_membership_id,
        author_membership_id, published_version_id));
ALTER POLICY maintenance_case_insert ON maintenance_case WITH CHECK (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND maintenance_actor_membership(organization_id) IS NOT NULL
    AND ((origin = 'READER_REPORT' AND (reporter_membership_id = maintenance_actor_membership(organization_id)
            OR maintenance_actor_is_admin(organization_id)))
      OR (origin = 'REVIEWER_INTAKE' AND maintenance_actor_membership(organization_id) IS DISTINCT FROM author_membership_id
            AND maintenance_actor_can_review_version(published_version_id))));

ALTER POLICY maintenance_event_read ON maintenance_case_event USING (EXISTS (
    SELECT 1 FROM maintenance_case c WHERE c.case_id = maintenance_case_event.case_id
        AND c.organization_id = maintenance_case_event.organization_id
        AND maintenance_case_visible(c.organization_id, c.reporter_membership_id, c.assignee_membership_id,
            c.author_membership_id, c.published_version_id)
        AND (audience = 'PUBLIC' OR maintenance_actor_membership(c.organization_id) IS DISTINCT FROM c.reporter_membership_id)));
ALTER POLICY maintenance_event_insert ON maintenance_case_event WITH CHECK (EXISTS (
    SELECT 1 FROM maintenance_case c WHERE c.case_id = maintenance_case_event.case_id
        AND c.organization_id = maintenance_case_event.organization_id
        AND maintenance_case_visible(c.organization_id, c.reporter_membership_id, c.assignee_membership_id,
            c.author_membership_id, c.published_version_id)));

CREATE OR REPLACE FUNCTION protect_flow2_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_version_id IS NOT NULL AND
       (NEW.shared_draft_version_id, NEW.shared_draft_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_membership_id,
        NEW.target_scope_type, NEW.target_department_id, NEW.responsible_department_id,
        NEW.title, NEW.classification,
        NEW.policy_version, NEW.review_rule, NEW.content_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id, NEW.proposed_selection_id,
        NEW.keywords, NEW.change_description,
        NEW.request_type, NEW.request_reason, NEW.target_published_version_id,
        NEW.renewal_expiration_date, NEW.on_behalf_of_author, NEW.author_decides_until)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification,
        OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id, OLD.proposed_selection_id,
        OLD.keywords, OLD.change_description,
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
               d.title, d.classification, d.draft_selection_id,
               d.current_version_no, v.version_no, v.content_uri, v.mime_type, v.content_hash
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
            OR source_row.title IS DISTINCT FROM NEW.title
            OR source_row.classification IS DISTINCT FROM NEW.classification
            OR source_row.content_uri IS DISTINCT FROM NEW.content_uri
            OR source_row.mime_type IS DISTINCT FROM NEW.mime_type
            OR source_row.content_hash IS DISTINCT FROM NEW.content_hash
            OR source_row.draft_selection_id IS DISTINCT FROM NEW.proposed_selection_id
            OR NEW.target_department_id IS DISTINCT FROM (CASE WHEN NEW.target_scope_type = 'DEPARTMENT'
                THEN source_row.responsible_department_id END) THEN
            RAISE EXCEPTION 'Submission must freeze the author-owned current shared draft snapshot'
                USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM reader_selection rs
             WHERE rs.selection_id = NEW.proposed_selection_id
               AND rs.organization_id = NEW.organization_id
               AND (rs.reader_mode = 'ORGANIZATION') = (NEW.target_scope_type = 'ORGANIZATION')
        ) THEN
            RAISE EXCEPTION 'Review scope must match the proposed readers' USING ERRCODE = '23514';
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

CREATE OR REPLACE FUNCTION validate_review_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; reviewer_org uuid; is_org_admin boolean; author_window record; author_decides boolean;
BEGIN
    SELECT s.submitted_by_membership_id, s.organization_id, s.shared_draft_version_id,
           s.content_hash, s.responsible_department_id, s.classification,
           s.target_scope_type, s.review_rule
      INTO STRICT submission_row FROM shared_submission s WHERE s.submission_id = NEW.submission_id;
    SELECT organization_id INTO STRICT reviewer_org FROM organization_membership
     WHERE membership_id = NEW.reviewer_membership_id;
    is_org_admin := governance_is_org_admin(governance_actor_membership(reviewer_org), reviewer_org);
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
            OR (NOT is_org_admin AND NOT author_decides AND NOT actor_has_review_scope(submission_row.organization_id,
                submission_row.responsible_department_id, submission_row.classification,
                submission_row.target_scope_type, submission_row.review_rule)) THEN
            RAISE EXCEPTION 'Review decision does not match a live authorized snapshot' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_flow2_review_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; publication_count integer;
BEGIN
    IF NOT NEW.flow2 THEN RETURN NEW; END IF;
    SELECT status, publication_state, organization_id, responsible_department_id,
           classification, target_scope_type, review_rule, request_type
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
       AND NOT actor_has_review_scope(submission_row.organization_id,
           submission_row.responsible_department_id, submission_row.classification,
           submission_row.target_scope_type, submission_row.review_rule) THEN
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

CREATE OR REPLACE FUNCTION request_publication_renewal(p_document_id uuid, p_expiration_date date, p_reason text,
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
        classification, policy_version, review_rule, content_uri, mime_type,
        content_hash, submit_request_id, request_type, request_reason, target_published_version_id,
        renewal_expiration_date, on_behalf_of_author, author_decides_until)
    VALUES (released.organization_id, released.shared_draft_id, released.shared_draft_version_id,
        released.snapshot_version_no, actor, released.target_scope_type, released.target_department_id,
        released.responsible_department_id, released.title, released.classification, released.policy_version, released.review_rule,
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
             AND actor_has_review_scope(s.organization_id, s.responsible_department_id,
                 s.classification, s.target_scope_type, s.review_rule)));
$$;

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
         OR actor_has_review_scope(s.organization_id, s.responsible_department_id,
                 s.classification, s.target_scope_type, s.review_rule))
     ORDER BY sr.ordinal;
$$;

CREATE OR REPLACE FUNCTION publication_change_target_state(p_submission_id uuid)
RETURNS TABLE (target_is_current boolean, newer_version_preparing boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    request shared_submission%ROWTYPE;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    SELECT * INTO request FROM shared_submission s
     WHERE s.submission_id = p_submission_id AND s.organization_id = org AND s.request_type <> 'CONTENT';
    IF NOT FOUND THEN RETURN; END IF;
    IF NOT (governance_is_org_admin(actor, org)
        OR actor_has_review_scope(request.organization_id, request.responsible_department_id,
               request.classification, request.target_scope_type, request.review_rule)
        OR EXISTS (SELECT 1 FROM shared_draft d WHERE d.shared_draft_id = request.shared_draft_id
                     AND d.author_membership_id = actor)) THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT
        EXISTS (SELECT 1 FROM knowledge_current_publication cp WHERE cp.shared_draft_id = request.shared_draft_id
                  AND cp.organization_id = org AND cp.published_version_id = request.target_published_version_id),
        EXISTS (SELECT 1 FROM shared_submission c WHERE c.shared_draft_id = request.shared_draft_id
                  AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING');
END;
$$;

CREATE OR REPLACE FUNCTION copy_published_version_anchor()
RETURNS trigger LANGUAGE plpgsql SET search_path = arden, public AS $$
BEGIN
    SELECT s.submitted_by_membership_id
      INTO NEW.author_membership_id
      FROM shared_submission s
     WHERE s.submission_id = NEW.submission_id;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION list_graph_monitor_documents(p_include_expired boolean)
RETURNS TABLE (
    document_id uuid,
    published_version_id uuid,
    title text,
    management jsonb,
    owner_department_id uuid,
    owner_department_name text,
    author_display_name text,
    published_at timestamptz,
    expiration_date text,
    readers_selection_id uuid,
    readers_mode text,
    readers_department_id uuid,
    readers_member_ids uuid[],
    knowledge_base_scope_type text,
    collection_id uuid,
    collection_name text,
    collection_allowed_types text[],
    is_author boolean,
    can_renew boolean,
    is_currently_readable boolean,
    open_target text,
    open_maintenance_case_count integer,
    is_unassigned_org_doc boolean,
    requires_audited_inspection boolean,
    actor_accountable boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    WITH base_context AS (
        SELECT NULLIF(current_setting('arden.organization_id', true), '')::uuid AS org_id,
               (now() AT TIME ZONE 'UTC')::date AS today
    ), actor_context AS (
        SELECT base.org_id,
               base.today,
               governance_actor_membership(base.org_id) AS actor_membership_id
          FROM base_context base
    ), context AS (
        SELECT actor.*,
               governance_is_org_admin(actor.actor_membership_id, actor.org_id) AS is_admin
          FROM actor_context actor
    ), readable_ids AS MATERIALIZED (
        SELECT current_readable_document_ids() AS document_id
    ), actor_grants AS MATERIALIZED (
        SELECT g.scope,
               g.department_id,
               g.classifications,
               g.level,
               COALESCE(dep.status = 'ACTIVE', false) AS department_active
          FROM context ctx
          JOIN reviewer_grant g
            ON g.reviewer_membership_id = ctx.actor_membership_id
           AND g.organization_id = ctx.org_id
          LEFT JOIN department dep
            ON dep.department_id = g.department_id
           AND dep.organization_id = g.organization_id
         WHERE ctx.actor_membership_id IS NOT NULL
           AND g.status = 'ACTIVE'
           AND g.valid_from <= now()
           AND (g.valid_until IS NULL OR g.valid_until > now())
    ), current_docs AS (
        SELECT cp.shared_draft_id AS document_id,
               pv.published_version_id,
               pv.title,
               pv.management,
               pv.classification,
               pv.responsible_department_id AS owner_department_id,
               owner_department.name AS owner_department_name,
               pv.published_at,
               kb.scope_type AS knowledge_base_scope_type,
               publication_expiration_date(pv.published_version_id, pv.management) AS expiration_on,
               COALESCE(cp.reader_selection_id, pv.reader_selection_id) AS readers_selection_id,
               rs.reader_mode AS readers_mode,
               rs.department_id AS readers_department_id,
               version_rs.reader_mode AS review_reader_mode,
               ARRAY(
                   SELECT sr.membership_id
                     FROM selected_reader sr
                    WHERE sr.selection_id = COALESCE(cp.reader_selection_id, pv.reader_selection_id)
                    ORDER BY sr.ordinal
               ) AS readers_member_ids,
               cp.target_scope_type,
               d.author_membership_id,
               kc.collection_id,
               kc.name AS collection_name,
               kc.allowed_types AS collection_allowed_types
          FROM context ctx
          JOIN knowledge_current_publication cp
            ON cp.organization_id = ctx.org_id
          JOIN shared_draft d
            ON d.shared_draft_id = cp.shared_draft_id
           AND d.organization_id = cp.organization_id
           AND d.status = 'ACTIVE'
          JOIN published_knowledge_version pv
            ON pv.published_version_id = cp.published_version_id
           AND pv.shared_draft_id = cp.shared_draft_id
          JOIN knowledge_base kb
            ON kb.knowledge_base_id = pv.knowledge_base_id
           AND kb.organization_id = cp.organization_id
          LEFT JOIN department owner_department
            ON owner_department.department_id = pv.responsible_department_id
           AND owner_department.organization_id = cp.organization_id
          LEFT JOIN reader_selection rs
            ON rs.selection_id = COALESCE(cp.reader_selection_id, pv.reader_selection_id)
          LEFT JOIN reader_selection version_rs
            ON version_rs.selection_id = pv.reader_selection_id
          LEFT JOIN knowledge_collection_placement kcp
            ON kcp.shared_draft_id = cp.shared_draft_id
           AND kcp.organization_id = cp.organization_id
          LEFT JOIN knowledge_collection kc
            ON kc.collection_id = kcp.collection_id
           AND kc.organization_id = cp.organization_id
           AND kc.status = 'ACTIVE'
         WHERE ctx.actor_membership_id IS NOT NULL
           AND cp.valid_from <= now()
           AND (cp.valid_until IS NULL OR cp.valid_until > now())
           AND pv.published_at <= now()
    ), scoped AS (
        SELECT c.*,
               ctx.today,
               ctx.is_admin,
               (c.author_membership_id = ctx.actor_membership_id) AS is_author,
               (c.document_id IN (SELECT document_id FROM readable_ids)) AS is_currently_readable,
               (EXISTS (
                   SELECT 1
                     FROM actor_grants ag
                    WHERE c.classification = ANY(ag.classifications)
                      AND (c.classification <> 'RESTRICTED' OR ag.level IN ('SPECIALIST', 'SENIOR'))


                      AND CASE WHEN COALESCE(c.review_reader_mode,
                              CASE c.target_scope_type WHEN 'DEPARTMENT' THEN 'DEPARTMENT' ELSE 'ORGANIZATION' END
                          ) = 'ORGANIZATION'
                          THEN ag.scope = 'ORGANIZATION'
                          ELSE ag.scope = 'DEPARTMENT'
                               AND ag.department_id = c.owner_department_id
                               AND ag.department_active
                      END
               ) AND c.author_membership_id IS DISTINCT FROM ctx.actor_membership_id) AS is_disjoint_reviewer,
               (c.expiration_on IS NOT NULL AND c.expiration_on < ctx.today) AS is_expired,
               COALESCE(c.readers_mode,
                   CASE c.target_scope_type WHEN 'ORGANIZATION' THEN 'ORGANIZATION' ELSE 'DEPARTMENT' END
               ) AS governance_reader_mode
          FROM current_docs c
          CROSS JOIN context ctx
    ), visible AS (
        SELECT s.*
          FROM scoped s
         WHERE (s.is_currently_readable OR s.is_author OR s.is_disjoint_reviewer OR s.is_admin)
           AND (p_include_expired IS TRUE OR NOT s.is_expired)
    ), routed AS (
        SELECT v.*,
               (v.is_author OR v.is_disjoint_reviewer OR v.is_admin) AS actor_accountable,
               CASE
                   WHEN v.is_currently_readable AND NOT v.is_expired THEN 'READER'
                   WHEN v.is_author THEN 'MY_CONTRIBUTIONS'
                   WHEN v.is_disjoint_reviewer THEN 'RESPONSIBLE_VIEW'
                   WHEN v.is_admin THEN 'ADMIN_INSPECTION'
                   ELSE 'READER'
               END AS open_target
          FROM visible v
    ), renewal_pending AS (
        SELECT s.shared_draft_id AS document_id
          FROM shared_submission s
          JOIN context ctx ON ctx.org_id = s.organization_id
         WHERE s.request_type = 'RENEWAL'
           AND s.status = 'PENDING_REVIEW'
         GROUP BY s.shared_draft_id
    ), open_case_counts AS (
        SELECT mc.document_id,
               mc.published_version_id,
               count(*)::integer AS open_count
          FROM maintenance_case mc
          JOIN context ctx ON ctx.org_id = mc.organization_id
         WHERE mc.reporter_status <> 'Resolved'
           AND EXISTS (
               SELECT 1
                 FROM visible v
                WHERE v.is_admin OR v.is_disjoint_reviewer
           )
         GROUP BY mc.document_id, mc.published_version_id
    ), visible_ids AS (
        SELECT array_agg(r.published_version_id) AS ids
          FROM routed r
    ), author_chunks AS (
        SELECT ids[starts.start_index:starts.start_index + 999] AS chunk
          FROM visible_ids
          CROSS JOIN LATERAL generate_series(1, COALESCE(cardinality(ids), 0), 1000) AS starts(start_index)
    ), author_names AS (
        SELECT names.published_version_id,
               names.author_name
          FROM author_chunks chunks
          CROSS JOIN LATERAL list_publication_author_names(chunks.chunk) AS names
    )
    SELECT r.document_id,
           r.published_version_id,
           r.title,
           r.management,
           r.owner_department_id,
           COALESCE(r.owner_department_name, 'Unknown department') AS owner_department_name,
           an.author_name AS author_display_name,
           r.published_at,
           to_char(r.expiration_on, 'YYYY-MM-DD') AS expiration_date,
           r.readers_selection_id,
           r.readers_mode,
           r.readers_department_id,
           CASE WHEN r.is_currently_readable THEN r.readers_member_ids ELSE ARRAY[]::uuid[] END AS readers_member_ids,
           r.knowledge_base_scope_type,
           r.collection_id,
           r.collection_name,
           r.collection_allowed_types,
           r.is_author,
           (
               r.expiration_on IS NOT NULL
               AND rp.document_id IS NULL
               AND (
                   r.is_author
                   OR NOT renewal_member_active(r.author_membership_id)
                   OR r.expiration_on <= r.today + 7
               )
               AND (
                   r.is_author
                   OR r.is_admin
                   OR EXISTS (
                       SELECT 1
                         FROM actor_grants ag
                        WHERE (r.governance_reader_mode = 'ORGANIZATION' AND ag.scope = 'ORGANIZATION')
                           OR (r.governance_reader_mode <> 'ORGANIZATION'
                               AND ag.scope = 'DEPARTMENT'
                               AND ag.department_id = r.owner_department_id)
                   )
               )
           ) AS can_renew,
           r.is_currently_readable,
           r.open_target,
           CASE
               WHEN r.is_admin OR r.is_disjoint_reviewer THEN COALESCE(occ.open_count, 0)
               ELSE NULL
           END AS open_maintenance_case_count,
           (
               COALESCE(r.readers_mode,
                   CASE WHEN r.knowledge_base_scope_type = 'ORGANIZATION' THEN 'ORGANIZATION' ELSE 'DEPARTMENT' END
               ) = 'ORGANIZATION'
               AND r.collection_id IS NULL
           ) AS is_unassigned_org_doc,
           (r.open_target = 'ADMIN_INSPECTION') AS requires_audited_inspection,
           r.actor_accountable
      FROM routed r
      LEFT JOIN renewal_pending rp ON rp.document_id = r.document_id
      LEFT JOIN open_case_counts occ
        ON occ.document_id = r.document_id
       AND occ.published_version_id = r.published_version_id
      LEFT JOIN author_names an ON an.published_version_id = r.published_version_id
     ORDER BY r.published_at DESC, r.document_id ASC;
$$;

CREATE OR REPLACE FUNCTION maintenance_reviewer_covers(p_membership_id uuid, p_version_id uuid)
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


           AND CASE WHEN maintenance_version_reader_mode(pv.published_version_id) = 'ORGANIZATION'
                    THEN g.scope = 'ORGANIZATION'
                    ELSE g.scope = 'DEPARTMENT' AND g.department_id = pv.responsible_department_id
                         AND dep.status = 'ACTIVE' END);
$$;

CREATE OR REPLACE FUNCTION notify_arden_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    organization_wide boolean;
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
        organization_wide := NEW.target_scope_type = 'ORGANIZATION';

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


                      AND (
                        (organization_wide
                          AND (g.scope = 'ORGANIZATION'
                            OR (NEW.review_rule = 'LEGACY' AND g.scope = 'DEPARTMENT'
                              AND g.department_id = NEW.responsible_department_id
                              AND g.level IN ('SPECIALIST', 'SENIOR'))))
                        OR (NOT organization_wide AND g.scope = 'DEPARTMENT'
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

CREATE OR REPLACE FUNCTION maintenance_next_event_sequence(p_case_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM maintenance_case c
         WHERE c.case_id = p_case_id AND c.organization_id = org
           AND maintenance_case_visible(c.organization_id, c.reporter_membership_id, c.assignee_membership_id,
                c.author_membership_id, c.published_version_id)) THEN
        RAISE EXCEPTION 'maintenance case is unavailable' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT COALESCE(MAX(e.sequence), 0) + 1 FROM maintenance_case_event e WHERE e.case_id = p_case_id);
END;
$$;

DROP TRIGGER trg_validate_shared_submission ON shared_submission;
CREATE CONSTRAINT TRIGGER trg_validate_shared_submission
AFTER INSERT OR UPDATE OF draft_version_id, shared_draft_version_id, shared_draft_id, snapshot_version_no,
    submitted_by_membership_id, organization_id, target_scope_type, target_department_id, responsible_department_id,
    title, classification, policy_version, content_uri, mime_type, content_hash ON shared_submission
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_shared_submission();

DROP FUNCTION maintenance_case_visible(uuid, uuid, uuid, uuid, uuid, text, text, text);
DROP FUNCTION actor_has_reviewer_grant(uuid, uuid, text, text, text);
DROP INDEX uq_active_reviewer_grant_exact;

ALTER TABLE reviewer_grant DROP COLUMN team_tag, DROP COLUMN project_tag;
ALTER TABLE shared_draft DROP COLUMN team_tag, DROP COLUMN project_tag;
ALTER TABLE shared_submission DROP COLUMN team_tag, DROP COLUMN project_tag;
ALTER TABLE published_knowledge_version DROP COLUMN team_tag, DROP COLUMN project_tag;
ALTER TABLE maintenance_case DROP COLUMN team_tag, DROP COLUMN project_tag;

CREATE UNIQUE INDEX uq_active_reviewer_grant_exact
    ON reviewer_grant (organization_id, reviewer_membership_id, scope, department_id,
                       reviewer_grant_classification_set(classifications), level, valid_until)
    NULLS NOT DISTINCT WHERE status = 'ACTIVE';
