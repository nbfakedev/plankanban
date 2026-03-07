DROP INDEX IF EXISTS idx_agent_idempotency_created_at;

DROP INDEX IF EXISTS idx_agent_idempotency_service_account_id;

DROP TABLE IF EXISTS agent_idempotency;

DROP TABLE IF EXISTS service_accounts;
