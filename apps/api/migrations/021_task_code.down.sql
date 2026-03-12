DROP INDEX IF EXISTS idx_tasks_project_task_code;
ALTER TABLE tasks DROP COLUMN IF EXISTS task_code;
ALTER TABLE task_trash DROP COLUMN IF EXISTS task_code;
