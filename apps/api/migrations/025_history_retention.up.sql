ALTER TABLE projects ADD COLUMN IF NOT EXISTS history_retention_months INTEGER;
COMMENT ON COLUMN projects.history_retention_months IS 'Retention: 3, 6, or NULL (keep all / since project start)';
