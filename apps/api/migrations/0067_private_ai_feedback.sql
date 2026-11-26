SET search_path TO arden, public;

-- The random vote key deduplicates revisions of a rating. It has no
-- relationship to any account, organization, note, conversation or prompt.
CREATE TABLE private_ai_feedback (
    vote_key uuid PRIMARY KEY,
    feedback text CHECK (feedback IN ('GOOD', 'BAD')),
    rated_at timestamptz,
    CHECK ((feedback IS NULL) = (rated_at IS NULL))
);

CREATE INDEX private_ai_feedback_rated_at_idx ON private_ai_feedback (rated_at)
    WHERE rated_at IS NOT NULL;

ALTER TABLE private_ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_ai_feedback FORCE ROW LEVEL SECURITY;
CREATE POLICY private_ai_feedback_capability ON private_ai_feedback FOR ALL TO arden_runtime
    USING (vote_key = NULLIF(current_setting('arden.private_feedback_key', true), '')::uuid)
    WITH CHECK (vote_key = NULLIF(current_setting('arden.private_feedback_key', true), '')::uuid);
CREATE POLICY private_ai_feedback_system_analytics ON private_ai_feedback FOR SELECT TO arden_runtime
    USING (current_setting('arden.instance_admin', true) = 'true');

GRANT SELECT, INSERT ON private_ai_feedback TO arden_runtime;
GRANT UPDATE (feedback, rated_at) ON private_ai_feedback TO arden_runtime;
