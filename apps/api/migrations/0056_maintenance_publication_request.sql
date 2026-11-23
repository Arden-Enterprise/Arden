SET search_path TO arden, public;

ALTER TABLE maintenance_case
    ADD COLUMN publication_link_submission_id uuid;

ALTER TABLE maintenance_case
    ADD CONSTRAINT fk_maintenance_case_publication_submission
        FOREIGN KEY (publication_link_submission_id)
        REFERENCES shared_submission (submission_id);

ALTER TABLE maintenance_case DROP CONSTRAINT ck_maintenance_case_publication_link;

ALTER TABLE maintenance_case
    ADD CONSTRAINT ck_maintenance_case_publication_link CHECK (
        (publication_link_version_id IS NULL
            AND publication_link_submission_id IS NULL
            AND publication_link_reason IS NULL)
        OR (publication_link_reason IS NOT NULL
            AND length(btrim(publication_link_reason)) BETWEEN 1 AND 2000
            AND ((publication_link_version_id IS NOT NULL AND publication_link_submission_id IS NULL)
                OR (publication_link_version_id IS NULL AND publication_link_submission_id IS NOT NULL))));
