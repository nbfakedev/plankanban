CREATE TABLE IF NOT EXISTS task_trash (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL UNIQUE,
  public_id BIGINT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  deleted_project_name TEXT,
  title TEXT NOT NULL,
  col TEXT CHECK (col IN ('backlog', 'todo', 'doing', 'review', 'done')),
  stage TEXT,
  assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  track TEXT,
  agent TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  hours NUMERIC,
  descript TEXT,
  notes TEXT,
  deps JSONB,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_trash_deleted_at_desc
  ON task_trash (deleted_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_trash_project_id
  ON task_trash (project_id);

CREATE INDEX IF NOT EXISTS idx_task_trash_stage
  ON task_trash (stage);

CREATE INDEX IF NOT EXISTS idx_task_trash_deleted_by_user_id
  ON task_trash (deleted_by_user_id);

CREATE INDEX IF NOT EXISTS idx_task_trash_public_id
  ON task_trash (public_id);
