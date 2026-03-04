CREATE TABLE IF NOT EXISTS llm_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('new_task', 'chat', 'import_parse')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_estimate_usd NUMERIC,
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'llm_requests'
      AND column_name = 'cost_estimate'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'llm_requests'
      AND column_name = 'cost_estimate_usd'
  ) THEN
    ALTER TABLE llm_requests RENAME COLUMN cost_estimate TO cost_estimate_usd;
  END IF;
END $$;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES users(id);

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS purpose TEXT;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS request_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS response_meta JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS input_tokens INTEGER;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS output_tokens INTEGER;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS cost_estimate_usd NUMERIC;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS status TEXT;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS error_code TEXT;

ALTER TABLE llm_requests
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE llm_requests
ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE llm_requests
ALTER COLUMN actor_user_id SET NOT NULL;

ALTER TABLE llm_requests
ALTER COLUMN purpose SET NOT NULL;

ALTER TABLE llm_requests
ALTER COLUMN provider SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'llm_requests'
      AND column_name = 'cost_estimate'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'llm_requests'
      AND column_name = 'cost_estimate_usd'
  ) THEN
    UPDATE llm_requests
    SET cost_estimate_usd = COALESCE(cost_estimate_usd, cost_estimate)
    WHERE cost_estimate IS NOT NULL;
    ALTER TABLE llm_requests DROP COLUMN cost_estimate;
  END IF;
END $$;

ALTER TABLE llm_requests
ALTER COLUMN model SET NOT NULL;

ALTER TABLE llm_requests
ALTER COLUMN request_meta SET DEFAULT '{}'::jsonb;

ALTER TABLE llm_requests
ALTER COLUMN request_meta SET NOT NULL;

ALTER TABLE llm_requests
ALTER COLUMN response_meta SET DEFAULT '{}'::jsonb;

ALTER TABLE llm_requests
ALTER COLUMN response_meta SET NOT NULL;

ALTER TABLE llm_requests
ALTER COLUMN status SET NOT NULL;

ALTER TABLE llm_requests
ALTER COLUMN created_at SET DEFAULT NOW();

ALTER TABLE llm_requests
ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE llm_requests
DROP CONSTRAINT IF EXISTS llm_requests_project_id_fkey;

ALTER TABLE llm_requests
ADD CONSTRAINT llm_requests_project_id_fkey
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE llm_requests
DROP CONSTRAINT IF EXISTS llm_requests_actor_user_id_fkey;

ALTER TABLE llm_requests
ADD CONSTRAINT llm_requests_actor_user_id_fkey
FOREIGN KEY (actor_user_id) REFERENCES users(id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'llm_requests_purpose_check'
      AND conrelid = 'llm_requests'::regclass
  ) THEN
    ALTER TABLE llm_requests
    ADD CONSTRAINT llm_requests_purpose_check
    CHECK (purpose IN ('new_task', 'chat', 'import_parse'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'llm_requests_status_check'
      AND conrelid = 'llm_requests'::regclass
  ) THEN
    ALTER TABLE llm_requests
    ADD CONSTRAINT llm_requests_status_check
    CHECK (status IN ('ok', 'error'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_llm_requests_project_id
ON llm_requests (project_id);

CREATE INDEX IF NOT EXISTS idx_llm_requests_actor_user_id
ON llm_requests (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_llm_requests_created_at
ON llm_requests (created_at);
