SET search_path TO arden, public;

ALTER TABLE maintenance_case DROP CONSTRAINT maintenance_case_outcome_check;
ALTER TABLE maintenance_case ADD CONSTRAINT maintenance_case_outcome_check
    CHECK (outcome IS NULL OR outcome IN ('NO_CHANGE_NEEDED', 'UPDATED', 'WITHDRAWN'));
