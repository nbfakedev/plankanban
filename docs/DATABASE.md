# База данных (Postgres) — минимальная схема

## users
- id (uuid)
- email (unique)
- password_hash
- role: admin|techlead|employee
- status: active|disabled
- created_at, updated_at

## projects
- id (uuid)
- name
- created_by (user_id)
- llm_provider (nullable)
- llm_model (nullable)
- duration_weeks (int, default 0)
- budget_total (bigint, default 0)
- stages (text[], default `['A','R1','R1.1','R2','R3+','F']`)
- stage_settings (jsonb, default `[]`; elements: `{name, budget, color}`)
- created_at, updated_at

## project_members
- project_id
- user_id
- role_in_project (опционально)
- PRIMARY KEY (project_id, user_id)

## tasks
- id (uuid, PK)
- public_id (bigint, unique, global readable ID across all projects)
- project_id
- title
- col (backlog|todo|doing|review|done)
- position (int, default 0; manual order inside column)
- stage (например R0..R4+)
- assignee_user_id (nullable)
- track (nullable)
- agent (nullable)
- priority (int)
- hours (numeric)
- size (text, nullable; XS|S|M|L|XL — объём задачи)
- descript (text, nullable, max 5000 chars; CHECK constraint)
- notes (text)
- deps (text/json)
- created_at, updated_at

## task_events (аудит)
- id (uuid)
- project_id
- task_id (uuid snapshot of task id; stored even after task delete)
- actor_user_id
- action (create|update|move|reorder|delete|...)
- before (jsonb)
- after (jsonb)
- event_type (task_created|task_updated|task_moved|task_reordered|task_deleted|agent_action|...)
- payload (jsonb)
- created_at

Используется для аналитики проекта/задач:
- created/updated/moved/reordered/deleted task metrics
- cycle time и weekly throughput через SQL-агрегации по `event_type` + `payload`

## task_chats (персистентный чат техлида по задаче)
- id (uuid, PK)
- task_id (uuid, FK -> tasks.id, ON DELETE CASCADE)
- role (text: user|assistant)
- content (text)
- action (jsonb, nullable) — предложенное изменение задачи { field: value } для PATCH
- action_applied (boolean, default false)
- created_at (timestamptz)

Индекс: task_id, created_at.

## task_trash
- id (uuid, PK)
- task_id (uuid, unique; original task id)
- public_id (bigint, nullable)
- project_id (uuid, nullable)
- deleted_project_name (text; snapshot name if project removed)
- title
- col (backlog|todo|doing|review|done)
- stage
- assignee_user_id (nullable)
- track (nullable)
- agent (nullable)
- priority (int)
- hours (numeric)
- descript (text)
- notes (text)
- deps (jsonb)
- deleted_at
- deleted_by_user_id (nullable)
- created_at (original task created_at)
- updated_at
## llm_model_pricing
- id (uuid)
- provider (text)
- model_id (text)
- model_display_name (text)
- input_price_per_1m, output_price_per_1m (numeric)
- input_cached_price_per_1m (numeric, nullable)
- source, fetched_at, updated_at
- UNIQUE(provider, model_id)

Загружается из llm-prices.com (скрипт `npm run llm:prices:fetch`, автообновление раз в сутки).

## llm_requests
- id (uuid)
- project_id (uuid, nullable)
- actor_user_id (uuid, not null)
- purpose (new_task|chat|import_parse)
- provider (text)
- model (text)
- request_meta (jsonb)
- response_meta (jsonb)
- input_tokens (int, nullable)
- output_tokens (int, nullable)
- cost_estimate_usd (numeric, nullable)
- status (ok|error)
- error_code (text, nullable)
- created_at

Миграции: хранить в `apps/api/migrations/` (SQL).

## service_accounts
- id (uuid)
- name (text)
- scopes (text[])
- token_hash (text, unique; SHA-256 hash of service token)
- created_at
- revoked_at (nullable)

## agent_idempotency
- id (uuid)
- service_account_id (uuid, FK -> service_accounts.id, ON DELETE CASCADE)
- idempotency_key (text)
- response_json (jsonb)
- created_at
- UNIQUE(service_account_id, idempotency_key)
- indexes:
  - service_account_id
  - created_at

## user_active_projects
- user_id (uuid, PK, FK -> users.id)
- project_id (uuid, FK -> projects.id)
- updated_at (timestamptz)

Назначение: хранит активный проект для каждого пользователя.

## project_timers
- project_id (uuid, PK, FK -> projects.id)
- status (`running|paused`)
- project_origin_started_at (timestamptz, nullable)
- project_started_at (timestamptz, nullable)
- project_elapsed_ms (bigint, default 0)
- client_delay_started_at (timestamptz, nullable)
- client_delay_elapsed_ms (bigint, default 0)
- deadline_at (timestamptz, nullable)
- created_at, updated_at

Назначение: серверное состояние таймера проекта и таймера клиентской задержки.

