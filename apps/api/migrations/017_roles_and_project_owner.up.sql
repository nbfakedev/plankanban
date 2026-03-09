-- Add 'manager' role to users
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'techlead', 'manager', 'employee'));

-- Add responsible_user_id to projects (the user who "owns" the project)
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Backfill: set responsible_user_id = created_by for existing projects
UPDATE projects SET responsible_user_id = created_by WHERE responsible_user_id IS NULL;
