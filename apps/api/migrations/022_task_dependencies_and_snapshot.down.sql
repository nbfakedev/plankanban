DROP TABLE IF EXISTS task_dependencies;
ALTER TABLE projects DROP COLUMN IF EXISTS snapshot_md;
ALTER TABLE projects DROP COLUMN IF EXISTS snapshot_updated_at;
