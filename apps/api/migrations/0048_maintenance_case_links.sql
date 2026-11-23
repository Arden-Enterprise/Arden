SET search_path TO arden, public;

CREATE TABLE maintenance_case_link (
    organization_id uuid NOT NULL,
    left_case_id uuid NOT NULL,
    right_case_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, left_case_id, right_case_id),
    CONSTRAINT ck_maintenance_case_link_order CHECK (left_case_id::text < right_case_id::text),
    CONSTRAINT fk_maintenance_case_link_left FOREIGN KEY (left_case_id, organization_id)
        REFERENCES maintenance_case (case_id, organization_id),
    CONSTRAINT fk_maintenance_case_link_right FOREIGN KEY (right_case_id, organization_id)
        REFERENCES maintenance_case (case_id, organization_id)
);

ALTER TABLE maintenance_case_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_case_link FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON maintenance_case_link TO arden_runtime;
CREATE POLICY maintenance_case_link_tenant ON maintenance_case_link
    FOR ALL TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND maintenance_actor_membership(organization_id) IS NOT NULL)
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND maintenance_actor_membership(organization_id) IS NOT NULL);
