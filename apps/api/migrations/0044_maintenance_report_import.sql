SET search_path TO arden, public;

-- Flow 4 cutover. One governance report maps to one maintenance case.
-- Closed reports stay in publication_report. Imported cases do not emit a new submission alert.

ALTER TABLE maintenance_case_event DROP CONSTRAINT maintenance_case_event_event_type_check;
ALTER TABLE maintenance_case_event ADD CONSTRAINT maintenance_case_event_event_type_check
    CHECK (event_type IN ('SUBMITTED', 'CLAIMED', 'REASSIGNED', 'RESOLVED', 'IMPORTED'));

CREATE TABLE maintenance_report_import (
    organization_id uuid NOT NULL,
    report_id uuid NOT NULL,
    case_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, report_id),
    CONSTRAINT uq_maintenance_report_import_case UNIQUE (organization_id, case_id),
    CONSTRAINT fk_maintenance_report_import_case FOREIGN KEY (case_id, organization_id)
        REFERENCES maintenance_case (case_id, organization_id),
    CONSTRAINT fk_maintenance_report_import_report FOREIGN KEY (report_id)
        REFERENCES publication_report (report_id)
);

DROP POLICY maintenance_case_insert ON maintenance_case;
CREATE POLICY maintenance_case_insert ON maintenance_case FOR INSERT TO arden_runtime
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
        AND maintenance_actor_membership(organization_id) IS NOT NULL
        AND (
            (origin = 'READER_REPORT' AND (
                reporter_membership_id = maintenance_actor_membership(organization_id)
                OR maintenance_actor_is_admin(organization_id)))
            OR (origin = 'REVIEWER_INTAKE'
                AND maintenance_actor_membership(organization_id) IS DISTINCT FROM author_membership_id
                AND actor_has_reviewer_grant(organization_id, route_department_id, classification, team_tag, project_tag))));

ALTER TABLE maintenance_report_import ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON maintenance_report_import TO arden_runtime;
CREATE POLICY maintenance_report_import_tenant ON maintenance_report_import
    FOR ALL TO arden_runtime
    USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid);
