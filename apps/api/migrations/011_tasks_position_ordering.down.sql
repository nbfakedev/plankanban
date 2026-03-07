DROP INDEX IF EXISTS idx_tasks_project_col_position_created_at;

ALTER TABLE tasks
DROP COLUMN IF EXISTS position;
