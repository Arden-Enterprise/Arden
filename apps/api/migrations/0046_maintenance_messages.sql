SET search_path TO arden, public;

ALTER TABLE maintenance_case_event DROP CONSTRAINT maintenance_case_event_event_type_check;
ALTER TABLE maintenance_case_event ADD CONSTRAINT maintenance_case_event_event_type_check
    CHECK (event_type IN (
        'SUBMITTED', 'CLAIMED', 'REASSIGNED', 'RESOLVED', 'IMPORTED', 'MESSAGE'));
