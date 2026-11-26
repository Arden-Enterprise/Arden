-- Install only in the database used by the configured Supabase Realtime service.
-- Run as the Supabase database administrator after reviewing the active policy inventory.
-- These roles can read or send private Broadcast envelopes only; they have no Arden data grants.
BEGIN;

DO $roles$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'arden_notification_reader') THEN
        CREATE ROLE arden_notification_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'arden_notification_sender') THEN
        CREATE ROLE arden_notification_sender NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$roles$;

ALTER ROLE arden_notification_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
ALTER ROLE arden_notification_sender NOLOGIN NOSUPERUSER NOBYPASSRLS;

GRANT USAGE ON SCHEMA realtime, auth TO arden_notification_reader, arden_notification_sender;
GRANT SELECT ON TABLE realtime.messages TO arden_notification_reader;
GRANT INSERT ON TABLE realtime.messages TO arden_notification_sender;
GRANT EXECUTE ON FUNCTION realtime.topic() TO arden_notification_reader, arden_notification_sender;
GRANT EXECUTE ON FUNCTION auth.jwt() TO arden_notification_reader, arden_notification_sender;

DROP POLICY IF EXISTS arden_notification_reader_receive ON realtime.messages;
CREATE POLICY arden_notification_reader_receive ON realtime.messages
    AS PERMISSIVE FOR SELECT TO arden_notification_reader
    USING (
        extension = 'broadcast'
        AND realtime.topic() = (SELECT auth.jwt() ->> 'topic')
        AND cardinality(string_to_array(realtime.topic(), ':')) = 4
        AND split_part(realtime.topic(), ':', 1) = 'arden-notifications'
        AND split_part(realtime.topic(), ':', 2) = (SELECT auth.jwt() ->> 'namespace')
        AND split_part(realtime.topic(), ':', 3) = (SELECT auth.jwt() ->> 'organization_id')
        AND split_part(realtime.topic(), ':', 4) = (SELECT auth.jwt() ->> 'membership_id')
    );
DROP POLICY IF EXISTS arden_notification_reader_scope ON realtime.messages;
CREATE POLICY arden_notification_reader_scope ON realtime.messages
    AS RESTRICTIVE FOR SELECT TO arden_notification_reader
    USING (
        extension = 'broadcast'
        AND realtime.topic() = (SELECT auth.jwt() ->> 'topic')
        AND cardinality(string_to_array(realtime.topic(), ':')) = 4
        AND split_part(realtime.topic(), ':', 1) = 'arden-notifications'
        AND split_part(realtime.topic(), ':', 2) = (SELECT auth.jwt() ->> 'namespace')
        AND split_part(realtime.topic(), ':', 3) = (SELECT auth.jwt() ->> 'organization_id')
        AND split_part(realtime.topic(), ':', 4) = (SELECT auth.jwt() ->> 'membership_id')
    );
DROP POLICY IF EXISTS arden_notification_reader_cannot_send ON realtime.messages;
CREATE POLICY arden_notification_reader_cannot_send ON realtime.messages
    AS RESTRICTIVE FOR INSERT TO arden_notification_reader
    WITH CHECK (false);

DROP POLICY IF EXISTS arden_notification_sender_broadcast ON realtime.messages;
CREATE POLICY arden_notification_sender_broadcast ON realtime.messages
    AS PERMISSIVE FOR INSERT TO arden_notification_sender
    WITH CHECK (
        extension = 'broadcast'
        AND realtime.topic() = (SELECT auth.jwt() ->> 'topic')
        AND cardinality(string_to_array(realtime.topic(), ':')) = 4
        AND split_part(realtime.topic(), ':', 1) = 'arden-notifications'
        AND split_part(realtime.topic(), ':', 2) = (SELECT auth.jwt() ->> 'namespace')
        AND split_part(realtime.topic(), ':', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND split_part(realtime.topic(), ':', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );
DROP POLICY IF EXISTS arden_notification_sender_scope ON realtime.messages;
CREATE POLICY arden_notification_sender_scope ON realtime.messages
    AS RESTRICTIVE FOR INSERT TO arden_notification_sender
    WITH CHECK (
        extension = 'broadcast'
        AND realtime.topic() = (SELECT auth.jwt() ->> 'topic')
        AND cardinality(string_to_array(realtime.topic(), ':')) = 4
        AND split_part(realtime.topic(), ':', 1) = 'arden-notifications'
        AND split_part(realtime.topic(), ':', 2) = (SELECT auth.jwt() ->> 'namespace')
        AND split_part(realtime.topic(), ':', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND split_part(realtime.topic(), ':', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    );
DROP POLICY IF EXISTS arden_notification_sender_cannot_read ON realtime.messages;
CREATE POLICY arden_notification_sender_cannot_read ON realtime.messages
    AS RESTRICTIVE FOR SELECT TO arden_notification_sender
    USING (false);

COMMIT;
