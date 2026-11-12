import type { Pool } from "pg";

/** Upgrade old workflow fixtures to KM required business fields, without changing
 * their deliberately frozen legacy audience/reviewer projection. Production
 * authoring never uses this fixture helper. */
export async function prepareKnowledgeFixture(pool: Pool, organizationId: string, draftId: string,
  members: string[], selectReaders = true) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO arden, public");
    const topic = await client.query<{ topic_id: string }>(`INSERT INTO knowledge_topic (organization_id, name)
      VALUES ($1, 'Workflow fixtures') ON CONFLICT (organization_id, lower(btrim(name)))
      DO UPDATE SET name = EXCLUDED.name RETURNING topic_id`, [organizationId]);
    await client.query(`UPDATE shared_draft SET management = jsonb_build_object('type', 'Guide', 'topicId', $2::text,
      'version', '1.0', 'effectiveDate', '2026-01-01', 'expirationDate', NULL, 'changeNote', '', 'topicName', 'Workflow fixtures')
      WHERE shared_draft_id = $1`, [draftId, topic.rows[0]!.topic_id]);
    if (selectReaders) {
      const selection = await client.query<{ selection_id: string }>(`INSERT INTO reader_selection
        (organization_id, reader_mode) VALUES ($1, 'SELECTED_MEMBERS') RETURNING selection_id`, [organizationId]);
      await client.query(`INSERT INTO selected_reader (selection_id, organization_id, membership_id, ordinal)
        SELECT $1, $2, id, ordinality FROM unnest($3::uuid[]) WITH ORDINALITY item(id, ordinality)`,
      [selection.rows[0]!.selection_id, organizationId, members]);
      await client.query("UPDATE shared_draft SET draft_selection_id = $2 WHERE shared_draft_id = $1", [draftId, selection.rows[0]!.selection_id]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Represents a pre-KM pending snapshot for legacy-compatibility tests only. */
export async function submitLegacyKnowledgeFixture(pool: Pool, organizationId: string, draftId: string): Promise<string> {
  const result = await pool.query<{ submission_id: string }>(`INSERT INTO arden.shared_submission
    (organization_id, shared_draft_id, shared_draft_version_id, snapshot_version_no, submitted_by_membership_id,
      target_scope_type, target_department_id, responsible_department_id, title, classification, team_tag,
      project_tag, audience_role_ids, policy_version, content_uri, mime_type, content_hash, submit_request_id)
    SELECT d.organization_id, d.shared_draft_id, v.shared_draft_version_id, v.version_no, d.author_membership_id,
      d.target_scope_type, CASE WHEN d.target_scope_type = 'DEPARTMENT' THEN d.responsible_department_id END,
      d.responsible_department_id, d.title, d.classification, d.team_tag, d.project_tag,
      ARRAY(SELECT role_id FROM arden.shared_draft_audience a WHERE a.shared_draft_id = d.shared_draft_id),
      1, v.content_uri, v.mime_type, v.content_hash, gen_random_uuid()
    FROM arden.shared_draft d JOIN arden.shared_draft_version v ON v.shared_draft_id = d.shared_draft_id
      AND v.version_no = d.current_version_no WHERE d.organization_id = $1 AND d.shared_draft_id = $2
    RETURNING submission_id`, [organizationId, draftId]);
  return result.rows[0]!.submission_id;
}
