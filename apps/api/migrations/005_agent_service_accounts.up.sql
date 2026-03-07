CREATE TABLE service_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}'::text[],
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE agent_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_id UUID NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_account_id, idempotency_key)
);

CREATE INDEX idx_agent_idempotency_service_account_id
ON agent_idempotency (service_account_id);

CREATE INDEX idx_agent_idempotency_created_at
ON agent_idempotency (created_at);
