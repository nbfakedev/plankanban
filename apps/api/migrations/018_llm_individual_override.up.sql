-- Add flag to distinguish individual overrides from base config
ALTER TABLE llm_provider_settings
  ADD COLUMN IF NOT EXISTS is_individual_override BOOLEAN DEFAULT false;

-- Existing rows: treat as base (not individual)
UPDATE llm_provider_settings SET is_individual_override = false WHERE is_individual_override IS NULL;
