SET search_path TO arden, public;

LOCK TABLE organization IN ACCESS EXCLUSIVE MODE;
LOCK TABLE organization_direct_share_setting IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM organization AS org
        LEFT JOIN organization_direct_share_setting AS old ON old.organization_id = org.organization_id
        WHERE (org.direct_share_enabled, org.direct_share_recipient_limit,
               org.direct_share_updated_by_membership_id, org.direct_share_updated_at)
              IS DISTINCT FROM (COALESCE(old.enabled, true), COALESCE(old.recipient_limit, 10),
                                old.updated_by_membership_id, old.updated_at)
    ) THEN
        RAISE EXCEPTION 'Direct Share storage differs from the source settings; cutover aborted';
    END IF;
END;
$$;

CREATE FUNCTION update_organization_direct_share_settings(
    p_organization_id uuid, p_enabled boolean, p_recipient_limit integer, p_request_id text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
DECLARE
    editor_id uuid := governance_actor_membership(p_organization_id);
BEGIN
    IF NOT governance_is_org_admin(editor_id, p_organization_id) THEN
        RETURN false;
    END IF;

    UPDATE organization
       SET direct_share_enabled = p_enabled,
           direct_share_recipient_limit = p_recipient_limit,
           direct_share_updated_by_membership_id = editor_id,
           direct_share_updated_at = now()
     WHERE organization_id = p_organization_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    INSERT INTO audit_event (organization_id, actor_membership_id, event_type, outcome, details_json)
    VALUES (p_organization_id, editor_id, 'DIRECT_SHARE_SETTINGS_UPDATED', 'SUCCESS',
            jsonb_build_object('enabled', p_enabled, 'recipientLimit', p_recipient_limit,
                               'requestId', p_request_id));
    RETURN true;
END;
$$;
ALTER FUNCTION update_organization_direct_share_settings(uuid, boolean, integer, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION update_organization_direct_share_settings(uuid, boolean, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_organization_direct_share_settings(uuid, boolean, integer, text) TO arden_runtime;

DROP TABLE organization_direct_share_setting;
DROP FUNCTION mirror_organization_direct_share_settings();
