-- API keys per user per provider (simplified settings)
CREATE TABLE IF NOT EXISTS llm_user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('anthropic', 'openai', 'deepseek', 'groq', 'qwen', 'custom')),
  api_key_encrypted TEXT NOT NULL,
  base_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_llm_user_api_keys_user ON llm_user_api_keys(user_id);

-- Migrate existing keys from llm_provider_settings (one per user+provider, pick latest)
INSERT INTO llm_user_api_keys (user_id, provider, api_key_encrypted, base_url, updated_at)
SELECT user_id, provider, api_key_encrypted, base_url, updated_at FROM (
  SELECT user_id, provider, api_key_encrypted, base_url, updated_at,
         ROW_NUMBER() OVER (PARTITION BY user_id, provider ORDER BY updated_at DESC NULLS LAST) AS rn
  FROM llm_provider_settings
  WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted != ''
) sub WHERE rn = 1
ON CONFLICT (user_id, provider) DO NOTHING;
