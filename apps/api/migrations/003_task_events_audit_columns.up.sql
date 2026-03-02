ALTER TABLE task_events
ADD COLUMN action TEXT;

ALTER TABLE task_events
ADD COLUMN "before" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE task_events
ADD COLUMN "after" JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE task_events
SET action = event_type
WHERE action IS NULL;

ALTER TABLE task_events
ALTER COLUMN action SET NOT NULL;
