SET search_path TO arden, public;

-- Document Type lives in management metadata. Retire the unused catalog and
-- policy scaffold after checking that no custom classification would be lost.
LOCK TABLE organization, shared_draft, shared_submission, document_category, authorization_policy
    IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM authorization_policy) THEN
        RAISE EXCEPTION 'Legacy authorization policies need reconciliation before retirement' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM document_category c WHERE c.status <> 'ACTIVE' OR NOT EXISTS (
            SELECT 1 FROM default_document_categories() d
             WHERE (d.code, d.name, d.sort_order, d.is_default) = (c.code, c.name, c.sort_order, c.is_default)
        )
    ) OR EXISTS (
        SELECT 1 FROM shared_draft d JOIN document_category c USING (category_id) WHERE NOT c.is_default
    ) OR EXISTS (
        SELECT 1 FROM shared_submission s JOIN document_category c USING (category_id) WHERE NOT c.is_default
    ) THEN
        RAISE EXCEPTION 'Legacy document categories need reconciliation before retirement' USING ERRCODE = '55000';
    END IF;
END;
$$;

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
        NEW.keywords, NEW.change_description,
        NEW.request_type, NEW.request_reason, NEW.target_published_version_id,
        NEW.renewal_expiration_date, NEW.on_behalf_of_author, NEW.author_decides_until)
       IS DISTINCT FROM
       (OLD.shared_draft_version_id, OLD.shared_draft_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_membership_id,
        OLD.target_scope_type, OLD.target_department_id, OLD.responsible_department_id,
        OLD.title, OLD.classification, OLD.team_tag, OLD.project_tag,
        OLD.audience_role_ids, OLD.policy_version, OLD.review_rule, OLD.content_uri, OLD.mime_type,
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

DROP TRIGGER trg_seed_document_categories ON organization;
DROP FUNCTION seed_document_categories();
ALTER TABLE shared_submission DROP COLUMN category_id;
ALTER TABLE shared_draft DROP COLUMN category_id;
DROP TABLE document_category;
DROP FUNCTION default_document_categories();
DROP TABLE authorization_policy;
