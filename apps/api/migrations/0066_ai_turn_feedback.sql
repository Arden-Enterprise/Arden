SET search_path TO arden, public;

ALTER TABLE ai_conversation_turn ADD COLUMN feedback text
    CHECK (feedback IN ('GOOD', 'BAD'));

-- The existing owner policy checks active account, organization and membership.
-- The runtime can change only the rating on an owned turn.
GRANT UPDATE (feedback) ON ai_conversation_turn TO arden_runtime;
