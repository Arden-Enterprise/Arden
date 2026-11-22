SET search_path TO arden, public;

CREATE TABLE maintenance_analysis_run (
    run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    case_id uuid NOT NULL,
    state text NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    findings jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_maintenance_analysis_case FOREIGN KEY (case_id, organization_id)
        REFERENCES maintenance_case (case_id, organization_id)
);

CREATE UNIQUE INDEX uq_maintenance_analysis_active ON maintenance_analysis_run (case_id)
    WHERE state IN ('queued', 'running');

ALTER TABLE maintenance_analysis_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_analysis_run FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON maintenance_analysis_run TO arden_runtime;
CREATE POLICY maintenance_analysis_assignee ON maintenance_analysis_run
    FOR ALL TO arden_runtime
    USING (EXISTS (
        SELECT 1 FROM maintenance_case c
         WHERE c.case_id = maintenance_analysis_run.case_id
           AND c.organization_id = maintenance_analysis_run.organization_id
           AND c.assignee_membership_id = maintenance_actor_membership(c.organization_id)))
    WITH CHECK (EXISTS (
        SELECT 1 FROM maintenance_case c
         WHERE c.case_id = maintenance_analysis_run.case_id
           AND c.organization_id = maintenance_analysis_run.organization_id
           AND c.assignee_membership_id = maintenance_actor_membership(c.organization_id)));
