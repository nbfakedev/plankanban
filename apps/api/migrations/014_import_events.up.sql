CREATE TABLE IF NOT EXISTS import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event TEXT NOT NULL CHECK (event IN ('import_started', 'import_completed', 'import_failed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS import_events_created_at_idx ON import_events (created_at);
CREATE INDEX IF NOT EXISTS import_events_project_id_idx ON import_events (project_id);
