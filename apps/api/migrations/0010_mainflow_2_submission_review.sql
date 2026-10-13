SET search_path TO arden, public;

-- Extend the original governance tables. Legacy private-version submissions
-- remain readable to migrations, but new Flow 2 submissions reference the
-- author-owned shared-draft snapshot instead of a private original.
ALTER TABLE shared_submission ALTER COLUMN draft_version_id DROP NOT NULL;
ALTER TABLE shared_submission ADD COLUMN organization_id uuid REFERENCES organization(organization_id);
ALTER TABLE shared_submission ADD COLUMN shared_draft_version_id uuid
    REFERENCES shared_draft_version(shared_draft_version_id);
ALTER TABLE shared_submission ADD COLUMN shared_draft_id uuid REFERENCES shared_draft(shared_draft_id);
ALTER TABLE shared_submission ADD COLUMN snapshot_version_no integer;
ALTER TABLE shared_submission ADD COLUMN responsible_department_id uuid;
ALTER TABLE shared_submission ADD COLUMN title text;
ALTER TABLE shared_submission ADD COLUMN classification text;
ALTER TABLE shared_submission ADD COLUMN team_tag text;
ALTER TABLE shared_submission ADD COLUMN project_tag text;
ALTER TABLE shared_submission ADD COLUMN audience_role_ids uuid[];
ALTER TABLE shared_submission ADD COLUMN policy_version integer;
ALTER TABLE shared_submission ADD COLUMN content_uri text;
ALTER TABLE shared_submission ADD COLUMN mime_type text;
ALTER TABLE shared_submission ADD COLUMN content_hash text;
ALTER TABLE shared_submission ADD COLUMN submit_request_id uuid;
ALTER TABLE shared_submission ADD CONSTRAINT fk_shared_submission_responsible_department
    FOREIGN KEY (responsible_department_id, organization_id)
    REFERENCES department(department_id, organization_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_one_version
    CHECK (num_nonnulls(draft_version_id, shared_draft_version_id) = 1);
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_flow2_snapshot
    CHECK (shared_draft_version_id IS NULL OR (
        organization_id IS NOT NULL AND shared_draft_id IS NOT NULL
        AND snapshot_version_no IS NOT NULL AND snapshot_version_no > 0
        AND responsible_department_id IS NOT NULL
        AND title IS NOT NULL AND length(btrim(title)) > 0
        AND classification IS NOT NULL AND classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')
        AND policy_version IS NOT NULL AND policy_version = 1
        AND content_uri IS NOT NULL AND mime_type IS NOT NULL AND mime_type = 'text/plain'
        AND content_hash IS NOT NULL AND content_hash ~ '^[0-9a-f]{64}$'
        AND submit_request_id IS NOT NULL AND audience_role_ids IS NOT NULL
        AND cardinality(audience_role_ids) BETWEEN 1 AND 100));
CREATE UNIQUE INDEX uq_flow2_submitted_snapshot ON shared_submission(shared_draft_version_id)
    WHERE shared_draft_version_id IS NOT NULL;
CREATE UNIQUE INDEX uq_flow2_submit_request ON shared_submission(submitted_by_membership_id, submit_request_id)
    WHERE submit_request_id IS NOT NULL;

CREATE TABLE reviewer_grant (
    reviewer_grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    reviewer_membership_id uuid NOT NULL,
    department_id uuid NOT NULL,
    granted_by_membership_id uuid NOT NULL,
    classifications text[] NOT NULL,
    level text NOT NULL DEFAULT 'STANDARD',
    team_tag text,
    project_tag text,
    status text NOT NULL DEFAULT 'ACTIVE',
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_reviewer_grant_reviewer FOREIGN KEY (reviewer_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id),
    CONSTRAINT fk_reviewer_grant_granter FOREIGN KEY (granted_by_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id),
    CONSTRAINT fk_reviewer_grant_department FOREIGN KEY (department_id, organization_id)
        REFERENCES department(department_id, organization_id),
    CONSTRAINT ck_reviewer_grant_classifications CHECK (
        cardinality(classifications) BETWEEN 1 AND 3
        AND array_position(classifications, NULL) IS NULL
        AND classifications <@ ARRAY['INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']::text[]),
    CONSTRAINT ck_reviewer_grant_level CHECK (level IN ('STANDARD', 'SPECIALIST', 'SENIOR')),
    CONSTRAINT ck_reviewer_grant_status CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_reviewer_grant_dates CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT ck_reviewer_grant_tags CHECK (
        (team_tag IS NULL OR length(btrim(team_tag)) BETWEEN 1 AND 100)
        AND (project_tag IS NULL OR length(btrim(project_tag)) BETWEEN 1 AND 100))
);
CREATE INDEX ix_reviewer_grant_queue ON reviewer_grant
    (organization_id, reviewer_membership_id, department_id, status, valid_until);

ALTER TABLE review_decision ADD COLUMN flow2 boolean NOT NULL DEFAULT false;
ALTER TABLE review_decision ADD COLUMN decision_request_id uuid;
CREATE UNIQUE INDEX uq_flow2_review_decision ON review_decision(submission_id) WHERE flow2;
CREATE UNIQUE INDEX uq_flow2_decision_request ON review_decision(reviewer_membership_id, decision_request_id)
    WHERE decision_request_id IS NOT NULL;

ALTER TABLE published_knowledge_version ALTER COLUMN published_by_membership_id DROP NOT NULL;
CREATE SEQUENCE flow2_publication_version_seq AS integer;
GRANT USAGE ON SEQUENCE flow2_publication_version_seq TO arden_runtime;
ALTER TABLE published_knowledge_version ADD COLUMN shared_draft_id uuid REFERENCES shared_draft(shared_draft_id);
ALTER TABLE published_knowledge_version ADD COLUMN classification text;
ALTER TABLE published_knowledge_version ADD COLUMN responsible_department_id uuid;
ALTER TABLE published_knowledge_version ADD COLUMN audience_role_ids uuid[];
ALTER TABLE published_knowledge_version ADD COLUMN valid_from timestamptz;
ALTER TABLE published_knowledge_version ADD COLUMN valid_until timestamptz;
ALTER TABLE published_knowledge_version ADD CONSTRAINT ck_published_flow2_snapshot CHECK (
    shared_draft_id IS NULL OR (published_by_membership_id IS NULL
      AND classification IS NOT NULL AND classification IN ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')
      AND responsible_department_id IS NOT NULL
      AND audience_role_ids IS NOT NULL AND cardinality(audience_role_ids) BETWEEN 1 AND 100
      AND valid_from IS NOT NULL AND (valid_until IS NULL OR valid_until > valid_from)));

CREATE TABLE knowledge_current_publication (
    shared_draft_id uuid PRIMARY KEY REFERENCES shared_draft(shared_draft_id),
    organization_id uuid NOT NULL REFERENCES organization(organization_id),
    published_version_id uuid NOT NULL UNIQUE REFERENCES published_knowledge_version(published_version_id),
    audience_role_ids uuid[] NOT NULL,
    target_scope_type text NOT NULL,
    target_department_id uuid,
    valid_from timestamptz NOT NULL,
    valid_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_current_publication_scope CHECK (
        (target_scope_type = 'ORGANIZATION' AND target_department_id IS NULL)
        OR (target_scope_type = 'DEPARTMENT' AND target_department_id IS NOT NULL)),
    CONSTRAINT ck_current_publication_validity CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX ix_knowledge_current_publication_org ON knowledge_current_publication(organization_id);

-- Authors may propose any active organization audience role. Permit reading
-- its content-view capability without granting membership or content access.
CREATE POLICY flow2_role_permission_org_read ON role_permission FOR SELECT TO arden_runtime
    USING (EXISTS (SELECT 1 FROM role r
        JOIN organization_membership om ON om.organization_id = r.organization_id
        WHERE r.role_id = role_permission.role_id
          AND r.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
          AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.status = 'ACTIVE'));

-- Existing data does not satisfy Flow 2's frozen-snapshot contract. The old
-- validation trigger is replaced only for new rows; legacy rows keep their
-- original tenant checks and cannot be published by the new API.
CREATE OR REPLACE FUNCTION validate_shared_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE source_org uuid; submitter_org uuid; department_org uuid; source_row record;
BEGIN
    SELECT organization_id INTO STRICT submitter_org FROM organization_membership
     WHERE membership_id = NEW.submitted_by_membership_id;
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

DROP TRIGGER trg_validate_shared_submission ON shared_submission;
CREATE CONSTRAINT TRIGGER trg_validate_shared_submission
AFTER INSERT OR UPDATE OF draft_version_id, shared_draft_version_id, shared_draft_id,
    snapshot_version_no, submitted_by_membership_id,
    organization_id, target_scope_type, target_department_id, responsible_department_id,
    title, classification, team_tag, project_tag, audience_role_ids, policy_version,
    content_uri, mime_type, content_hash ON shared_submission
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_shared_submission();

CREATE FUNCTION protect_flow2_submission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_version_id IS NOT NULL AND
       (NEW.shared_draft_version_id, NEW.shared_draft_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_membership_id,
        NEW.target_scope_type, NEW.target_department_id, NEW.responsible_department_id,
        NEW.title, NEW.classification, NEW.team_tag, NEW.project_tag,
        NEW.audience_role_ids, NEW.policy_version, NEW.content_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id) THEN
        RAISE EXCEPTION 'Submitted snapshot is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_flow2_submission_snapshot BEFORE UPDATE ON shared_submission
FOR EACH ROW EXECUTE FUNCTION protect_flow2_submission_snapshot();

CREATE FUNCTION reject_pending_shared_draft_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM shared_submission s
        JOIN shared_draft_version v ON v.shared_draft_version_id = s.shared_draft_version_id
        WHERE v.shared_draft_id = NEW.shared_draft_id AND s.status = 'PENDING_REVIEW') THEN
        RAISE EXCEPTION 'Shared draft cannot change while a snapshot is pending review' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION reject_pending_shared_draft_change() FROM PUBLIC;
CREATE TRIGGER trg_reject_pending_shared_draft_change BEFORE UPDATE ON shared_draft
FOR EACH ROW EXECUTE FUNCTION reject_pending_shared_draft_change();

-- Audience rows are draft metadata too. Serialize direct audience writes with
-- submission and keep them frozen while a snapshot awaits a decision.
CREATE FUNCTION reject_pending_shared_draft_audience_change()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE draft_id uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN draft_id := OLD.shared_draft_id;
    ELSE draft_id := NEW.shared_draft_id; END IF;
    PERFORM 1 FROM shared_draft WHERE shared_draft_id = draft_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM shared_submission
        WHERE shared_draft_id = draft_id AND status = 'PENDING_REVIEW') THEN
        RAISE EXCEPTION 'Shared draft audience cannot change during pending review' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION reject_pending_shared_draft_audience_change() FROM PUBLIC;
CREATE TRIGGER trg_reject_pending_shared_draft_audience_change
BEFORE INSERT OR DELETE ON shared_draft_audience
FOR EACH ROW EXECUTE FUNCTION reject_pending_shared_draft_audience_change();

-- Reviewer authority is an explicit Org Admin grant, not inherited from
-- being an administrator or from a content audience role.
ALTER TABLE reviewer_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewer_grant FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON reviewer_grant TO arden_runtime;
GRANT UPDATE (status) ON reviewer_grant TO arden_runtime;
CREATE POLICY reviewer_grant_self_read ON reviewer_grant FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM organization_membership om
           WHERE om.membership_id = reviewer_grant.reviewer_membership_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));
CREATE POLICY reviewer_grant_admin_read ON reviewer_grant FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true');
CREATE POLICY reviewer_grant_admin_insert ON reviewer_grant FOR INSERT TO arden_runtime
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true'
       AND EXISTS (SELECT 1 FROM organization_membership om
           WHERE om.membership_id = reviewer_grant.granted_by_membership_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));
CREATE POLICY reviewer_grant_admin_update ON reviewer_grant FOR UPDATE TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true');

CREATE FUNCTION actor_has_reviewer_grant(p_organization_id uuid, p_department_id uuid,
    p_classification text, p_team_tag text, p_project_tag text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
          SELECT 1 FROM reviewer_grant g
          JOIN organization_membership om ON om.membership_id = g.reviewer_membership_id
          JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
          JOIN department d ON d.department_id = g.department_id AND d.status = 'ACTIVE'
          WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
            AND om.status = 'ACTIVE' AND om.organization_id = p_organization_id
            AND g.organization_id = p_organization_id AND g.department_id = p_department_id
            AND g.status = 'ACTIVE' AND g.valid_from <= now()
            AND (g.valid_until IS NULL OR g.valid_until > now())
            AND p_classification = ANY(g.classifications)
            AND (p_classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))
            AND (g.team_tag IS NULL OR g.team_tag IS NOT DISTINCT FROM p_team_tag)
            AND (g.project_tag IS NULL OR g.project_tag IS NOT DISTINCT FROM p_project_tag));
$$;
REVOKE ALL ON FUNCTION actor_has_reviewer_grant(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_has_reviewer_grant(uuid, uuid, text, text, text) TO arden_runtime;

ALTER TABLE shared_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_submission FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON shared_submission TO arden_runtime;
GRANT UPDATE (status) ON shared_submission TO arden_runtime;
CREATE POLICY flow2_submission_author_read ON shared_submission FOR SELECT TO arden_runtime
    USING (shared_draft_version_id IS NOT NULL
       AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM organization_membership om
           WHERE om.membership_id = shared_submission.submitted_by_membership_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));
CREATE POLICY flow2_submission_reviewer_read ON shared_submission FOR SELECT TO arden_runtime
    USING (shared_draft_version_id IS NOT NULL
       AND actor_has_reviewer_grant(organization_id, responsible_department_id,
           classification, team_tag, project_tag)
       AND submitted_by_membership_id <> (
           SELECT om.membership_id FROM organization_membership om
            WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.organization_id = shared_submission.organization_id));
CREATE POLICY flow2_submission_author_insert ON shared_submission FOR INSERT TO arden_runtime
    WITH CHECK (shared_draft_version_id IS NOT NULL AND draft_version_id IS NULL
       AND status = 'PENDING_REVIEW'
       AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM organization_membership om
           WHERE om.membership_id = shared_submission.submitted_by_membership_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));
CREATE POLICY flow2_submission_reviewer_update ON shared_submission FOR UPDATE TO arden_runtime
    USING (shared_draft_version_id IS NOT NULL AND status = 'PENDING_REVIEW'
       AND actor_has_reviewer_grant(organization_id, responsible_department_id,
           classification, team_tag, project_tag)
       AND submitted_by_membership_id <> (
           SELECT om.membership_id FROM organization_membership om
            WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND om.organization_id = shared_submission.organization_id))
    WITH CHECK (shared_draft_version_id IS NOT NULL
       AND status IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')
       AND actor_has_reviewer_grant(organization_id, responsible_department_id,
           classification, team_tag, project_tag));

ALTER TABLE review_decision ADD COLUMN snapshot_version_id uuid REFERENCES shared_draft_version(shared_draft_version_id);
ALTER TABLE review_decision ADD COLUMN content_hash text;
ALTER TABLE review_decision ADD CONSTRAINT ck_flow2_review_snapshot CHECK (
    NOT flow2 OR (decision_request_id IS NOT NULL AND snapshot_version_id IS NOT NULL
        AND content_hash IS NOT NULL AND content_hash ~ '^[0-9a-f]{64}$'));

CREATE OR REPLACE FUNCTION validate_review_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; reviewer_org uuid;
BEGIN
    SELECT s.submitted_by_membership_id, s.organization_id, s.shared_draft_version_id,
           s.content_hash, s.responsible_department_id, s.classification,
           s.team_tag, s.project_tag, s.audience_role_ids, s.status
      INTO STRICT submission_row FROM shared_submission s WHERE s.submission_id = NEW.submission_id;
    SELECT organization_id INTO STRICT reviewer_org FROM organization_membership
     WHERE membership_id = NEW.reviewer_membership_id;
    IF NEW.reviewer_membership_id = submission_row.submitted_by_membership_id
        OR reviewer_org IS DISTINCT FROM COALESCE(submission_row.organization_id,
            (SELECT organization_id FROM organization_membership WHERE membership_id = submission_row.submitted_by_membership_id)) THEN
        RAISE EXCEPTION 'Reviewer must be a different member of the submission organization' USING ERRCODE = '23514';
    END IF;
    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NOT NEW.flow2
            OR NEW.snapshot_version_id IS DISTINCT FROM submission_row.shared_draft_version_id
            OR NEW.content_hash IS DISTINCT FROM submission_row.content_hash
            OR NOT actor_has_reviewer_grant(submission_row.organization_id,
                submission_row.responsible_department_id, submission_row.classification,
                submission_row.team_tag, submission_row.project_tag) THEN
            RAISE EXCEPTION 'Review decision does not match a live authorized snapshot' USING ERRCODE = '23514';
        END IF;
        IF NEW.decision = 'APPROVED' AND EXISTS (
            SELECT 1 FROM unnest(submission_row.audience_role_ids) AS audience(role_id)
            LEFT JOIN role r ON r.role_id = audience.role_id
            WHERE r.role_id IS NULL OR r.organization_id IS DISTINCT FROM submission_row.organization_id
               OR r.status <> 'ACTIVE' OR r.is_system
               OR NOT EXISTS (SELECT 1 FROM role_permission rp JOIN permission p
                   ON p.permission_id = rp.permission_id
                   WHERE rp.role_id = r.role_id AND p.code = 'PUBLISHED_CONTENT_VIEW')) THEN
            RAISE EXCEPTION 'Approval audience is no longer enforceable' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE review_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_decision FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON review_decision TO arden_runtime;
CREATE POLICY flow2_review_decision_read ON review_decision FOR SELECT TO arden_runtime
    USING (flow2 AND EXISTS (SELECT 1 FROM shared_submission s
        WHERE s.submission_id = review_decision.submission_id));
CREATE POLICY flow2_review_decision_insert ON review_decision FOR INSERT TO arden_runtime
    WITH CHECK (flow2 AND EXISTS (SELECT 1 FROM shared_submission s
        WHERE s.submission_id = review_decision.submission_id AND s.status = 'PENDING_REVIEW'
          AND s.submitted_by_membership_id <> review_decision.reviewer_membership_id
          AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
              s.classification, s.team_tag, s.project_tag))
       AND EXISTS (SELECT 1 FROM organization_membership om
           WHERE om.membership_id = review_decision.reviewer_membership_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));

CREATE FUNCTION actor_in_publication_audience(p_organization_id uuid, p_role_ids uuid[],
    p_scope_type text, p_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
           SELECT 1 FROM organization_membership om
           JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
           JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
           JOIN role_assignment ra ON ra.membership_id = om.membership_id
           JOIN role r ON r.role_id = ra.role_id AND r.organization_id = p_organization_id
                       AND r.status = 'ACTIVE' AND NOT r.is_system
           JOIN role_permission rp ON rp.role_id = r.role_id
           JOIN permission permission ON permission.permission_id = rp.permission_id
               AND permission.code = 'PUBLISHED_CONTENT_VIEW'
           JOIN access_scope scope ON scope.access_scope_id = ra.access_scope_id
               AND scope.organization_id = p_organization_id AND scope.status = 'ACTIVE'
           WHERE om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.organization_id = p_organization_id AND om.status = 'ACTIVE'
             AND ra.status = 'ACTIVE' AND ra.valid_from <= now()
             AND (ra.valid_until IS NULL OR ra.valid_until > now())
             AND r.role_id = ANY(p_role_ids)
             AND (scope.scope_type = 'ORGANIZATION' OR EXISTS (
                 SELECT 1 FROM department_membership dm
                  WHERE dm.membership_id = om.membership_id
                    AND dm.department_id = scope.department_id AND dm.status = 'ACTIVE'))
             AND (p_scope_type = 'ORGANIZATION' OR
                  (p_scope_type = 'DEPARTMENT' AND
                   (scope.scope_type = 'ORGANIZATION' OR scope.department_id = p_department_id)
                   AND EXISTS (SELECT 1 FROM department_membership target_dm
                       WHERE target_dm.membership_id = om.membership_id
                         AND target_dm.department_id = p_department_id
                         AND target_dm.status = 'ACTIVE'))));
$$;
REVOKE ALL ON FUNCTION actor_in_publication_audience(uuid, uuid[], text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION actor_in_publication_audience(uuid, uuid[], text, uuid) TO arden_runtime;

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON knowledge_base TO arden_runtime;
CREATE POLICY flow2_knowledge_base_member_read ON knowledge_base FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM organization_membership om
           WHERE om.organization_id = knowledge_base.organization_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));
CREATE POLICY flow2_knowledge_base_reviewer_insert ON knowledge_base FOR INSERT TO arden_runtime
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND name = 'Arden Knowledge' AND status = 'ACTIVE'
       AND EXISTS (SELECT 1 FROM shared_submission s
           WHERE s.submission_id::text = current_setting('arden.publishing_submission_id', true)
             AND s.organization_id = knowledge_base.organization_id
             AND s.target_scope_type = knowledge_base.scope_type
             AND s.target_department_id IS NOT DISTINCT FROM knowledge_base.department_id
             AND s.status = 'APPROVED'
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)));

CREATE OR REPLACE FUNCTION validate_published_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; knowledge_row record; publisher_org uuid;
BEGIN
    SELECT s.*, m.organization_id AS submitter_org INTO STRICT submission_row
      FROM shared_submission s
      JOIN organization_membership m ON m.membership_id = s.submitted_by_membership_id
     WHERE s.submission_id = NEW.submission_id;
    SELECT organization_id, scope_type, department_id INTO STRICT knowledge_row
      FROM knowledge_base WHERE knowledge_base_id = NEW.knowledge_base_id;
    IF submission_row.status <> 'APPROVED'
        OR submission_row.submitter_org IS DISTINCT FROM knowledge_row.organization_id THEN
        RAISE EXCEPTION 'Publication requires an approved same-organization submission' USING ERRCODE = '23514';
    END IF;
    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NEW.published_by_membership_id IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM review_decision rd
                WHERE rd.submission_id = NEW.submission_id AND rd.flow2 AND rd.decision = 'APPROVED')
            OR NEW.shared_draft_id IS DISTINCT FROM submission_row.shared_draft_id
            OR NEW.title IS DISTINCT FROM submission_row.title
            OR NEW.classification IS DISTINCT FROM submission_row.classification
            OR NEW.responsible_department_id IS DISTINCT FROM submission_row.responsible_department_id
            OR NEW.audience_role_ids IS DISTINCT FROM submission_row.audience_role_ids
            OR NEW.content_uri IS DISTINCT FROM submission_row.content_uri
            OR NEW.content_hash IS DISTINCT FROM submission_row.content_hash
            OR NEW.valid_from IS NULL
            OR knowledge_row.scope_type IS DISTINCT FROM submission_row.target_scope_type
            OR knowledge_row.department_id IS DISTINCT FROM submission_row.target_department_id THEN
            RAISE EXCEPTION 'System publication must match the exact approved snapshot and scope'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT organization_id INTO STRICT publisher_org FROM organization_membership
         WHERE membership_id = NEW.published_by_membership_id;
        IF publisher_org IS DISTINCT FROM submission_row.submitter_org THEN
            RAISE EXCEPTION 'Legacy publisher belongs to another organization' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION protect_flow2_published_metadata()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.shared_draft_id IS NOT NULL AND
       (NEW.shared_draft_id, NEW.classification, NEW.responsible_department_id,
        NEW.audience_role_ids, NEW.valid_from, NEW.valid_until)
       IS DISTINCT FROM
       (OLD.shared_draft_id, OLD.classification, OLD.responsible_department_id,
        OLD.audience_role_ids, OLD.valid_from, OLD.valid_until) THEN
        RAISE EXCEPTION 'Published governance metadata is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_protect_flow2_published_metadata BEFORE UPDATE ON published_knowledge_version
FOR EACH ROW EXECUTE FUNCTION protect_flow2_published_metadata();

ALTER TABLE published_knowledge_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE published_knowledge_version FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON published_knowledge_version TO arden_runtime;

ALTER TABLE knowledge_current_publication ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_current_publication FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON knowledge_current_publication TO arden_runtime;
GRANT UPDATE (published_version_id, audience_role_ids, target_scope_type,
              target_department_id, valid_from, valid_until, updated_at)
    ON knowledge_current_publication TO arden_runtime;
CREATE POLICY flow2_current_publication_audience_read ON knowledge_current_publication FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())
       AND actor_in_publication_audience(organization_id, audience_role_ids,
           target_scope_type, target_department_id));
CREATE POLICY flow2_current_publication_reviewer_read ON knowledge_current_publication FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM shared_submission s
           WHERE s.shared_draft_id = knowledge_current_publication.shared_draft_id
             AND s.submission_id::text = current_setting('arden.publishing_submission_id', true)
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)));
CREATE POLICY flow2_published_audience_read ON published_knowledge_version FOR SELECT TO arden_runtime
    USING (shared_draft_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM knowledge_current_publication cp
         WHERE cp.published_version_id = published_knowledge_version.published_version_id));
CREATE POLICY flow2_published_reviewer_read ON published_knowledge_version FOR SELECT TO arden_runtime
    USING (shared_draft_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM shared_submission s
         WHERE s.submission_id = published_knowledge_version.submission_id
           AND s.submission_id::text = current_setting('arden.publishing_submission_id', true)
           AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
               s.classification, s.team_tag, s.project_tag)));
CREATE POLICY flow2_published_reviewer_insert ON published_knowledge_version FOR INSERT TO arden_runtime
    WITH CHECK (shared_draft_id IS NOT NULL AND published_by_membership_id IS NULL
       AND EXISTS (SELECT 1 FROM shared_submission s
           WHERE s.submission_id = published_knowledge_version.submission_id
             AND s.submission_id::text = current_setting('arden.publishing_submission_id', true)
             AND s.status = 'APPROVED'
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)));

CREATE FUNCTION validate_current_publication()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE publication_row record;
BEGIN
    SELECT pv.shared_draft_id, pv.audience_role_ids, pv.valid_from, pv.valid_until,
           kb.organization_id, kb.scope_type, kb.department_id
      INTO STRICT publication_row FROM published_knowledge_version pv
      JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
     WHERE pv.published_version_id = NEW.published_version_id;
    IF publication_row.shared_draft_id IS DISTINCT FROM NEW.shared_draft_id
        OR publication_row.organization_id IS DISTINCT FROM NEW.organization_id
        OR publication_row.audience_role_ids IS DISTINCT FROM NEW.audience_role_ids
        OR publication_row.scope_type IS DISTINCT FROM NEW.target_scope_type
        OR publication_row.department_id IS DISTINCT FROM NEW.target_department_id
        OR publication_row.valid_from IS DISTINCT FROM NEW.valid_from
        OR publication_row.valid_until IS DISTINCT FROM NEW.valid_until THEN
        RAISE EXCEPTION 'Current pointer must exactly match its published version' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_current_publication() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER trg_validate_current_publication
AFTER INSERT OR UPDATE ON knowledge_current_publication
DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION validate_current_publication();

CREATE POLICY flow2_current_publication_reviewer_insert ON knowledge_current_publication FOR INSERT TO arden_runtime
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM shared_submission s
           JOIN published_knowledge_version pv ON pv.submission_id = s.submission_id
           WHERE pv.published_version_id = knowledge_current_publication.published_version_id
             AND s.submission_id::text = current_setting('arden.publishing_submission_id', true)
             AND s.status = 'APPROVED'
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)));
CREATE POLICY flow2_current_publication_reviewer_update ON knowledge_current_publication FOR UPDATE TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM shared_submission s
           WHERE s.shared_draft_id = knowledge_current_publication.shared_draft_id
             AND s.organization_id = knowledge_current_publication.organization_id
             AND s.submission_id::text = current_setting('arden.publishing_submission_id', true)
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)))
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM shared_submission s
           JOIN published_knowledge_version pv ON pv.submission_id = s.submission_id
           WHERE pv.published_version_id = knowledge_current_publication.published_version_id
             AND s.submission_id::text = current_setting('arden.publishing_submission_id', true)
             AND s.status = 'APPROVED'
             AND actor_has_reviewer_grant(s.organization_id, s.responsible_department_id,
                 s.classification, s.team_tag, s.project_tag)));

CREATE POLICY flow2_system_publication_audit ON audit_event FOR INSERT TO arden_runtime
    WITH CHECK (actor_membership_id IS NULL AND event_type = 'KNOWLEDGE_AUTO_PUBLISHED'
       AND outcome = 'SUCCESS' AND review_decision_id IS NOT NULL
       AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM review_decision rd
           JOIN shared_submission s ON s.submission_id = rd.submission_id
           JOIN organization_membership om ON om.membership_id = rd.reviewer_membership_id
           WHERE rd.review_decision_id = audit_event.review_decision_id
             AND rd.flow2 AND rd.decision = 'APPROVED' AND s.status = 'APPROVED'
             AND s.organization_id = audit_event.organization_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid));
GRANT SELECT ON audit_event TO arden_runtime;
CREATE POLICY flow2_review_audit_read ON audit_event FOR SELECT TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND review_decision_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM review_decision rd
           JOIN organization_membership om ON om.membership_id = rd.reviewer_membership_id
           WHERE rd.review_decision_id = audit_event.review_decision_id
             AND rd.flow2 AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid));

CREATE FUNCTION enforce_flow2_review_outcome()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
DECLARE submission_row record; publication_count integer; current_count integer;
BEGIN
    IF NOT NEW.flow2 THEN RETURN NEW; END IF;
    SELECT status, organization_id, responsible_department_id, classification, team_tag, project_tag
      INTO STRICT submission_row FROM shared_submission WHERE submission_id = NEW.submission_id;
    IF submission_row.status IS DISTINCT FROM NEW.decision
        OR NOT actor_has_reviewer_grant(submission_row.organization_id,
            submission_row.responsible_department_id, submission_row.classification,
            submission_row.team_tag, submission_row.project_tag) THEN
        RAISE EXCEPTION 'Review decision and submission status diverged' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO publication_count FROM published_knowledge_version
     WHERE submission_id = NEW.submission_id;
    IF NEW.decision = 'APPROVED' THEN
        SELECT count(*) INTO current_count FROM knowledge_current_publication cp
        JOIN published_knowledge_version pv ON pv.published_version_id = cp.published_version_id
        WHERE pv.submission_id = NEW.submission_id;
        IF publication_count <> 1 OR current_count <> 1
            OR NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.review_decision_id = NEW.review_decision_id
                AND a.event_type = 'KNOWLEDGE_AUTO_PUBLISHED' AND a.outcome = 'SUCCESS') THEN
            RAISE EXCEPTION 'Final approval must atomically publish and audit the approved snapshot'
                USING ERRCODE = '23514';
        END IF;
    ELSIF publication_count <> 0 THEN
        RAISE EXCEPTION 'Rejected or revision-requested submission cannot be published' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.review_decision_id = NEW.review_decision_id
        AND a.event_type = 'KNOWLEDGE_REVIEW_DECIDED' AND a.outcome = 'SUCCESS') THEN
        RAISE EXCEPTION 'Review decision needs a separate audit record' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION enforce_flow2_review_outcome() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER trg_enforce_flow2_review_outcome
AFTER INSERT ON review_decision DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_flow2_review_outcome();
