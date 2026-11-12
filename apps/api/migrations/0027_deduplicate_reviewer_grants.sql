SET search_path TO arden, public;

-- Keep the earliest assignment for each exact active grant. Classifications, level,
-- tags, and expiry are included so legacy pending-review authority is preserved.
WITH normalized AS (
    SELECT g.*,
           ARRAY(SELECT DISTINCT c.classification
                   FROM unnest(g.classifications) AS c(classification)
                  ORDER BY c.classification) AS classification_set
      FROM reviewer_grant g
     WHERE g.status = 'ACTIVE'
), ranked AS (
    SELECT reviewer_grant_id, organization_id,
           first_value(reviewer_grant_id) OVER grant_order AS kept_grant_id,
           row_number() OVER grant_order AS duplicate_number
      FROM normalized
    WINDOW grant_order AS (
      PARTITION BY organization_id, reviewer_membership_id, scope, department_id,
                   classification_set, level, team_tag, project_tag, valid_until
      ORDER BY valid_from, created_at, reviewer_grant_id
    )
), changed AS (
    UPDATE reviewer_grant grant_row SET status = 'INACTIVE'
      FROM ranked
     WHERE grant_row.reviewer_grant_id = ranked.reviewer_grant_id
       AND ranked.duplicate_number > 1
    RETURNING grant_row.reviewer_grant_id, grant_row.organization_id
)
INSERT INTO audit_event (organization_id, event_type, outcome, details_json)
SELECT changed.organization_id, 'REVIEWER_GRANT_DUPLICATE_DEACTIVATED', 'SUCCESS',
       jsonb_build_object('reviewerGrantId', changed.reviewer_grant_id,
                          'keptReviewerGrantId', ranked.kept_grant_id,
                          'reason', 'exact duplicate grant migration')
  FROM changed JOIN ranked ON ranked.reviewer_grant_id = changed.reviewer_grant_id;

-- An exact duplicate cannot be inserted directly, even outside the API. The API
-- separately blocks an effective grant with the same scope, tags, level, and
-- classification set, including requests with a different expiry.
CREATE UNIQUE INDEX uq_active_reviewer_grant_exact
    ON reviewer_grant (organization_id, reviewer_membership_id, scope, department_id,
                       classifications, level, team_tag, project_tag, valid_until)
    NULLS NOT DISTINCT WHERE status = 'ACTIVE';
