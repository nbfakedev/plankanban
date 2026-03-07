ALTER TABLE projects
ADD COLUMN IF NOT EXISTS stage_settings JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE SEQUENCE IF NOT EXISTS tasks_public_id_seq;

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS public_id BIGINT;

ALTER TABLE tasks
ALTER COLUMN public_id SET DEFAULT nextval('tasks_public_id_seq');

UPDATE tasks
SET public_id = nextval('tasks_public_id_seq')
WHERE public_id IS NULL;

SELECT setval(
  'tasks_public_id_seq',
  COALESCE((SELECT MAX(public_id) FROM tasks), 0)
);

ALTER TABLE tasks
ALTER COLUMN public_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_public_id_unique
ON tasks (public_id);