CREATE TABLE IF NOT EXISTS llm_model_pricing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_display_name TEXT,
  input_price_per_1m NUMERIC NOT NULL,
  output_price_per_1m NUMERIC NOT NULL,
  input_cached_price_per_1m NUMERIC,
  source TEXT DEFAULT 'llm-prices.com',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, model_id)
);

CREATE INDEX IF NOT EXISTS idx_llm_model_pricing_provider ON llm_model_pricing(provider);
CREATE INDEX IF NOT EXISTS idx_llm_model_pricing_fetched_at ON llm_model_pricing(fetched_at DESC);
