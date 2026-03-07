ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY project_id, col
      ORDER BY created_at ASC, id ASC
    ) - 1 AS next_position
  FROM tasks
)
UPDATE tasks t
SET position = ranked.next_position
FROM ranked
WHERE ranked.id = t.id;

CREATE INDEX IF NOT EXISTS idx_tasks_project_col_position_created_at
ON tasks (project_id, col, position, created_at);
