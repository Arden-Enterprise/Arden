SET search_path TO arden, public;

-- Flow 2 T6.1 (BM04 RF-03, SDD S-16): requests to change the readers of a published document or to
-- withdraw it. A request is a shared_submission with request_type READER_CHANGE or WITHDRAWAL and a reason.
-- It points at the current publication it asks about and reuses that publication's frozen snapshot, so it
-- routes to the same reviewers. While it is pending, the current version and readers do not change; this
-- migration records requests only. Approving them (applying readers, WITHDRAWN) is T6.2, so until then the
-- database refuses an approval of a change request.
--
-- Operator rollout: replaces two reviewed SECURITY DEFINER validation routines; apply as the trusted
-- superuser so they keep their postgres owner (20 in total, unchanged).

ALTER TABLE shared_submission ADD COLUMN request_type text NOT NULL DEFAULT 'CONTENT';
ALTER TABLE shared_submission ADD COLUMN request_reason text;
ALTER TABLE shared_submission ADD COLUMN target_published_version_id uuid;
ALTER TABLE shared_submission ADD CONSTRAINT fk_shared_submission_target_publication
    FOREIGN KEY (target_published_version_id) REFERENCES published_knowledge_version(published_version_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_request_type
    CHECK (request_type IN ('CONTENT', 'READER_CHANGE', 'WITHDRAWAL'));
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_request_shape CHECK (
    (request_type = 'CONTENT' AND request_reason IS NULL AND target_published_version_id IS NULL)
    OR (request_type <> 'CONTENT' AND shared_draft_version_id IS NOT NULL
        AND target_published_version_id IS NOT NULL
        AND request_reason IS NOT NULL AND length(btrim(request_reason)) BETWEEN 1 AND 1000
        AND (request_type = 'READER_CHANGE') = (proposed_selection_id IS NOT NULL)));

-- A change request reuses the published snapshot, so only content submissions keep a snapshot unique.
DROP INDEX uq_flow2_submitted_snapshot;
CREATE UNIQUE INDEX uq_flow2_submitted_snapshot ON shared_submission (shared_draft_version_id)
    WHERE shared_draft_version_id IS NOT NULL AND request_type = 'CONTENT';

-- Same rules as 0030, with the request columns added to the immutable tuple.
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
        NEW.category_id, NEW.keywords, NEW.change_description, NEW.effective_date, NEW.expiration_date,
        NEW.request_type, NEW.request_reason, NEW.target_published_version_id)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id, OLD.proposed_selection_id,
        OLD.category_id, OLD.keywords, OLD.change_description, OLD.effective_date, OLD.expiration_date,
        OLD.request_type, OLD.request_reason, OLD.target_published_version_id) THEN
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

-- 0024 rule for content submissions (they freeze the draft's readers). A reader-change request instead
-- carries its own new readers, which must belong to the same organization (enforced by the foreign key).
CREATE OR REPLACE FUNCTION validate_submission_reader_selection()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NEW.approved_selection_id IS NOT NULL THEN
        RAISE EXCEPTION 'A submission cannot be created with approved readers' USING ERRCODE = '23514';
    END IF;
    IF NEW.request_type = 'CONTENT' AND NEW.shared_draft_id IS NOT NULL
       AND NEW.proposed_selection_id IS DISTINCT FROM (
        SELECT d.draft_selection_id FROM shared_draft d WHERE d.shared_draft_id = NEW.shared_draft_id) THEN
        RAISE EXCEPTION 'Submission must freeze the draft reader selection' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

-- 0010/0016 rules for content submissions, unchanged. A change request must come from the document's author
-- and repeat exactly the snapshot of the publication that is current for the document.
CREATE OR REPLACE FUNCTION validate_shared_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE source_org uuid; submitter_org uuid; department_org uuid; source_row record; published_row record;
BEGIN
    SELECT organization_id INTO STRICT submitter_org FROM organization_membership
     WHERE membership_id = NEW.submitted_by_membership_id;
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

-- Until T6.2 defines what an approved change request does, a reviewer may only reject it.
CREATE FUNCTION reject_change_request_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NEW.decision = 'APPROVED' AND EXISTS (SELECT 1 FROM shared_submission s
        WHERE s.submission_id = NEW.submission_id AND s.request_type <> 'CONTENT') THEN
        RAISE EXCEPTION 'Approving reader-change and withdrawal requests is not available yet'
            USING ERRCODE = '0A000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION reject_change_request_approval() FROM PUBLIC;
CREATE TRIGGER trg_reject_change_request_approval BEFORE INSERT ON review_decision
FOR EACH ROW EXECUTE FUNCTION reject_change_request_approval();
