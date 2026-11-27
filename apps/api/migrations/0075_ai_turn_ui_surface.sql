SET search_path TO arden, public;

ALTER TABLE ai_conversation_turn
  ADD COLUMN ui_surface jsonb NULL,
  ADD COLUMN scope_filter_hash text NULL
    CONSTRAINT ck_ai_turn_scope_filter_hash CHECK (
      scope_filter_hash IS NULL OR scope_filter_hash ~ '^[a-f0-9]{64}$'
    ),
  ADD CONSTRAINT ck_ai_turn_ui_surface_shape CHECK (
    ui_surface IS NULL OR (
      jsonb_typeof(ui_surface) = 'object'
      AND ui_surface->'schemaVersion' = '1'::jsonb
      AND jsonb_typeof(ui_surface->'rootId') = 'string'
      AND jsonb_typeof(ui_surface->'nodes') = 'object'
      AND jsonb_typeof(ui_surface->'bindings') = 'object'
      AND jsonb_typeof(ui_surface->'bindings'->'documents') = 'array'
      AND jsonb_typeof(ui_surface->'bindings'->'citationIndexes') = 'array'
      AND octet_length(ui_surface::text) <= 65536
    )
  );

CREATE TABLE ai_turn_surface_binding (
  turn_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  published_version_id uuid NOT NULL,
  PRIMARY KEY (turn_id, published_version_id),
  FOREIGN KEY (turn_id, organization_id)
    REFERENCES ai_conversation_turn(turn_id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (document_id, organization_id)
    REFERENCES shared_draft(shared_draft_id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (published_version_id)
    REFERENCES published_knowledge_version(published_version_id) ON DELETE RESTRICT
);

ALTER TABLE ai_turn_surface_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_turn_surface_binding FORCE ROW LEVEL SECURITY;

CREATE POLICY ai_turn_surface_binding_owner_select
  ON ai_turn_surface_binding FOR SELECT TO arden_runtime
  USING (EXISTS (
    SELECT 1 FROM ai_conversation_turn t
    WHERE t.turn_id = ai_turn_surface_binding.turn_id
      AND t.organization_id = ai_turn_surface_binding.organization_id
  ));

CREATE POLICY ai_turn_surface_binding_owner_insert
  ON ai_turn_surface_binding FOR INSERT TO arden_runtime
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversation_turn t
      WHERE t.turn_id = ai_turn_surface_binding.turn_id
        AND t.organization_id = ai_turn_surface_binding.organization_id
    )
    AND published_version_id IN (SELECT eligible_ai_publications())
  );

GRANT SELECT, INSERT ON ai_turn_surface_binding TO arden_runtime;
