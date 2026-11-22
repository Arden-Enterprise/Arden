SET search_path TO arden, public;

ALTER TABLE published_knowledge_version
    ADD COLUMN author_membership_id uuid,
    ADD COLUMN team_tag text,
    ADD COLUMN project_tag text;

ALTER TABLE published_knowledge_version
    ADD CONSTRAINT fk_published_version_author
        FOREIGN KEY (author_membership_id) REFERENCES organization_membership (membership_id),
    ADD CONSTRAINT ck_published_version_tags CHECK (
        (team_tag IS NULL OR length(btrim(team_tag)) BETWEEN 1 AND 100)
        AND (project_tag IS NULL OR length(btrim(project_tag)) BETWEEN 1 AND 100));

UPDATE published_knowledge_version pv
   SET author_membership_id = s.submitted_by_membership_id,
       team_tag = s.team_tag,
       project_tag = s.project_tag
  FROM shared_submission s
 WHERE s.submission_id = pv.submission_id
   AND pv.author_membership_id IS NULL;

CREATE FUNCTION copy_published_version_anchor()
RETURNS trigger LANGUAGE plpgsql SET search_path = arden, public AS $$
BEGIN
    SELECT s.submitted_by_membership_id, s.team_tag, s.project_tag
      INTO NEW.author_membership_id, NEW.team_tag, NEW.project_tag
      FROM shared_submission s
     WHERE s.submission_id = NEW.submission_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_published_version_anchor
    BEFORE INSERT ON published_knowledge_version
    FOR EACH ROW EXECUTE FUNCTION copy_published_version_anchor();
