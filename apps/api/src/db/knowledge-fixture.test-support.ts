import type { Pool } from "pg";

/** Seed document metadata and, when requested, an exact selected-reader policy. */
export async function prepareKnowledgeFixture(pool: Pool, organizationId: string, draftId: string,
  members: string[], selectReaders = true) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO arden, public");
    await client.query(`UPDATE company_document SET metadata = jsonb_build_object('type', 'Guide',
      'version', '1.0', 'effectiveDate', '2026-01-01', 'expirationDate', NULL, 'changeNote', '')
      WHERE id = $1`, [draftId]);
    if (selectReaders) {
      const selection = await client.query<{ selection_id: string }>(`INSERT INTO reader_policy
        (organization_id, mode) VALUES ($1, 'SELECTED_MEMBERS') RETURNING id AS selection_id`, [organizationId]);
      await client.query(`INSERT INTO policy_reader (reader_policy_id, organization_id, membership_id, position)
        SELECT $1, $2, id, ordinality FROM unnest($3::uuid[]) WITH ORDINALITY item(id, ordinality)`,
      [selection.rows[0]!.selection_id, organizationId, members]);
      await client.query("UPDATE company_document SET reader_policy_id = $2 WHERE id = $1", [draftId, selection.rows[0]!.selection_id]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
