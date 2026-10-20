SET search_path TO arden, public;

-- Phase 1 of decision 0010 is additive. Legacy role rows remain a bounded
-- compatibility projection for pre-0017 RLS and immutable snapshot storage.

CREATE TABLE system_administrator (
    user_id                    uuid PRIMARY KEY,
    status                     text NOT NULL DEFAULT 'ACTIVE',
    granted_by_user_id         uuid,
    granted_at                 timestamptz NOT NULL DEFAULT now(),
    revoked_by_user_id         uuid,
    revoked_at                 timestamptz,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_system_administrator_user
        FOREIGN KEY (user_id) REFERENCES user_account(user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_system_administrator_granter
        FOREIGN KEY (granted_by_user_id) REFERENCES user_account(user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_system_administrator_revoker
        FOREIGN KEY (revoked_by_user_id) REFERENCES user_account(user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_system_administrator_status
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT ck_system_administrator_revocation
        CHECK ((status = 'ACTIVE' AND revoked_by_user_id IS NULL AND revoked_at IS NULL)
            OR (status = 'REVOKED' AND revoked_by_user_id IS NOT NULL AND revoked_at IS NOT NULL))
);

CREATE FUNCTION protect_last_system_administrator()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF OLD.status = 'ACTIVE' THEN
        IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW.status <> 'ACTIVE'))
           AND NOT EXISTS (
               SELECT 1 FROM system_administrator other
                WHERE other.status = 'ACTIVE' AND other.user_id <> OLD.user_id
           ) THEN
            RAISE EXCEPTION 'The last active Arden System Admin cannot be removed'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION protect_last_system_administrator() FROM PUBLIC;
CREATE TRIGGER trg_protect_last_system_administrator
BEFORE UPDATE OF status OR DELETE ON system_administrator
FOR EACH ROW EXECUTE FUNCTION protect_last_system_administrator();

CREATE TABLE system_administration_event (
    system_administration_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id                   uuid NOT NULL,
    event_type                      text NOT NULL,
    target_user_id                  uuid,
    request_id                      text NOT NULL,
    details_json                    jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at                     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_system_administration_event_actor
        FOREIGN KEY (actor_user_id) REFERENCES user_account(user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_system_administration_event_target
        FOREIGN KEY (target_user_id) REFERENCES user_account(user_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_system_administration_event_details
        CHECK (jsonb_typeof(details_json) = 'object')
);

CREATE TABLE audience (
    audience_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id            uuid NOT NULL,
    kind                        text NOT NULL,
    department_id               uuid,
    name                        text NOT NULL,
    description                 text NOT NULL DEFAULT '',
    status                      text NOT NULL DEFAULT 'ACTIVE',
    is_managed                  boolean NOT NULL,
    configuration_version       integer NOT NULL DEFAULT 1,
    created_by_membership_id    uuid,
    legacy_role_id              uuid,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_audience_organization
        FOREIGN KEY (organization_id) REFERENCES organization(organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audience_department
        FOREIGN KEY (department_id, organization_id)
        REFERENCES department(department_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audience_creator
        FOREIGN KEY (created_by_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audience_legacy_role
        FOREIGN KEY (legacy_role_id) REFERENCES role(role_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT uq_audience_id_org UNIQUE (audience_id, organization_id),
    CONSTRAINT uq_audience_legacy_role UNIQUE (legacy_role_id),
    CONSTRAINT ck_audience_kind
        CHECK (kind IN ('ORGANIZATION_ALL', 'DEPARTMENT_ALL', 'GROUP')),
    CONSTRAINT ck_audience_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_audience_version CHECK (configuration_version > 0),
    CONSTRAINT ck_audience_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT ck_audience_description CHECK (length(description) <= 300),
    CONSTRAINT ck_audience_shape CHECK (
        (kind = 'ORGANIZATION_ALL' AND department_id IS NULL AND is_managed)
        OR (kind = 'DEPARTMENT_ALL' AND department_id IS NOT NULL AND is_managed)
        OR (kind = 'GROUP' AND department_id IS NULL AND NOT is_managed)
    )
);

CREATE UNIQUE INDEX uq_audience_org_all
    ON audience(organization_id) WHERE kind = 'ORGANIZATION_ALL';
CREATE UNIQUE INDEX uq_audience_department_all
    ON audience(organization_id, department_id) WHERE kind = 'DEPARTMENT_ALL';
CREATE UNIQUE INDEX uq_audience_group_name
    ON audience(organization_id, lower(btrim(name)))
    WHERE kind = 'GROUP' AND status = 'ACTIVE';

CREATE TABLE audience_group_membership (
    audience_group_membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audience_id                  uuid NOT NULL,
    organization_id              uuid NOT NULL,
    membership_id                uuid NOT NULL,
    status                       text NOT NULL DEFAULT 'ACTIVE',
    valid_from                   timestamptz NOT NULL DEFAULT now(),
    valid_until                  timestamptz,
    assigned_by_membership_id    uuid,
    assigned_at                  timestamptz NOT NULL DEFAULT now(),
    revoked_at                   timestamptz,

    CONSTRAINT fk_audience_group_membership_audience
        FOREIGN KEY (audience_id, organization_id)
        REFERENCES audience(audience_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audience_group_membership_member
        FOREIGN KEY (membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT fk_audience_group_membership_assigner
        FOREIGN KEY (assigned_by_membership_id, organization_id)
        REFERENCES organization_membership(membership_id, organization_id)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_audience_group_membership_status
        CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
    CONSTRAINT ck_audience_group_membership_validity
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT ck_audience_group_membership_revocation
        CHECK ((status = 'REVOKED' AND revoked_at IS NOT NULL)
            OR (status <> 'REVOKED' AND revoked_at IS NULL))
);

CREATE UNIQUE INDEX uq_audience_group_membership_active
    ON audience_group_membership(audience_id, membership_id)
    WHERE status = 'ACTIVE';

CREATE FUNCTION validate_audience_group_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = arden, pg_temp AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM audience a
         WHERE a.audience_id = NEW.audience_id
           AND a.organization_id = NEW.organization_id
           AND a.kind = 'GROUP' AND a.status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'Audience group membership requires an active group audience'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION validate_audience_group_membership() FROM PUBLIC;
CREATE TRIGGER trg_validate_audience_group_membership
BEFORE INSERT OR UPDATE OF audience_id, organization_id ON audience_group_membership
FOR EACH ROW EXECUTE FUNCTION validate_audience_group_membership();

-- Backfill managed organization audiences, preserving the legacy marker UUID
-- when it exists so immutable snapshot references can be mapped without guesswork.
INSERT INTO audience (audience_id, organization_id, kind, name, description,
                      status, is_managed, legacy_role_id)
SELECT COALESCE(r.role_id, gen_random_uuid()), o.organization_id,
       'ORGANIZATION_ALL', 'Everyone in organization',
       'Every active member of the organization', 'ACTIVE', true, r.role_id
  FROM organization o
  LEFT JOIN role r ON r.organization_id = o.organization_id
                  AND r.code = 'ALL_MEMBERS' AND NOT r.is_system
ON CONFLICT (organization_id) WHERE kind = 'ORGANIZATION_ALL' DO NOTHING;

INSERT INTO audience (audience_id, organization_id, kind, department_id, name,
                      description, status, is_managed, legacy_role_id)
SELECT d.default_role_id, d.organization_id, 'DEPARTMENT_ALL', d.department_id,
       d.name || ' members', 'Every active member of ' || d.name,
       CASE WHEN d.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
       true, d.default_role_id
  FROM department d
ON CONFLICT (organization_id, department_id) WHERE kind = 'DEPARTMENT_ALL' DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT r.organization_id, lower(btrim(r.name))
          FROM role r
         WHERE r.organization_id IS NOT NULL AND NOT r.is_system
           AND r.code <> 'ALL_MEMBERS'
           AND NOT EXISTS (SELECT 1 FROM department d WHERE d.default_role_id = r.role_id)
           AND EXISTS (SELECT 1 FROM role_permission rp JOIN permission p USING(permission_id)
                WHERE rp.role_id = r.role_id AND p.code = 'PUBLISHED_CONTENT_VIEW'
                  AND p.status = 'ACTIVE')
         GROUP BY r.organization_id, lower(btrim(r.name)) HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Legacy audience roles contain duplicate group names; resolve them before migration 0017';
    END IF;
END;
$$;

INSERT INTO audience (audience_id, organization_id, kind, name, description,
                      status, is_managed, configuration_version, legacy_role_id)
SELECT r.role_id, r.organization_id, 'GROUP', r.name, COALESCE(r.description, ''),
       r.status, false, r.configuration_version, r.role_id
  FROM role r
 WHERE r.organization_id IS NOT NULL AND NOT r.is_system
   AND r.code <> 'ALL_MEMBERS'
   AND NOT EXISTS (SELECT 1 FROM department d WHERE d.default_role_id = r.role_id)
   AND EXISTS (SELECT 1 FROM role_permission rp JOIN permission p USING(permission_id)
        WHERE rp.role_id = r.role_id AND p.code = 'PUBLISHED_CONTENT_VIEW'
          AND p.status = 'ACTIVE')
ON CONFLICT (audience_id) DO NOTHING;

INSERT INTO audience_group_membership (
    audience_group_membership_id, audience_id, organization_id, membership_id,
    status, valid_from, valid_until, assigned_at, revoked_at)
SELECT DISTINCT ON (ra.role_id, ra.membership_id)
       ra.role_assignment_id, ra.role_id, om.organization_id, ra.membership_id,
       CASE WHEN ra.status = 'REVOKED' THEN 'REVOKED'
            WHEN ra.status = 'EXPIRED' OR (ra.valid_until IS NOT NULL AND ra.valid_until <= now()) THEN 'EXPIRED'
            ELSE 'ACTIVE' END,
       ra.valid_from, ra.valid_until, ra.assigned_at,
       CASE WHEN ra.status = 'REVOKED' THEN ra.assigned_at ELSE NULL END
  FROM role_assignment ra
  JOIN organization_membership om ON om.membership_id = ra.membership_id
  JOIN audience a ON a.audience_id = ra.role_id
                 AND a.organization_id = om.organization_id AND a.kind = 'GROUP'
 ORDER BY ra.role_id, ra.membership_id,
          (ra.status = 'ACTIVE' AND (ra.valid_until IS NULL OR ra.valid_until > now())) DESC,
          ra.assigned_at DESC, ra.role_assignment_id
ON CONFLICT DO NOTHING;

ALTER TABLE system_administrator ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_administrator FORCE ROW LEVEL SECURITY;
ALTER TABLE system_administration_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_administration_event FORCE ROW LEVEL SECURITY;
ALTER TABLE audience ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience FORCE ROW LEVEL SECURITY;
ALTER TABLE audience_group_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_group_membership FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON system_administrator TO arden_runtime;
GRANT SELECT, INSERT ON system_administration_event TO arden_runtime;
GRANT SELECT, INSERT, UPDATE ON audience TO arden_runtime;
GRANT SELECT, INSERT, UPDATE ON audience_group_membership TO arden_runtime;

CREATE POLICY system_administrator_self_read ON system_administrator
FOR SELECT TO arden_runtime
USING (user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);

CREATE POLICY system_administrator_instance_access ON system_administrator
FOR ALL TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true')
WITH CHECK (current_setting('arden.instance_admin', true) = 'true');

-- Instance administration needs to validate an explicit target account UUID.
-- No organization, membership, private-content, or publication table receives
-- an instance-admin policy.
CREATE POLICY user_account_instance_admin_read ON user_account
FOR SELECT TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true');

CREATE POLICY system_administration_event_instance_access ON system_administration_event
FOR SELECT TO arden_runtime
USING (current_setting('arden.instance_admin', true) = 'true');
CREATE POLICY system_administration_event_instance_insert ON system_administration_event
FOR INSERT TO arden_runtime
WITH CHECK (current_setting('arden.instance_admin', true) = 'true'
            AND actor_user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid);

CREATE POLICY audience_org_admin_access ON audience
FOR ALL TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
            AND current_setting('arden.org_admin', true) = 'true');

CREATE POLICY audience_member_read ON audience
FOR SELECT TO arden_runtime
USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (
        SELECT 1 FROM organization_membership om
         WHERE om.organization_id = audience.organization_id
           AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
           AND om.status = 'ACTIVE'
           AND (
               audience.kind = 'ORGANIZATION_ALL'
               OR (audience.kind = 'DEPARTMENT_ALL' AND EXISTS (
                   SELECT 1 FROM department_membership dm
                    WHERE dm.membership_id = om.membership_id
                      AND dm.department_id = audience.department_id
                      AND dm.status = 'ACTIVE'))
               OR (audience.kind = 'GROUP' AND EXISTS (
                   SELECT 1 FROM audience_group_membership agm
                    WHERE agm.audience_id = audience.audience_id
                      AND agm.membership_id = om.membership_id
                      AND agm.status = 'ACTIVE' AND agm.valid_from <= now()
                      AND (agm.valid_until IS NULL OR agm.valid_until > now())))
           )
    )
);

CREATE POLICY audience_group_membership_org_admin_access ON audience_group_membership
FOR ALL TO arden_runtime
USING (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
       AND current_setting('arden.org_admin', true) = 'true')
WITH CHECK (organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
            AND current_setting('arden.org_admin', true) = 'true');

CREATE POLICY audience_group_membership_self_read ON audience_group_membership
FOR SELECT TO arden_runtime
USING (
    organization_id = NULLIF(current_setting('arden.organization_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM organization_membership om
        WHERE om.membership_id = audience_group_membership.membership_id
          AND om.user_id = NULLIF(current_setting('arden.actor_id', true), '')::uuid
          AND om.organization_id = audience_group_membership.organization_id
          AND om.status = 'ACTIVE')
);

CREATE FUNCTION audience_snapshot_enforceable(
    requested_organization_id uuid,
    requested_audience_ids uuid[],
    requested_scope_type text,
    requested_department_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = arden, pg_temp AS $$
    SELECT coalesce(array_length(requested_audience_ids, 1), 0) > 0
       AND coalesce(array_length(requested_audience_ids, 1), 0) <= 100
       AND cardinality(requested_audience_ids) = cardinality(ARRAY(SELECT DISTINCT unnest(requested_audience_ids)))
       AND NOT EXISTS (
           SELECT 1 FROM unnest(requested_audience_ids) requested(audience_id)
           LEFT JOIN audience a ON a.audience_id = requested.audience_id
             AND a.organization_id = requested_organization_id AND a.status = 'ACTIVE'
          WHERE a.audience_id IS NULL
             OR (a.kind = 'ORGANIZATION_ALL' AND requested_scope_type <> 'ORGANIZATION')
             OR (a.kind = 'DEPARTMENT_ALL' AND
                 (requested_scope_type <> 'DEPARTMENT' OR a.department_id IS DISTINCT FROM requested_department_id))
       );
$$;
REVOKE ALL ON FUNCTION audience_snapshot_enforceable(uuid, uuid[], text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_snapshot_enforceable(uuid, uuid[], text, uuid) TO arden_runtime;

COMMENT ON TABLE audience IS
    'Canonical published-content audience. GROUP replaces the product Custom Role concept; legacy_role_id is a temporary migration bridge.';
COMMENT ON TABLE system_administrator IS
    'Arden installation administrators. This capability never grants organization membership or content access.';
