SET search_path TO arden, public;

-- Target Readers are authoritative for newly saved drafts and review submissions.
-- Old snapshots retain their frozen Audience projection during the cutover rehearsal.
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
        AND submit_request_id IS NOT NULL AND audience_role_ids IS NOT NULL
        AND (
            cardinality(audience_role_ids) BETWEEN 1 AND 100
            OR (cardinality(audience_role_ids) = 0
                AND review_rule = 'GRANT_SCOPE'
                AND (proposed_selection_id IS NOT NULL
                     OR (request_type IN ('RENEWAL', 'WITHDRAWAL') AND target_published_version_id IS NOT NULL)))
        )
    ));

ALTER TABLE published_knowledge_version DROP CONSTRAINT ck_published_flow2_snapshot;
ALTER TABLE published_knowledge_version ADD CONSTRAINT ck_published_flow2_snapshot
    CHECK (shared_draft_id IS NULL OR (
        published_by_membership_id IS NULL
        AND classification IS NOT NULL AND classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')
        AND responsible_department_id IS NOT NULL
        AND audience_role_ids IS NOT NULL
        AND (reader_selection_id IS NOT NULL OR cardinality(audience_role_ids) BETWEEN 1 AND 100)
        AND valid_from IS NOT NULL AND (valid_until IS NULL OR valid_until > valid_from)
    ));

-- The approved_reader_publication_pointer policy authorizes modern reads.
-- Scope the compatibility policy to snapshots without Target Readers.
ALTER POLICY flow3_current_publication_audience_read ON knowledge_current_publication
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND reader_selection_id IS NULL
        AND actor_in_publication_audience(organization_id, audience_role_ids,
            target_scope_type, target_department_id));


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
               d.target_scope_type, d.title, d.classification, d.team_tag, d.project_tag, d.draft_selection_id,
               d.current_version_no, v.version_no, v.content_uri, v.mime_type, v.content_hash,
               CASE WHEN NEW.proposed_selection_id IS NULL THEN ARRAY(
                   SELECT a.role_id FROM shared_draft_audience a
                    WHERE a.shared_draft_id = d.shared_draft_id ORDER BY a.role_id)
               END AS audience_ids
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
            OR (NEW.proposed_selection_id IS NULL AND (
                source_row.target_scope_type IS DISTINCT FROM NEW.target_scope_type
                OR source_row.team_tag IS DISTINCT FROM NEW.team_tag
                OR source_row.project_tag IS DISTINCT FROM NEW.project_tag
                OR source_row.audience_ids IS DISTINCT FROM NEW.audience_role_ids))
            OR (NEW.proposed_selection_id IS NOT NULL AND (
                source_row.draft_selection_id IS DISTINCT FROM NEW.proposed_selection_id
                OR NEW.team_tag IS NOT NULL OR NEW.project_tag IS NOT NULL
                OR cardinality(NEW.audience_role_ids) <> 0
                OR NEW.target_department_id IS DISTINCT FROM CASE WHEN NEW.target_scope_type = 'DEPARTMENT'
                    THEN source_row.responsible_department_id END)) THEN
            RAISE EXCEPTION 'Submission must freeze the author-owned current shared draft snapshot'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.proposed_selection_id IS NULL
            AND EXISTS (SELECT 1 FROM unnest(NEW.audience_role_ids) AS audience(role_id)
            LEFT JOIN role r ON r.role_id = audience.role_id
            WHERE r.role_id IS NULL OR r.organization_id IS DISTINCT FROM NEW.organization_id
               OR r.status <> 'ACTIVE' OR r.is_system
               OR NOT EXISTS (SELECT 1 FROM role_permission rp JOIN permission p
                   ON p.permission_id = rp.permission_id
                   WHERE rp.role_id = r.role_id AND p.code = 'PUBLISHED_CONTENT_VIEW')) THEN
            RAISE EXCEPTION 'Submission audience is not enforceable' USING ERRCODE = '23514';
        END IF;
        IF NEW.proposed_selection_id IS NOT NULL AND NOT EXISTS (
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
           s.team_tag, s.project_tag, s.audience_role_ids, s.status, s.request_type,
           s.proposed_selection_id, s.target_published_version_id
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
        IF NEW.decision = 'APPROVED'
           AND submission_row.proposed_selection_id IS NULL
           AND NOT (
               submission_row.request_type IN ('WITHDRAWAL', 'RENEWAL')
               AND EXISTS (
                   SELECT 1 FROM published_knowledge_version pv
                   JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
                   WHERE pv.published_version_id = submission_row.target_published_version_id
                     AND pv.reader_selection_id IS NOT NULL
                     AND kb.organization_id = submission_row.organization_id
               )
           )
           AND NOT audience_snapshot_enforceable(
            submission_row.organization_id, submission_row.audience_role_ids,
            (SELECT target_scope_type FROM shared_submission WHERE submission_id = NEW.submission_id),
            (SELECT target_department_id FROM shared_submission WHERE submission_id = NEW.submission_id)) THEN
            RAISE EXCEPTION 'Approval audience is no longer enforceable' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_arden_notification()
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
        IF NEW.request_type = 'CONTENT' AND NEW.proposed_selection_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM reader_selection rs
                 WHERE rs.selection_id = NEW.proposed_selection_id
                   AND rs.organization_id = NEW.organization_id AND rs.reader_mode = 'ORGANIZATION'
            ) INTO has_organization_audience;
        ELSIF cardinality(NEW.audience_role_ids) = 0 AND NEW.review_rule = 'GRANT_SCOPE' THEN
            has_organization_audience := NEW.target_scope_type = 'ORGANIZATION';
        ELSE
            SELECT EXISTS (SELECT 1 FROM audience a WHERE NEW.target_scope_type = 'ORGANIZATION'
                AND a.organization_id = NEW.organization_id
                AND a.audience_id = ANY(NEW.audience_role_ids) AND a.kind = 'ORGANIZATION_ALL')
              INTO has_organization_audience;
        END IF;

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

CREATE OR REPLACE FUNCTION notify_arden_publication_share()
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

-- The worker activates only the exact snapshot with approved Target Readers.
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
    job_row knowledge_index_job%ROWTYPE;
    generation_row knowledge_index_generation%ROWTYPE;
    submission_row shared_submission%ROWTYPE;
    knowledge_base_id_value uuid;
    published_version_id_value uuid;
    decision_id uuid;
BEGIN
    IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'object' THEN
        RAISE EXCEPTION 'Index manifest must be an object' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO STRICT job_row FROM knowledge_index_job
     WHERE knowledge_index_job.job_id = p_job_id FOR UPDATE;
    IF job_row.status <> 'RUNNING' OR job_row.lease_owner IS DISTINCT FROM p_worker_id
       OR job_row.lease_expires_at <= now() THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;

    SELECT * INTO STRICT generation_row FROM knowledge_index_generation
     WHERE knowledge_index_generation.generation_id = job_row.generation_id FOR UPDATE;
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
        audience_role_ids, valid_from, valid_until)
    VALUES (
        submission_row.submission_id, knowledge_base_id_value, NULL,
        submission_row.shared_draft_id, submission_row.title,
        nextval('flow2_publication_version_seq'), submission_row.content_uri,
        submission_row.content_hash, 'INDEXED', submission_row.classification,
        submission_row.responsible_department_id, submission_row.audience_role_ids,
        now(), NULL)
    RETURNING published_version_id INTO STRICT published_version_id_value;

    INSERT INTO knowledge_current_publication (
        shared_draft_id, organization_id, published_version_id,
        audience_role_ids, target_scope_type, target_department_id,
        valid_from, valid_until)
    VALUES (
        submission_row.shared_draft_id, submission_row.organization_id,
        published_version_id_value, submission_row.audience_role_ids,
        submission_row.target_scope_type, submission_row.target_department_id,
        now(), NULL)
    ON CONFLICT (shared_draft_id) DO UPDATE SET
        published_version_id = EXCLUDED.published_version_id,
        audience_role_ids = EXCLUDED.audience_role_ids,
        target_scope_type = EXCLUDED.target_scope_type,
        target_department_id = EXCLUDED.target_department_id,
        valid_from = EXCLUDED.valid_from,
        valid_until = EXCLUDED.valid_until,
        updated_at = now();

    UPDATE knowledge_index_generation
       SET status = 'READY', manifest_json = p_manifest, completed_at = now()
     WHERE generation_id = generation_row.generation_id;
    UPDATE knowledge_index_job
       SET status = 'SUCCEEDED', lease_owner = NULL, lease_expires_at = NULL,
           completed_at = now()
     WHERE knowledge_index_job.job_id = p_job_id;
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
