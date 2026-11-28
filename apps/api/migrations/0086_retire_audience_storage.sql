SET search_path TO arden, public;

LOCK TABLE shared_draft, shared_submission, published_knowledge_version, knowledge_current_publication,
    audience, audience_group_membership, shared_draft_audience IN ACCESS EXCLUSIVE MODE;

-- Check every authoring and publication path before discarding the projection.
-- In particular, a pending historical request must keep its reviewer routing.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM shared_draft_audience a JOIN shared_draft d USING (shared_draft_id)
         WHERE d.status = 'ACTIVE' AND d.draft_selection_id IS NULL
    ) OR EXISTS (
        SELECT 1 FROM shared_submission s WHERE s.shared_draft_version_id IS NOT NULL
          AND s.request_type = 'CONTENT' AND s.proposed_selection_id IS NULL
    ) OR EXISTS (
        SELECT 1 FROM published_knowledge_version pv
         WHERE pv.shared_draft_id IS NOT NULL AND pv.reader_selection_id IS NULL
    ) OR EXISTS (
        SELECT 1 FROM knowledge_current_publication cp
          JOIN published_knowledge_version pv USING (published_version_id)
         WHERE cp.reader_selection_id IS NULL OR cp.reader_selection_id IS DISTINCT FROM pv.reader_selection_id
    ) OR EXISTS (
        SELECT 1 FROM shared_submission s LEFT JOIN reader_selection rs ON rs.selection_id = s.proposed_selection_id
         WHERE s.status = 'PENDING_REVIEW' AND s.shared_draft_version_id IS NOT NULL
           AND s.target_scope_type = 'ORGANIZATION'
           AND CASE WHEN s.request_type = 'CONTENT' THEN rs.reader_mode IS DISTINCT FROM 'ORGANIZATION'
                    WHEN cardinality(s.audience_role_ids) = 0 THEN s.review_rule <> 'GRANT_SCOPE'
                    ELSE NOT EXISTS (
                        SELECT 1 FROM audience a WHERE a.organization_id = s.organization_id
                          AND a.audience_id = ANY(s.audience_role_ids) AND a.kind = 'ORGANIZATION_ALL'
                    ) END
    ) THEN
        RAISE EXCEPTION 'Resolve legacy draft, review or publication readership before retiring Audience'
            USING ERRCODE = '55000';
    END IF;
END;
$$;

-- Publication activation is owned by the worker, and changes go through the
-- reviewed governance routines. Remove the original session-setting write path.
DROP POLICY flow2_knowledge_base_reviewer_insert ON knowledge_base;
DROP POLICY flow2_current_publication_reviewer_insert ON knowledge_current_publication;
DROP POLICY flow2_current_publication_reviewer_update ON knowledge_current_publication;
DROP POLICY flow2_current_publication_reviewer_read ON knowledge_current_publication;
DROP POLICY flow2_published_reviewer_insert ON published_knowledge_version;
DROP POLICY flow2_published_reviewer_read ON published_knowledge_version;
ALTER POLICY flow2_published_audience_read ON published_knowledge_version RENAME TO flow2_published_reader_read;
REVOKE INSERT ON knowledge_base, knowledge_current_publication, published_knowledge_version FROM arden_runtime;
REVOKE UPDATE (published_version_id, audience_role_ids, target_scope_type,
    target_department_id, valid_from, valid_until, updated_at) ON knowledge_current_publication FROM arden_runtime;

ALTER TABLE shared_submission DROP CONSTRAINT ck_shared_submission_flow2_snapshot;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_flow2_snapshot
    CHECK (shared_draft_version_id IS NULL OR (
        organization_id IS NOT NULL AND shared_draft_id IS NOT NULL
        AND snapshot_version_no IS NOT NULL AND snapshot_version_no > 0
        AND responsible_department_id IS NOT NULL
        AND title IS NOT NULL AND length(btrim(title)) > 0
        AND classification IS NOT NULL AND classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')
        AND policy_version IS NOT NULL AND policy_version = 1
        AND content_uri IS NOT NULL AND mime_type IS NOT NULL AND mime_type IN ('text/plain', 'application/pdf')
        AND content_hash IS NOT NULL AND content_hash ~ '^[0-9a-f]{64}$'
        AND submit_request_id IS NOT NULL AND (request_type <> 'CONTENT' OR proposed_selection_id IS NOT NULL)
    ));

ALTER TABLE published_knowledge_version DROP CONSTRAINT ck_published_flow2_snapshot;
ALTER TABLE published_knowledge_version ADD CONSTRAINT ck_published_flow2_snapshot
    CHECK (shared_draft_id IS NULL OR (
        published_by_membership_id IS NULL
        AND classification IS NOT NULL AND classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')
        AND responsible_department_id IS NOT NULL AND reader_selection_id IS NOT NULL
        AND valid_from IS NOT NULL AND (valid_until IS NULL OR valid_until > valid_from)
    ));

CREATE OR REPLACE FUNCTION protect_flow2_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_version_id IS NOT NULL AND
       (NEW.shared_draft_version_id, NEW.shared_draft_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_membership_id,
        NEW.target_scope_type, NEW.target_department_id, NEW.responsible_department_id,
        NEW.title, NEW.classification, NEW.team_tag, NEW.project_tag,
        NEW.policy_version, NEW.review_rule, NEW.content_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id, NEW.proposed_selection_id,
        NEW.keywords, NEW.change_description,
        NEW.request_type, NEW.request_reason, NEW.target_published_version_id,
        NEW.renewal_expiration_date, NEW.on_behalf_of_author, NEW.author_decides_until)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
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
            OR NEW.team_tag IS NOT NULL OR NEW.project_tag IS NOT NULL
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
           s.team_tag, s.project_tag
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
    END IF;
    RETURN NEW;
END;
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
                      AND (g.team_tag IS NULL OR g.team_tag IS NOT DISTINCT FROM NEW.team_tag)
                      AND (g.project_tag IS NULL OR g.project_tag IS NOT DISTINCT FROM NEW.project_tag)
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
        classification, team_tag, project_tag, policy_version, review_rule, content_uri, mime_type,
        content_hash, submit_request_id, request_type, request_reason, target_published_version_id,
        renewal_expiration_date, on_behalf_of_author, author_decides_until)
    VALUES (released.organization_id, released.shared_draft_id, released.shared_draft_version_id,
        released.snapshot_version_no, actor, released.target_scope_type, released.target_department_id,
        released.responsible_department_id, released.title, released.classification, released.team_tag,
        released.project_tag, released.policy_version, released.review_rule,
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

CREATE OR REPLACE FUNCTION validate_published_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = arden, pg_temp
AS $$
DECLARE
    submission_row record;
    knowledge_row record;
    submission_org uuid;
    publisher_org uuid;
BEGIN
    SELECT s.*
      INTO STRICT submission_row
      FROM shared_submission s
     WHERE s.submission_id = NEW.submission_id;

    SELECT organization_id, scope_type, department_id
      INTO STRICT knowledge_row
      FROM knowledge_base
     WHERE knowledge_base_id = NEW.knowledge_base_id;

    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        submission_org := submission_row.organization_id;
    ELSE
        SELECT organization_id
          INTO STRICT submission_org
          FROM organization_membership
         WHERE membership_id = submission_row.submitted_by_membership_id;
    END IF;

    IF submission_row.status <> 'APPROVED'
        OR submission_org IS DISTINCT FROM knowledge_row.organization_id THEN
        RAISE EXCEPTION 'Publication requires an approved same-organization submission'
            USING ERRCODE = '23514';
    END IF;

    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NEW.published_by_membership_id IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM review_decision rd
                WHERE rd.submission_id = NEW.submission_id AND rd.flow2 AND rd.decision = 'APPROVED')
            OR NEW.shared_draft_id IS DISTINCT FROM submission_row.shared_draft_id
            OR NEW.title IS DISTINCT FROM submission_row.title
            OR NEW.classification IS DISTINCT FROM submission_row.classification
            OR NEW.responsible_department_id IS DISTINCT FROM submission_row.responsible_department_id
            OR NEW.reader_selection_id IS DISTINCT FROM submission_row.approved_selection_id
            OR NEW.content_uri IS DISTINCT FROM submission_row.content_uri
            OR NEW.content_hash IS DISTINCT FROM submission_row.content_hash
            OR NEW.valid_from IS NULL
            OR knowledge_row.scope_type IS DISTINCT FROM submission_row.target_scope_type
            OR knowledge_row.department_id IS DISTINCT FROM submission_row.target_department_id THEN
            RAISE EXCEPTION 'System publication must match the exact approved snapshot and scope'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT organization_id
          INTO STRICT publisher_org
          FROM organization_membership
         WHERE membership_id = NEW.published_by_membership_id;

        IF publisher_org IS DISTINCT FROM submission_org THEN
            RAISE EXCEPTION 'Legacy publisher belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_current_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE publication_row record;
BEGIN
    SELECT pv.shared_draft_id, pv.reader_selection_id, pv.valid_from, pv.valid_until,
           kb.organization_id, kb.scope_type, kb.department_id
      INTO STRICT publication_row FROM published_knowledge_version pv
      JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
     WHERE pv.published_version_id = NEW.published_version_id;
    IF publication_row.shared_draft_id IS DISTINCT FROM NEW.shared_draft_id
        OR publication_row.organization_id IS DISTINCT FROM NEW.organization_id
        OR publication_row.reader_selection_id IS DISTINCT FROM NEW.reader_selection_id
        OR publication_row.scope_type IS DISTINCT FROM NEW.target_scope_type
        OR publication_row.department_id IS DISTINCT FROM NEW.target_department_id
        OR publication_row.valid_from IS DISTINCT FROM NEW.valid_from
        OR publication_row.valid_until IS DISTINCT FROM NEW.valid_until THEN
        RAISE EXCEPTION 'Current pointer must exactly match its published version' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_flow2_published_metadata()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_id IS NOT NULL AND
       (NEW.shared_draft_id, NEW.classification, NEW.responsible_department_id,
        NEW.valid_from, NEW.valid_until)
       IS DISTINCT FROM
       (OLD.shared_draft_id, OLD.classification, OLD.responsible_department_id,
        OLD.valid_from, OLD.valid_until) THEN
        RAISE EXCEPTION 'Published governance metadata is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION complete_knowledge_index_job_unordered_v1(
    p_job_id uuid,
    p_worker_id uuid,
    p_manifest jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = arden, pg_temp
AS $$
DECLARE
    generation_row knowledge_index_generation%ROWTYPE;
    submission_row shared_submission%ROWTYPE;
    knowledge_base_id_value uuid;
    published_version_id_value uuid;
    decision_id uuid;
BEGIN
    IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'object' THEN
        RAISE EXCEPTION 'Index manifest must be an object' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO STRICT generation_row FROM knowledge_index_generation g WHERE g.job_id = p_job_id FOR UPDATE;
    IF generation_row.job_status <> 'RUNNING' OR generation_row.lease_owner_id IS DISTINCT FROM p_worker_id
       OR generation_row.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;
    SELECT * INTO STRICT submission_row FROM shared_submission
     WHERE shared_submission.submission_id = generation_row.submission_id FOR UPDATE;

    IF generation_row.status <> 'PROCESSING'
       OR submission_row.status <> 'APPROVED'
       OR submission_row.publication_state <> 'PREPARING'
       OR submission_row.shared_draft_version_id IS DISTINCT FROM generation_row.snapshot_version_id
       OR submission_row.content_hash IS DISTINCT FROM generation_row.snapshot_content_hash
       OR NOT EXISTS (
           SELECT 1 FROM reader_selection rs
            WHERE rs.selection_id = submission_row.approved_selection_id
              AND rs.organization_id = submission_row.organization_id
       ) THEN
        RAISE EXCEPTION 'Index generation is no longer activatable' USING ERRCODE = '23514';
    END IF;

    IF p_manifest->>'jobId' IS DISTINCT FROM p_job_id::text
       OR p_manifest->>'generationId' IS DISTINCT FROM generation_row.generation_id::text
       OR p_manifest->>'snapshotVersionId' IS DISTINCT FROM generation_row.snapshot_version_id::text
       OR p_manifest->>'snapshotContentHash' IS DISTINCT FROM generation_row.snapshot_content_hash
       OR p_manifest->>'contractVersion' IS DISTINCT FROM '1'
       OR COALESCE(p_manifest->>'compilerVersion', '') = ''
       OR COALESCE(p_manifest->>'chunkingVersion', '') = ''
       OR COALESCE(p_manifest->>'embeddingModel', '') = ''
       OR COALESCE((p_manifest->>'embeddingDimensions')::integer, 0) <= 0
       OR COALESCE(p_manifest->>'markdownContentHash', '') !~ '^[0-9a-f]{64}$'
       OR COALESCE(p_manifest->>'chunksDigest', '') !~ '^[0-9a-f]{64}$'
       OR jsonb_typeof(p_manifest->'chunks') <> 'array'
       OR jsonb_array_length(p_manifest->'chunks') = 0 THEN
        RAISE EXCEPTION 'Index manifest does not match the claimed generation' USING ERRCODE = '23514';
    END IF;

    INSERT INTO knowledge_base (organization_id, department_id, name, scope_type)
    VALUES (submission_row.organization_id, submission_row.target_department_id,
            'Arden Knowledge', submission_row.target_scope_type)
    ON CONFLICT DO NOTHING;

    SELECT kb.knowledge_base_id INTO STRICT knowledge_base_id_value
      FROM knowledge_base kb
     WHERE kb.organization_id = submission_row.organization_id
       AND kb.name = 'Arden Knowledge'
       AND kb.scope_type = submission_row.target_scope_type
       AND kb.department_id IS NOT DISTINCT FROM submission_row.target_department_id
       AND kb.status = 'ACTIVE';

    INSERT INTO published_knowledge_version (
        submission_id, knowledge_base_id, published_by_membership_id,
        shared_draft_id, title, version_no, content_uri, content_hash,
        index_status, classification, responsible_department_id,
        valid_from, valid_until)
    VALUES (
        submission_row.submission_id, knowledge_base_id_value, NULL,
        submission_row.shared_draft_id, submission_row.title,
        nextval('flow2_publication_version_seq'), submission_row.content_uri,
        submission_row.content_hash, 'INDEXED', submission_row.classification,
        submission_row.responsible_department_id,
        now(), NULL)
    RETURNING published_version_id INTO STRICT published_version_id_value;

    INSERT INTO knowledge_current_publication (
        shared_draft_id, organization_id, published_version_id,
        target_scope_type, target_department_id,
        valid_from, valid_until)
    VALUES (
        submission_row.shared_draft_id, submission_row.organization_id,
        published_version_id_value,
        submission_row.target_scope_type, submission_row.target_department_id,
        now(), NULL)
    ON CONFLICT (shared_draft_id) DO UPDATE SET
        published_version_id = EXCLUDED.published_version_id,
        target_scope_type = EXCLUDED.target_scope_type,
        target_department_id = EXCLUDED.target_department_id,
        valid_from = EXCLUDED.valid_from,
        valid_until = EXCLUDED.valid_until,
        updated_at = now();

    UPDATE knowledge_index_generation
       SET status = 'READY', manifest_json = p_manifest, completed_at = now(),
           job_status = 'SUCCEEDED', lease_owner_id = NULL, lease_expires_at = NULL,
           job_completed_at = now(), job_updated_at = now()
     WHERE generation_id = generation_row.generation_id;
    UPDATE shared_submission SET publication_state = 'ACTIVE'
     WHERE submission_id = submission_row.submission_id;

    SELECT rd.review_decision_id INTO STRICT decision_id
      FROM review_decision rd
     WHERE rd.submission_id = submission_row.submission_id
       AND rd.flow2 AND rd.decision = 'APPROVED';
    INSERT INTO audit_event (
        organization_id, actor_membership_id, review_decision_id,
        event_type, outcome, details_json)
    VALUES (
        submission_row.organization_id, NULL, decision_id,
        'KNOWLEDGE_INDEX_ACTIVATED', 'SUCCESS',
        jsonb_build_object(
            'jobId', p_job_id,
            'generationId', generation_row.generation_id,
            'publishedVersionId', published_version_id_value,
            'snapshotVersionId', generation_row.snapshot_version_id));

    RETURN published_version_id_value;
END;
$$;

DROP TRIGGER trg_validate_shared_submission ON shared_submission;
CREATE CONSTRAINT TRIGGER trg_validate_shared_submission
AFTER INSERT OR UPDATE OF draft_version_id, shared_draft_version_id, shared_draft_id,
    snapshot_version_no, submitted_by_membership_id,
    organization_id, target_scope_type, target_department_id, responsible_department_id,
    title, classification, team_tag, project_tag, policy_version,
    content_uri, mime_type, content_hash ON shared_submission
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_shared_submission();

ALTER TABLE knowledge_current_publication DROP COLUMN audience_role_ids;
ALTER TABLE published_knowledge_version DROP COLUMN audience_role_ids;
ALTER TABLE shared_submission DROP COLUMN audience_role_ids;

DROP POLICY audience_member_read ON audience;
DROP TABLE shared_draft_audience;
DROP TABLE audience_group_membership;
DROP TABLE audience;
DROP FUNCTION validate_shared_draft_audience();
DROP FUNCTION reject_pending_shared_draft_audience_change();
DROP FUNCTION validate_audience_group_membership();
DROP FUNCTION migrate_publication_readers(boolean, uuid);
DROP FUNCTION audience_reader_memberships(uuid, uuid[], text, uuid);
DROP FUNCTION audience_snapshot_enforceable(uuid, uuid[], text, uuid);
DROP FUNCTION actor_in_publication_audience(uuid, uuid[], text, uuid);
