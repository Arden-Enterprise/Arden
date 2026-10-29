-- Migration 0023: Allow organization invitations without a department assignment
SET search_path TO arden, public;

ALTER TABLE organization_invitation ALTER COLUMN department_id DROP NOT NULL;
