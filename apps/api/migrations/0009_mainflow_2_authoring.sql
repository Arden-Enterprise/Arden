SET search_path TO arden, public;

-- A new shared document has no private provenance. A contributed copy keeps
-- exactly one source; the private source remains owner-only.
ALTER TABLE shared_draft DROP CONSTRAINT ck_shared_draft_one_source;
ALTER TABLE shared_draft ADD CONSTRAINT ck_shared_draft_one_source
    CHECK (num_nonnulls(source_private_version_id, source_published_version_id) <= 1);

ALTER TABLE shared_draft ADD COLUMN responsible_department_id uuid;
ALTER TABLE shared_draft ADD COLUMN target_scope_type text;
ALTER TABLE shared_draft ADD COLUMN team_tag text;
ALTER TABLE shared_draft ADD COLUMN project_tag text;
ALTER TABLE shared_draft ADD CONSTRAINT fk_shared_draft_responsible_department
    FOREIGN KEY (responsible_department_id, organization_id)
    REFERENCES department(department_id, organization_id) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE shared_draft ADD CONSTRAINT ck_shared_draft_scope
    CHECK (target_scope_type IS NULL OR target_scope_type IN ('ORGANIZATION', 'DEPARTMENT'));
ALTER TABLE shared_draft ADD CONSTRAINT ck_shared_draft_tags
    CHECK ((team_tag IS NULL OR (length(btrim(team_tag)) BETWEEN 1 AND 100))
       AND (project_tag IS NULL OR (length(btrim(project_tag)) BETWEEN 1 AND 100)));

CREATE OR REPLACE FUNCTION validate_shared_draft_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE source_org uuid; source_owner uuid;
BEGIN
    IF NEW.source_private_version_id IS NOT NULL THEN
        SELECT om.organization_id, om.membership_id INTO source_org, source_owner
          FROM draft_version v
          JOIN draft_document d ON d.draft_id = v.draft_id
          JOIN private_workspace w ON w.workspace_id = d.workspace_id
          JOIN organization_membership om ON om.membership_id = w.membership_id
         WHERE v.draft_version_id = NEW.source_private_version_id;
        IF source_org IS DISTINCT FROM NEW.organization_id OR source_owner IS DISTINCT FROM NEW.author_membership_id THEN
            RAISE EXCEPTION 'Shared draft private source must belong to its author and organization' USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.source_published_version_id IS NOT NULL THEN
        SELECT kb.organization_id INTO source_org
          FROM published_knowledge_version pv
          JOIN knowledge_base kb ON kb.knowledge_base_id = pv.knowledge_base_id
         WHERE pv.published_version_id = NEW.source_published_version_id;
        IF source_org IS DISTINCT FROM NEW.organization_id THEN
            RAISE EXCEPTION 'Shared draft published source must belong to its organization' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

GRANT UPDATE (title, classification, responsible_department_id, target_scope_type,
              team_tag, project_tag) ON shared_draft TO arden_runtime;
GRANT SELECT, INSERT, DELETE ON shared_draft_audience TO arden_runtime;

DROP POLICY shared_draft_author_read ON shared_draft;
CREATE POLICY shared_draft_author_read ON shared_draft FOR SELECT TO arden_runtime
    USING (source_published_version_id IS NULL
       AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
           SELECT 1 FROM organization_membership om
           JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
           JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
           WHERE om.membership_id = shared_draft.author_membership_id
             AND om.organization_id = shared_draft.organization_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));

DROP POLICY shared_draft_author_insert ON shared_draft;
CREATE POLICY shared_draft_author_insert ON shared_draft FOR INSERT TO arden_runtime
    WITH CHECK (source_published_version_id IS NULL
       AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (
           SELECT 1 FROM organization_membership om
           JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
           JOIN organization o ON o.organization_id = om.organization_id AND o.status = 'ACTIVE'
           WHERE om.membership_id = shared_draft.author_membership_id
             AND om.organization_id = shared_draft.organization_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));

DROP POLICY shared_draft_author_update ON shared_draft;
CREATE POLICY shared_draft_author_update ON shared_draft FOR UPDATE TO arden_runtime
    USING (status = 'ACTIVE' AND source_published_version_id IS NULL
       AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM organization_membership om
           JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
           WHERE om.membership_id = shared_draft.author_membership_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'))
    WITH CHECK (status = 'ACTIVE' AND source_published_version_id IS NULL
       AND organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND EXISTS (SELECT 1 FROM organization_membership om
           JOIN user_account ua ON ua.user_id = om.user_id AND ua.status = 'ACTIVE'
           WHERE om.membership_id = shared_draft.author_membership_id
             AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
             AND om.status = 'ACTIVE'));

DROP POLICY shared_draft_version_author_insert ON shared_draft_version;
CREATE POLICY shared_draft_version_author_insert ON shared_draft_version FOR INSERT TO arden_runtime
    WITH CHECK (EXISTS (
        SELECT 1 FROM shared_draft d WHERE d.shared_draft_id = shared_draft_version.shared_draft_id
          AND d.status = 'ACTIVE' AND d.current_version_no = shared_draft_version.version_no - 1
          AND shared_draft_version.version_no > 0));

CREATE POLICY shared_draft_audience_author_read ON shared_draft_audience FOR SELECT TO arden_runtime
    USING (EXISTS (SELECT 1 FROM shared_draft d WHERE d.shared_draft_id = shared_draft_audience.shared_draft_id
        AND d.organization_id = shared_draft_audience.organization_id));
CREATE POLICY shared_draft_audience_author_insert ON shared_draft_audience FOR INSERT TO arden_runtime
    WITH CHECK (EXISTS (SELECT 1 FROM shared_draft d WHERE d.shared_draft_id = shared_draft_audience.shared_draft_id
        AND d.organization_id = shared_draft_audience.organization_id AND d.status = 'ACTIVE'));
CREATE POLICY shared_draft_audience_author_delete ON shared_draft_audience FOR DELETE TO arden_runtime
    USING (EXISTS (SELECT 1 FROM shared_draft d WHERE d.shared_draft_id = shared_draft_audience.shared_draft_id
        AND d.organization_id = shared_draft_audience.organization_id AND d.status = 'ACTIVE'));
