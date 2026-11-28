SET LOCAL search_path TO arden, public;

-- Rename in place so identity values, data, FKs, grants and RLS keep their OIDs.
-- These names are the physical schema. Function result aliases remain stable for
-- existing Core and worker contracts.

ALTER TABLE arden.access_scope RENAME COLUMN access_scope_id TO id;
ALTER TABLE arden.access_scope RENAME COLUMN scope_type TO scope;
ALTER TABLE arden.account RENAME COLUMN user_id TO id;
ALTER TABLE arden.ai_usage RENAME COLUMN usage_event_id TO id;
ALTER TABLE arden.ai_usage RENAME COLUMN usage_complete TO is_complete;
ALTER TABLE arden.answer_feedback RENAME COLUMN feedback_id TO id;
ALTER TABLE arden.answer_result RENAME COLUMN owner_membership_id TO owner_id;
ALTER TABLE arden.answer_result RENAME COLUMN result_type TO type;
ALTER TABLE arden.answer_result RENAME COLUMN answer_status TO status;
ALTER TABLE arden.audit_event RENAME COLUMN audit_event_id TO id;
ALTER TABLE arden.audit_event RENAME COLUMN actor_membership_id TO actor_id;
ALTER TABLE arden.audit_event RENAME COLUMN details_json TO details;
ALTER TABLE arden.case_analysis RENAME COLUMN run_id TO id;
ALTER TABLE arden.case_analysis RENAME COLUMN state TO status;
ALTER TABLE arden.case_analysis RENAME COLUMN fence TO fence_token;
ALTER TABLE arden.case_analysis RENAME COLUMN lease_until TO lease_expires_at;
ALTER TABLE arden.case_analysis RENAME COLUMN version_ids TO input_version_ids;
ALTER TABLE arden.case_analysis RENAME COLUMN started_by_membership_id TO started_by_id;
ALTER TABLE arden.case_event RENAME COLUMN event_id TO id;
ALTER TABLE arden.case_event RENAME COLUMN actor_membership_id TO actor_id;
ALTER TABLE arden.case_event RENAME COLUMN audience TO visibility;
ALTER TABLE arden.case_intake_key RENAME COLUMN actor_membership_id TO actor_id;
ALTER TABLE arden.case_intake_key RENAME COLUMN request_key TO idempotency_key;
ALTER TABLE arden.company_document RENAME COLUMN shared_draft_id TO id;
ALTER TABLE arden.company_document RENAME COLUMN author_membership_id TO author_id;
ALTER TABLE arden.company_document RENAME COLUMN responsible_department_id TO owner_department_id;
ALTER TABLE arden.company_document RENAME COLUMN target_scope_type TO target_scope;
ALTER TABLE arden.company_document RENAME COLUMN draft_selection_id TO reader_policy_id;
ALTER TABLE arden.company_document RENAME COLUMN management TO metadata;
ALTER TABLE arden.conversation RENAME COLUMN conversation_id TO id;
ALTER TABLE arden.conversation RENAME COLUMN owner_membership_id TO owner_id;
ALTER TABLE arden.conversation_turn RENAME COLUMN turn_id TO id;
ALTER TABLE arden.conversation_turn RENAME COLUMN ui_surface TO surface;
ALTER TABLE arden.current_publication RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.current_publication RENAME COLUMN target_scope_type TO target_scope;
ALTER TABLE arden.current_publication RENAME COLUMN reader_selection_id TO reader_policy_id;
ALTER TABLE arden.department RENAME COLUMN department_id TO id;
ALTER TABLE arden.department_membership RENAME COLUMN department_membership_id TO id;
ALTER TABLE arden.direct_share RENAME COLUMN share_id TO id;
ALTER TABLE arden.direct_share RENAME COLUMN draft_id TO document_id;
ALTER TABLE arden.direct_share RENAME COLUMN owner_membership_id TO owner_id;
ALTER TABLE arden.direct_share RENAME COLUMN recipient_membership_id TO recipient_id;
ALTER TABLE arden.direct_share RENAME COLUMN revoked_by_membership_id TO revoked_by_id;
ALTER TABLE arden.document_relationship RENAME COLUMN relationship_id TO id;
ALTER TABLE arden.document_relationship RENAME COLUMN relationship_type TO type;
ALTER TABLE arden.document_relationship RENAME COLUMN created_by_membership_id TO created_by_id;
ALTER TABLE arden.handbook RENAME COLUMN collection_id TO id;
ALTER TABLE arden.handbook RENAME COLUMN configuration_version TO revision;
ALTER TABLE arden.handbook_placement RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.handbook_placement RENAME COLUMN collection_id TO handbook_id;
ALTER TABLE arden.handbook_placement RENAME COLUMN placement_revision TO revision;
ALTER TABLE arden.index_generation RENAME COLUMN generation_id TO id;
ALTER TABLE arden.index_generation RENAME COLUMN submission_id TO review_submission_id;
ALTER TABLE arden.index_generation RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.index_generation RENAME COLUMN manifest_json TO manifest;
ALTER TABLE arden.inspection RENAME COLUMN inspection_id TO id;
ALTER TABLE arden.inspection RENAME COLUMN admin_membership_id TO opened_by_id;
ALTER TABLE arden.inspection RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.invitation RENAME COLUMN invitation_id TO id;
ALTER TABLE arden.invitation RENAME COLUMN invited_by_membership_id TO invited_by_id;
ALTER TABLE arden.invitation RENAME COLUMN accepted_by_user_id TO accepted_by_account_id;
ALTER TABLE arden.knowledge_base RENAME COLUMN knowledge_base_id TO id;
ALTER TABLE arden.knowledge_base RENAME COLUMN scope_type TO scope;
ALTER TABLE arden.maintenance_case RENAME COLUMN case_id TO id;
ALTER TABLE arden.maintenance_case RENAME COLUMN reporter_membership_id TO reporter_id;
ALTER TABLE arden.maintenance_case RENAME COLUMN route_department_id TO review_department_id;
ALTER TABLE arden.maintenance_case RENAME COLUMN author_membership_id TO author_id;
ALTER TABLE arden.maintenance_case RENAME COLUMN assignee_membership_id TO assignee_id;
ALTER TABLE arden.maintenance_case RENAME COLUMN publication_link_version_id TO remedy_version_id;
ALTER TABLE arden.maintenance_case RENAME COLUMN publication_link_reason TO remedy_reason;
ALTER TABLE arden.maintenance_case RENAME COLUMN publication_link_submission_id TO remedy_request_id;
ALTER TABLE arden.membership RENAME COLUMN membership_id TO id;
ALTER TABLE arden.membership RENAME COLUMN user_id TO account_id;
ALTER TABLE arden.notification RENAME COLUMN notification_id TO id;
ALTER TABLE arden.notification RENAME COLUMN recipient_membership_id TO recipient_id;
ALTER TABLE arden.notification_outbox RENAME COLUMN outbox_id TO id;
ALTER TABLE arden.notification_outbox RENAME COLUMN lease_owner TO lease_owner_id;
ALTER TABLE arden.organization RENAME COLUMN organization_id TO id;
ALTER TABLE arden.organization RENAME COLUMN created_by_user_id TO created_by_account_id;
ALTER TABLE arden.organization RENAME COLUMN direct_share_updated_by_membership_id TO direct_share_updated_by_id;
ALTER TABLE arden.permission RENAME COLUMN permission_id TO id;
ALTER TABLE arden.policy_reader RENAME COLUMN selected_reader_id TO id;
ALTER TABLE arden.policy_reader RENAME COLUMN selection_id TO reader_policy_id;
ALTER TABLE arden.policy_reader RENAME COLUMN ordinal TO position;
ALTER TABLE arden.private_document RENAME COLUMN draft_id TO id;
ALTER TABLE arden.private_document RENAME COLUMN collection_id TO folder_id;
ALTER TABLE arden.private_document RENAME COLUMN sort_position TO position;
ALTER TABLE arden.private_folder RENAME COLUMN collection_id TO id;
ALTER TABLE arden.private_folder RENAME COLUMN parent_collection_id TO parent_folder_id;
ALTER TABLE arden.private_version RENAME COLUMN draft_version_id TO id;
ALTER TABLE arden.private_version RENAME COLUMN draft_id TO document_id;
ALTER TABLE arden.private_version RENAME COLUMN source_uri TO file_uri;
ALTER TABLE arden.private_version RENAME COLUMN created_by_membership_id TO created_by_id;
ALTER TABLE arden.private_version RENAME COLUMN text_source_uri TO text_uri;
ALTER TABLE arden.private_version RENAME COLUMN content_size_bytes TO size_bytes;
ALTER TABLE arden.private_workspace RENAME COLUMN workspace_id TO id;
ALTER TABLE arden.publication_renewal RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.publication_renewal RENAME COLUMN expiration_date TO valid_until;
ALTER TABLE arden.publication_renewal RENAME COLUMN renewal_submission_id TO review_submission_id;
ALTER TABLE arden.published_version RENAME COLUMN published_version_id TO id;
ALTER TABLE arden.published_version RENAME COLUMN submission_id TO review_submission_id;
ALTER TABLE arden.published_version RENAME COLUMN published_by_membership_id TO published_by_id;
ALTER TABLE arden.published_version RENAME COLUMN content_uri TO file_uri;
ALTER TABLE arden.published_version RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.published_version RENAME COLUMN responsible_department_id TO owner_department_id;
ALTER TABLE arden.published_version RENAME COLUMN reader_selection_id TO reader_policy_id;
ALTER TABLE arden.published_version RENAME COLUMN management TO metadata;
ALTER TABLE arden.published_version RENAME COLUMN author_membership_id TO author_id;
ALTER TABLE arden.reader_policy RENAME COLUMN selection_id TO id;
ALTER TABLE arden.reader_policy RENAME COLUMN reader_mode TO mode;
ALTER TABLE arden.relationship_request_key RENAME COLUMN actor_membership_id TO actor_id;
ALTER TABLE arden.relationship_request_key RENAME COLUMN status_code TO http_status;
ALTER TABLE arden.relationship_request_key RENAME COLUMN response_json TO response;
ALTER TABLE arden.review_decision RENAME COLUMN review_decision_id TO id;
ALTER TABLE arden.review_decision RENAME COLUMN submission_id TO review_submission_id;
ALTER TABLE arden.review_decision RENAME COLUMN reviewer_membership_id TO reviewer_id;
ALTER TABLE arden.review_decision RENAME COLUMN flow2 TO is_snapshot_review;
ALTER TABLE arden.review_decision RENAME COLUMN snapshot_version_id TO working_version_id;
ALTER TABLE arden.review_decision RENAME COLUMN approved_selection_id TO approved_reader_policy_id;
ALTER TABLE arden.review_submission RENAME COLUMN submission_id TO id;
ALTER TABLE arden.review_submission RENAME COLUMN draft_version_id TO private_version_id;
ALTER TABLE arden.review_submission RENAME COLUMN submitted_by_membership_id TO submitted_by_id;
ALTER TABLE arden.review_submission RENAME COLUMN target_scope_type TO target_scope;
ALTER TABLE arden.review_submission RENAME COLUMN shared_draft_version_id TO working_version_id;
ALTER TABLE arden.review_submission RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.review_submission RENAME COLUMN responsible_department_id TO owner_department_id;
ALTER TABLE arden.review_submission RENAME COLUMN content_uri TO file_uri;
ALTER TABLE arden.review_submission RENAME COLUMN proposed_selection_id TO proposed_reader_policy_id;
ALTER TABLE arden.review_submission RENAME COLUMN approved_selection_id TO approved_reader_policy_id;
ALTER TABLE arden.review_submission RENAME COLUMN management TO metadata;
ALTER TABLE arden.review_submission RENAME COLUMN withdrawn_by TO withdrawn_by_role;
ALTER TABLE arden.review_submission RENAME COLUMN withdrawn_reason TO withdrawal_reason;
ALTER TABLE arden.review_submission RENAME COLUMN renewal_expiration_date TO renewal_valid_until;
ALTER TABLE arden.review_submission RENAME COLUMN author_decides_until TO author_response_deadline;
ALTER TABLE arden.reviewer_grant RENAME COLUMN reviewer_grant_id TO id;
ALTER TABLE arden.reviewer_grant RENAME COLUMN reviewer_membership_id TO reviewer_id;
ALTER TABLE arden.reviewer_grant RENAME COLUMN granted_by_membership_id TO granted_by_id;
ALTER TABLE arden.role RENAME COLUMN role_id TO id;
ALTER TABLE arden.role RENAME COLUMN configuration_version TO revision;
ALTER TABLE arden.role_assignment RENAME COLUMN role_assignment_id TO id;
ALTER TABLE arden.working_version RENAME COLUMN shared_draft_version_id TO id;
ALTER TABLE arden.working_version RENAME COLUMN shared_draft_id TO document_id;
ALTER TABLE arden.working_version RENAME COLUMN content_uri TO file_uri;
ALTER TABLE arden.working_version RENAME COLUMN content_size_bytes TO size_bytes;
ALTER TABLE arden_system.admin_session RENAME COLUMN session_id TO id;
ALTER TABLE arden_system.administration_event RENAME COLUMN event_id TO id;
ALTER TABLE arden_system.administration_event RENAME COLUMN actor_admin_id TO actor_id;
ALTER TABLE arden_system.administration_event RENAME COLUMN target_admin_id TO target_id;
ALTER TABLE arden_system.administration_event RENAME COLUMN details_json TO details;
ALTER TABLE arden_system.administrator RENAME COLUMN admin_id TO id;
ALTER TABLE arden_system.administrator RENAME COLUMN granted_by_admin_id TO granted_by_id;
ALTER TABLE arden_system.administrator RENAME COLUMN revoked_by_admin_id TO revoked_by_id;
ALTER TABLE arden_system.auth_throttle RENAME COLUMN bucket TO bucket_key;

CREATE OR REPLACE FUNCTION arden.actor_can_manage_relationship_source(p_organization_id uuid, p_source_document_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT p_organization_id IS NOT NULL
       AND p_source_document_id IS NOT NULL
       AND p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND governance_actor_membership(p_organization_id) IS NOT NULL
       AND EXISTS (
           SELECT 1
             FROM current_publication cp
             JOIN company_document d
               ON d.id = cp.document_id
              AND d.organization_id = cp.organization_id
              AND d.status = 'ACTIVE'
             JOIN published_version pv
               ON pv.id = cp.published_version_id
              AND pv.document_id = cp.document_id
             JOIN knowledge_base kb
               ON kb.id = pv.knowledge_base_id
              AND kb.organization_id = cp.organization_id
            WHERE cp.organization_id = p_organization_id
              AND cp.document_id = p_source_document_id
              AND cp.valid_from <= now()
              AND (cp.valid_until IS NULL OR cp.valid_until > now())
              AND pv.published_at <= now()
              AND (
                  d.author_id = governance_actor_membership(p_organization_id)
                  OR (
                      governance_is_org_admin(governance_actor_membership(p_organization_id), p_organization_id)
                      AND actor_in_reader_selection(cp.reader_policy_id)
                  )
              )
       );
$function$;

CREATE OR REPLACE FUNCTION arden.actor_can_read_direct_share(p_draft_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT direct_sharing_enabled() AND EXISTS (
        SELECT 1 FROM direct_share s
         WHERE s.document_id = p_draft_id AND s.revoked_at IS NULL
           AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND actor_owns_private_membership(s.recipient_id)
           AND EXISTS (SELECT 1 FROM knowledge_reader_directory('', ARRAY[s.owner_id])))
$function$;

CREATE OR REPLACE FUNCTION arden.actor_has_review_scope(p_organization_id uuid, p_department_id uuid, p_classification text, p_target_scope text, p_review_rule text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
           SELECT 1 FROM reviewer_grant g
             JOIN membership om ON om.id = g.reviewer_id
             JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
             JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
             LEFT JOIN department d ON d.id = g.department_id AND d.organization_id = g.organization_id
            WHERE om.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
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
$function$;

CREATE OR REPLACE FUNCTION arden.actor_in_reader_selection(p_selection_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM reader_policy rs
          JOIN membership om
            ON om.organization_id = rs.organization_id AND om.status = 'ACTIVE'
           AND om.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
         WHERE rs.id = p_selection_id
           AND rs.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND (rs.mode = 'ORGANIZATION'
             OR (rs.mode = 'DEPARTMENT' AND EXISTS (
                 SELECT 1 FROM department_membership dm
                   JOIN department d ON d.id = dm.department_id
                                    AND d.organization_id = rs.organization_id AND d.status = 'ACTIVE'
                  WHERE dm.membership_id = om.id AND dm.department_id = rs.department_id
                    AND dm.status = 'ACTIVE'))
             OR (rs.mode = 'SELECTED_MEMBERS' AND EXISTS (
                 SELECT 1 FROM policy_reader sr
                  WHERE sr.reader_policy_id = rs.id AND sr.membership_id = om.id))));
$function$;

CREATE OR REPLACE FUNCTION arden.actor_owns_private_membership(p_membership_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM membership om
        JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
        WHERE om.id = p_membership_id AND om.status = 'ACTIVE'
          AND om.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    );
$function$;

CREATE OR REPLACE FUNCTION arden.advance_draft_current_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE private_document
       SET current_version_no = GREATEST(current_version_no, NEW.version_no)
     WHERE id = NEW.document_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.advance_shared_draft_current_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE company_document SET current_version_no = NEW.version_no
     WHERE id = NEW.document_id AND current_version_no = NEW.version_no - 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Shared draft version must advance by exactly one'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.apply_publication_change(p_submission_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE request record; current_version uuid;
BEGIN
    -- Only the review_decision trigger may apply an approval. Direct runtime calls could otherwise
    -- replay an older reader change after a later approval and restore readers that were removed.
    IF pg_trigger_depth() <> 1 THEN
        RAISE EXCEPTION 'Publication changes apply only inside a review decision' USING ERRCODE = '55000';
    END IF;
    SELECT s.request_type, s.document_id AS shared_draft_id, s.target_published_version_id, s.approved_reader_policy_id AS approved_selection_id, s.status,
           s.organization_id, s.renewal_valid_until AS renewal_expiration_date, s.on_behalf_of_author, s.submitted_by_id AS submitted_by_membership_id
      INTO request FROM review_submission s WHERE s.id = p_submission_id;
    IF NOT FOUND OR request.status <> 'APPROVED' OR request.request_type = 'CONTENT' THEN
        RAISE EXCEPTION 'Only an approved change request can be applied' USING ERRCODE = '55000';
    END IF;
    -- Same lock as activation (0021), so a pointer change and an activation of this document serialize.
    PERFORM 1 FROM company_document WHERE id = request.shared_draft_id FOR UPDATE;
    SELECT cp.published_version_id INTO current_version
      FROM current_publication cp WHERE cp.document_id = request.shared_draft_id FOR UPDATE;
    IF current_version IS DISTINCT FROM request.target_published_version_id THEN
        RAISE EXCEPTION 'The publication changed after the request was made' USING ERRCODE = '40001';
    END IF;

    IF request.request_type = 'RENEWAL' THEN
        -- Only validity changes: content, readers, owner, history and reports stay as they are.
        INSERT INTO publication_renewal (published_version_id, organization_id, document_id,
            valid_until, review_submission_id)
        VALUES (current_version, request.organization_id, request.shared_draft_id,
            request.renewal_expiration_date, p_submission_id)
        ON CONFLICT (published_version_id) DO UPDATE
           SET valid_until = EXCLUDED.valid_until,
               review_submission_id = EXCLUDED.review_submission_id, renewed_at = now();
        INSERT INTO audit_event (organization_id, actor_id, event_type, outcome, details)
        VALUES (request.organization_id, request.submitted_by_membership_id, 'KNOWLEDGE_PUBLICATION_RENEWED',
            'SUCCESS', jsonb_build_object('documentId', request.shared_draft_id, 'publishedVersionId', current_version,
                'submissionId', p_submission_id, 'expirationDate', request.renewal_expiration_date,
                'onBehalfOfAuthor', request.on_behalf_of_author));
    ELSIF request.request_type = 'READER_CHANGE' THEN
        IF request.approved_selection_id IS NULL THEN
            RAISE EXCEPTION 'A reader change needs approved readers' USING ERRCODE = '23514';
        END IF;
        UPDATE published_version SET reader_policy_id = request.approved_selection_id
         WHERE id = current_version;
        -- assign_current_publication_readers copies the published version's readers to the pointer.
        UPDATE current_publication SET updated_at = now() WHERE document_id = request.shared_draft_id;
    ELSE
        IF EXISTS (SELECT 1 FROM review_submission c WHERE c.document_id = request.shared_draft_id
                     AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING') THEN
            RAISE EXCEPTION 'A newer version is being prepared; withdraw after it finishes' USING ERRCODE = '40001';
        END IF;
        UPDATE review_submission SET publication_state = 'WITHDRAWN'
         WHERE id = (SELECT pv.review_submission_id AS submission_id FROM published_version pv
                                 WHERE pv.id = current_version);
        DELETE FROM current_publication WHERE document_id = request.shared_draft_id;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.apply_review_decision()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE kind text;
BEGIN
    UPDATE review_submission
       SET status = NEW.decision,
           publication_state = CASE WHEN NEW.decision = 'APPROVED' AND request_type = 'CONTENT'
                                    THEN 'PREPARING' ELSE 'NONE' END,
           approved_reader_policy_id = COALESCE(NEW.approved_reader_policy_id, approved_reader_policy_id)
     WHERE id = NEW.review_submission_id
     RETURNING request_type INTO kind;

    IF NEW.is_snapshot_review AND NEW.decision = 'APPROVED' AND kind <> 'CONTENT' THEN
        PERFORM apply_publication_change(NEW.review_submission_id);
    ELSIF NEW.is_snapshot_review AND NEW.decision = 'APPROVED' THEN
        INSERT INTO index_generation (
            organization_id, review_submission_id, document_id, snapshot_version_id, snapshot_content_hash,
            job_id, job_status, attempt_count, max_attempts, available_at, job_created_at, job_updated_at)
        SELECT organization_id, id, document_id, working_version_id, content_hash,
               gen_random_uuid(), 'PENDING', 0, 6, now(), now(), now()
          FROM review_submission
         WHERE id = NEW.review_submission_id;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.assign_current_publication_readers()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    SELECT pv.reader_policy_id AS reader_selection_id INTO STRICT NEW.reader_policy_id
      FROM published_version pv WHERE pv.id = NEW.published_version_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.assign_published_version_readers()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    SELECT s.approved_reader_policy_id AS approved_selection_id INTO STRICT NEW.reader_policy_id
      FROM review_submission s WHERE s.id = NEW.review_submission_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.check_reader_selection_size()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE reader_count integer;
BEGIN
    SELECT count(*) INTO reader_count FROM policy_reader WHERE reader_policy_id = NEW.id;
    IF NEW.mode = 'SELECTED_MEMBERS' AND reader_count NOT BETWEEN 2 AND 100 THEN
        RAISE EXCEPTION 'Selected Members needs 2 to 100 readers' USING ERRCODE = '23514';
    END IF;
    IF NEW.mode <> 'SELECTED_MEMBERS' AND reader_count <> 0 THEN
        RAISE EXCEPTION 'Only Selected Members selections list readers' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.claim_knowledge_index_job(p_worker_id uuid, p_lease_seconds integer DEFAULT 90)
 RETURNS TABLE(job_id uuid, generation_id uuid, organization_id uuid, submission_id uuid, snapshot_version_id uuid, snapshot_content_hash text, source_uri text, mime_type text, attempt_count integer, max_attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF p_worker_id IS NULL OR p_lease_seconds NOT BETWEEN 15 AND 600 THEN
        RAISE EXCEPTION 'Invalid indexing worker lease request' USING ERRCODE = '22023';
    END IF;

    WITH exhausted AS (
        UPDATE index_generation g
           SET status = 'FAILED', failure_code = 'INDEXING_LEASE_EXHAUSTED', completed_at = now(),
               job_status = 'FAILED', lease_owner_id = NULL, lease_expires_at = NULL,
               last_error_code = 'INDEXING_LEASE_EXHAUSTED', job_completed_at = now(), job_updated_at = now()
         WHERE g.job_status = 'RUNNING' AND g.lease_expires_at <= now()
           AND g.attempt_count >= g.max_attempts
        RETURNING g.review_submission_id AS submission_id
    )
    UPDATE review_submission s SET publication_state = 'FAILED'
      FROM exhausted e
     WHERE s.id = e.submission_id
       AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING';

    RETURN QUERY
    WITH candidate AS (
        SELECT g.id AS generation_id
          FROM index_generation g
          JOIN review_submission s ON s.id = g.review_submission_id
         WHERE ((g.job_status = 'PENDING' AND g.available_at <= now())
            OR (g.job_status = 'RUNNING' AND g.lease_expires_at <= now()))
           AND g.attempt_count < g.max_attempts
           AND g.status IN ('PENDING', 'PROCESSING')
           AND s.status = 'APPROVED' AND s.publication_state = 'PREPARING'
           AND s.working_version_id = g.snapshot_version_id AND s.content_hash = g.snapshot_content_hash
         ORDER BY g.available_at, g.job_created_at, g.job_id
         FOR UPDATE OF g, s SKIP LOCKED
         LIMIT 1
    ), claimed AS (
        UPDATE index_generation g
           SET status = 'PROCESSING', started_at = COALESCE(g.started_at, now()),
               job_status = 'RUNNING', attempt_count = g.attempt_count + 1, lease_owner_id = p_worker_id,
               lease_expires_at = now() + make_interval(secs => p_lease_seconds), last_error_code = NULL,
               job_updated_at = now()
          FROM candidate c
         WHERE g.id = c.generation_id
        RETURNING g.id AS generation_id,
           g.organization_id,
           g.review_submission_id AS submission_id,
           g.document_id AS shared_draft_id,
           g.snapshot_version_id,
           g.snapshot_content_hash,
           g.status,
           g.manifest AS manifest_json,
           g.failure_code,
           g.created_at,
           g.started_at,
           g.completed_at,
           g.updated_at,
           g.job_id,
           g.job_status,
           g.attempt_count,
           g.max_attempts,
           g.available_at,
           g.lease_owner_id,
           g.lease_expires_at,
           g.last_error_code,
           g.job_created_at,
           g.job_completed_at,
           g.job_updated_at
    )
    SELECT g.job_id, g.generation_id, g.organization_id, g.submission_id,
           g.snapshot_version_id, g.snapshot_content_hash, s.file_uri AS content_uri, s.mime_type,
           g.attempt_count, g.max_attempts
      FROM claimed g JOIN review_submission s ON s.id = g.submission_id;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.collection_source_eligible(p_organization_id uuid, p_document_id uuid, p_collection_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM current_publication cp
        JOIN published_version pv ON pv.id = cp.published_version_id
        JOIN reader_policy readers ON readers.id = pv.reader_policy_id
        LEFT JOIN handbook c ON c.id = p_collection_id AND c.organization_id = cp.organization_id
        WHERE cp.organization_id = p_organization_id AND cp.document_id = p_document_id
          AND cp.valid_from <= now() AND (cp.valid_until IS NULL OR cp.valid_until > now())
          AND readers.mode = 'ORGANIZATION'
          AND (p_collection_id IS NULL OR (c.status = 'ACTIVE'
              AND pv.metadata->>'type' = ANY(c.allowed_types))))
$function$;

CREATE OR REPLACE FUNCTION arden.complete_knowledge_index_job(p_job_id uuid, p_worker_id uuid, p_manifest jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    draft_id uuid;
    candidate_version integer;
    newest_published_version integer;
    result_id uuid;
BEGIN
    SELECT g.document_id AS shared_draft_id INTO STRICT draft_id
      FROM index_generation g
     WHERE g.job_id = p_job_id;
    -- Every activation for this draft holds the same lock before inspecting
    -- history or moving the current pointer. The next statement sees the
    -- preceding activation's committed state under READ COMMITTED.
    PERFORM 1 FROM company_document WHERE id = draft_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Index draft is unavailable' USING ERRCODE = '23514'; END IF;

    SELECT s.snapshot_version_no INTO STRICT candidate_version
      FROM index_generation g
      JOIN review_submission s ON s.id = g.review_submission_id
     WHERE g.job_id = p_job_id;
    -- Publication history remains a high-water mark even after unpublication;
    -- deleting a pointer must not enable an older delayed job to resurrect it.
    SELECT max(s.snapshot_version_no) INTO newest_published_version
      FROM published_version pv JOIN review_submission s ON pv.review_submission_id = s.id
     WHERE pv.document_id = draft_id;
    IF newest_published_version >= candidate_version THEN
        RAISE EXCEPTION 'Index generation is superseded by a published snapshot' USING ERRCODE = 'AR001';
    END IF;

    result_id := complete_knowledge_index_job_unordered_v1(p_job_id, p_worker_id, p_manifest);
    UPDATE review_submission SET publication_state = 'SUPERSEDED'
     WHERE document_id = draft_id AND publication_state = 'ACTIVE'
       AND id <> (SELECT review_submission_id AS submission_id FROM published_version WHERE id = result_id);
    RETURN result_id;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.complete_knowledge_index_job_unordered_v1(p_job_id uuid, p_worker_id uuid, p_manifest jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    generation_row index_generation%ROWTYPE;
    submission_row review_submission%ROWTYPE;
    knowledge_base_id_value uuid;
    published_version_id_value uuid;
    decision_id uuid;
BEGIN
    IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'object' THEN
        RAISE EXCEPTION 'Index manifest must be an object' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO STRICT generation_row FROM index_generation g WHERE g.job_id = p_job_id FOR UPDATE;
    IF generation_row.job_status <> 'RUNNING' OR generation_row.lease_owner_id IS DISTINCT FROM p_worker_id
       OR generation_row.lease_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;
    SELECT review_submission.id AS submission_id,
           review_submission.private_version_id AS draft_version_id,
           review_submission.submitted_by_id AS submitted_by_membership_id,
           review_submission.target_scope AS target_scope_type,
           review_submission.target_department_id,
           review_submission.status,
           review_submission.submitted_at,
           review_submission.organization_id,
           review_submission.working_version_id AS shared_draft_version_id,
           review_submission.document_id AS shared_draft_id,
           review_submission.snapshot_version_no,
           review_submission.owner_department_id AS responsible_department_id,
           review_submission.title,
           review_submission.classification,
           review_submission.policy_version,
           review_submission.file_uri AS content_uri,
           review_submission.mime_type,
           review_submission.content_hash,
           review_submission.submit_request_id,
           review_submission.publication_state,
           review_submission.review_rule,
           review_submission.proposed_reader_policy_id AS proposed_selection_id,
           review_submission.approved_reader_policy_id AS approved_selection_id,
           review_submission.keywords,
           review_submission.change_description,
           review_submission.document_code,
           review_submission.metadata AS management,
           review_submission.request_type,
           review_submission.request_reason,
           review_submission.target_published_version_id,
           review_submission.publication_failure_code,
           review_submission.withdrawn_by_role AS withdrawn_by,
           review_submission.withdrawal_reason AS withdrawn_reason,
           review_submission.withdrawn_at,
           review_submission.renewal_valid_until AS renewal_expiration_date,
           review_submission.on_behalf_of_author,
           review_submission.author_response_deadline AS author_decides_until INTO STRICT submission_row FROM review_submission
     WHERE review_submission.id = generation_row.review_submission_id FOR UPDATE;

    IF generation_row.status <> 'PROCESSING'
       OR submission_row.status <> 'APPROVED'
       OR submission_row.publication_state <> 'PREPARING'
       OR submission_row.working_version_id IS DISTINCT FROM generation_row.snapshot_version_id
       OR submission_row.content_hash IS DISTINCT FROM generation_row.snapshot_content_hash
       OR NOT EXISTS (
           SELECT 1 FROM reader_policy rs
            WHERE rs.id = submission_row.approved_reader_policy_id
              AND rs.organization_id = submission_row.organization_id
       ) THEN
        RAISE EXCEPTION 'Index generation is no longer activatable' USING ERRCODE = '23514';
    END IF;

    IF p_manifest->>'jobId' IS DISTINCT FROM p_job_id::text
       OR p_manifest->>'generationId' IS DISTINCT FROM generation_row.id::text
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

    INSERT INTO knowledge_base (organization_id, department_id, name, scope)
    VALUES (submission_row.organization_id, submission_row.target_department_id,
            'Arden Knowledge', submission_row.target_scope)
    ON CONFLICT DO NOTHING;

    SELECT kb.id AS knowledge_base_id INTO STRICT knowledge_base_id_value
      FROM knowledge_base kb
     WHERE kb.organization_id = submission_row.organization_id
       AND kb.name = 'Arden Knowledge'
       AND kb.scope = submission_row.target_scope
       AND kb.department_id IS NOT DISTINCT FROM submission_row.target_department_id
       AND kb.status = 'ACTIVE';

    INSERT INTO published_version (
        review_submission_id, knowledge_base_id, published_by_id,
        document_id, title, version_no, file_uri, content_hash,
        index_status, classification, owner_department_id,
        valid_from, valid_until)
    VALUES (
        submission_row.id, knowledge_base_id_value, NULL,
        submission_row.document_id, submission_row.title,
        nextval('flow2_publication_version_seq'), submission_row.file_uri,
        submission_row.content_hash, 'INDEXED', submission_row.classification,
        submission_row.owner_department_id,
        now(), NULL)
    RETURNING id AS published_version_id INTO STRICT published_version_id_value;

    INSERT INTO current_publication (
        document_id, organization_id, published_version_id,
        target_scope, target_department_id,
        valid_from, valid_until)
    VALUES (
        submission_row.document_id, submission_row.organization_id,
        published_version_id_value,
        submission_row.target_scope, submission_row.target_department_id,
        now(), NULL)
    ON CONFLICT (document_id) DO UPDATE SET
        published_version_id = EXCLUDED.published_version_id,
        target_scope = EXCLUDED.target_scope,
        target_department_id = EXCLUDED.target_department_id,
        valid_from = EXCLUDED.valid_from,
        valid_until = EXCLUDED.valid_until,
        updated_at = now();

    UPDATE index_generation
       SET status = 'READY', manifest = p_manifest, completed_at = now(),
           job_status = 'SUCCEEDED', lease_owner_id = NULL, lease_expires_at = NULL,
           job_completed_at = now(), job_updated_at = now()
     WHERE id = generation_row.id;
    UPDATE review_submission SET publication_state = 'ACTIVE'
     WHERE id = submission_row.id;

    SELECT rd.id AS review_decision_id INTO STRICT decision_id
      FROM review_decision rd
     WHERE rd.review_submission_id = submission_row.id
       AND rd.is_snapshot_review AND rd.decision = 'APPROVED';
    INSERT INTO audit_event (
        organization_id, actor_id, review_decision_id,
        event_type, outcome, details)
    VALUES (
        submission_row.organization_id, NULL, decision_id,
        'KNOWLEDGE_INDEX_ACTIVATED', 'SUCCESS',
        jsonb_build_object(
            'jobId', p_job_id,
            'generationId', generation_row.id,
            'publishedVersionId', published_version_id_value,
            'snapshotVersionId', generation_row.snapshot_version_id));

    RETURN published_version_id_value;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.copy_published_version_anchor()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'public'
AS $function$
BEGIN
    SELECT s.submitted_by_id AS submitted_by_membership_id
      INTO NEW.author_id
      FROM review_submission s
     WHERE s.id = NEW.review_submission_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.current_readable_document_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT cp.document_id AS shared_draft_id
      FROM current_publication cp
      JOIN company_document d
        ON d.id = cp.document_id
       AND d.organization_id = cp.organization_id
       AND d.status = 'ACTIVE'
      JOIN published_version pv
        ON pv.id = cp.published_version_id
       AND pv.document_id = cp.document_id
      JOIN knowledge_base kb
        ON kb.id = pv.knowledge_base_id
     WHERE cp.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND kb.organization_id = cp.organization_id
       AND cp.valid_from <= now()
       AND (cp.valid_until IS NULL OR cp.valid_until > now())
       AND pv.published_at <= now()
       AND (
           publication_expiration_date(pv.id, pv.metadata) IS NULL
           OR publication_expiration_date(pv.id, pv.metadata) >= (now() AT TIME ZONE 'UTC')::date
       )
       AND EXISTS (
           SELECT 1
             FROM membership m
             JOIN account u ON m.account_id = u.id
             JOIN organization o ON m.organization_id = o.id
            WHERE m.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND m.organization_id = cp.organization_id
              AND m.status = 'ACTIVE'
              AND u.status = 'ACTIVE'
              AND o.status = 'ACTIVE'
              AND actor_in_reader_selection(cp.reader_policy_id)
       );
$function$;

CREATE OR REPLACE FUNCTION arden.decide_on_behalf_renewal(p_submission_id uuid, p_decision text, p_snapshot_version_id uuid, p_content_hash text, p_comment text, p_request_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    request review_submission%ROWTYPE;
    previous review_decision%ROWTYPE;
    decided uuid := gen_random_uuid();
    note text := NULLIF(btrim(COALESCE(p_comment, '')), '');
BEGIN
    IF actor IS NULL OR p_decision NOT IN ('APPROVED', 'REJECTED') OR p_request_id IS NULL THEN
        RETURN 'NOT_APPLICABLE';
    END IF;
    SELECT s.id AS submission_id,
           s.private_version_id AS draft_version_id,
           s.submitted_by_id AS submitted_by_membership_id,
           s.target_scope AS target_scope_type,
           s.target_department_id,
           s.status,
           s.submitted_at,
           s.organization_id,
           s.working_version_id AS shared_draft_version_id,
           s.document_id AS shared_draft_id,
           s.snapshot_version_no,
           s.owner_department_id AS responsible_department_id,
           s.title,
           s.classification,
           s.policy_version,
           s.file_uri AS content_uri,
           s.mime_type,
           s.content_hash,
           s.submit_request_id,
           s.publication_state,
           s.review_rule,
           s.proposed_reader_policy_id AS proposed_selection_id,
           s.approved_reader_policy_id AS approved_selection_id,
           s.keywords,
           s.change_description,
           s.document_code,
           s.metadata AS management,
           s.request_type,
           s.request_reason,
           s.target_published_version_id,
           s.publication_failure_code,
           s.withdrawn_by_role AS withdrawn_by,
           s.withdrawal_reason AS withdrawn_reason,
           s.withdrawn_at,
           s.renewal_valid_until AS renewal_expiration_date,
           s.on_behalf_of_author,
           s.author_response_deadline AS author_decides_until INTO request FROM review_submission s
      JOIN company_document d ON d.id = s.document_id AND d.author_id = actor
     WHERE s.id = p_submission_id AND s.organization_id = org
       AND s.request_type = 'RENEWAL' AND s.on_behalf_of_author
     FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN 'NOT_APPLICABLE'; END IF;
    SELECT rd.id AS review_decision_id,
           rd.review_submission_id AS submission_id,
           rd.reviewer_id AS reviewer_membership_id,
           rd.decision,
           rd.comment,
           rd.decided_at,
           rd.is_snapshot_review AS flow2,
           rd.decision_request_id,
           rd.working_version_id AS snapshot_version_id,
           rd.content_hash,
           rd.approved_reader_policy_id AS approved_selection_id INTO previous FROM review_decision rd
     WHERE rd.reviewer_id = actor AND rd.decision_request_id = p_request_id AND rd.is_snapshot_review;
    IF FOUND THEN
        RETURN CASE WHEN previous.review_submission_id = p_submission_id AND previous.decision = p_decision
            THEN 'REPLAYED' ELSE 'CONFLICT' END;
    END IF;
    IF request.status <> 'PENDING_REVIEW'
       OR request.working_version_id IS DISTINCT FROM p_snapshot_version_id
       OR request.content_hash IS DISTINCT FROM p_content_hash THEN
        RETURN 'CONFLICT';
    END IF;
    IF p_decision = 'REJECTED' AND note IS NULL THEN RETURN 'COMMENT_REQUIRED'; END IF;
    IF note IS NOT NULL AND char_length(note) > 2000 THEN RETURN 'CONFLICT'; END IF;
    INSERT INTO review_decision (id, review_submission_id, reviewer_id, decision, comment, is_snapshot_review,
        decision_request_id, working_version_id, content_hash)
    VALUES (decided, p_submission_id, actor, p_decision, note, true, p_request_id,
        request.working_version_id, request.content_hash);
    INSERT INTO audit_event (organization_id, actor_id, review_decision_id, event_type, outcome, details)
    VALUES (org, actor, decided, 'KNOWLEDGE_REVIEW_DECIDED', 'SUCCESS', jsonb_build_object(
        'submissionId', p_submission_id, 'snapshotVersionId', request.working_version_id, 'decision', p_decision,
        'requestType', 'RENEWAL', 'publishedVersionId', request.target_published_version_id,
        'decidedAs', 'AUTHOR', 'selfApproved', false, 'requestId', p_request_id));
    RETURN 'DECIDED';
END;
$function$;

CREATE OR REPLACE FUNCTION arden.direct_sharing_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT COALESCE((SELECT org.direct_share_enabled FROM organization org
        WHERE org.id = NULLIF(current_setting('arden.organization_id', true), '')::uuid), false)
$function$;

CREATE OR REPLACE FUNCTION arden.eligible_ai_publications()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT pv.id AS published_version_id
      FROM current_publication cp
      JOIN published_version pv ON pv.id = cp.published_version_id
           AND pv.document_id = cp.document_id
      JOIN knowledge_base kb ON kb.id = pv.knowledge_base_id
     WHERE cp.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND kb.organization_id = cp.organization_id
       AND cp.valid_from <= now() AND (cp.valid_until IS NULL OR cp.valid_until > now())
       AND pv.published_at <= now() AND pv.index_status = 'INDEXED'
       AND (publication_expiration_date(pv.id, pv.metadata) IS NULL
            OR publication_expiration_date(pv.id, pv.metadata) >= (now() AT TIME ZONE 'UTC')::date)
       AND EXISTS (
           SELECT 1 FROM membership m
             JOIN account u ON m.account_id = u.id JOIN organization o ON m.organization_id = o.id
            WHERE m.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
              AND m.organization_id = cp.organization_id
              AND m.status = 'ACTIVE' AND u.status = 'ACTIVE' AND o.status = 'ACTIVE'
              AND actor_in_reader_selection(cp.reader_policy_id)
       );
$function$;

CREATE OR REPLACE FUNCTION arden.enforce_document_relationship_invariants()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    has_cycle boolean;
BEGIN
    -- For runtime callers, enforce the governed INSERT RLS preconditions before touching
    -- hidden organization edges so probing an unreadable target never produces a 409 oracle.
    IF session_user = 'arden_runtime' OR current_setting('role', true) = 'arden_runtime' THEN
        IF NEW.organization_id IS DISTINCT FROM NULLIF(current_setting('arden.organization_id', true), '')::uuid
           OR NEW.created_by_id IS DISTINCT FROM governance_actor_membership(NEW.organization_id)
           OR NOT actor_can_manage_relationship_source(NEW.organization_id, NEW.source_document_id)
           OR NOT (NEW.source_document_id IN (SELECT current_readable_document_ids()))
           OR NOT (NEW.target_document_id IN (SELECT current_readable_document_ids())) THEN
            RAISE EXCEPTION 'new row violates row-level security policy for table "document_relationship"'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Let ck_document_relationship_not_self handle self-links cleanly.
    IF NEW.source_document_id = NEW.target_document_id THEN
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('arden:doc_rel:' || NEW.organization_id::text));

    IF NEW.type = 'RELATED' THEN
        IF EXISTS (
            SELECT 1
              FROM document_relationship r
             WHERE r.organization_id = NEW.organization_id
               AND r.type = 'RELATED'
               AND r.source_document_id = NEW.target_document_id
               AND r.target_document_id = NEW.source_document_id
               AND (TG_OP = 'INSERT' OR r.id <> OLD.id)
        ) THEN
            RAISE EXCEPTION 'Symmetric RELATED relationship already exists'
                USING ERRCODE = '23505', CONSTRAINT = 'uq_document_relationship_symmetric_related';
        END IF;
    ELSIF NEW.type = 'SUPERSEDES' THEN
        WITH RECURSIVE supersedes_walk(doc_id, path) AS (
            SELECT NEW.target_document_id, ARRAY[NEW.target_document_id]
            UNION ALL
            SELECT r.target_document_id, w.path || r.target_document_id
              FROM supersedes_walk w
              JOIN document_relationship r
                ON r.organization_id = NEW.organization_id
               AND r.type = 'SUPERSEDES'
               AND r.source_document_id = w.doc_id
               AND (TG_OP = 'INSERT' OR r.id <> OLD.id)
             WHERE NOT (r.target_document_id = ANY(w.path))
        )
        SELECT EXISTS (
            SELECT 1
              FROM supersedes_walk
             WHERE doc_id = NEW.source_document_id
        ) INTO has_cycle;

        IF has_cycle THEN
            RAISE EXCEPTION 'SUPERSEDES relationship would form a cycle'
                USING ERRCODE = '23514', CONSTRAINT = 'ck_document_relationship_supersedes_acyclic';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.enforce_flow2_review_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE submission_row record; publication_count integer;
BEGIN
    IF NOT NEW.is_snapshot_review THEN RETURN NEW; END IF;
    SELECT status, publication_state, organization_id, owner_department_id AS responsible_department_id,
           classification, target_scope AS target_scope_type, review_rule, request_type
      INTO STRICT submission_row FROM review_submission WHERE id = NEW.review_submission_id;
    IF submission_row.status IS DISTINCT FROM NEW.decision THEN
        RAISE EXCEPTION 'Review decision and submission status diverged' USING ERRCODE = '23514';
    END IF;
    -- Decision 0032: the active author decides a renewal asked on their behalf without a reviewer grant.
    IF COALESCE(current_setting('arden.org_admin', true), 'false') <> 'true'
       -- (validate_review_decision also requires that author to be active; this invoker check reads only rows
       -- the caller can see, which for the author is decide_on_behalf_renewal's owner context.)
       AND NOT EXISTS (SELECT 1 FROM review_submission rs JOIN company_document d ON d.id = rs.document_id
            WHERE rs.id = NEW.review_submission_id AND rs.request_type = 'RENEWAL' AND rs.on_behalf_of_author
              AND d.author_id = NEW.reviewer_id)
       AND NOT actor_has_review_scope(submission_row.organization_id,
           submission_row.responsible_department_id, submission_row.classification,
           submission_row.target_scope_type, submission_row.review_rule) THEN
        RAISE EXCEPTION 'Review decision lacks current reviewer authority' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO publication_count FROM published_version
     WHERE review_submission_id = NEW.review_submission_id;
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
    IF NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.review_decision_id = NEW.id
        AND a.event_type = 'KNOWLEDGE_REVIEW_DECIDED' AND a.outcome = 'SUCCESS') THEN
        RAISE EXCEPTION 'Review decision needs a separate audit record' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.enqueue_maintenance_case_notice(p_id uuid, p_case_id uuid, p_recipient uuid, p_key text, p_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(org);
    notice_id uuid;
BEGIN
    IF actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM maintenance_case c
          JOIN membership recipient ON recipient.id = p_recipient
                AND recipient.organization_id = c.organization_id
          WHERE c.id = p_case_id AND c.organization_id = org
            AND (actor IN (c.reporter_id, c.assignee_id) OR governance_is_org_admin(actor, org))
            AND (p_recipient IN (c.reporter_id, c.assignee_id) OR governance_is_org_admin(actor, org))
    ) THEN
        RAISE EXCEPTION 'Maintenance notice is unavailable' USING ERRCODE = '42501';
    END IF;
    IF p_key IS NULL OR char_length(btrim(p_key)) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'Invalid maintenance notice key' USING ERRCODE = '22023';
    END IF;
    INSERT INTO notification (id, organization_id, recipient_id,
        event_key, event_type, resource_type, resource_id, message)
    VALUES (p_id, org, p_recipient, 'maintenance:' || p_key, 'MAINTENANCE_CASE_UPDATED', 'MAINTENANCE_CASE',
        p_case_id, p_message)
    ON CONFLICT (event_key, recipient_id) DO NOTHING
    RETURNING id AS notification_id INTO notice_id;
    IF notice_id IS NOT NULL THEN
        INSERT INTO notification_outbox (notification_id, organization_id) VALUES (notice_id, org);
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.enqueue_maintenance_submission_notices()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    submitted maintenance_case%ROWTYPE;
    actor uuid := governance_actor_membership(NEW.organization_id);
BEGIN
    IF actor IS NULL OR actor IS DISTINCT FROM NEW.actor_id THEN RETURN NEW; END IF;
    -- Intake already verified the pin. A later publication must not suppress its notices.
    SELECT c.id AS case_id,
           c.organization_id,
           c.origin,
           c.reporter_id AS reporter_membership_id,
           c.document_id,
           c.published_version_id,
           c.content_hash,
           c.title,
           c.description,
           c.anchor_page,
           c.anchor_passage,
           c.review_department_id AS route_department_id,
           c.classification,
           c.author_id AS author_membership_id,
           c.assignee_id AS assignee_membership_id,
           c.reporter_status,
           c.outcome,
           c.reporter_explanation,
           c.reviewer_rationale,
           c.revision,
           c.first_claimed_at,
           c.created_at,
           c.resolved_at,
           c.remedy_version_id AS publication_link_version_id,
           c.remedy_reason AS publication_link_reason,
           c.remedy_request_id AS publication_link_submission_id INTO submitted FROM maintenance_case c
     WHERE c.organization_id = NEW.organization_id AND c.id = NEW.case_id
       AND c.reporter_status = 'Submitted'
       AND ((c.origin = 'READER_REPORT' AND c.reporter_id = actor)
         OR (c.origin = 'REVIEWER_INTAKE' AND maintenance_reviewer_eligible(actor, c.published_version_id)));
    IF NOT FOUND THEN RETURN NEW; END IF;

    WITH active_members AS (
        SELECT m.id AS membership_id FROM membership m
          JOIN account u ON u.id = m.account_id AND u.status = 'ACTIVE'
         WHERE m.organization_id = submitted.organization_id AND m.status = 'ACTIVE'
    ), eligible AS (
        SELECT m.membership_id FROM active_members m
         WHERE m.membership_id IS DISTINCT FROM submitted.reporter_id
           AND maintenance_reviewer_eligible(m.membership_id, submitted.published_version_id)
    ), targets AS (
        SELECT membership_id FROM eligible
        UNION ALL
        SELECT m.membership_id FROM active_members m
         WHERE NOT EXISTS (SELECT 1 FROM eligible)
           AND governance_is_org_admin(m.membership_id, submitted.organization_id)
    ), inserted AS (
        INSERT INTO notification (organization_id, recipient_id, event_key,
            event_type, resource_type, resource_id, message)
        SELECT submitted.organization_id, t.membership_id, 'maintenance:submitted:' || submitted.id,
               'MAINTENANCE_CASE_UPDATED', 'MAINTENANCE_CASE', submitted.id,
               'A maintenance case is waiting for review.'
          FROM targets t
        ON CONFLICT (event_key, recipient_id) DO NOTHING
        RETURNING id AS notification_id, organization_id
    )
    INSERT INTO notification_outbox (notification_id, organization_id)
    SELECT notification_id, organization_id FROM inserted;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.enqueue_publication_expiry_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    today date := (now() AT TIME ZONE 'UTC')::date;
    written integer;
BEGIN
    WITH due AS (
        SELECT g.organization_id, g.shared_draft_id, g.published_version_id, g.title, g.responsible_department_id,
               g.reader_mode, g.submitted_by_membership_id AS author_id, e.expires_on,
               renewal_member_active(g.submitted_by_membership_id) AS author_is_active,
               EXISTS (SELECT 1 FROM review_submission c WHERE c.document_id = g.shared_draft_id
                         AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW') AS pending
          FROM governance_current_publication g
          JOIN published_version pv ON pv.id = g.published_version_id
          JOIN organization o ON o.id = g.organization_id AND o.status = 'ACTIVE'
          CROSS JOIN LATERAL (SELECT publication_expiration_date(g.published_version_id, pv.metadata) AS expires_on) e
         WHERE e.expires_on BETWEEN today AND today + 30
    ), recipients AS (
        SELECT d.*, d.author_id AS recipient, '30' AS threshold FROM due d WHERE d.author_is_active
        UNION ALL
        SELECT d.*, om.id AS membership_id, CASE WHEN d.author_is_active THEN '7' ELSE '30' END
          FROM due d
          JOIN membership om ON om.organization_id = d.organization_id
         WHERE om.id <> d.author_id AND renewal_member_active(om.id)
           AND governance_is_responsible_reviewer(om.id, d.organization_id,
                   d.responsible_department_id, d.reader_mode)
           AND (NOT d.author_is_active OR (d.expires_on <= today + 7 AND NOT d.pending))
    ), notices AS (
        INSERT INTO notification (organization_id, recipient_id, event_key, event_type,
            resource_type, resource_id, publication_title, expires_on)
        SELECT r.organization_id, r.recipient,
               'expiry:' || r.published_version_id::text || ':' || r.expires_on::text || ':' || r.threshold,
               'PUBLICATION_EXPIRING', 'DOCUMENT', r.shared_draft_id, r.title, r.expires_on
          FROM recipients r
        ON CONFLICT (event_key, recipient_id) DO NOTHING
        RETURNING id AS notification_id, organization_id)
    INSERT INTO notification_outbox (notification_id, organization_id)
    SELECT notification_id, organization_id FROM notices;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.fail_knowledge_index_job(p_job_id uuid, p_worker_id uuid, p_error_code text, p_retryable boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE generation_row index_generation%ROWTYPE;
BEGIN
    IF p_error_code IS NULL OR p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
        RAISE EXCEPTION 'Invalid indexing failure code' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO STRICT generation_row FROM index_generation g WHERE g.job_id = p_job_id FOR UPDATE;
    IF generation_row.job_status <> 'RUNNING' OR generation_row.lease_owner_id IS DISTINCT FROM p_worker_id THEN
        RAISE EXCEPTION 'Index job lease is no longer valid' USING ERRCODE = '40001';
    END IF;

    IF NOT p_retryable OR generation_row.attempt_count >= generation_row.max_attempts THEN
        UPDATE index_generation
           SET status = 'FAILED', failure_code = p_error_code, completed_at = now(),
               job_status = 'FAILED', lease_owner_id = NULL, lease_expires_at = NULL,
               last_error_code = p_error_code, job_completed_at = now(), job_updated_at = now()
         WHERE id = generation_row.id;
        UPDATE review_submission SET publication_state = CASE
            WHEN p_error_code = 'INDEX_GENERATION_SUPERSEDED' THEN 'SUPERSEDED' ELSE 'FAILED' END
         WHERE id = generation_row.review_submission_id AND status = 'APPROVED' AND publication_state = 'PREPARING';
        RETURN 'FAILED';
    END IF;

    UPDATE index_generation
       SET status = 'PENDING', started_at = NULL,
           job_status = 'PENDING', lease_owner_id = NULL, lease_expires_at = NULL, last_error_code = p_error_code,
           available_at = now() + make_interval(secs => LEAST(900, 30 * (2 ^ (generation_row.attempt_count - 1)))),
           job_updated_at = now()
     WHERE id = generation_row.id;
    RETURN 'PENDING';
END;
$function$;

CREATE OR REPLACE FUNCTION arden.freeze_knowledge_management()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE source record;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.document_code IS DISTINCT FROM NEW.document_code
           OR (TG_TABLE_NAME <> 'company_document' AND OLD.metadata IS DISTINCT FROM NEW.metadata) THEN
            RAISE EXCEPTION 'Document identity and snapshot metadata are immutable' USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;
    -- Nested IF: only review_submission rows have request_type (plpgsql does not short-circuit AND).
    IF TG_TABLE_NAME = 'review_submission' THEN
        IF NEW.request_type <> 'CONTENT' THEN
            SELECT released.document_code, released.metadata AS management INTO STRICT source
              FROM published_version pv
              JOIN review_submission released ON released.id = pv.review_submission_id
             WHERE pv.id = NEW.target_published_version_id
               AND pv.document_id = NEW.document_id;
            NEW.document_code := source.document_code;
            NEW.metadata := source.management;
            RETURN NEW;
        END IF;
    END IF;
    IF TG_TABLE_NAME = 'review_submission' THEN
        SELECT d.document_code, d.metadata - 'topicId' - 'topicName' - 'effectiveDate' AS management
            INTO STRICT source FROM company_document d
            WHERE d.id = NEW.document_id AND d.organization_id = NEW.organization_id;
    ELSE
        SELECT s.document_code, s.metadata AS management INTO STRICT source FROM review_submission s
            WHERE s.id = NEW.review_submission_id;
    END IF;
    NEW.document_code := source.document_code;
    NEW.metadata := source.management;
    IF TG_TABLE_NAME = 'review_submission' AND NEW.metadata IS NOT NULL THEN
        NEW.metadata := NEW.metadata || jsonb_build_object('releaseKind', CASE WHEN EXISTS (
            SELECT 1 FROM review_submission prior WHERE prior.document_id = NEW.document_id
              AND prior.publication_state IN ('ACTIVE', 'SUPERSEDED')) THEN 'UPDATED' ELSE 'NEW' END);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.get_publication_renewal_state(p_document_id uuid)
 RETURNS TABLE(document_id uuid, published_version_id uuid, title text, responsible_department_id uuid, expiration_date date, renewal_pending boolean, author_active boolean, is_author boolean, can_renew boolean, pending_submission_id uuid, pending_snapshot_version_id uuid, pending_content_hash text, pending_on_behalf boolean, pending_requested_by text, pending_reason text, pending_expiration_date date, pending_requested_at timestamp with time zone, author_window_until timestamp with time zone, can_decide boolean, author_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    admin boolean;
    today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    IF actor IS NULL OR p_document_id IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    WITH visible AS (
        SELECT g.shared_draft_id, g.published_version_id, g.title, g.responsible_department_id,
               publication_expiration_date(g.published_version_id, pv.metadata) AS expires_on,
               renewal_member_active(g.submitted_by_membership_id) AS author_is_active,
               g.submitted_by_membership_id = actor AS mine,
               CASE WHEN renewal_member_active(g.submitted_by_membership_id)
                    THEN renewal_member_name(g.submitted_by_membership_id) END AS author_display_name
          FROM governance_current_publication g
          JOIN published_version pv ON pv.id = g.published_version_id
         WHERE g.organization_id = org
           AND g.shared_draft_id = p_document_id
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
      LEFT JOIN LATERAL (SELECT c.id AS submission_id,
           c.private_version_id AS draft_version_id,
           c.submitted_by_id AS submitted_by_membership_id,
           c.target_scope AS target_scope_type,
           c.target_department_id,
           c.status,
           c.submitted_at,
           c.organization_id,
           c.working_version_id AS shared_draft_version_id,
           c.document_id AS shared_draft_id,
           c.snapshot_version_no,
           c.owner_department_id AS responsible_department_id,
           c.title,
           c.classification,
           c.policy_version,
           c.file_uri AS content_uri,
           c.mime_type,
           c.content_hash,
           c.submit_request_id,
           c.publication_state,
           c.review_rule,
           c.proposed_reader_policy_id AS proposed_selection_id,
           c.approved_reader_policy_id AS approved_selection_id,
           c.keywords,
           c.change_description,
           c.document_code,
           c.metadata AS management,
           c.request_type,
           c.request_reason,
           c.target_published_version_id,
           c.publication_failure_code,
           c.withdrawn_by_role AS withdrawn_by,
           c.withdrawal_reason AS withdrawn_reason,
           c.withdrawn_at,
           c.renewal_valid_until AS renewal_expiration_date,
           c.on_behalf_of_author,
           c.author_response_deadline AS author_decides_until FROM review_submission c WHERE c.document_id = v.shared_draft_id
                           AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW' LIMIT 1) p ON true;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.governance_actor_membership(p_organization_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT om.id AS membership_id FROM membership om
      JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
      JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
     WHERE om.organization_id = p_organization_id AND om.status = 'ACTIVE'
       AND p_organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND om.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
$function$;

CREATE OR REPLACE FUNCTION arden.governance_is_org_admin(p_membership_id uuid, p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT p_membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM role_assignment ra
      JOIN role r ON r.id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
      JOIN access_scope scope ON scope.id = ra.access_scope_id
       AND scope.organization_id = p_organization_id AND scope.scope = 'ORGANIZATION' AND scope.status = 'ACTIVE'
     WHERE ra.membership_id = p_membership_id AND ra.status = 'ACTIVE'
       AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now()))
$function$;

CREATE OR REPLACE FUNCTION arden.governance_is_responsible_reviewer(p_membership_id uuid, p_organization_id uuid, p_department_id uuid, p_reader_mode text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT p_membership_id IS NOT NULL AND EXISTS (SELECT 1 FROM reviewer_grant g
     WHERE g.organization_id = p_organization_id AND g.reviewer_id = p_membership_id
       AND g.status = 'ACTIVE' AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
       AND ((p_reader_mode = 'ORGANIZATION' AND g.scope = 'ORGANIZATION')
         OR (p_reader_mode <> 'ORGANIZATION' AND g.scope = 'DEPARTMENT' AND g.department_id = p_department_id)))
$function$;

CREATE OR REPLACE FUNCTION arden.knowledge_reader_directory(p_query text, p_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(membership_id uuid, display_name text, email text, department_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    WITH members AS (
        SELECT om.id AS membership_id, COALESCE(NULLIF(btrim(ua.full_name), ''), 'Member') AS display_name,
               lower(ua.email) AS email,
               (SELECT d.name FROM department_membership dm
                  JOIN department d ON d.id = dm.department_id AND d.status = 'ACTIVE'
                 WHERE dm.membership_id = om.id AND dm.status = 'ACTIVE'
                 ORDER BY dm.is_primary DESC, d.name LIMIT 1) AS department_name
          FROM membership om
          JOIN account ua ON om.account_id = ua.id
          JOIN organization o ON om.organization_id = o.id
         WHERE om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
           AND om.status = 'ACTIVE' AND ua.status = 'ACTIVE' AND o.status = 'ACTIVE'
           AND cardinality(p_ids) <= 100 AND length(p_query) <= 80
           AND EXISTS (SELECT 1 FROM membership actor
                JOIN account account ON account.id = actor.account_id
               WHERE actor.organization_id = om.organization_id AND actor.status = 'ACTIVE'
                 AND account.status = 'ACTIVE'
                 AND actor.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
    ), selected AS (
        SELECT * FROM members WHERE membership_id = ANY(p_ids)
    ), found AS (
        SELECT * FROM members
         WHERE length(btrim(p_query)) >= 2
           AND (strpos(lower(display_name), lower(btrim(p_query))) > 0
             OR strpos(email, lower(btrim(p_query))) > 0)
         -- An exact email first, then names and addresses that start with the query.
         ORDER BY (email = lower(btrim(p_query))) DESC,
                  (lower(display_name) LIKE lower(btrim(p_query)) || '%' OR email LIKE lower(btrim(p_query)) || '%') DESC,
                  display_name, membership_id
         LIMIT 20
    )
    SELECT membership_id, display_name, email, department_name FROM selected
    UNION
    SELECT membership_id, display_name, email, department_name FROM found
    ORDER BY 2, 1;
$function$;

CREATE OR REPLACE FUNCTION arden.list_closed_publication_reports(p_after uuid)
 RETURNS TABLE(report_id uuid, document_id uuid, published_version_id uuid, title text, message text, reporter_name text, created_at timestamp with time zone, still_current boolean, can_view boolean, resolution text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(org);
    admin boolean;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    admin := governance_is_org_admin(actor, org);
    RETURN QUERY
    WITH visible AS NOT MATERIALIZED (
        SELECT imported.source_report_id AS report_id, c.document_id, c.published_version_id, c.title, c.description,
               c.reporter_id AS reporter_membership_id, c.created_at, closed.occurred_at AS closed_at,
               g.published_version_id AS current_version_id,
               CASE closed.message WHEN 'The historical report was dismissed.' THEN 'DISMISSED'
                                   WHEN 'The document was withdrawn.' THEN 'WITHDRAWN' END AS resolution
          FROM case_event imported
          JOIN case_event closed ON closed.id = imported.source_report_id
               AND closed.organization_id = imported.organization_id AND closed.case_id = imported.case_id
               AND closed.event_type = 'RESOLVED'
          JOIN maintenance_case c ON c.id = imported.case_id AND c.organization_id = imported.organization_id
          LEFT JOIN governance_current_publication g ON g.shared_draft_id = c.document_id
         WHERE imported.organization_id = org AND imported.source_report_id IS NOT NULL
           AND (admin OR closed.actor_id = actor
                OR (g.shared_draft_id IS NOT NULL AND g.submitted_by_membership_id IS DISTINCT FROM actor
                    AND governance_is_responsible_reviewer(actor, org, g.responsible_department_id, g.reader_mode)))
    ), boundary AS (
        SELECT a.closed_at, a.created_at, a.report_id FROM visible a WHERE a.report_id = p_after
    )
    SELECT r.report_id, r.document_id, r.published_version_id, r.title, r.description,
           COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email), r.created_at,
           r.current_version_id IS NOT DISTINCT FROM r.published_version_id, false, r.resolution
      FROM visible r
      JOIN membership om ON om.id = r.reporter_membership_id AND om.organization_id = org
      JOIN account ua ON ua.id = om.account_id
     WHERE p_after IS NULL OR EXISTS (
        SELECT 1 FROM boundary b
         WHERE (r.closed_at, r.created_at, r.report_id) < (b.closed_at, b.created_at, b.report_id))
     ORDER BY r.closed_at DESC, r.created_at DESC, r.report_id DESC
     LIMIT 201;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.list_graph_monitor_documents(p_include_expired boolean)
 RETURNS TABLE(document_id uuid, published_version_id uuid, title text, management jsonb, owner_department_id uuid, owner_department_name text, author_display_name text, published_at timestamp with time zone, expiration_date text, readers_selection_id uuid, readers_mode text, readers_department_id uuid, readers_member_ids uuid[], knowledge_base_scope_type text, collection_id uuid, collection_name text, collection_allowed_types text[], is_author boolean, can_renew boolean, is_currently_readable boolean, open_target text, open_maintenance_case_count integer, is_unassigned_org_doc boolean, requires_audited_inspection boolean, actor_accountable boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
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
            ON g.reviewer_id = ctx.actor_membership_id
           AND g.organization_id = ctx.org_id
          LEFT JOIN department dep
            ON dep.id = g.department_id
           AND dep.organization_id = g.organization_id
         WHERE ctx.actor_membership_id IS NOT NULL
           AND g.status = 'ACTIVE'
           AND g.valid_from <= now()
           AND (g.valid_until IS NULL OR g.valid_until > now())
    ), current_docs AS (
        SELECT cp.document_id AS document_id,
               pv.id AS published_version_id,
               pv.title,
               pv.metadata AS management,
               pv.classification,
               pv.owner_department_id AS owner_department_id,
               owner_department.name AS owner_department_name,
               pv.published_at,
               kb.scope AS knowledge_base_scope_type,
               publication_expiration_date(pv.id, pv.metadata) AS expiration_on,
               COALESCE(cp.reader_policy_id, pv.reader_policy_id) AS readers_selection_id,
               rs.mode AS readers_mode,
               rs.department_id AS readers_department_id,
               version_rs.mode AS review_reader_mode,
               ARRAY(
                   SELECT sr.membership_id
                     FROM policy_reader sr
                    WHERE sr.reader_policy_id = COALESCE(cp.reader_policy_id, pv.reader_policy_id)
                    ORDER BY sr.position
               ) AS readers_member_ids,
               cp.target_scope AS target_scope_type,
               d.author_id AS author_membership_id,
               kc.id AS collection_id,
               kc.name AS collection_name,
               kc.allowed_types AS collection_allowed_types
          FROM context ctx
          JOIN current_publication cp
            ON cp.organization_id = ctx.org_id
          JOIN company_document d
            ON d.id = cp.document_id
           AND d.organization_id = cp.organization_id
           AND d.status = 'ACTIVE'
          JOIN published_version pv
            ON pv.id = cp.published_version_id
           AND pv.document_id = cp.document_id
          JOIN knowledge_base kb
            ON kb.id = pv.knowledge_base_id
           AND kb.organization_id = cp.organization_id
          LEFT JOIN department owner_department
            ON owner_department.id = pv.owner_department_id
           AND owner_department.organization_id = cp.organization_id
          LEFT JOIN reader_policy rs
            ON rs.id = COALESCE(cp.reader_policy_id, pv.reader_policy_id)
          LEFT JOIN reader_policy version_rs
            ON version_rs.id = pv.reader_policy_id
          LEFT JOIN handbook_placement kcp
            ON kcp.document_id = cp.document_id
           AND kcp.organization_id = cp.organization_id
          LEFT JOIN handbook kc
            ON kc.id = kcp.handbook_id
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
        SELECT s.document_id AS document_id
          FROM review_submission s
          JOIN context ctx ON ctx.org_id = s.organization_id
         WHERE s.request_type = 'RENEWAL'
           AND s.status = 'PENDING_REVIEW'
         GROUP BY s.document_id
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
$function$;

CREATE OR REPLACE FUNCTION arden.list_maintenance_document_versions(p_document_id uuid, p_pinned_version_id uuid)
 RETURNS TABLE(published_version_id uuid, version_no integer, published_at timestamp with time zone, is_current boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
BEGIN
    IF actor IS NULL OR NOT EXISTS (
        SELECT 1 FROM published_version pv
          JOIN company_document d ON d.id = pv.document_id AND d.organization_id = org
         WHERE pv.id = p_pinned_version_id AND pv.document_id = p_document_id) THEN
        RETURN;
    END IF;
    IF NOT governance_is_org_admin(actor, org) AND NOT maintenance_reviewer_eligible(actor, p_pinned_version_id) THEN
        RETURN;
    END IF;
    RETURN QUERY
    WITH chosen AS (
        (SELECT pv.id AS published_version_id FROM published_version pv
          WHERE pv.document_id = p_document_id ORDER BY pv.version_no DESC, pv.published_at DESC LIMIT 49)
        UNION
        SELECT p_pinned_version_id)
    SELECT pv.id AS published_version_id, pv.version_no, pv.published_at,
           EXISTS (SELECT 1 FROM current_publication cp
             WHERE cp.published_version_id = pv.id AND cp.document_id = p_document_id
               AND cp.organization_id = org)
      FROM published_version pv
      JOIN chosen ON chosen.published_version_id = pv.id
     ORDER BY pv.version_no, pv.published_at;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.list_maintenance_eligible_reviewers(p_version_id uuid)
 RETURNS TABLE(membership_id uuid, display_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT governance_is_org_admin(governance_actor_membership(org), org) THEN RETURN; END IF;
    RETURN QUERY
    SELECT om.id AS membership_id, COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
      FROM membership om
      JOIN account ua ON ua.id = om.account_id
     WHERE om.organization_id = org
       AND EXISTS (SELECT 1 FROM reviewer_grant g WHERE g.reviewer_id = om.id AND g.organization_id = org)
       AND maintenance_reviewer_eligible(om.id, p_version_id)
     ORDER BY 2, 1;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.list_publication_author_names(p_published_version_ids uuid[])
 RETURNS TABLE(published_version_id uuid, author_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT g.published_version_id, NULLIF(btrim(ua.full_name), '')
      FROM governance_current_publication g
      JOIN membership om ON om.id = g.submitted_by_membership_id AND om.status = 'ACTIVE'
      JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
     WHERE g.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND cardinality(p_published_version_ids) <= 1000
       AND g.published_version_id = ANY(p_published_version_ids)
       AND g.published_version_id IN (SELECT eligible_ai_publications())
       AND NULLIF(btrim(ua.full_name), '') IS NOT NULL
$function$;

CREATE OR REPLACE FUNCTION arden.list_publication_renewal_state()
 RETURNS TABLE(document_id uuid, published_version_id uuid, title text, responsible_department_id uuid, expiration_date date, renewal_pending boolean, author_active boolean, is_author boolean, can_renew boolean, pending_submission_id uuid, pending_snapshot_version_id uuid, pending_content_hash text, pending_on_behalf boolean, pending_requested_by text, pending_reason text, pending_expiration_date date, pending_requested_at timestamp with time zone, author_window_until timestamp with time zone, can_decide boolean, author_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
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
               publication_expiration_date(g.published_version_id, pv.metadata) AS expires_on,
               renewal_member_active(g.submitted_by_membership_id) AS author_is_active,
               g.submitted_by_membership_id = actor AS mine,
               CASE WHEN renewal_member_active(g.submitted_by_membership_id)
                    THEN renewal_member_name(g.submitted_by_membership_id) END AS author_display_name
          FROM governance_current_publication g
          JOIN published_version pv ON pv.id = g.published_version_id
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
      LEFT JOIN LATERAL (SELECT c.id AS submission_id,
           c.private_version_id AS draft_version_id,
           c.submitted_by_id AS submitted_by_membership_id,
           c.target_scope AS target_scope_type,
           c.target_department_id,
           c.status,
           c.submitted_at,
           c.organization_id,
           c.working_version_id AS shared_draft_version_id,
           c.document_id AS shared_draft_id,
           c.snapshot_version_no,
           c.owner_department_id AS responsible_department_id,
           c.title,
           c.classification,
           c.policy_version,
           c.file_uri AS content_uri,
           c.mime_type,
           c.content_hash,
           c.submit_request_id,
           c.publication_state,
           c.review_rule,
           c.proposed_reader_policy_id AS proposed_selection_id,
           c.approved_reader_policy_id AS approved_selection_id,
           c.keywords,
           c.change_description,
           c.document_code,
           c.metadata AS management,
           c.request_type,
           c.request_reason,
           c.target_published_version_id,
           c.publication_failure_code,
           c.withdrawn_by_role AS withdrawn_by,
           c.withdrawal_reason AS withdrawn_reason,
           c.withdrawn_at,
           c.renewal_valid_until AS renewal_expiration_date,
           c.on_behalf_of_author,
           c.author_response_deadline AS author_decides_until FROM review_submission c WHERE c.document_id = v.shared_draft_id
                           AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW' LIMIT 1) p ON true
     ORDER BY v.expires_on NULLS LAST, v.shared_draft_id
     LIMIT 1000;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_actor_is_admin(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1
          FROM membership om
          JOIN role_assignment ra ON ra.membership_id = om.id
          JOIN role r ON r.id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
          JOIN access_scope s ON s.id = ra.access_scope_id
           AND s.organization_id = om.organization_id AND s.scope = 'ORGANIZATION' AND s.status = 'ACTIVE'
         WHERE om.id = maintenance_actor_membership(p_organization_id)
           AND ra.status = 'ACTIVE'
           AND ra.valid_from <= now()
           AND (ra.valid_until IS NULL OR ra.valid_until > now()));
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_actor_membership(p_organization_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT om.id AS membership_id
      FROM membership om
      JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
     WHERE om.organization_id = p_organization_id
       AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND om.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
       AND om.status = 'ACTIVE';
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_lock_document(p_document_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF governance_actor_membership(org) IS NULL THEN RETURN false; END IF;
    PERFORM 1 FROM company_document d WHERE d.id = p_document_id AND d.organization_id = org FOR SHARE;
    RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_next_event_sequence(p_case_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM maintenance_case c
         WHERE c.id = p_case_id AND c.organization_id = org
           AND maintenance_case_visible(c.organization_id, c.reporter_id, c.assignee_id,
                c.author_id, c.published_version_id)) THEN
        RAISE EXCEPTION 'maintenance case is unavailable' USING ERRCODE = '42501';
    END IF;
    RETURN (SELECT COALESCE(MAX(e.sequence), 0) + 1 FROM case_event e WHERE e.case_id = p_case_id);
END;
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_publication_proof(p_document_id uuid, p_reported_version_id uuid)
 RETURNS TABLE(current_version_id uuid, current_version_no integer, reported_version_no integer, valid_from timestamp with time zone, valid_until timestamp with time zone, status text, request_type text, publication_state text, rejected boolean, withdrawn_version_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    reported published_version%ROWTYPE;
    current_row record;
    was_rejected boolean;
    taken_down uuid;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    SELECT pv.id AS published_version_id,
           pv.review_submission_id AS submission_id,
           pv.knowledge_base_id,
           pv.published_by_id AS published_by_membership_id,
           pv.title,
           pv.version_no,
           pv.file_uri AS content_uri,
           pv.content_hash,
           pv.index_status,
           pv.published_at,
           pv.document_id AS shared_draft_id,
           pv.classification,
           pv.owner_department_id AS responsible_department_id,
           pv.valid_from,
           pv.valid_until,
           pv.reader_policy_id AS reader_selection_id,
           pv.document_code,
           pv.metadata AS management,
           pv.author_id AS author_membership_id INTO reported FROM published_version pv
      JOIN company_document d ON d.id = pv.document_id AND d.organization_id = org
     WHERE pv.id = p_reported_version_id AND pv.document_id = p_document_id;
    IF NOT FOUND THEN RETURN; END IF;
    IF NOT governance_is_org_admin(actor, org) AND NOT maintenance_reviewer_eligible(actor, p_reported_version_id) THEN
        RETURN;
    END IF;
    was_rejected := EXISTS (
        SELECT 1 FROM review_submission rejected_submission
         WHERE rejected_submission.document_id = p_document_id AND rejected_submission.organization_id = org
           AND rejected_submission.status = 'REJECTED'
           AND rejected_submission.request_type IN ('CONTENT', 'WITHDRAWAL'));
    SELECT pv.id AS published_version_id, pv.version_no,
           GREATEST(pv.valid_from, pv.published_at) AS valid_from,
           pv.valid_until, s.status, s.request_type, s.publication_state
      INTO current_row
      FROM current_publication cp
      JOIN published_version pv ON pv.id = cp.published_version_id
      JOIN review_submission s ON s.id = pv.review_submission_id
     WHERE cp.document_id = p_document_id AND cp.organization_id = org;
    IF NOT FOUND THEN
        SELECT pv.id AS published_version_id INTO taken_down
          FROM published_version pv
          JOIN review_submission s ON s.id = pv.review_submission_id
         WHERE pv.document_id = p_document_id AND s.organization_id = org
           AND s.publication_state = 'WITHDRAWN' AND pv.version_no >= reported.version_no
         ORDER BY pv.version_no DESC LIMIT 1;
        RETURN QUERY SELECT NULL::uuid, NULL::integer, reported.version_no, NULL::timestamptz, NULL::timestamptz,
            NULL::text, NULL::text, NULL::text, was_rejected, taken_down;
        RETURN;
    END IF;
    RETURN QUERY SELECT current_row.published_version_id, current_row.version_no, reported.version_no,
        current_row.valid_from, current_row.valid_until, current_row.status, current_row.request_type,
        current_row.publication_state, was_rejected, NULL::uuid;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_reviewer_covers(p_membership_id uuid, p_version_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT p_membership_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM published_version pv
          JOIN company_document d ON d.id = pv.document_id
           AND d.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
          JOIN membership om ON om.id = p_membership_id
           AND om.organization_id = d.organization_id AND om.status = 'ACTIVE'
          JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
          JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
          JOIN reviewer_grant g ON g.reviewer_id = om.id AND g.organization_id = d.organization_id
          LEFT JOIN department dep ON dep.id = g.department_id AND dep.organization_id = g.organization_id
         WHERE pv.id = p_version_id
           AND g.status = 'ACTIVE' AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
           AND pv.classification = ANY(g.classifications)
           AND (pv.classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))


           AND CASE WHEN maintenance_version_reader_mode(pv.id) = 'ORGANIZATION'
                    THEN g.scope = 'ORGANIZATION'
                    ELSE g.scope = 'DEPARTMENT' AND g.department_id = pv.owner_department_id
                         AND dep.status = 'ACTIVE' END);
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_reviewer_eligible(p_membership_id uuid, p_version_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT maintenance_reviewer_covers(p_membership_id, p_version_id)
       AND NOT EXISTS (SELECT 1 FROM published_version pv
            WHERE pv.id = p_version_id AND pv.author_id = p_membership_id);
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_version_reader_mode(p_version_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    -- Anything other than an explicit limited audience follows the organization-wide branch.
    SELECT CASE
        WHEN rs.mode IS NOT NULL THEN rs.mode
        WHEN COALESCE(cp.target_scope, s.target_scope) = 'DEPARTMENT' THEN 'DEPARTMENT'
        ELSE 'ORGANIZATION' END
      FROM published_version pv
      LEFT JOIN reader_policy rs ON rs.id = pv.reader_policy_id
      LEFT JOIN current_publication cp ON cp.published_version_id = pv.id
      LEFT JOIN review_submission s ON s.id = pv.review_submission_id
     WHERE pv.id = p_version_id
$function$;

CREATE OR REPLACE FUNCTION arden.maintenance_version_source(p_published_version_id uuid)
 RETURNS TABLE(document_id uuid, content_uri text, content_hash text, mime_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF NOT maintenance_reviewer_covers(governance_actor_membership(org), p_published_version_id)
       AND NOT EXISTS (SELECT 1 FROM published_version pv
            WHERE pv.id = p_published_version_id
              AND pv.author_id = governance_actor_membership(org)) THEN
        RETURN;
    END IF;
    RETURN QUERY
    SELECT pv.document_id AS shared_draft_id, pv.file_uri AS content_uri, pv.content_hash, COALESCE(s.mime_type, 'text/plain')
      FROM published_version pv
      JOIN company_document d ON d.id = pv.document_id AND d.organization_id = org
      LEFT JOIN review_submission s ON s.id = pv.review_submission_id
     WHERE pv.id = p_published_version_id;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.notify_arden_notification()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
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
    IF TG_TABLE_NAME = 'review_submission' AND TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PENDING_REVIEW' OR NEW.policy_version <> 1 THEN RETURN NEW; END IF;
        organization_wide := NEW.target_scope = 'ORGANIZATION';

        FOR recipient IN
            SELECT om.id AS membership_id
              FROM membership om
              JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
             WHERE om.organization_id = NEW.organization_id AND om.status = 'ACTIVE'
               AND (EXISTS (SELECT 1 FROM role_assignment ra
                    JOIN role r ON r.id = ra.role_id AND r.organization_id IS NULL
                      AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
                    JOIN access_scope s ON s.id = ra.access_scope_id
                      AND s.organization_id = NEW.organization_id AND s.scope = 'ORGANIZATION' AND s.status = 'ACTIVE'
                    WHERE ra.membership_id = om.id AND ra.status = 'ACTIVE' AND ra.valid_from <= now()
                      AND (ra.valid_until IS NULL OR ra.valid_until > now()))
                 OR (om.id <> NEW.submitted_by_id AND EXISTS (SELECT 1 FROM reviewer_grant g
                    LEFT JOIN department d ON d.id = g.department_id AND d.organization_id = g.organization_id
                    WHERE g.organization_id = NEW.organization_id AND g.reviewer_id = om.id
                      AND g.status = 'ACTIVE' AND g.valid_from <= now()
                      AND (g.valid_until IS NULL OR g.valid_until > now())
                      AND NEW.classification = ANY(g.classifications)
                      AND (NEW.classification <> 'RESTRICTED' OR g.level IN ('SPECIALIST', 'SENIOR'))


                      AND (
                        (organization_wide
                          AND (g.scope = 'ORGANIZATION'
                            OR (NEW.review_rule = 'LEGACY' AND g.scope = 'DEPARTMENT'
                              AND g.department_id = NEW.owner_department_id
                              AND g.level IN ('SPECIALIST', 'SENIOR'))))
                        OR (NOT organization_wide AND g.scope = 'DEPARTMENT'
                          AND g.department_id = NEW.owner_department_id AND d.status = 'ACTIVE')
                      )
                    )
                  )
               )
        LOOP
            INSERT INTO notification (organization_id, recipient_id, event_key, event_type, resource_type, resource_id)
            VALUES (NEW.organization_id, recipient.membership_id,
                'submission:' || NEW.id::text || ':review-request', 'REVIEW_REQUESTED', 'SUBMISSION', NEW.id)
            ON CONFLICT (event_key, recipient_id) DO NOTHING
            RETURNING id AS notification_id INTO inserted_notification_id;
            IF inserted_notification_id IS NOT NULL THEN
                INSERT INTO notification_outbox (notification_id, organization_id)
                VALUES (inserted_notification_id, NEW.organization_id);
            END IF;
            inserted_notification_id := NULL;
        END LOOP;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'review_decision' THEN
        IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
        IF NOT NEW.is_snapshot_review THEN RETURN NEW; END IF;
        SELECT s.organization_id, s.submitted_by_id AS submitted_by_membership_id INTO v_organization_id, v_recipient_membership_id
          FROM review_submission s WHERE s.id = NEW.review_submission_id;
        v_event_key := 'review:' || NEW.id::text || ':author-outcome';
        v_event_type := CASE WHEN NEW.decision = 'APPROVED' THEN 'REVIEW_APPROVED' ELSE 'REVIEW_REJECTED' END;
        v_resource_type := 'SUBMISSION'; v_resource_id := NEW.review_submission_id;
    ELSIF TG_TABLE_NAME = 'review_submission' THEN
        IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
        IF NEW.publication_state IS NOT DISTINCT FROM OLD.publication_state
            OR NEW.publication_state NOT IN ('ACTIVE', 'FAILED') THEN RETURN NEW; END IF;
        v_organization_id := NEW.organization_id; v_recipient_membership_id := NEW.submitted_by_id;
        SELECT g.completed_at INTO v_event_at
          FROM index_generation g
         WHERE g.review_submission_id = NEW.id
         ORDER BY g.created_at DESC, g.id DESC LIMIT 1;
        v_event_at := COALESCE(v_event_at, clock_timestamp());
        v_event_key := 'publication:' || NEW.id::text || ':' || NEW.publication_state || ':'
            || to_char(v_event_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS.US');
        v_event_type := CASE WHEN NEW.publication_state = 'ACTIVE' THEN 'PUBLICATION_ACTIVE' ELSE 'PUBLICATION_FAILED' END;
        v_resource_type := 'SUBMISSION'; v_resource_id := NEW.id;
    ELSIF TG_TABLE_NAME = 'reviewer_grant' THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.status <> 'ACTIVE' THEN RETURN NEW; END IF;
            v_organization_id := NEW.organization_id; v_recipient_membership_id := NEW.reviewer_id;
            v_event_key := 'reviewer-grant:' || NEW.id::text || ':created';
            v_event_type := 'REVIEWER_GRANT_CREATED';
        ELSIF TG_OP = 'UPDATE' THEN
            IF OLD.status <> 'ACTIVE' OR NEW.status = 'ACTIVE' THEN RETURN NEW; END IF;
            v_organization_id := NEW.organization_id; v_recipient_membership_id := NEW.reviewer_id;
            v_event_key := 'reviewer-grant:' || NEW.id::text || ':revoked';
            v_event_type := 'REVIEWER_GRANT_REVOKED';
        ELSE
            RETURN NEW;
        END IF;
        v_resource_type := 'REVIEWER_GRANT'; v_resource_id := NEW.id;
        SELECT EXISTS (SELECT 1 FROM membership om
            JOIN role_assignment ra ON ra.membership_id = om.id AND ra.status = 'ACTIVE'
              AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
            JOIN role r ON r.id = ra.role_id AND r.organization_id IS NULL
              AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
            JOIN access_scope s ON s.id = ra.access_scope_id AND s.organization_id = v_organization_id
              AND s.scope = 'ORGANIZATION' AND s.status = 'ACTIVE'
            JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.account_id = actor_id AND om.organization_id = v_organization_id AND om.status = 'ACTIVE')
          INTO is_current_org_admin;
        IF NOT COALESCE(is_current_org_admin, false) THEN RETURN NEW; END IF;
    ELSIF TG_TABLE_NAME = 'department_membership' THEN
        IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN RETURN NEW; END IF;
        IF NEW.is_primary IS DISTINCT FROM true OR NEW.status IS DISTINCT FROM 'ACTIVE' THEN RETURN NEW; END IF;
        IF TG_OP = 'UPDATE' AND OLD.is_primary IS NOT DISTINCT FROM NEW.is_primary
            AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
        SELECT om.organization_id INTO v_organization_id
          FROM membership om WHERE om.id = NEW.membership_id;
        v_recipient_membership_id := NEW.membership_id;
        v_event_key := 'department:' || NEW.membership_id::text || ':' || NEW.department_id::text || ':' || NEW.assigned_at::text;
        v_event_type := 'PRIMARY_DEPARTMENT_CHANGED'; v_resource_type := 'DEPARTMENT'; v_resource_id := NEW.department_id;
        SELECT EXISTS (SELECT 1 FROM membership om
            JOIN role_assignment ra ON ra.membership_id = om.id AND ra.status = 'ACTIVE'
              AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now())
            JOIN role r ON r.id = ra.role_id AND r.organization_id IS NULL
              AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
            JOIN access_scope s ON s.id = ra.access_scope_id AND s.organization_id = v_organization_id
              AND s.scope = 'ORGANIZATION' AND s.status = 'ACTIVE'
            JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
            JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
            WHERE om.account_id = actor_id AND om.organization_id = v_organization_id AND om.status = 'ACTIVE')
          INTO is_current_org_admin;
        IF NOT COALESCE(is_current_org_admin, false) THEN RETURN NEW; END IF;
    ELSE
        RETURN NEW;
    END IF;

    INSERT INTO notification (organization_id, recipient_id, event_key, event_type, resource_type, resource_id)
    SELECT v_organization_id, v_recipient_membership_id, v_event_key, v_event_type, v_resource_type, v_resource_id
     WHERE EXISTS (SELECT 1 FROM membership om
        JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
        JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
        WHERE om.id = v_recipient_membership_id AND om.organization_id = v_organization_id AND om.status = 'ACTIVE')
    ON CONFLICT (event_key, recipient_id) DO NOTHING
    RETURNING id AS notification_id INTO inserted_notification_id;
    IF inserted_notification_id IS NOT NULL THEN
        INSERT INTO notification_outbox (notification_id, organization_id)
        VALUES (inserted_notification_id, v_organization_id);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.notify_arden_publication_share()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
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
       OR OLD.reader_policy_id IS NOT DISTINCT FROM NEW.reader_policy_id THEN
        RETURN NEW;
    END IF;

    -- apply_publication_change updates this pointer inside the review-decision transaction. Resolve
    -- the exact approved request. The new selection determines whether it is a personal or group share.
    SELECT s.id AS submission_id, s.submitted_by_id AS submitted_by_membership_id, pv.title,
           COALESCE(NULLIF(btrim(ua.full_name), ''), 'A colleague'),
           CASE WHEN rs.mode = 'SELECTED_MEMBERS'
                THEN 'DOCUMENT_SHARED_PERSONAL' ELSE 'DOCUMENT_SHARED_GROUP' END
      INTO share_submission_id, author_membership_id, publication_title, shared_by_name, share_notification_type
      FROM review_submission s
      JOIN company_document d ON d.id = s.document_id
                         AND d.author_id = s.submitted_by_id
      JOIN membership author ON author.id = s.submitted_by_id
                                         AND author.organization_id = s.organization_id
      JOIN account ua ON ua.id = author.account_id
      JOIN published_version pv ON pv.id = s.target_published_version_id
                                          AND pv.document_id = s.document_id
      JOIN reader_policy rs ON rs.id = s.approved_reader_policy_id
                               AND rs.organization_id = s.organization_id
     WHERE s.organization_id = NEW.organization_id
       AND s.document_id = NEW.document_id
       AND s.request_type = 'READER_CHANGE'
       AND s.status = 'APPROVED'
       AND s.target_published_version_id = NEW.published_version_id
       AND s.approved_reader_policy_id = NEW.reader_policy_id
     ORDER BY s.submitted_at DESC, s.id DESC
     LIMIT 1;
    IF NOT FOUND THEN RETURN NEW; END IF;

    FOR recipient IN
        SELECT om.id AS membership_id
          FROM membership om
          JOIN account recipient_account ON recipient_account.id = om.account_id
                                               AND recipient_account.status = 'ACTIVE'
          JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
         WHERE om.organization_id = NEW.organization_id
           AND om.status = 'ACTIVE'
           AND om.id <> author_membership_id
           AND om.id IN (
               SELECT reader_mode_memberships(NEW.organization_id, rs.mode, rs.department_id, rs.id)
                 FROM reader_policy rs
                WHERE rs.id = NEW.reader_policy_id
                  AND rs.organization_id = NEW.organization_id)
         ORDER BY om.id
    LOOP
        inserted_notification_id := NULL;
        INSERT INTO notification (organization_id, recipient_id, event_key,
            event_type, resource_type, resource_id, publication_title, shared_by_name)
        VALUES (NEW.organization_id, recipient.membership_id,
            'publication:' || NEW.published_version_id::text || ':shared:' || share_submission_id::text,
            share_notification_type, 'PUBLICATION', NEW.published_version_id, publication_title, shared_by_name)
        ON CONFLICT (event_key, recipient_id) DO NOTHING
        RETURNING id AS notification_id INTO inserted_notification_id;
        IF inserted_notification_id IS NOT NULL THEN
            INSERT INTO notification_outbox (notification_id, organization_id)
            VALUES (inserted_notification_id, NEW.organization_id);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.notify_private_item_share()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    item_title text;
    owner_name text;
    inserted_notification_id uuid;
BEGIN
    SELECT d.title, COALESCE(NULLIF(btrim(ua.full_name), ''), 'A colleague')
      INTO item_title, owner_name
      FROM private_document d
      JOIN private_workspace w ON w.id = d.workspace_id AND w.membership_id = NEW.owner_id
      JOIN membership om ON om.id = NEW.owner_id
                                     AND om.organization_id = NEW.organization_id
      JOIN account ua ON ua.id = om.account_id
     WHERE d.id = NEW.document_id;
    IF NOT FOUND OR char_length(btrim(item_title)) = 0 THEN RETURN NEW; END IF;
    INSERT INTO notification (organization_id, recipient_id, event_key,
        event_type, resource_type, resource_id, publication_title, shared_by_name)
    VALUES (NEW.organization_id, NEW.recipient_id, 'private-share:' || NEW.id::text,
        'DOCUMENT_SHARED_DIRECT', 'PRIVATE_ITEM', NEW.document_id, item_title, owner_name)
    ON CONFLICT (event_key, recipient_id) DO NOTHING
    RETURNING id AS notification_id INTO inserted_notification_id;
    IF inserted_notification_id IS NOT NULL THEN
        INSERT INTO notification_outbox (notification_id, organization_id)
        VALUES (inserted_notification_id, NEW.organization_id);
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.open_governance_inspection(p_document_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row governance_current_publication%ROWTYPE;
    opened uuid;
    started timestamptz := now();
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN
        RAISE EXCEPTION 'Organization administration required' USING ERRCODE = '42501';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Give a reason of 1 to 1000 characters' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO current_row FROM governance_current_publication g
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org;
    IF NOT FOUND THEN RETURN NULL; END IF;
    INSERT INTO inspection (organization_id, opened_by_id, document_id, published_version_id,
        reason, opened_at, last_used_at, expires_at)
    VALUES (org, actor, p_document_id, current_row.published_version_id, btrim(p_reason), started, started,
        started + interval '2 hours')
    RETURNING id AS inspection_id INTO opened;
    INSERT INTO audit_event (organization_id, actor_id, event_type, outcome, details)
    VALUES (org, actor, 'KNOWLEDGE_GOVERNANCE_INSPECTION_OPENED', 'SUCCESS',
        jsonb_build_object('inspectionId', opened, 'documentId', p_document_id,
            'publishedVersionId', current_row.published_version_id, 'reason', btrim(p_reason)));
    RETURN opened;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.organization_has_active_reviewer_grant(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM membership caller
        JOIN account caller_user ON caller_user.id = caller.account_id
          AND caller_user.status = 'ACTIVE'
        JOIN organization o ON o.id = caller.organization_id AND o.status = 'ACTIVE'
        WHERE caller.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND caller.organization_id = p_organization_id
          AND caller.status = 'ACTIVE')
      AND EXISTS (
        SELECT 1 FROM reviewer_grant g
        JOIN membership reviewer
          ON reviewer.id = g.reviewer_id
         AND reviewer.organization_id = g.organization_id
         AND reviewer.status = 'ACTIVE'
        JOIN account reviewer_user ON reviewer_user.id = reviewer.account_id
         AND reviewer_user.status = 'ACTIVE'
        WHERE g.organization_id = p_organization_id
          AND g.scope = 'ORGANIZATION'
          AND g.status = 'ACTIVE'
          AND g.valid_from <= now()
          AND (g.valid_until IS NULL OR g.valid_until > now()));
$function$;

CREATE OR REPLACE FUNCTION arden.protect_flow2_published_metadata()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.document_id IS NOT NULL AND
       (NEW.document_id, NEW.classification, NEW.owner_department_id,
        NEW.valid_from, NEW.valid_until)
       IS DISTINCT FROM
       (OLD.document_id, OLD.classification, OLD.owner_department_id,
        OLD.valid_from, OLD.valid_until) THEN
        RAISE EXCEPTION 'Published governance metadata is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.protect_flow2_submission_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.working_version_id IS NOT NULL AND
       (NEW.working_version_id, NEW.document_id, NEW.snapshot_version_no,
        NEW.organization_id, NEW.submitted_by_id,
        NEW.target_scope, NEW.target_department_id, NEW.owner_department_id,
        NEW.title, NEW.classification,
        NEW.policy_version, NEW.review_rule, NEW.file_uri, NEW.mime_type,
        NEW.content_hash, NEW.submit_request_id, NEW.proposed_reader_policy_id,
        NEW.keywords, NEW.change_description,
        NEW.request_type, NEW.request_reason, NEW.target_published_version_id,
        NEW.renewal_valid_until, NEW.on_behalf_of_author, NEW.author_response_deadline)
       IS DISTINCT FROM
       (OLD.working_version_id, OLD.document_id, OLD.snapshot_version_no,
        OLD.organization_id, OLD.submitted_by_id,
        OLD.target_scope, OLD.target_department_id, OLD.owner_department_id,
        OLD.title, OLD.classification,
        OLD.policy_version, OLD.review_rule, OLD.file_uri, OLD.mime_type,
        OLD.content_hash, OLD.submit_request_id, OLD.proposed_reader_policy_id,
        OLD.keywords, OLD.change_description,
        OLD.request_type, OLD.request_reason, OLD.target_published_version_id,
        OLD.renewal_valid_until, OLD.on_behalf_of_author, OLD.author_response_deadline) THEN
        RAISE EXCEPTION 'Submitted snapshot is immutable' USING ERRCODE = '55000';
    END IF;
    IF NEW.approved_reader_policy_id IS DISTINCT FROM OLD.approved_reader_policy_id
       AND (OLD.approved_reader_policy_id IS NOT NULL OR NEW.approved_reader_policy_id IS NULL
            OR OLD.proposed_reader_policy_id IS NULL
            OR OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'APPROVED') THEN
        RAISE EXCEPTION 'Approved readers are recorded once, at approval' USING ERRCODE = '55000';
    END IF;
    IF OLD.proposed_reader_policy_id IS NOT NULL AND OLD.status = 'PENDING_REVIEW' AND NEW.status = 'APPROVED'
       AND NEW.approved_reader_policy_id IS NULL THEN
        RAISE EXCEPTION 'Approving proposed readers must record the approved readers' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.protect_private_draft_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'private_version is immutable: DELETE is not allowed' USING ERRCODE = '55000';
    END IF;
    IF OLD.sealed_at IS NOT NULL THEN
        RAISE EXCEPTION 'A sealed private note version is immutable' USING ERRCODE = '55000';
    END IF;
    IF (NEW.id, NEW.document_id, NEW.created_by_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.document_id, OLD.created_by_id, OLD.created_at) THEN
        RAISE EXCEPTION 'A private note version keeps its identity' USING ERRCODE = '55000';
    END IF;
    IF NEW.version_no < OLD.version_no THEN
        RAISE EXCEPTION 'A private note version number cannot go back' USING ERRCODE = '55000';
    END IF;
    -- A contributed version may only become sealed; its content and number never change.
    IF (NEW.sealed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM company_document s WHERE s.source_private_version_id = OLD.id)
        OR EXISTS (SELECT 1 FROM review_submission s WHERE s.private_version_id = OLD.id))
       AND (NEW.version_no, NEW.file_uri, NEW.mime_type, NEW.content_hash, NEW.text_uri, NEW.text_content_hash)
           IS DISTINCT FROM (OLD.version_no, OLD.file_uri, OLD.mime_type, OLD.content_hash, OLD.text_uri, OLD.text_content_hash) THEN
        RAISE EXCEPTION 'A contributed private note version is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.protect_private_item_share()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF (NEW.id, NEW.organization_id, NEW.document_id, NEW.owner_id, NEW.recipient_id, NEW.created_at)
       IS DISTINCT FROM (OLD.id, OLD.organization_id, OLD.document_id, OLD.owner_id, OLD.recipient_id, OLD.created_at)
       OR OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'A direct share can only be revoked' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.protect_published_version_content()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'published_version is immutable: DELETE is not allowed'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.review_submission_id IS DISTINCT FROM OLD.review_submission_id
       OR NEW.knowledge_base_id IS DISTINCT FROM OLD.knowledge_base_id
       OR NEW.published_by_id IS DISTINCT FROM OLD.published_by_id
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.file_uri IS DISTINCT FROM OLD.file_uri
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
        RAISE EXCEPTION 'Published content and provenance are immutable; create a new version instead'
            USING ERRCODE = '55000';
    END IF;

    -- index_status is intentionally mutable so the indexing worker can move
    -- PENDING -> PROCESSING -> INDEXED/FAILED without rewriting content.
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.protect_shared_draft_provenance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.source_private_version_id IS DISTINCT FROM OLD.source_private_version_id
       OR NEW.source_published_version_id IS DISTINCT FROM OLD.source_published_version_id THEN
        RAISE EXCEPTION 'Shared draft provenance is immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.publication_change_target_state(p_submission_id uuid)
 RETURNS TABLE(target_is_current boolean, newer_version_preparing boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    request review_submission%ROWTYPE;
BEGIN
    IF actor IS NULL THEN RETURN; END IF;
    SELECT s.id AS submission_id,
           s.private_version_id AS draft_version_id,
           s.submitted_by_id AS submitted_by_membership_id,
           s.target_scope AS target_scope_type,
           s.target_department_id,
           s.status,
           s.submitted_at,
           s.organization_id,
           s.working_version_id AS shared_draft_version_id,
           s.document_id AS shared_draft_id,
           s.snapshot_version_no,
           s.owner_department_id AS responsible_department_id,
           s.title,
           s.classification,
           s.policy_version,
           s.file_uri AS content_uri,
           s.mime_type,
           s.content_hash,
           s.submit_request_id,
           s.publication_state,
           s.review_rule,
           s.proposed_reader_policy_id AS proposed_selection_id,
           s.approved_reader_policy_id AS approved_selection_id,
           s.keywords,
           s.change_description,
           s.document_code,
           s.metadata AS management,
           s.request_type,
           s.request_reason,
           s.target_published_version_id,
           s.publication_failure_code,
           s.withdrawn_by_role AS withdrawn_by,
           s.withdrawal_reason AS withdrawn_reason,
           s.withdrawn_at,
           s.renewal_valid_until AS renewal_expiration_date,
           s.on_behalf_of_author,
           s.author_response_deadline AS author_decides_until INTO request FROM review_submission s
     WHERE s.id = p_submission_id AND s.organization_id = org AND s.request_type <> 'CONTENT';
    IF NOT FOUND THEN RETURN; END IF;
    IF NOT (governance_is_org_admin(actor, org)
        OR actor_has_review_scope(request.organization_id, request.owner_department_id,
               request.classification, request.target_scope, request.review_rule)
        OR EXISTS (SELECT 1 FROM company_document d WHERE d.id = request.document_id
                     AND d.author_id = actor)) THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT
        EXISTS (SELECT 1 FROM current_publication cp WHERE cp.document_id = request.document_id
                  AND cp.organization_id = org AND cp.published_version_id = request.target_published_version_id),
        EXISTS (SELECT 1 FROM review_submission c WHERE c.document_id = request.document_id
                  AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING');
END;
$function$;

CREATE OR REPLACE FUNCTION arden.publication_expiration_date(p_published_version_id uuid, p_management jsonb)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT CASE WHEN r.published_version_id IS NOT NULL THEN r.valid_until
                ELSE NULLIF(p_management->>'expirationDate', '')::date END
      FROM (SELECT 1) AS one
      LEFT JOIN publication_renewal r ON r.published_version_id = p_published_version_id
$function$;

CREATE OR REPLACE FUNCTION arden.reader_mode_memberships(p_organization_id uuid, p_mode text, p_department_id uuid, p_selection_id uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT om.id AS membership_id
      FROM membership om
      JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
     WHERE om.organization_id = p_organization_id AND om.status = 'ACTIVE'
       AND (p_mode = 'ORGANIZATION'
         OR (p_mode = 'DEPARTMENT' AND EXISTS (
             SELECT 1 FROM department_membership dm
               JOIN department d ON d.id = dm.department_id
                                AND d.organization_id = p_organization_id AND d.status = 'ACTIVE'
              WHERE dm.membership_id = om.id AND dm.department_id = p_department_id
                AND dm.status = 'ACTIVE'))
         OR (p_mode = 'SELECTED_MEMBERS' AND EXISTS (
             SELECT 1 FROM policy_reader sr
              WHERE sr.reader_policy_id = p_selection_id AND sr.membership_id = om.id)));
$function$;

CREATE OR REPLACE FUNCTION arden.reader_selection_member_facts(p_membership_ids uuid[])
 RETURNS TABLE(membership_id uuid, membership_status text, account_active boolean, department_ids uuid[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT om.id AS membership_id, om.status, ua.status = 'ACTIVE',
           ARRAY(SELECT dm.department_id FROM department_membership dm
                   JOIN department d ON d.id = dm.department_id
                                    AND d.organization_id = om.organization_id AND d.status = 'ACTIVE'
                  WHERE dm.membership_id = om.id AND dm.status = 'ACTIVE'
                  ORDER BY dm.department_id)
      FROM membership om
      JOIN account ua ON ua.id = om.account_id
     WHERE om.id = ANY(p_membership_ids)
       AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND cardinality(p_membership_ids) <= 500
       AND EXISTS (SELECT 1 FROM membership actor
           WHERE actor.organization_id = om.organization_id
             AND actor.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND actor.status = 'ACTIVE');
$function$;

CREATE OR REPLACE FUNCTION arden.reconcile_collection_placement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE changed_document_id uuid;
BEGIN
    IF TG_TABLE_NAME = 'handbook' THEN
        UPDATE handbook_placement p SET handbook_id = NULL
          WHERE p.handbook_id = NEW.id
            AND NOT collection_source_eligible(p.organization_id, p.document_id, p.handbook_id);
    ELSE
        changed_document_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.document_id ELSE NEW.document_id END;
        UPDATE handbook_placement p SET handbook_id = NULL
          WHERE p.document_id = changed_document_id AND p.handbook_id IS NOT NULL
            AND NOT collection_source_eligible(p.organization_id, p.document_id, p.handbook_id);
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.record_index_ai_usage(p_job_id uuid, p_worker_id uuid, p_events jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE job_org uuid; job_generation uuid; event jsonb; inserted integer := 0; event_id uuid; operation text;
        provider_name text; model_name text; input_count bigint; output_count bigint;
        duration_ms integer; complete_usage boolean;
BEGIN
    IF current_setting('role', true) <> 'arden_indexer'
       OR p_events IS NULL OR jsonb_typeof(p_events) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Index usage write is unavailable' USING ERRCODE='42501';
    END IF;
    IF jsonb_array_length(p_events) > 32 THEN
        RAISE EXCEPTION 'Index usage write is unavailable' USING ERRCODE='42501';
    END IF;
    SELECT g.organization_id, g.id AS generation_id INTO job_org, job_generation
      FROM index_generation g
     WHERE g.job_id=p_job_id AND g.job_status='RUNNING' AND g.lease_owner_id=p_worker_id
       AND g.lease_expires_at > clock_timestamp() AND g.status='PROCESSING';
    IF job_org IS NULL THEN
        RAISE EXCEPTION 'Index usage job is not owned by this worker' USING ERRCODE='42501';
    END IF;
    FOR event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
        IF jsonb_typeof(event) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Invalid index usage event' USING ERRCODE='22023';
        END IF;
        IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(event) AS keys(key)) IS DISTINCT FROM
             ARRAY['eventId','inputTokens','latencyMs','model','operation','outputTokens','provider','usageComplete']::text[] THEN
            RAISE EXCEPTION 'Invalid index usage event' USING ERRCODE='22023';
        END IF;
        event_id := (event->>'eventId')::uuid;
        operation := event->>'operation'; provider_name := event->>'provider'; model_name := event->>'model';
        input_count := NULLIF(event->>'inputTokens','')::bigint;
        output_count := NULLIF(event->>'outputTokens','')::bigint;
        duration_ms := NULLIF(event->>'latencyMs','')::integer;
        complete_usage := (event->>'usageComplete')::boolean;
        IF event_id IS NULL OR operation IS DISTINCT FROM 'INDEX_EMBEDDING'
           OR provider_name IS NULL OR provider_name !~ '^[A-Z0-9_-]{1,80}$'
           OR model_name IS NULL OR length(model_name) NOT BETWEEN 1 AND 120
           OR (input_count IS NOT NULL AND input_count < 0) OR (output_count IS NOT NULL AND output_count < 0)
           OR (duration_ms IS NOT NULL AND duration_ms < 0)
           OR (complete_usage AND (input_count IS NULL OR output_count IS NULL)) THEN
            RAISE EXCEPTION 'Invalid index usage event values' USING ERRCODE='22023';
        END IF;
        INSERT INTO ai_usage(organization_id, request_id, idempotency_key, operation, provider, model,
            input_tokens, output_tokens, latency_ms, is_complete, estimated_cost_micro_usd, price_book_version)
        SELECT job_org, p_job_id, job_generation::text || ':' || event_id::text, operation, provider_name, model_name,
          input_count, output_count, duration_ms, complete_usage,
          CASE WHEN complete_usage AND price.price_book_version IS NOT NULL THEN
            ceil((input_count::numeric * price.input_micro_usd_per_million_tokens
              + output_count::numeric * price.output_micro_usd_per_million_tokens) / 1000000)::bigint END,
          price.price_book_version
        FROM (SELECT 1) seed LEFT JOIN LATERAL (SELECT pb.price_book_version, pb.input_micro_usd_per_million_tokens,
            pb.output_micro_usd_per_million_tokens FROM price_book pb
          WHERE pb.provider=provider_name AND pb.model=model_name AND pb.effective_from<=now()
            AND (pb.effective_until IS NULL OR pb.effective_until>now())
          ORDER BY pb.effective_from DESC LIMIT 1) price ON true
        ON CONFLICT (idempotency_key) DO NOTHING;
        inserted := inserted + CASE WHEN FOUND THEN 1 ELSE 0 END;
    END LOOP;
    RETURN inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.record_publication_failure_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF NEW.status = 'FAILED' AND OLD.status IS DISTINCT FROM 'FAILED' THEN
        UPDATE review_submission SET publication_failure_code = NEW.failure_code
         WHERE id = NEW.review_submission_id;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.reject_maintenance_case_rewrite()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.origin IS DISTINCT FROM OLD.origin
        OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
        OR NEW.document_id IS DISTINCT FROM OLD.document_id
        OR NEW.published_version_id IS DISTINCT FROM OLD.published_version_id
        OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.author_id IS DISTINCT FROM OLD.author_id
        OR NEW.review_department_id IS DISTINCT FROM OLD.review_department_id
        OR NEW.classification IS DISTINCT FROM OLD.classification
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.revision <= OLD.revision THEN
        RAISE EXCEPTION 'maintenance case identity and revision are immutable' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$function$;

-- The last trigger using this pre-snapshot rule was removed in 0018.
DROP FUNCTION arden.reject_pending_shared_draft_change();

CREATE OR REPLACE FUNCTION arden.reject_private_collection_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF NEW.parent_folder_id IS NOT NULL AND EXISTS (
        WITH RECURSIVE ancestor(collection_id, depth) AS (
            SELECT NEW.parent_folder_id AS parent_collection_id, 1
            UNION ALL
            SELECT c.parent_folder_id AS parent_collection_id, a.depth + 1
              FROM private_folder c
              JOIN ancestor a ON a.collection_id = c.id
             WHERE c.parent_folder_id IS NOT NULL AND a.depth < 10000
        )
        SELECT 1 FROM ancestor WHERE collection_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'A private collection cannot be moved into itself or a descendant'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.remove_governed_document_relationship(p_source_document_id uuid, p_relationship_id uuid)
 RETURNS TABLE(relationship_id uuid, source_document_id uuid, target_document_id uuid, relationship_type text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
BEGIN
    IF org IS NULL OR p_source_document_id IS NULL OR p_relationship_id IS NULL THEN
        RETURN;
    END IF;
    IF NOT actor_can_manage_relationship_source(org, p_source_document_id) THEN
        RETURN;
    END IF;
    RETURN QUERY
    DELETE FROM document_relationship r
     WHERE r.id = p_relationship_id
       AND r.organization_id = org
       AND r.source_document_id = p_source_document_id
    RETURNING r.id AS relationship_id, r.source_document_id, r.target_document_id, r.type AS relationship_type;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.renewal_author_window(p_submission_id uuid)
 RETURNS TABLE(author_membership_id uuid, author_active boolean, window_until timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT d.author_id AS author_membership_id, renewal_member_active(d.author_id), s.author_response_deadline AS author_decides_until
      FROM review_submission s
      JOIN company_document d ON d.id = s.document_id
     WHERE s.id = p_submission_id AND s.request_type = 'RENEWAL' AND s.on_behalf_of_author
$function$;

CREATE OR REPLACE FUNCTION arden.renewal_member_active(p_membership_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM membership om
      JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
      JOIN organization o ON o.id = om.organization_id AND o.status = 'ACTIVE'
     WHERE om.id = p_membership_id AND om.status = 'ACTIVE')
$function$;

CREATE OR REPLACE FUNCTION arden.renewal_member_name(p_membership_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT COALESCE(NULLIF(btrim(ua.full_name), ''), 'A colleague')
      FROM membership om JOIN account ua ON ua.id = om.account_id
     WHERE om.id = p_membership_id
$function$;

CREATE OR REPLACE FUNCTION arden.request_publication_renewal(p_document_id uuid, p_expiration_date date, p_reason text, p_request_id uuid)
 RETURNS TABLE(outcome text, submission_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row record;
    released review_submission%ROWTYPE;
    replay review_submission%ROWTYPE;
    on_behalf boolean;
    created uuid;
    today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
    IF actor IS NULL OR p_request_id IS NULL THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid; RETURN; END IF;
    SELECT s.id AS submission_id,
           s.private_version_id AS draft_version_id,
           s.submitted_by_id AS submitted_by_membership_id,
           s.target_scope AS target_scope_type,
           s.target_department_id,
           s.status,
           s.submitted_at,
           s.organization_id,
           s.working_version_id AS shared_draft_version_id,
           s.document_id AS shared_draft_id,
           s.snapshot_version_no,
           s.owner_department_id AS responsible_department_id,
           s.title,
           s.classification,
           s.policy_version,
           s.file_uri AS content_uri,
           s.mime_type,
           s.content_hash,
           s.submit_request_id,
           s.publication_state,
           s.review_rule,
           s.proposed_reader_policy_id AS proposed_selection_id,
           s.approved_reader_policy_id AS approved_selection_id,
           s.keywords,
           s.change_description,
           s.document_code,
           s.metadata AS management,
           s.request_type,
           s.request_reason,
           s.target_published_version_id,
           s.publication_failure_code,
           s.withdrawn_by_role AS withdrawn_by,
           s.withdrawal_reason AS withdrawn_reason,
           s.withdrawn_at,
           s.renewal_valid_until AS renewal_expiration_date,
           s.on_behalf_of_author,
           s.author_response_deadline AS author_decides_until INTO replay FROM review_submission s
     WHERE s.submitted_by_id = actor AND s.submit_request_id = p_request_id;
    IF FOUND THEN
        RETURN QUERY SELECT CASE WHEN replay.document_id = p_document_id AND replay.request_type = 'RENEWAL'
            THEN 'REPLAYED' ELSE 'PENDING' END, replay.id AS submission_id;
        RETURN;
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RETURN QUERY SELECT 'INVALID_REASON'::text, NULL::uuid; RETURN;
    END IF;
    -- Same lock as activation, withdrawal and approved changes (0021/0035/0038).
    PERFORM 1 FROM company_document d WHERE d.id = p_document_id AND d.organization_id = org
        AND d.status = 'ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid; RETURN; END IF;
    SELECT g.*, publication_expiration_date(g.published_version_id, pv.metadata) AS expires_on
      INTO current_row
      FROM governance_current_publication g
      JOIN published_version pv ON pv.id = g.published_version_id
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
    IF EXISTS (SELECT 1 FROM review_submission c WHERE c.document_id = p_document_id
                 AND c.request_type = 'RENEWAL' AND c.status = 'PENDING_REVIEW') THEN
        RETURN QUERY SELECT 'PENDING'::text, NULL::uuid; RETURN;
    END IF;
    SELECT s.id AS submission_id,
           s.private_version_id AS draft_version_id,
           s.submitted_by_id AS submitted_by_membership_id,
           s.target_scope AS target_scope_type,
           s.target_department_id,
           s.status,
           s.submitted_at,
           s.organization_id,
           s.working_version_id AS shared_draft_version_id,
           s.document_id AS shared_draft_id,
           s.snapshot_version_no,
           s.owner_department_id AS responsible_department_id,
           s.title,
           s.classification,
           s.policy_version,
           s.file_uri AS content_uri,
           s.mime_type,
           s.content_hash,
           s.submit_request_id,
           s.publication_state,
           s.review_rule,
           s.proposed_reader_policy_id AS proposed_selection_id,
           s.approved_reader_policy_id AS approved_selection_id,
           s.keywords,
           s.change_description,
           s.document_code,
           s.metadata AS management,
           s.request_type,
           s.request_reason,
           s.target_published_version_id,
           s.publication_failure_code,
           s.withdrawn_by_role AS withdrawn_by,
           s.withdrawal_reason AS withdrawn_reason,
           s.withdrawn_at,
           s.renewal_valid_until AS renewal_expiration_date,
           s.on_behalf_of_author,
           s.author_response_deadline AS author_decides_until INTO STRICT released FROM review_submission s WHERE s.id = current_row.submission_id;
    -- Repeats the released snapshot so the request routes to the same reviewers (0013/0015).
    INSERT INTO review_submission (organization_id, document_id, working_version_id, snapshot_version_no,
        submitted_by_id, target_scope, target_department_id, owner_department_id, title,
        classification, policy_version, review_rule, file_uri, mime_type,
        content_hash, submit_request_id, request_type, request_reason, target_published_version_id,
        renewal_valid_until, on_behalf_of_author, author_response_deadline)
    VALUES (released.organization_id, released.document_id, released.working_version_id,
        released.snapshot_version_no, actor, released.target_scope, released.target_department_id,
        released.owner_department_id, released.title, released.classification, released.policy_version, released.review_rule,
        released.file_uri, released.mime_type, released.content_hash, p_request_id, 'RENEWAL', btrim(p_reason),
        current_row.published_version_id, p_expiration_date, on_behalf,
        -- The active author's priority window: 3 days, or until the end of the Valid until day if earlier.
        CASE WHEN on_behalf AND renewal_member_active(current_row.submitted_by_membership_id)
             THEN LEAST(now() + interval '3 days', ((current_row.expires_on + 1)::timestamp AT TIME ZONE 'UTC')) END)
    RETURNING review_submission.id AS submission_id INTO created;
    INSERT INTO audit_event (organization_id, actor_id, event_type, outcome, details)
    VALUES (org, actor, 'KNOWLEDGE_CHANGE_REQUESTED', 'SUCCESS', jsonb_build_object('submissionId', created,
        'draftId', p_document_id, 'requestType', 'RENEWAL', 'publishedVersionId', current_row.published_version_id,
        'expirationDate', p_expiration_date, 'onBehalfOfAuthor', on_behalf, 'requestedBy', actor));
    -- Someone else renewed: tell the active author who asked and why (0032 B4).
    IF on_behalf AND renewal_member_active(current_row.submitted_by_membership_id) THEN
        WITH notice AS (
            INSERT INTO notification (organization_id, recipient_id, event_key, event_type,
                resource_type, resource_id, publication_title, shared_by_name, request_reason)
            VALUES (org, current_row.submitted_by_membership_id, 'renewal:' || created::text || ':author',
                'PUBLICATION_RENEWAL_ON_BEHALF', 'DOCUMENT', p_document_id, current_row.title,
                renewal_member_name(actor), btrim(p_reason))
            ON CONFLICT (event_key, recipient_id) DO NOTHING
            RETURNING id AS notification_id)
        INSERT INTO notification_outbox (notification_id, organization_id)
        SELECT notice.notification_id, org FROM notice;
    END IF;
    RETURN QUERY SELECT 'REQUESTED'::text, created;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.retry_knowledge_publication(p_submission_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    actor uuid := NULLIF(current_setting('arden.actor_id', true), '')::uuid;
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    sub record;
    newest_published integer;
    restarted_generation uuid;
BEGIN
    IF actor IS NULL OR org IS NULL OR p_submission_id IS NULL THEN
        RAISE EXCEPTION 'Retrying a publication needs an actor context' USING ERRCODE = '42501';
    END IF;
    SELECT s.id AS submission_id, s.document_id AS shared_draft_id, s.snapshot_version_no, s.status, s.request_type,
           s.publication_state, s.publication_failure_code, s.submitted_by_id AS submitted_by_membership_id
      INTO sub
      FROM review_submission s
      JOIN membership om ON om.id = s.submitted_by_id
     WHERE s.id = p_submission_id AND s.organization_id = org
       AND om.organization_id = org AND om.account_id = actor AND om.status = 'ACTIVE';
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;

    -- Same lock as activation (0021) and publication changes (0035).
    PERFORM 1 FROM company_document WHERE id = sub.shared_draft_id FOR UPDATE;
    SELECT s.status, s.request_type, s.publication_state, s.publication_failure_code
      INTO sub.status, sub.request_type, sub.publication_state, sub.publication_failure_code
      FROM review_submission s WHERE s.id = p_submission_id FOR UPDATE;

    IF sub.status = 'APPROVED' AND sub.publication_state = 'PREPARING' THEN RETURN 'PREPARING'; END IF;
    IF sub.status <> 'APPROVED' OR sub.request_type <> 'CONTENT' OR sub.publication_state <> 'FAILED' THEN
        RETURN 'NOT_FAILED';
    END IF;
    IF knowledge_publication_failure_kind(sub.publication_failure_code) IS DISTINCT FROM 'TEMPORARY' THEN
        RETURN 'NOT_RETRYABLE';
    END IF;
    SELECT max(s.snapshot_version_no) INTO newest_published
      FROM published_version pv JOIN review_submission s ON pv.review_submission_id = s.id
     WHERE pv.document_id = sub.shared_draft_id;
    IF newest_published >= sub.snapshot_version_no THEN RETURN 'SUPERSEDED'; END IF;

    UPDATE index_generation
       SET status = 'PENDING', failure_code = NULL, started_at = NULL, completed_at = NULL,
           job_status = 'PENDING', attempt_count = 0, max_attempts = 6, available_at = now(),
           lease_owner_id = NULL, lease_expires_at = NULL, last_error_code = NULL,
           job_completed_at = NULL, job_updated_at = now()
     WHERE review_submission_id = p_submission_id AND status = 'FAILED' AND job_status = 'FAILED'
     RETURNING id AS generation_id INTO restarted_generation;
    IF restarted_generation IS NULL THEN
        RAISE EXCEPTION 'The failed preparation job is unavailable' USING ERRCODE = '55000';
    END IF;
    UPDATE review_submission SET publication_state = 'PREPARING', publication_failure_code = NULL
     WHERE id = p_submission_id;
    INSERT INTO audit_event (organization_id, actor_id, event_type, outcome, details)
    VALUES (org, sub.submitted_by_membership_id, 'KNOWLEDGE_PUBLICATION_RETRIED', 'SUCCESS',
            jsonb_build_object('submissionId', p_submission_id, 'draftId', sub.shared_draft_id,
                               'generationId', restarted_generation,
                               'previousFailureCode', sub.publication_failure_code));
    RETURN 'PREPARING';
END;
$function$;

CREATE OR REPLACE FUNCTION arden.review_submission_authors(p_submission_ids uuid[])
 RETURNS TABLE(submission_id uuid, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT s.id AS submission_id, COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
      FROM review_submission s
      JOIN membership author ON author.id = s.submitted_by_id
      JOIN account ua ON ua.id = author.account_id
      JOIN membership actor
        ON actor.organization_id = s.organization_id AND actor.status = 'ACTIVE'
       AND actor.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
     WHERE s.id = ANY(p_submission_ids)
       AND cardinality(p_submission_ids) <= 200
       AND s.working_version_id IS NOT NULL
       AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND (EXISTS (SELECT 1 FROM role_assignment ra
               JOIN role r ON r.id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
               JOIN access_scope scope ON scope.id = ra.access_scope_id
                AND scope.organization_id = s.organization_id AND scope.scope = 'ORGANIZATION'
                AND scope.status = 'ACTIVE'
              WHERE ra.membership_id = actor.id AND ra.status = 'ACTIVE'
                AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now()))
         OR EXISTS (SELECT 1 FROM review_decision rd
              WHERE rd.review_submission_id = s.id AND rd.is_snapshot_review
                AND rd.reviewer_id = actor.id)
         OR (s.status = 'PENDING_REVIEW'
             AND actor_has_review_scope(s.organization_id, s.owner_department_id,
                 s.classification, s.target_scope, s.review_rule)));
$function$;

CREATE OR REPLACE FUNCTION arden.submission_proposed_reader_directory(p_submission_id uuid)
 RETURNS TABLE(membership_id uuid, display_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
    SELECT sr.membership_id, COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
      FROM review_submission s
      JOIN policy_reader sr ON sr.reader_policy_id = s.proposed_reader_policy_id
      JOIN membership om ON om.id = sr.membership_id
      JOIN account ua ON ua.id = om.account_id
      JOIN membership actor
        ON actor.organization_id = s.organization_id AND actor.status = 'ACTIVE'
       AND actor.account_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
     WHERE s.id = p_submission_id
       AND s.status = 'PENDING_REVIEW'
       AND s.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND (EXISTS (SELECT 1 FROM role_assignment ra
               JOIN role r ON r.id = ra.role_id AND r.code = 'ORG_ADMIN' AND r.is_system AND r.status = 'ACTIVE'
               JOIN access_scope scope ON scope.id = ra.access_scope_id
                AND scope.organization_id = s.organization_id AND scope.scope = 'ORGANIZATION'
                AND scope.status = 'ACTIVE'
              WHERE ra.membership_id = actor.id AND ra.status = 'ACTIVE'
                AND ra.valid_from <= now() AND (ra.valid_until IS NULL OR ra.valid_until > now()))
         OR actor_has_review_scope(s.organization_id, s.owner_department_id,
                 s.classification, s.target_scope, s.review_rule))
     ORDER BY sr.position;
$function$;

CREATE OR REPLACE FUNCTION arden.update_organization_direct_share_settings(p_organization_id uuid, p_enabled boolean, p_recipient_limit integer, p_request_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    editor_id uuid := governance_actor_membership(p_organization_id);
BEGIN
    IF NOT governance_is_org_admin(editor_id, p_organization_id) THEN
        RETURN false;
    END IF;

    UPDATE organization
       SET direct_share_enabled = p_enabled,
           direct_share_recipient_limit = p_recipient_limit,
           direct_share_updated_by_id = editor_id,
           direct_share_updated_at = now()
     WHERE id = p_organization_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    INSERT INTO audit_event (organization_id, actor_id, event_type, outcome, details)
    VALUES (p_organization_id, editor_id, 'DIRECT_SHARE_SETTINGS_UPDATED', 'SUCCESS',
            jsonb_build_object('enabled', p_enabled, 'recipientLimit', p_recipient_limit,
                               'requestId', p_request_id));
    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.use_governance_inspection(p_inspection_id uuid)
 RETURNS TABLE(document_id uuid, published_version_id uuid, title text, content_uri text, content_hash text, mime_type text, responsible_department_id uuid, reader_mode text, reader_department_id uuid, reader_names text[], reason text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    inspection inspection%ROWTYPE;
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN RETURN; END IF;
    SELECT i.id AS inspection_id,
           i.organization_id,
           i.opened_by_id AS admin_membership_id,
           i.document_id AS shared_draft_id,
           i.published_version_id,
           i.reason,
           i.opened_at,
           i.last_used_at,
           i.expires_at INTO inspection FROM inspection i
     WHERE i.id = p_inspection_id AND i.organization_id = org AND i.opened_by_id = actor
       AND now() < i.expires_at AND now() < i.last_used_at + interval '15 minutes'
     FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE inspection SET last_used_at = now() WHERE id = p_inspection_id;
    RETURN QUERY
    SELECT g.shared_draft_id, g.published_version_id, g.title, g.content_uri, g.content_hash,
           COALESCE(g.mime_type, CASE WHEN g.content_uri LIKE '%.pdf' THEN 'application/pdf' ELSE 'text/plain' END),
           g.responsible_department_id, g.reader_mode, g.reader_department_id,
           CASE WHEN g.reader_mode = 'SELECTED_MEMBERS' THEN ARRAY(
               SELECT COALESCE(NULLIF(btrim(ua.full_name), ''), ua.email)
                 FROM policy_reader sr
                 JOIN membership om ON om.id = sr.membership_id
                 JOIN account ua ON ua.id = om.account_id
                WHERE sr.reader_policy_id = g.reader_selection_id ORDER BY sr.position)
             ELSE ARRAY[]::text[] END,
           inspection.reason, LEAST(inspection.expires_at, now() + interval '15 minutes')
      FROM governance_current_publication g
     WHERE g.shared_draft_id = inspection.document_id AND g.organization_id = org
       AND g.published_version_id = inspection.published_version_id;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_audit_event_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    related_org uuid;
BEGIN
    IF NEW.actor_id IS NOT NULL THEN
        SELECT organization_id
          INTO STRICT related_org
          FROM membership
         WHERE id = NEW.actor_id;

        IF related_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'Audit actor must belong to the audit organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.role_assignment_id IS NOT NULL THEN
        SELECT m.organization_id
          INTO STRICT related_org
          FROM role_assignment ra
          JOIN membership m ON m.id = ra.membership_id
         WHERE ra.id = NEW.role_assignment_id;

        IF related_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'Audited role assignment belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.review_decision_id IS NOT NULL THEN
        SELECT COALESCE(s.organization_id, reviewer.organization_id)
          INTO STRICT related_org
          FROM review_decision rd
          JOIN review_submission s ON s.id = rd.review_submission_id
          JOIN membership reviewer
            ON reviewer.id = rd.reviewer_id
         WHERE rd.id = NEW.review_decision_id;

        IF related_org <> NEW.organization_id THEN
            RAISE EXCEPTION 'Audited review decision belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_collection_placement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.document_id <> OLD.document_id OR NEW.organization_id <> OLD.organization_id THEN
            RAISE EXCEPTION 'Placement identity is immutable' USING ERRCODE = '55000';
        END IF;
        NEW.revision := OLD.revision + 1;
    ELSE
        NEW.revision := 1;
    END IF;
    NEW.updated_at := now();
    IF NEW.handbook_id IS NOT NULL THEN
        -- Locks serialize eligibility with folder edits/Archive and activation.
        PERFORM 1 FROM handbook WHERE id = NEW.handbook_id
          AND organization_id = NEW.organization_id FOR SHARE;
        PERFORM 1 FROM current_publication WHERE document_id = NEW.document_id
          AND organization_id = NEW.organization_id FOR SHARE;
        IF NOT collection_source_eligible(NEW.organization_id, NEW.document_id, NEW.handbook_id) THEN
            RAISE EXCEPTION 'Document is not eligible for this collection' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_current_publication()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE publication_row record;
BEGIN
    SELECT pv.document_id AS shared_draft_id, pv.reader_policy_id AS reader_selection_id, pv.valid_from, pv.valid_until,
           kb.organization_id, kb.scope AS scope_type, kb.department_id
      INTO STRICT publication_row FROM published_version pv
      JOIN knowledge_base kb ON kb.id = pv.knowledge_base_id
     WHERE pv.id = NEW.published_version_id;
    IF publication_row.shared_draft_id IS DISTINCT FROM NEW.document_id
        OR publication_row.organization_id IS DISTINCT FROM NEW.organization_id
        OR publication_row.reader_selection_id IS DISTINCT FROM NEW.reader_policy_id
        OR publication_row.scope_type IS DISTINCT FROM NEW.target_scope
        OR publication_row.department_id IS DISTINCT FROM NEW.target_department_id
        OR publication_row.valid_from IS DISTINCT FROM NEW.valid_from
        OR publication_row.valid_until IS DISTINCT FROM NEW.valid_until THEN
        RAISE EXCEPTION 'Current pointer must exactly match its published version' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_department_membership()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    membership_org uuid;
    department_org uuid;
BEGIN
    SELECT organization_id
      INTO STRICT membership_org
      FROM membership
     WHERE id = NEW.membership_id;

    SELECT organization_id
      INTO STRICT department_org
      FROM department
     WHERE id = NEW.department_id;

    IF membership_org <> department_org THEN
        RAISE EXCEPTION 'Membership and department must belong to the same organization'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_draft_version_creator()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    owner_membership uuid;
    owner_org        uuid;
    creator_org      uuid;
BEGIN
    SELECT w.membership_id, m.organization_id
      INTO STRICT owner_membership, owner_org
      FROM private_document d
      JOIN private_workspace w ON w.id = d.workspace_id
      JOIN membership m ON m.id = w.membership_id
     WHERE d.id = NEW.document_id;

    SELECT organization_id
      INTO STRICT creator_org
      FROM membership
     WHERE id = NEW.created_by_id;

    IF owner_org <> creator_org THEN
        RAISE EXCEPTION 'Draft version creator cannot cross organization boundaries'
            USING ERRCODE = '23514';
    END IF;

    -- Authorization for a non-owner creator remains an application-level RBAC
    -- decision; this trigger only guarantees tenant isolation.
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_published_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    submission_row record;
    knowledge_row record;
    submission_org uuid;
    publisher_org uuid;
BEGIN
    SELECT s.id AS submission_id,
           s.private_version_id AS draft_version_id,
           s.submitted_by_id AS submitted_by_membership_id,
           s.target_scope AS target_scope_type,
           s.target_department_id,
           s.status,
           s.submitted_at,
           s.organization_id,
           s.working_version_id AS shared_draft_version_id,
           s.document_id AS shared_draft_id,
           s.snapshot_version_no,
           s.owner_department_id AS responsible_department_id,
           s.title,
           s.classification,
           s.policy_version,
           s.file_uri AS content_uri,
           s.mime_type,
           s.content_hash,
           s.submit_request_id,
           s.publication_state,
           s.review_rule,
           s.proposed_reader_policy_id AS proposed_selection_id,
           s.approved_reader_policy_id AS approved_selection_id,
           s.keywords,
           s.change_description,
           s.document_code,
           s.metadata AS management,
           s.request_type,
           s.request_reason,
           s.target_published_version_id,
           s.publication_failure_code,
           s.withdrawn_by_role AS withdrawn_by,
           s.withdrawal_reason AS withdrawn_reason,
           s.withdrawn_at,
           s.renewal_valid_until AS renewal_expiration_date,
           s.on_behalf_of_author,
           s.author_response_deadline AS author_decides_until
      INTO STRICT submission_row
      FROM review_submission s
     WHERE s.id = NEW.review_submission_id;

    SELECT organization_id, scope AS scope_type, department_id
      INTO STRICT knowledge_row
      FROM knowledge_base
     WHERE id = NEW.knowledge_base_id;

    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        submission_org := submission_row.organization_id;
    ELSE
        SELECT organization_id
          INTO STRICT submission_org
          FROM membership
         WHERE id = submission_row.submitted_by_membership_id;
    END IF;

    IF submission_row.status <> 'APPROVED'
        OR submission_org IS DISTINCT FROM knowledge_row.organization_id THEN
        RAISE EXCEPTION 'Publication requires an approved same-organization submission'
            USING ERRCODE = '23514';
    END IF;

    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NEW.published_by_id IS NOT NULL
            OR NOT EXISTS (SELECT 1 FROM review_decision rd
                WHERE rd.review_submission_id = NEW.review_submission_id AND rd.is_snapshot_review AND rd.decision = 'APPROVED')
            OR NEW.document_id IS DISTINCT FROM submission_row.shared_draft_id
            OR NEW.title IS DISTINCT FROM submission_row.title
            OR NEW.classification IS DISTINCT FROM submission_row.classification
            OR NEW.owner_department_id IS DISTINCT FROM submission_row.responsible_department_id
            OR NEW.reader_policy_id IS DISTINCT FROM submission_row.approved_selection_id
            OR NEW.file_uri IS DISTINCT FROM submission_row.content_uri
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
          FROM membership
         WHERE id = NEW.published_by_id;

        IF publisher_org IS DISTINCT FROM submission_org THEN
            RAISE EXCEPTION 'Legacy publisher belongs to another organization'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_reader_selection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM organization o
        WHERE o.id = NEW.organization_id AND o.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Reader selection organization is not active' USING ERRCODE = '23514';
    END IF;
    IF NEW.mode = 'DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM department d
        WHERE d.id = NEW.department_id
          AND d.organization_id = NEW.organization_id AND d.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Reader selection department is not active' USING ERRCODE = '23514';
    END IF;
    -- The creation time is the freeze marker used by validate_selected_reader.
    NEW.created_at := transaction_timestamp();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_review_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE submission_row record; reviewer_org uuid; is_org_admin boolean; author_window record; author_decides boolean;
BEGIN
    SELECT s.submitted_by_id AS submitted_by_membership_id, s.organization_id, s.working_version_id AS shared_draft_version_id,
           s.content_hash, s.owner_department_id AS responsible_department_id, s.classification,
           s.target_scope AS target_scope_type, s.review_rule
      INTO STRICT submission_row FROM review_submission s WHERE s.id = NEW.review_submission_id;
    SELECT organization_id INTO STRICT reviewer_org FROM membership
     WHERE id = NEW.reviewer_id;
    is_org_admin := governance_is_org_admin(governance_actor_membership(reviewer_org), reviewer_org);
    IF reviewer_org IS DISTINCT FROM submission_row.organization_id THEN
        RAISE EXCEPTION 'Reviewer authority does not cover this submission' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO author_window FROM renewal_author_window(NEW.review_submission_id);
    author_decides := FOUND AND author_window.author_active
        AND author_window.author_membership_id = NEW.reviewer_id;
    IF FOUND AND author_window.author_active AND NOT author_decides AND now() < author_window.window_until THEN
        RAISE EXCEPTION 'The author decides this renewal first' USING ERRCODE = 'AR032';
    END IF;
    IF submission_row.shared_draft_version_id IS NOT NULL THEN
        IF NOT NEW.is_snapshot_review
            OR NEW.working_version_id IS DISTINCT FROM submission_row.shared_draft_version_id
            OR NEW.content_hash IS DISTINCT FROM submission_row.content_hash
            OR (NOT is_org_admin AND NOT author_decides AND NOT actor_has_review_scope(submission_row.organization_id,
                submission_row.responsible_department_id, submission_row.classification,
                submission_row.target_scope_type, submission_row.review_rule)) THEN
            RAISE EXCEPTION 'Review decision does not match a live authorized snapshot' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_review_decision_readers()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE submission_row record; selection_row record;
BEGIN
    SELECT s.organization_id, s.proposed_reader_policy_id AS proposed_selection_id INTO STRICT submission_row
      FROM review_submission s WHERE s.id = NEW.review_submission_id;
    IF NEW.approved_reader_policy_id IS NULL THEN
        IF NEW.is_snapshot_review AND NEW.decision = 'APPROVED' AND submission_row.proposed_selection_id IS NOT NULL THEN
            RAISE EXCEPTION 'Approving proposed readers must record the approved readers' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT NEW.is_snapshot_review OR NEW.decision <> 'APPROVED' OR submission_row.proposed_selection_id IS NULL
       OR NEW.approved_reader_policy_id = submission_row.proposed_selection_id THEN
        RAISE EXCEPTION 'Approved readers belong only to an approval of proposed readers, as their own selection'
            USING ERRCODE = '23514';
    END IF;
    SELECT organization_id, created_at INTO selection_row FROM reader_policy
     WHERE id = NEW.approved_reader_policy_id;
    -- A is created in the deciding transaction; it is never a reused selection.
    IF NOT FOUND OR selection_row.organization_id IS DISTINCT FROM submission_row.organization_id
       OR selection_row.created_at <> transaction_timestamp() THEN
        RAISE EXCEPTION 'Approved readers must be a new selection of the same organization' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_role_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    membership_org uuid;
    scope_org      uuid;
    role_org       uuid;
BEGIN
    SELECT organization_id
      INTO STRICT membership_org
      FROM membership
     WHERE id = NEW.membership_id;

    SELECT organization_id
      INTO STRICT scope_org
      FROM access_scope
     WHERE id = NEW.access_scope_id;

    SELECT organization_id
      INTO role_org
      FROM role
     WHERE id = NEW.role_id;

    IF membership_org <> scope_org THEN
        RAISE EXCEPTION 'Membership and access scope must belong to the same organization'
            USING ERRCODE = '23514';
    END IF;

    IF role_org IS NOT NULL AND role_org <> membership_org THEN
        RAISE EXCEPTION 'Organization-specific role cannot be assigned across tenants'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_selected_reader()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE selection_row record;
BEGIN
    SELECT mode AS reader_mode, created_at INTO selection_row FROM reader_policy
     WHERE id = NEW.reader_policy_id AND organization_id = NEW.organization_id;
    IF NOT FOUND OR selection_row.reader_mode <> 'SELECTED_MEMBERS' THEN
        RAISE EXCEPTION 'Readers can be listed only on a Selected Members selection' USING ERRCODE = '23514';
    END IF;
    -- A committed selection is frozen: readers may be added only in the
    -- transaction that created the selection.
    IF selection_row.created_at <> transaction_timestamp() THEN
        RAISE EXCEPTION 'reader_policy is immutable once saved' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM membership om
        JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
        WHERE om.id = NEW.membership_id
          AND om.organization_id = NEW.organization_id AND om.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'Selected reader must be an active member of the organization' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_shared_draft_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE source_org uuid; source_owner uuid;
BEGIN
    IF NEW.source_private_version_id IS NOT NULL THEN
        SELECT om.organization_id, om.id AS membership_id INTO source_org, source_owner
          FROM private_version v
          JOIN private_document d ON d.id = v.document_id
          JOIN private_workspace w ON w.id = d.workspace_id
          JOIN membership om ON om.id = w.membership_id
         WHERE v.id = NEW.source_private_version_id;
        IF source_org IS DISTINCT FROM NEW.organization_id OR source_owner IS DISTINCT FROM NEW.author_id THEN
            RAISE EXCEPTION 'Shared draft private source must belong to its author and organization' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.source_published_version_id IS NOT NULL THEN
        SELECT kb.organization_id INTO source_org
          FROM published_version pv
          JOIN knowledge_base kb ON kb.id = pv.knowledge_base_id
         WHERE pv.id = NEW.source_published_version_id;
        IF source_org IS DISTINCT FROM NEW.organization_id THEN
            RAISE EXCEPTION 'Shared draft published source must belong to its organization' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_shared_submission()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE source_org uuid; submitter_org uuid; department_org uuid; source_row record; published_row record;
    renewal_row record; author_active boolean;
BEGIN
    SELECT organization_id INTO STRICT submitter_org FROM membership
     WHERE id = NEW.submitted_by_id;
    -- Decision 0032: a renewal changes only validity. The author may ask at any time; an Organization Admin
    -- or a responsible reviewer may ask on the author's behalf from 7 days before expiry (or after it), or at
    -- once when the author's membership is no longer active. One renewal request may wait at a time.
    IF NEW.request_type = 'RENEWAL' THEN
        SELECT g.*, publication_expiration_date(g.published_version_id, pv.metadata) AS expires_on,
               d.status AS draft_status
          INTO renewal_row
          FROM governance_current_publication g
          JOIN published_version pv ON pv.id = g.published_version_id
          JOIN company_document d ON d.id = g.shared_draft_id
         WHERE g.shared_draft_id = NEW.document_id AND g.organization_id = NEW.organization_id
           AND g.published_version_id = NEW.target_published_version_id;
        IF NOT FOUND OR renewal_row.draft_status <> 'ACTIVE'
            OR submitter_org IS DISTINCT FROM NEW.organization_id
            OR renewal_row.submission_id IS NULL
            OR NOT EXISTS (SELECT 1 FROM review_submission released
                 WHERE released.id = renewal_row.submission_id
                   AND released.working_version_id IS NOT DISTINCT FROM NEW.working_version_id
                   AND released.content_hash IS NOT DISTINCT FROM NEW.content_hash
                   AND released.snapshot_version_no IS NOT DISTINCT FROM NEW.snapshot_version_no) THEN
            RAISE EXCEPTION 'A renewal request must name the current publication' USING ERRCODE = '23514';
        END IF;
        IF renewal_row.expires_on IS NULL THEN
            RAISE EXCEPTION 'This publication has no expiry to renew' USING ERRCODE = '23514';
        END IF;
        IF NEW.renewal_valid_until IS NOT NULL
           AND NEW.renewal_valid_until <= (now() AT TIME ZONE 'UTC')::date THEN
            RAISE EXCEPTION 'A renewal must end after today or have no expiry' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM review_submission other WHERE other.document_id = NEW.document_id
                     AND other.request_type = 'RENEWAL' AND other.status = 'PENDING_REVIEW'
                     AND other.id <> NEW.id) THEN
            RAISE EXCEPTION 'A renewal request is already waiting for review' USING ERRCODE = '23505';
        END IF;
        author_active := EXISTS (SELECT 1 FROM membership om
            JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
            WHERE om.id = renewal_row.submitted_by_membership_id AND om.status = 'ACTIVE');
        IF NEW.submitted_by_id = renewal_row.submitted_by_membership_id THEN
            IF NEW.on_behalf_of_author THEN
                RAISE EXCEPTION 'The author renews in their own name' USING ERRCODE = '23514';
            END IF;
        ELSIF NOT NEW.on_behalf_of_author
            OR NOT (governance_is_org_admin(NEW.submitted_by_id, NEW.organization_id)
                 OR governance_is_responsible_reviewer(NEW.submitted_by_id, NEW.organization_id,
                        renewal_row.responsible_department_id, renewal_row.reader_mode))
            OR NOT EXISTS (SELECT 1 FROM membership om
                 JOIN account ua ON ua.id = om.account_id AND ua.status = 'ACTIVE'
                 WHERE om.id = NEW.submitted_by_id AND om.status = 'ACTIVE')
            OR (author_active AND renewal_row.expires_on > (now() AT TIME ZONE 'UTC')::date + 7) THEN
            RAISE EXCEPTION 'Renewal on behalf of the author is not available' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.request_type <> 'CONTENT' THEN
        SELECT s.working_version_id AS shared_draft_version_id, s.content_hash, s.snapshot_version_no, d.author_id AS author_membership_id,
               d.organization_id, d.status
          INTO published_row
          FROM current_publication cp
          JOIN published_version pv ON pv.id = cp.published_version_id
          JOIN review_submission s ON s.id = pv.review_submission_id
          JOIN company_document d ON d.id = cp.document_id
         WHERE cp.document_id = NEW.document_id
           AND cp.published_version_id = NEW.target_published_version_id;
        IF NOT FOUND
            OR published_row.status <> 'ACTIVE'
            OR published_row.organization_id IS DISTINCT FROM NEW.organization_id
            OR published_row.organization_id IS DISTINCT FROM submitter_org
            OR published_row.author_membership_id IS DISTINCT FROM NEW.submitted_by_id
            OR published_row.shared_draft_version_id IS DISTINCT FROM NEW.working_version_id
            OR published_row.content_hash IS DISTINCT FROM NEW.content_hash
            OR published_row.snapshot_version_no IS DISTINCT FROM NEW.snapshot_version_no THEN
            RAISE EXCEPTION 'A change request must come from the author and name the current publication'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.working_version_id IS NOT NULL THEN
        SELECT d.id AS shared_draft_id, d.organization_id, d.author_id AS author_membership_id, d.status,
               d.owner_department_id AS responsible_department_id,
               d.title, d.classification, d.reader_policy_id AS draft_selection_id,
               d.current_version_no, v.version_no, v.file_uri AS content_uri, v.mime_type, v.content_hash
          INTO STRICT source_row
          FROM working_version v JOIN company_document d ON d.id = v.document_id
         WHERE v.id = NEW.working_version_id;
        IF source_row.status <> 'ACTIVE'
            OR source_row.shared_draft_id IS DISTINCT FROM NEW.document_id
            OR source_row.organization_id IS DISTINCT FROM submitter_org
            OR source_row.organization_id IS DISTINCT FROM NEW.organization_id
            OR source_row.author_membership_id IS DISTINCT FROM NEW.submitted_by_id
            OR source_row.current_version_no IS DISTINCT FROM source_row.version_no
            OR source_row.version_no IS DISTINCT FROM NEW.snapshot_version_no
            OR source_row.responsible_department_id IS DISTINCT FROM NEW.owner_department_id
            OR source_row.title IS DISTINCT FROM NEW.title
            OR source_row.classification IS DISTINCT FROM NEW.classification
            OR source_row.content_uri IS DISTINCT FROM NEW.file_uri
            OR source_row.mime_type IS DISTINCT FROM NEW.mime_type
            OR source_row.content_hash IS DISTINCT FROM NEW.content_hash
            OR source_row.draft_selection_id IS DISTINCT FROM NEW.proposed_reader_policy_id
            OR NEW.target_department_id IS DISTINCT FROM (CASE WHEN NEW.target_scope = 'DEPARTMENT'
                THEN source_row.responsible_department_id END) THEN
            RAISE EXCEPTION 'Submission must freeze the author-owned current shared draft snapshot'
                USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM reader_policy rs
             WHERE rs.id = NEW.proposed_reader_policy_id
               AND rs.organization_id = NEW.organization_id
               AND (rs.mode = 'ORGANIZATION') = (NEW.target_scope = 'ORGANIZATION')
        ) THEN
            RAISE EXCEPTION 'Review scope must match the proposed readers' USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM department d
            WHERE d.id = NEW.owner_department_id
              AND d.organization_id = NEW.organization_id AND d.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'Responsible department is not active' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT owner_membership.organization_id INTO STRICT source_org
          FROM private_version v
          JOIN private_document d ON d.id = v.document_id
          JOIN private_workspace w ON w.id = d.workspace_id
          JOIN membership owner_membership ON owner_membership.id = w.membership_id
         WHERE v.id = NEW.private_version_id;
        IF source_org <> submitter_org THEN
            RAISE EXCEPTION 'Submission cannot cross organization boundaries' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF NEW.target_department_id IS NOT NULL THEN
        SELECT organization_id INTO STRICT department_org FROM department WHERE id = NEW.target_department_id;
        IF department_org <> submitter_org THEN
            RAISE EXCEPTION 'Target department belongs to another organization' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.validate_submission_reader_selection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
BEGIN
    IF NEW.approved_reader_policy_id IS NOT NULL THEN
        RAISE EXCEPTION 'A submission cannot be created with approved readers' USING ERRCODE = '23514';
    END IF;
    IF NEW.request_type = 'CONTENT' AND NEW.document_id IS NOT NULL
       AND NEW.proposed_reader_policy_id IS DISTINCT FROM (
        SELECT d.reader_policy_id AS draft_selection_id FROM company_document d WHERE d.id = NEW.document_id) THEN
        RAISE EXCEPTION 'Submission must freeze the draft reader selection' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION arden.withdraw_publication_directly(p_document_id uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden', 'pg_temp'
AS $function$
DECLARE
    org uuid := NULLIF(current_setting('arden.organization_id', true), '')::uuid;
    actor uuid := governance_actor_membership(NULLIF(current_setting('arden.organization_id', true), '')::uuid);
    current_row governance_current_publication%ROWTYPE;
BEGIN
    IF NOT governance_is_org_admin(actor, org) THEN RETURN 'NOT_FOUND'; END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) NOT BETWEEN 1 AND 1000 THEN
        RAISE EXCEPTION 'Give a reason of 1 to 1000 characters' USING ERRCODE = '22023';
    END IF;
    -- Serialize against activation and approved publication changes (0021/0035).
    PERFORM 1 FROM company_document WHERE id = p_document_id AND organization_id = org FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    SELECT * INTO current_row FROM governance_current_publication g
     WHERE g.shared_draft_id = p_document_id AND g.organization_id = org;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF EXISTS (SELECT 1 FROM review_submission c WHERE c.document_id = p_document_id
                 AND c.status = 'APPROVED' AND c.publication_state = 'PREPARING') THEN
        RETURN 'PREPARING';
    END IF;
    IF current_row.submission_id IS NOT NULL THEN
        UPDATE review_submission
           SET publication_state = 'WITHDRAWN', withdrawn_by_role = 'ORGANIZATION_ADMIN',
               withdrawal_reason = btrim(p_reason), withdrawn_at = now()
         WHERE id = current_row.submission_id;
    END IF;
    DELETE FROM current_publication WHERE document_id = p_document_id;
    INSERT INTO audit_event (organization_id, actor_id, event_type, outcome, details)
    VALUES (org, actor, 'KNOWLEDGE_PUBLICATION_WITHDRAWN', 'SUCCESS',
        jsonb_build_object('documentId', p_document_id, 'publishedVersionId', current_row.published_version_id,
            'submissionId', current_row.submission_id, 'withdrawnBy', 'ORGANIZATION_ADMIN',
            'reason', btrim(p_reason)));
    RETURN 'WITHDRAWN';
END;
$function$;

CREATE OR REPLACE FUNCTION arden_system.console_report(p_actor uuid, p_kind text, p_organization uuid DEFAULT NULL::uuid, p_from timestamp with time zone DEFAULT (now() - '30 days'::interval), p_to timestamp with time zone DEFAULT now(), p_search text DEFAULT ''::text, p_status text DEFAULT ''::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'arden', 'arden_system', 'pg_temp'
AS $function$
DECLARE result jsonb; offset_rows integer; search_pattern text;
BEGIN
    IF p_actor IS NULL OR p_kind IS NULL OR p_page IS NULL OR p_page_size IS NULL
       OR p_actor IS DISTINCT FROM NULLIF(current_setting('arden.actor_id', true), '')::uuid
       OR current_setting('arden.system_auth_mode', true) IS DISTINCT FROM 'session'
       OR length(coalesce(p_search, '')) > 120
       OR coalesce(p_status, '') NOT IN ('', 'ACTIVE', 'SUSPENDED', 'ARCHIVED')
       OR p_from IS NULL OR p_to IS NULL OR p_from >= p_to OR p_to - p_from > interval '366 days'
       OR p_page NOT BETWEEN 1 AND 100000 OR p_page_size NOT BETWEEN 1 AND 50
       OR p_kind NOT IN ('OVERVIEW', 'ORGANIZATIONS', 'ORGANIZATION', 'KNOWLEDGE', 'AI_USAGE',
          'CONTRIBUTIONS', 'FEEDBACK', 'QUALITY', 'HEALTH', 'PRIVATE_FEEDBACK') THEN
        RAISE EXCEPTION 'Invalid System Console query' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM arden_system.administrator iso
                    WHERE iso.id = p_actor AND iso.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'System Console access is unavailable' USING ERRCODE = '42501';
    END IF;
    offset_rows := (p_page - 1) * p_page_size;
    -- Literal search: escape LIKE metacharacters before wrapping in wildcards.
    search_pattern := '%' || replace(replace(replace(coalesce(p_search, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';

    IF p_kind = 'OVERVIEW' THEN
        SELECT jsonb_build_object(
          'organizations', jsonb_build_object('total', count(*),
            'active', count(*) FILTER (WHERE status = 'ACTIVE'),
            'suspended', count(*) FILTER (WHERE status = 'SUSPENDED'),
            'archived', count(*) FILTER (WHERE status = 'ARCHIVED')),
          'knowledge', (SELECT jsonb_build_object('drafts', count(*) FILTER (WHERE sd.status = 'ACTIVE'),
              'archivedDrafts', count(*) FILTER (WHERE sd.status = 'ARCHIVED'))
              FROM company_document sd),
          'publications', (SELECT jsonb_build_object('current', count(*),
              'expired', count(*) FILTER (WHERE NULLIF(pv.metadata->>'expirationDate','')::date < (now() AT TIME ZONE 'UTC')::date))
              FROM current_publication cp JOIN published_version pv ON cp.published_version_id = pv.id),
          'contributions', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE s.status = 'PENDING_REVIEW'),
              'approved', count(*) FILTER (WHERE s.status = 'APPROVED'), 'rejected', count(*) FILTER (WHERE s.status = 'REJECTED'))
              FROM review_submission s WHERE s.submitted_at >= p_from AND s.submitted_at < p_to),
          'ai', (SELECT jsonb_build_object('calls', count(*), 'inputTokens', sum(input_tokens),
              'outputTokens', sum(output_tokens), 'estimatedCostMicroUsd', CASE WHEN count(*) = 0 THEN NULL
                WHEN bool_and(is_complete AND estimated_cost_micro_usd IS NOT NULL) THEN sum(estimated_cost_micro_usd) END,
              'usageComplete', coalesce(bool_and(is_complete AND estimated_cost_micro_usd IS NOT NULL), false))
              FROM ai_usage u WHERE u.occurred_at >= p_from AND u.occurred_at < p_to),
          'feedback', (SELECT jsonb_build_object('positive', count(*) FILTER (WHERE rating = 'POSITIVE'),
              'negative', count(*) FILTER (WHERE rating = 'NEGATIVE'))
              FROM answer_ratings r WHERE r.rated_at >= p_from AND r.rated_at < p_to))
          INTO result FROM organization;
        RETURN result;
    ELSIF p_kind = 'ORGANIZATIONS' THEN
        SELECT jsonb_build_object('page', p_page, 'pageSize', p_page_size,
          'total', (SELECT count(*) FROM organization o WHERE (p_search = '' OR o.name ILIKE search_pattern ESCAPE '\')
            AND (p_status = '' OR o.status = p_status)),
          'items', coalesce((SELECT jsonb_agg(item ORDER BY item->>'name', item->>'id') FROM (
              SELECT jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status,
                'createdAt', o.created_at, 'drafts', (SELECT count(*) FROM company_document sd WHERE sd.organization_id = o.id AND sd.status = 'ACTIVE'),
                'published', (SELECT count(*) FROM current_publication cp WHERE cp.organization_id = o.id),
                'openCases', (SELECT count(*) FROM maintenance_case mc WHERE mc.organization_id = o.id AND mc.reporter_status <> 'Resolved')) AS item
                FROM organization o WHERE (p_search = '' OR o.name ILIKE search_pattern ESCAPE '\')
                  AND (p_status = '' OR o.status = p_status)
                ORDER BY o.name, o.id OFFSET offset_rows LIMIT p_page_size
          ) page_rows), '[]'::jsonb)) INTO result;
        RETURN result;
    ELSIF p_kind = 'ORGANIZATION' THEN
        -- An unknown organization returns NULL so the API answers 404, not an empty report.
        SELECT jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status,
          'createdAt', o.created_at,
          'drafts', (SELECT count(*) FROM company_document sd WHERE sd.organization_id = o.id AND sd.status = 'ACTIVE'),
          'published', (SELECT count(*) FROM current_publication cp WHERE cp.organization_id = o.id),
          'contributions', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE s.status = 'PENDING_REVIEW'),
            'approved', count(*) FILTER (WHERE s.status = 'APPROVED'), 'rejected', count(*) FILTER (WHERE s.status = 'REJECTED'))
            FROM review_submission s JOIN membership om ON om.id = s.submitted_by_id
            WHERE om.organization_id = o.id AND s.submitted_at >= p_from AND s.submitted_at < p_to),
          'openCases', (SELECT count(*) FROM maintenance_case mc WHERE mc.organization_id = o.id AND mc.reporter_status <> 'Resolved'),
          'storageBytes', (SELECT CASE WHEN count(*) FILTER (WHERE bytes IS NULL) > 0 THEN NULL ELSE coalesce(sum(bytes),0) END
            FROM (SELECT content_uri, max(content_size_bytes) AS bytes FROM (
              SELECT dv.file_uri AS content_uri, dv.size_bytes AS content_size_bytes FROM private_version dv
                JOIN private_document dd ON dv.document_id = dd.id JOIN private_workspace pw ON dd.workspace_id = pw.id
                JOIN membership om ON pw.membership_id = om.id WHERE om.organization_id = o.id
              UNION ALL
              SELECT sv.file_uri AS content_uri, sv.size_bytes AS content_size_bytes FROM working_version sv
                JOIN company_document sd ON sv.document_id = sd.id WHERE sd.organization_id = o.id
            ) referenced GROUP BY content_uri) distinct_objects))
          INTO result FROM organization o WHERE o.id = p_organization;
        RETURN result;
    ELSIF p_kind = 'KNOWLEDGE' THEN
        SELECT jsonb_build_object('drafts', (SELECT jsonb_build_object('active',count(*) FILTER (WHERE status='ACTIVE'), 'archived',count(*) FILTER (WHERE status='ARCHIVED')) FROM company_document WHERE p_organization IS NULL OR organization_id=p_organization),
          'submissions', (SELECT jsonb_build_object('pendingReview',count(*) FILTER (WHERE s.status='PENDING_REVIEW'),'approved',count(*) FILTER (WHERE s.status='APPROVED'),'rejected',count(*) FILTER (WHERE s.status='REJECTED'))
            FROM review_submission s JOIN membership om ON om.id=s.submitted_by_id WHERE s.submitted_at>=p_from AND s.submitted_at<p_to AND (p_organization IS NULL OR om.organization_id=p_organization)),
          'publications', (SELECT jsonb_build_object('current',count(*),'expired',count(*) FILTER (WHERE NULLIF(pv.metadata->>'expirationDate','')::date < (now() AT TIME ZONE 'UTC')::date)) FROM current_publication cp JOIN published_version pv ON cp.published_version_id = pv.id WHERE p_organization IS NULL OR cp.organization_id=p_organization))
          INTO result;
        RETURN result;
    ELSIF p_kind = 'AI_USAGE' THEN
        SELECT jsonb_build_object('calls',count(*),'inputTokens',sum(input_tokens),'outputTokens',sum(output_tokens),
          'avgLatencyMs',round(avg(latency_ms)),'estimatedCostMicroUsd',CASE WHEN count(*) > 0
            AND bool_and(is_complete AND estimated_cost_micro_usd IS NOT NULL) THEN sum(estimated_cost_micro_usd) END,
          'usageComplete',coalesce(bool_and(is_complete AND estimated_cost_micro_usd IS NOT NULL),false),
          'citationRate', (SELECT round(CASE WHEN count(*)=0 THEN NULL
            ELSE count(*) FILTER (WHERE citation_count>0)::numeric * 100 / count(*) END, 2)
            FROM answer_result ar WHERE ar.created_at>=p_from AND ar.created_at<p_to
              AND (p_organization IS NULL OR ar.organization_id=p_organization)),
          'byOperation',coalesce((SELECT jsonb_agg(jsonb_build_object('operation',operation,'provider',provider,'model',model,'calls',calls,
            'inputTokens',input_tokens,'outputTokens',output_tokens,
            'estimatedCostMicroUsd',CASE WHEN complete THEN cost END,'usageComplete',complete) ORDER BY operation,provider,model)
            FROM (SELECT operation,provider,model,count(*) calls,sum(input_tokens) input_tokens,
              sum(output_tokens) output_tokens,sum(estimated_cost_micro_usd) cost,
              bool_and(is_complete AND estimated_cost_micro_usd IS NOT NULL) complete
              FROM ai_usage grouped_usage WHERE occurred_at>=p_from AND occurred_at<p_to
                AND (p_organization IS NULL OR organization_id=p_organization)
              GROUP BY operation,provider,model) grouped), '[]'::jsonb))
          INTO result FROM ai_usage u WHERE u.occurred_at>=p_from AND u.occurred_at<p_to
            AND (p_organization IS NULL OR u.organization_id=p_organization);
        RETURN result;
    ELSIF p_kind = 'CONTRIBUTIONS' THEN
        WITH grouped AS (
          SELECT om.organization_id AS org_id, dm.department_id,
            count(*) AS submitted, count(*) FILTER (WHERE s.status='APPROVED') AS approved,
            count(*) FILTER (WHERE s.status='REJECTED') AS rejected,
            count(*) FILTER (WHERE s.status='PENDING_REVIEW') AS pending
            FROM review_submission s JOIN membership om ON om.id=s.submitted_by_id
            LEFT JOIN department_membership dm ON dm.membership_id=om.id AND dm.is_primary AND dm.status='ACTIVE'
           WHERE s.submitted_at>=p_from AND s.submitted_at<p_to AND (p_organization IS NULL OR om.organization_id=p_organization)
           GROUP BY om.organization_id, dm.department_id),
        page_rows AS (
          SELECT * FROM grouped ORDER BY org_id, department_id NULLS LAST OFFSET offset_rows LIMIT p_page_size)
        SELECT jsonb_build_object('page', p_page, 'pageSize', p_page_size,
          'total', (SELECT count(*) FROM grouped),
          'items', coalesce((SELECT jsonb_agg(jsonb_build_object('organizationId',org_id,'departmentId',department_id,
            'submitted',submitted,'approved',approved,'rejected',rejected,'pending',pending)
            ORDER BY org_id, department_id NULLS LAST) FROM page_rows), '[]'::jsonb)) INTO result;
        RETURN result;
    ELSIF p_kind = 'FEEDBACK' THEN
        SELECT jsonb_build_object(
          'positive',(SELECT count(*) FROM answer_ratings r WHERE r.rating='POSITIVE' AND r.rated_at>=p_from AND r.rated_at<p_to AND (p_organization IS NULL OR r.organization_id=p_organization)),
          'negative',(SELECT count(*) FROM answer_ratings r WHERE r.rating='NEGATIVE' AND r.rated_at>=p_from AND r.rated_at<p_to AND (p_organization IS NULL OR r.organization_id=p_organization)),
          'openCases',(SELECT count(*) FROM maintenance_case mc WHERE mc.reporter_status <> 'Resolved' AND (p_organization IS NULL OR mc.organization_id=p_organization)),
          'caseAgeOver30Days',(SELECT count(*) FROM maintenance_case mc WHERE mc.reporter_status <> 'Resolved' AND mc.created_at < now()-interval '30 days' AND (p_organization IS NULL OR mc.organization_id=p_organization)))
          INTO result;
        RETURN result;
    ELSIF p_kind = 'QUALITY' THEN
        WITH signals AS (
          SELECT substr(md5(cp.organization_id::text || cp.document_id::text),1,16) AS document_ref,
            'OPEN_CASES' AS signal, count(*) AS signal_count, 'OPEN' AS signal_status
            FROM maintenance_case mc JOIN current_publication cp ON cp.document_id=mc.document_id AND cp.organization_id=mc.organization_id
           WHERE mc.reporter_status <> 'Resolved' AND (p_organization IS NULL OR mc.organization_id=p_organization)
           GROUP BY cp.organization_id,cp.document_id HAVING count(*)>=2
          UNION ALL
          SELECT substr(md5(cp.organization_id::text || cp.document_id::text),1,16), 'STALE_PUBLICATION', 1, 'REVIEW'
            FROM current_publication cp WHERE cp.updated_at < now()-interval '180 days' AND (p_organization IS NULL OR cp.organization_id=p_organization)
          UNION ALL
          SELECT substr(md5(cp.organization_id::text || cp.document_id::text),1,16), 'EXPIRED', 1, 'EXPIRED'
            FROM current_publication cp JOIN published_version pv ON cp.published_version_id = pv.id
           WHERE NULLIF(pv.metadata->>'expirationDate','')::date < (now() AT TIME ZONE 'UTC')::date AND (p_organization IS NULL OR cp.organization_id=p_organization)
          UNION ALL
          SELECT substr(md5(cp.organization_id::text || cp.document_id::text),1,16), 'EXACT_DUPLICATE', dupe.copies, 'REVIEW'
            FROM current_publication cp JOIN published_version pv ON cp.published_version_id = pv.id
            JOIN (SELECT cp2.organization_id,pv2.content_hash,count(*) copies FROM current_publication cp2 JOIN published_version pv2 ON cp2.published_version_id = pv2.id
              GROUP BY cp2.organization_id,pv2.content_hash HAVING count(*)>1) dupe ON dupe.organization_id=cp.organization_id AND dupe.content_hash=pv.content_hash
           WHERE p_organization IS NULL OR cp.organization_id=p_organization),
        page_rows AS (
          SELECT * FROM signals ORDER BY signal, document_ref OFFSET offset_rows LIMIT p_page_size)
        SELECT jsonb_build_object('page', p_page, 'pageSize', p_page_size,
          'total', (SELECT count(*) FROM signals),
          'items', coalesce((SELECT jsonb_agg(jsonb_build_object('documentRef',document_ref,'signal',signal,
            'count',signal_count,'status',signal_status) ORDER BY signal, document_ref) FROM page_rows), '[]'::jsonb))
          INTO result;
        RETURN result;
    ELSIF p_kind = 'PRIVATE_FEEDBACK' THEN
        -- Private Notes answer ratings: weekly totals for the last twelve UTC weeks only.
        WITH cutoff AS (SELECT date_trunc('week', now() AT TIME ZONE 'UTC') AS current_week),
        weeks AS (SELECT current_week + offset_week * interval '1 week' AS week_start
          FROM cutoff CROSS JOIN generate_series(-11, 0) AS offset_week),
        totals AS (
          SELECT to_char(week_start, 'YYYY-MM-DD') AS week_label,
            count(*) FILTER (WHERE feedback = 'GOOD') AS good,
            count(*) FILTER (WHERE feedback = 'BAD') AS bad, week_start
          FROM weeks LEFT JOIN private_ai_feedback
            ON rated_at >= week_start AT TIME ZONE 'UTC'
           AND rated_at < (week_start + interval '1 week') AT TIME ZONE 'UTC'
          GROUP BY week_start)
        SELECT jsonb_build_object('weeks', coalesce(jsonb_agg(jsonb_build_object(
          'weekStart', week_label, 'good', good, 'bad', bad) ORDER BY week_start DESC), '[]'::jsonb))
          INTO result FROM totals;
        RETURN result;
    ELSE
        SELECT jsonb_build_object('database',jsonb_build_object('status','ok'),
          'indexing',jsonb_build_object(
            'status',CASE WHEN count(*) FILTER (WHERE j.job_status='FAILED') > 0
                OR min(j.job_created_at) FILTER (WHERE j.job_status='PENDING') < now()-interval '5 minutes'
              THEN 'degraded' ELSE 'ok' END,
            'pending',count(*) FILTER (WHERE j.job_status='PENDING'),
            'running',count(*) FILTER (WHERE j.job_status='RUNNING'),
            'failed',count(*) FILTER (WHERE j.job_status='FAILED'),
            'oldestPendingSeconds',CASE WHEN min(j.job_created_at) FILTER (WHERE j.job_status='PENDING') IS NULL THEN NULL
              ELSE floor(extract(epoch FROM now()-min(j.job_created_at) FILTER (WHERE j.job_status='PENDING'))) END),
          'notifications', (SELECT jsonb_build_object(
            'status',CASE WHEN count(*) FILTER (WHERE status='FAILED') > 0
                OR min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')) < now()-interval '5 minutes'
              THEN 'degraded' ELSE 'ok' END,
            'pending',count(*) FILTER (WHERE status IN ('PENDING','LEASED')),
            'failed',count(*) FILTER (WHERE status='FAILED'),
            'oldestPendingSeconds',CASE WHEN min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')) IS NULL THEN NULL
              ELSE floor(extract(epoch FROM now()-min(created_at) FILTER (WHERE status IN ('PENDING','LEASED')))) END)
            FROM notification_outbox))
          INTO result FROM index_generation j WHERE j.job_id IS NOT NULL;
        RETURN result;
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION arden_system.protect_last_administrator()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'arden_system', 'pg_temp'
AS $function$
DECLARE
    removing_admin boolean := false;
    removing_manager boolean := false;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('arden:system-administrator-lifecycle', 0));
    IF TG_OP = 'DELETE' THEN
        removing_admin := OLD.status = 'ACTIVE';
        removing_manager := OLD.status = 'ACTIVE' AND OLD.can_manage_system_admins;
    ELSIF TG_OP = 'UPDATE' THEN
        removing_admin := OLD.status = 'ACTIVE' AND NEW.status <> 'ACTIVE';
        removing_manager := OLD.status = 'ACTIVE' AND OLD.can_manage_system_admins
            AND (NEW.status <> 'ACTIVE' OR NOT NEW.can_manage_system_admins);
    END IF;

    IF removing_manager AND NOT EXISTS (
        SELECT 1 FROM arden_system.administrator other
         WHERE other.status = 'ACTIVE'
           AND other.can_manage_system_admins
           AND other.id <> OLD.id
    ) THEN
        RAISE EXCEPTION 'The last System Admin manager cannot be removed'
            USING ERRCODE = '23514';
    END IF;

    IF removing_admin AND NOT EXISTS (
        SELECT 1 FROM arden_system.administrator other
         WHERE other.status = 'ACTIVE'
           AND other.id <> OLD.id
    ) THEN
        RAISE EXCEPTION 'The last active Arden System Admin cannot be removed'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$function$;
