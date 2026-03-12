-- Project task field options: priority_options, size_options, column_settings
-- Used in task create/edit forms and main board columns visibility.

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS priority_options JSONB NOT NULL DEFAULT '[
  {"value":1,"label":"Low"},
  {"value":2,"label":"Medium"},
  {"value":3,"label":"High"},
  {"value":4,"label":"Critical"}
]'::jsonb;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS size_options JSONB NOT NULL DEFAULT '[
  {"id":"XS","label":"XS"},
  {"id":"S","label":"S"},
  {"id":"M","label":"M"},
  {"id":"L","label":"L"},
  {"id":"XL","label":"XL"}
]'::jsonb;

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS column_settings JSONB NOT NULL DEFAULT '[
  {"id":"backlog","label":"Backlog","visible":true,"locked":true},
  {"id":"todo","label":"To Do","visible":true,"locked":false},
  {"id":"doing","label":"In Progress","visible":true,"locked":false},
  {"id":"review","label":"Review","visible":true,"locked":false},
  {"id":"done","label":"Done","visible":true,"locked":true}
]'::jsonb;

COMMENT ON COLUMN projects.priority_options IS 'Array of {value: int, label: string}. Task priority options for forms.';
COMMENT ON COLUMN projects.size_options IS 'Array of {id: string, label: string}. Task size options (XS,S,M,L,XL or custom).';
COMMENT ON COLUMN projects.column_settings IS 'Array of {id, label, visible, locked}. Column visibility and labels. backlog and done have locked=true.';
