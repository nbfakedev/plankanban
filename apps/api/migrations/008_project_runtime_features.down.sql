DROP TABLE IF EXISTS project_timers;

DROP INDEX IF EXISTS idx_user_active_projects_project_id;
DROP TABLE IF EXISTS user_active_projects;

ALTER TABLE projects
DROP COLUMN IF EXISTS stages;

ALTER TABLE projects
DROP COLUMN IF EXISTS budget_total;

ALTER TABLE projects
DROP COLUMN IF EXISTS duration_weeks;