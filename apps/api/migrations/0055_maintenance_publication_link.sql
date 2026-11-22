SET search_path TO arden, public;

ALTER TABLE maintenance_case
    ADD COLUMN publication_link_version_id uuid,
    ADD COLUMN publication_link_reason text;

ALTER TABLE maintenance_case
    ADD CONSTRAINT fk_maintenance_case_publication_link
        FOREIGN KEY (publication_link_version_id)
        REFERENCES published_knowledge_version (published_version_id);

ALTER TABLE maintenance_case
    ADD CONSTRAINT ck_maintenance_case_publication_link CHECK (
        (publication_link_version_id IS NULL AND publication_link_reason IS NULL)
        OR (publication_link_version_id IS NOT NULL
            AND publication_link_reason IS NOT NULL
            AND length(btrim(publication_link_reason)) BETWEEN 1 AND 2000));
