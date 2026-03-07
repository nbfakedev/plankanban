DROP INDEX IF EXISTS idx_task_trash_public_id;
DROP INDEX IF EXISTS idx_task_trash_deleted_by_user_id;
DROP INDEX IF EXISTS idx_task_trash_stage;
DROP INDEX IF EXISTS idx_task_trash_project_id;
DROP INDEX IF EXISTS idx_task_trash_deleted_at_desc;

DROP TABLE IF EXISTS task_trash;
