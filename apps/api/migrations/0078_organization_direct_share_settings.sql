SET search_path TO arden, public;

-- The admin transaction reads organization before writing the legacy table.
-- Take the locks in the same order until the backfill and mirror are installed.
LOCK TABLE organization IN ACCESS EXCLUSIVE MODE;
LOCK TABLE organization_direct_share_setting IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE organization
    ADD COLUMN direct_share_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN direct_share_recipient_limit integer NOT NULL DEFAULT 10,
    ADD COLUMN direct_share_updated_by_membership_id uuid,
    ADD COLUMN direct_share_updated_at timestamptz,
    ADD CONSTRAINT ck_organization_direct_share_limit CHECK (direct_share_recipient_limit BETWEEN 1 AND 100),
    ADD CONSTRAINT ck_organization_direct_share_attribution CHECK (
        (direct_share_updated_by_membership_id IS NULL) = (direct_share_updated_at IS NULL)),
    ADD CONSTRAINT fk_organization_direct_share_editor
        FOREIGN KEY (direct_share_updated_by_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT;

-- A historical backfill is not an organization edit. Leave the other triggers
-- and all RLS policies in effect.
ALTER TABLE organization DISABLE TRIGGER trg_organization_updated_at;
UPDATE organization org
   SET direct_share_enabled = setting.enabled,
       direct_share_recipient_limit = setting.recipient_limit,
       direct_share_updated_by_membership_id = setting.updated_by_membership_id,
       direct_share_updated_at = setting.updated_at
  FROM organization_direct_share_setting setting
 WHERE org.organization_id = setting.organization_id;
ALTER TABLE organization ENABLE TRIGGER trg_organization_updated_at;

-- Trigger-only bridge. Existing settings-table RLS still authorizes writes.
-- This function grants no direct organization UPDATE policy to the runtime.
CREATE FUNCTION mirror_organization_direct_share_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        UPDATE arden.organization
           SET direct_share_enabled = true, direct_share_recipient_limit = 10,
               direct_share_updated_by_membership_id = NULL, direct_share_updated_at = NULL
         WHERE organization_id = OLD.organization_id;
    ELSE
        UPDATE arden.organization
           SET direct_share_enabled = NEW.enabled, direct_share_recipient_limit = NEW.recipient_limit,
               direct_share_updated_by_membership_id = NEW.updated_by_membership_id,
               direct_share_updated_at = NEW.updated_at
         WHERE organization_id = NEW.organization_id;
    END IF;
    RETURN NULL;
END;
$$;
ALTER FUNCTION mirror_organization_direct_share_settings() OWNER TO postgres;
REVOKE ALL ON FUNCTION mirror_organization_direct_share_settings() FROM PUBLIC, arden_runtime;

CREATE TRIGGER trg_mirror_organization_direct_share_settings
AFTER INSERT OR UPDATE OR DELETE ON organization_direct_share_setting
FOR EACH ROW EXECUTE FUNCTION mirror_organization_direct_share_settings();

CREATE OR REPLACE FUNCTION direct_sharing_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = arden, pg_temp AS $$
    SELECT COALESCE((SELECT org.direct_share_enabled FROM organization org
        WHERE org.organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid), false)
$$;
