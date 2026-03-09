CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  -- pending | processing | done | failed
  total_chunks INT NOT NULL DEFAULT 0,
  processed_chunks INT NOT NULL DEFAULT 0,
  tasks_created INT NOT NULL DEFAULT 0,
  error TEXT,
  result_meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_import_jobs_actor ON import_jobs(actor_user_id);
