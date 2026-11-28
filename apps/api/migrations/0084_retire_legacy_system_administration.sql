SET search_path TO arden, public;

LOCK TABLE system_administrator, system_administration_event IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM system_administrator) OR EXISTS (SELECT 1 FROM system_administration_event) THEN
        RAISE EXCEPTION 'Preserve historical System Admin identities and events before retirement' USING ERRCODE = '55000';
    END IF;
END;
$$;

DROP TRIGGER trg_guard_system_admin_membership ON organization_membership;
DROP TRIGGER trg_protect_last_system_admin_account ON user_account;
DROP TRIGGER trg_protect_last_system_administrator ON system_administrator;
DROP FUNCTION guard_system_admin_membership();
DROP FUNCTION protect_last_system_administrator();
DROP FUNCTION system_admin_lifecycle_counts(uuid);
DROP POLICY organization_membership_instance_admin_target_read ON organization_membership;
DROP POLICY user_account_instance_admin_target_read ON user_account;
DROP TABLE system_administration_event;
DROP TABLE system_administrator;
