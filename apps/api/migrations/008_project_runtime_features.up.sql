ALTER TABLE projects
ADD COLUMN IF NOT EXISTS duration_weeks INTEGER NOT NULL DEFAULT 0;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS budget_total BIGINT NOT NULL DEFAULT 0;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS stages TEXT[] NOT NULL DEFAULT ARRAY['A','R1','R1.1','R2','R3+','F'];

CREATE TABLE IF NOT EXISTS user_active_projects (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_active_projects_project_id
ON user_active_projects (project_id);

CREATE TABLE IF NOT EXISTS project_timers (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'paused' CHECK (status IN ('running', 'paused')),
  project_origin_started_at TIMESTAMPTZ,
  project_started_at TIMESTAMPTZ,
  project_elapsed_ms BIGINT NOT NULL DEFAULT 0,
  client_delay_started_at TIMESTAMPTZ,
  client_delay_elapsed_ms BIGINT NOT NULL DEFAULT 0,
  deadline_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);