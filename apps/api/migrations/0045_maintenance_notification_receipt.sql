SET search_path TO arden, public;

-- Read receipts stay separate so notification rows remain append-only.

CREATE TABLE maintenance_notification_receipt (
    organization_id uuid NOT NULL,
    notification_id uuid NOT NULL,
    recipient_membership_id uuid NOT NULL,
    read_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (notification_id, recipient_membership_id),
    CONSTRAINT fk_maintenance_receipt_notification FOREIGN KEY (notification_id)
        REFERENCES maintenance_notification (notification_id),
    CONSTRAINT fk_maintenance_receipt_recipient FOREIGN KEY (recipient_membership_id, organization_id)
        REFERENCES organization_membership (membership_id, organization_id)
);

ALTER TABLE maintenance_notification_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_notification_receipt FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON maintenance_notification_receipt TO arden_runtime;
CREATE POLICY maintenance_receipt_actor ON maintenance_notification_receipt
    FOR ALL TO arden_runtime
    USING (recipient_membership_id = maintenance_actor_membership(organization_id))
    WITH CHECK (recipient_membership_id = maintenance_actor_membership(organization_id));
