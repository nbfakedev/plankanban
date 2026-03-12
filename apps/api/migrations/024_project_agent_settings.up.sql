-- Project agent settings: per-project list of agents (name, type, color)
-- Used in task assignment and in Team tab. Each project has its own agents.
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS agent_settings JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN projects.agent_settings IS 'Array of {name, type: "ai"|"human", color}. Project-specific agents for task assignment.';
