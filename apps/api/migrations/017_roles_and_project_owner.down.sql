ALTER TABLE projects DROP COLUMN IF EXISTS responsible_user_id;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'techlead', 'employee'));
