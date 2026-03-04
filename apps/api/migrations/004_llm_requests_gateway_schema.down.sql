DROP INDEX IF EXISTS idx_llm_requests_created_at;

DROP INDEX IF EXISTS idx_llm_requests_actor_user_id;

DROP INDEX IF EXISTS idx_llm_requests_project_id;

ALTER TABLE llm_requests
DROP CONSTRAINT IF EXISTS llm_requests_project_id_fkey;

ALTER TABLE llm_requests
ADD CONSTRAINT llm_requests_project_id_fkey
FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE llm_requests
DROP CONSTRAINT IF EXISTS llm_requests_actor_user_id_fkey;

ALTER TABLE llm_requests
ADD CONSTRAINT llm_requests_actor_user_id_fkey
FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE llm_requests
DROP COLUMN IF EXISTS error_code;

ALTER TABLE llm_requests
DROP COLUMN IF EXISTS response_meta;

ALTER TABLE llm_requests
DROP COLUMN IF EXISTS request_meta;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'llm_requests'
      AND column_name = 'cost_estimate_usd'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'llm_requests'
      AND column_name = 'cost_estimate'
  ) THEN
    ALTER TABLE llm_requests RENAME COLUMN cost_estimate_usd TO cost_estimate;
  END IF;
END $$;
