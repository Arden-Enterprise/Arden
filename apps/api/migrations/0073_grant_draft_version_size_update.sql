SET search_path TO arden, public;

-- Migration 0065 grants column-level UPDATE on draft_version to arden_runtime;
-- migration 0071 added content_size_bytes which open-version overwrites update.
GRANT UPDATE (content_size_bytes) ON draft_version TO arden_runtime;

