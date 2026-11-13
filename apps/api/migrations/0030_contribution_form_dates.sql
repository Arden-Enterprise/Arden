SET search_path TO arden, public;

-- Flow 2 T3.2 (BM04 RF-03): the contribution form's Effective and Expiration Dates.
-- Both dates are optional (maintainer decision 2026-11-12, replacing the SRS "Effective Date *"); when both
-- are set, the Expiration Date is later than the Effective Date. The submission freezes both with the
-- snapshot. Activation and expiry by date belong to T4.1-T4.3; this migration only stores the values.

ALTER TABLE shared_draft ADD COLUMN effective_date date;
ALTER TABLE shared_draft ADD COLUMN expiration_date date;
ALTER TABLE shared_draft ADD CONSTRAINT ck_shared_draft_dates
    CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date > effective_date);
GRANT UPDATE (effective_date, expiration_date) ON shared_draft TO arden_runtime;

ALTER TABLE shared_submission ADD COLUMN effective_date date;
ALTER TABLE shared_submission ADD COLUMN expiration_date date;
ALTER TABLE shared_submission ADD CONSTRAINT ck_shared_submission_dates
    CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date > effective_date);

-- Same rules as 0027, with the frozen dates added to the immutable snapshot tuple.
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
        NEW.category_id, NEW.keywords, NEW.change_description, NEW.effective_date, NEW.expiration_date)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id, OLD.proposed_selection_id,
        OLD.category_id, OLD.keywords, OLD.change_description, OLD.effective_date, OLD.expiration_date) THEN
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
