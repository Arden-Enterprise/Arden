import { readFile } from "node:fs/promises";
import type { Pool, PoolClient } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

type Context = { pool: Pool; publish: () => Promise<{ id: string; draftId: string }> };
type Manifest = { sourceManifestSha256: string; rows: Record<string, unknown>[] };

/** Synthetic fixtures only; the real migration runs inside a rolled-back transaction. */
export function registerLegacyMetadataVerification(context: () => Context) {
  describe("verified legacy metadata repair", () => {
    let source: { id: string; draftId: string }, migration: string;
    beforeAll(async () => {
      const historicalSql = await readFile(new URL("../../migrations/0041_verified_legacy_metadata_repair.sql", import.meta.url), "utf8");
      // The recovery suite also applies the unmodified migration in chronological order.
      migration = historicalSql.replace(/\bshared_draft\b/g, "company_document")
        .replace(/\bshared_draft_version\b/g, "working_version")
        .replace(/\bshared_submission\b/g, "review_submission")
        .replace(/\bpublished_knowledge_version\b/g, "published_version")
        .replace(/\bknowledge_current_publication\b/g, "current_publication")
        .replace(/\b(d|v|s|p|cp)\.shared_draft_id\b/g, (_field, table) => table === "d" ? "d.id" : `${table}.document_id`)
        .replace(/\bp\.submission_id\b/g, "p.review_submission_id")
        .replace(/\bs\.submission_id\b/g, "s.id")
        .replace(/\bp\.published_version_id\b/g, "p.id")
        .replace(/\bWHERE (?:shared_draft_id|submission_id|published_version_id) = item/g, "WHERE id = item")
        .replace(/\bmanagement\b/g, "metadata")
        .replace("'metadata',patched", "'management',patched")
        .replace(/\bdetails_json\b/g, "details");
      source = await context().publish();
    });
    async function fixture(work: (client: PoolClient, manifest: Manifest) => Promise<void>) {
      const client = await context().pool.connect();
      try {
        await client.query("BEGIN");
        // Recreate a pre-0030 missing-metadata source, without touching other fixtures.
        await client.query(`ALTER TABLE arden.review_submission DISABLE TRIGGER trg_freeze_submission_management;
          ALTER TABLE arden.published_version DISABLE TRIGGER trg_freeze_publication_management;
          ALTER TABLE arden.published_version DISABLE TRIGGER trg_published_version_immutable;
          ALTER TABLE arden.company_document DISABLE TRIGGER trg_shared_draft_updated_at`);
        await client.query("UPDATE arden.company_document SET metadata=NULL,updated_at='2000-01-01Z' WHERE id=$1", [source.draftId]);
        await client.query(`UPDATE arden.review_submission SET metadata=NULL,document_code=NULL
          WHERE id=(SELECT review_submission_id AS submission_id FROM arden.published_version WHERE id=$1)`, [source.id]);
        await client.query("UPDATE arden.published_version SET metadata=NULL,document_code=NULL WHERE id=$1", [source.id]);
        await client.query(`ALTER TABLE arden.review_submission ENABLE TRIGGER trg_freeze_submission_management;
          ALTER TABLE arden.published_version ENABLE TRIGGER trg_freeze_publication_management;
          ALTER TABLE arden.published_version ENABLE TRIGGER trg_published_version_immutable;
          ALTER TABLE arden.company_document ENABLE TRIGGER trg_shared_draft_updated_at`);
        const row = (await client.query(`SELECT d.organization_id AS "organizationId",d.id AS "documentId",
          p.id AS "publicationId",p.review_submission_id AS "submissionId",p.content_hash AS "contentHash",
          d.document_code AS "documentCode",'Guide'::text AS type,'1.0'::text AS version
          FROM arden.published_version p JOIN arden.company_document d ON p.document_id = d.id
          WHERE p.id=$1`, [source.id])).rows[0];
        await client.query("SAVEPOINT repair_test");
        await work(client, { sourceManifestSha256: "f".repeat(64), rows: [row] });
      } finally { await client.query("ROLLBACK"); client.release(); }
    }
    async function apply(client: PoolClient, manifest: Manifest) {
      await client.query("SELECT set_config('arden.metadata_repair_manifest',$1,true)", [JSON.stringify(manifest)]);
      await client.query(migration);
    }
    async function unchangedAfterFailure(client: PoolClient) {
      await client.query("ROLLBACK TO SAVEPOINT repair_test");
      expect((await client.query("SELECT metadata AS management,document_code FROM arden.published_version WHERE id=$1", [source.id])).rows[0])
        .toEqual({ management: null, document_code: null });
      expect((await client.query(`SELECT count(*) FROM pg_trigger WHERE tgname IN
        ('trg_freeze_publication_management','trg_freeze_submission_management','trg_published_version_immutable',
         'trg_shared_draft_updated_at') AND tgenabled='O'`)).rows[0].count).toBe("4");
    }
    it("fills only missing metadata with the stable code, audits and restores immutable guards", async () => fixture(async (client, manifest) => {
      const pointers = (await client.query("SELECT * FROM arden.current_publication ORDER BY document_id")).rows;
      const generations = (await client.query("SELECT * FROM arden.index_generation ORDER BY id")).rows;
      await apply(client, manifest);
      const repaired = (await client.query("SELECT metadata AS management,document_code FROM arden.published_version WHERE id=$1", [source.id])).rows[0];
      expect(repaired).toEqual({ management: { schemaVersion: 1, type: "Guide", version: "1.0",
        topicId: null, effectiveDate: null, expirationDate: null, changeNote: "" }, document_code: manifest.rows[0]!.documentCode });
      expect((await client.query("SELECT * FROM arden.current_publication ORDER BY document_id")).rows).toEqual(pointers);
      expect((await client.query("SELECT * FROM arden.index_generation ORDER BY id")).rows).toEqual(generations);
      expect((await client.query("SELECT updated_at FROM arden.company_document WHERE id=$1", [source.draftId])).rows[0].updated_at.toISOString()).toBe("2000-01-01T00:00:00.000Z");
      const audit = (await client.query(`SELECT details AS details_json FROM arden.audit_event WHERE
        event_type='KNOWLEDGE_LEGACY_METADATA_REPAIRED' AND details->>'publicationId'=$1`, [source.id])).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].details_json.before.publicationManagement).toBeNull();
      expect(audit[0].details_json.after.management).toEqual(repaired.management);
      await client.query("SAVEPOINT immutable_test");
      await expect(client.query("UPDATE arden.published_version SET title='Forbidden' WHERE id=$1", [source.id])).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT immutable_test");
      await expect(apply(client, manifest)).rejects.toThrow(); // Never overwrite a repaired snapshot.
    }));
    it("rejects a mismatched source hash and rolls back guard DDL", async () => fixture(async (client, manifest) => {
      manifest.rows[0]!.contentHash = "b".repeat(64);
      await expect(apply(client, manifest)).rejects.toThrow();
      await unchangedAfterFailure(client);
    }));
    it("rejects duplicate targets", async () => fixture(async (client, manifest) => {
      manifest.rows.push({ ...manifest.rows[0] });
      await expect(apply(client, manifest)).rejects.toThrow("duplicate repair target");
      await unchangedAfterFailure(client);
    }));
    it("preserves an existing working metadata value", async () => fixture(async (client, manifest) => {
      await client.query("UPDATE arden.company_document SET metadata=$2 WHERE id=$1", [source.draftId, { type: "Procedure", version: "2.0" }]);
      await expect(apply(client, manifest)).rejects.toThrow();
      await unchangedAfterFailure(client);
    }));
    it("rolls back all metadata and trigger changes if audit cannot be written", async () => fixture(async (client, manifest) => {
      await client.query(`CREATE FUNCTION pg_temp.refuse_metadata_audit() RETURNS trigger LANGUAGE plpgsql AS
        $$BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END$$;
        CREATE TRIGGER refuse_metadata_audit BEFORE INSERT ON arden.audit_event
        FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_metadata_audit()`);
      await expect(apply(client, manifest)).rejects.toThrow("Synthetic audit failure");
      await unchangedAfterFailure(client);
    }));
    it("refuses the application runtime even with a supplied manifest", async () => fixture(async (client, manifest) => {
      await client.query("SET LOCAL ROLE arden_runtime");
      await expect(apply(client, manifest)).rejects.toThrow("requires the trusted operator");
      await unchangedAfterFailure(client);
    }));
    it("never infers a repair without a supplied manifest", async () => fixture(async (client) => {
      await client.query("SELECT set_config('arden.metadata_repair_manifest','',true)");
      await client.query(migration);
      expect((await client.query("SELECT metadata AS management FROM arden.published_version WHERE id=$1", [source.id])).rows[0].management).toBeNull();
    }));
  });
}
