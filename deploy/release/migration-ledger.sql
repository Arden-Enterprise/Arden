-- Versioned extension for the existing migration control ledger.
-- This file records SQL checksums only; it never runs application migrations.
ALTER TABLE public.arden_schema_migrations
    ADD COLUMN IF NOT EXISTS checksum text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.arden_schema_migrations'::regclass
           AND conname = 'arden_schema_migrations_checksum_format'
    ) THEN
        ALTER TABLE public.arden_schema_migrations
            ADD CONSTRAINT arden_schema_migrations_checksum_format
            CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$');
    END IF;
END
$$;
