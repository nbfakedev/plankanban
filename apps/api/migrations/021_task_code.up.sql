-- task_code: internal project task ID (max 10 chars), unique per project
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_code VARCHAR(10);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_project_task_code
  ON tasks (project_id, task_code) WHERE task_code IS NOT NULL;

-- task_trash: keep snapshot of task_code when deleting
ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS task_code VARCHAR(10);
