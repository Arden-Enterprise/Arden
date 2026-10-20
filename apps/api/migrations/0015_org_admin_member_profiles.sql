SET search_path TO arden, public;

-- The administration directory and reviewer-grant target check join membership
-- to user_account. Keep self-read intact, but let a verified Org Admin read only
-- profiles that have a membership in the transaction's organization.
CREATE POLICY user_account_org_admin_member_read ON user_account FOR SELECT TO arden_runtime
    USING (current_setting('arden.org_admin', true) = 'true'
       AND EXISTS (
           SELECT 1 FROM organization_membership om
            WHERE om.user_id = user_account.user_id
              AND om.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       ));
