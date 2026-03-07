ALTER TABLE task_events
ADD CONSTRAINT task_events_task_id_fkey
FOREIGN KEY (task_id)
REFERENCES tasks(id)
ON DELETE CASCADE;
