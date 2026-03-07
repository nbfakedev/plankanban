ALTER TABLE tasks
ALTER COLUMN descript TYPE text;

ALTER TABLE tasks
ADD CONSTRAINT tasks_descript_length_check
CHECK (descript IS NULL OR char_length(descript) <= 5000);
