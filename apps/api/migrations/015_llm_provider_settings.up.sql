CREATE TABLE IF NOT EXISTS llm_provider_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(32) NOT NULL CHECK (purpose IN ('import_parse', 'new_task', 'chat')),
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('anthropic', 'openai', 'deepseek', 'custom')),
  model VARCHAR(64) NOT NULL,
  api_key_encrypted TEXT,
  base_url TEXT,
  is_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, purpose)
);

CREATE INDEX idx_llm_provider_settings_user ON llm_provider_settings(user_id);
