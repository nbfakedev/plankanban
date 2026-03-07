DROP INDEX IF EXISTS idx_tasks_public_id_unique;

ALTER TABLE tasks
DROP COLUMN IF EXISTS public_id;

DROP SEQUENCE IF EXISTS tasks_public_id_seq;

ALTER TABLE projects
DROP COLUMN IF EXISTS stage_settings;