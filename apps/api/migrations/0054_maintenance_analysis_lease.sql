SET search_path TO arden, public;

ALTER TABLE maintenance_analysis_run
    ADD COLUMN attempt integer NOT NULL DEFAULT 1,
    ADD COLUMN fence uuid,
    ADD COLUMN lease_until timestamptz,
    ADD COLUMN version_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN started_by_membership_id uuid;
