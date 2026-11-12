SET search_path TO arden, public;

-- Flow 2 T5.1 (BM04 RF-03, FR-DOC-06): the author withdraws their own pending submission.
-- PENDING_REVIEW -> WITHDRAWN is the only withdrawal transition, and WITHDRAWN is terminal. A withdrawn
-- submission leaves every review queue (they list PENDING_REVIEW only) and frees the document's single
-- open release candidate (uq_flow3_open_release_candidate), so the author can submit again.

CREATE FUNCTION protect_submission_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND (OLD.status = 'WITHDRAWN' OR (NEW.status = 'WITHDRAWN' AND OLD.status <> 'PENDING_REVIEW')) THEN
        RAISE EXCEPTION 'Only a pending submission can be withdrawn, and a withdrawal is final'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION protect_submission_withdrawal() FROM PUBLIC;
CREATE TRIGGER trg_protect_submission_withdrawal BEFORE UPDATE OF status ON shared_submission
FOR EACH ROW EXECUTE FUNCTION protect_submission_withdrawal();

-- Only the submitting author, as an active member, and only to WITHDRAWN. The reviewer update policy
-- cannot reach WITHDRAWN (its check allows APPROVED/REJECTED only), and this policy cannot reach a decision.
CREATE POLICY flow2_submission_author_withdraw ON shared_submission FOR UPDATE TO arden_runtime
USING (shared_draft_version_id IS NOT NULL AND status = 'PENDING_REVIEW'
   AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership om
        WHERE om.membership_id = shared_submission.submitted_by_membership_id
          AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.status = 'ACTIVE'))
WITH CHECK (shared_draft_version_id IS NOT NULL AND status = 'WITHDRAWN'
   AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
   AND EXISTS (SELECT 1 FROM organization_membership om
        WHERE om.membership_id = shared_submission.submitted_by_membership_id
          AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.status = 'ACTIVE'));
