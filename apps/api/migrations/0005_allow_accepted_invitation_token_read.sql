SET search_path TO arden, public;

-- When accepting an organization invitation under arden_runtime, the row is
-- updated from status 'PENDING' to 'ACCEPTED'. In PostgreSQL, UPDATE on a table
-- with Row Level Security requires the modified row to satisfy SELECT policies.
-- Because invitation_token_read only matched status 'PENDING', updating the row
-- to 'ACCEPTED' failed RLS with a 'new row violates row-level security policy' error.
-- Allow reading an invitation that was accepted by the current actor.
DROP POLICY IF EXISTS invitation_token_read ON organization_invitation;
CREATE POLICY invitation_token_read ON organization_invitation FOR SELECT TO arden_runtime
    USING (
        (token_hash = current_setting('arden.invitation_token_hash', true)
         AND status = 'PENDING' AND expires_at > now())
        OR
        (token_hash = current_setting('arden.invitation_token_hash', true)
         AND status = 'ACCEPTED'
         AND accepted_by_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid)
    );
