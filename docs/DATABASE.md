# База данных (Postgres) — минимальная схема

## users
- id (uuid)
- email (unique)
- password_hash
- role: admin|techlead|employee
- created_at, updated_at

## projects
- id (uuid)
- name
- created_by (user_id)
- llm_provider (nullable)
- llm_model (nullable)
- created_at, updated_at

## project_members
- project_id
- user_id
- role_in_project (опционально)
- PRIMARY KEY (project_id, user_id)

## tasks
- id (text/uuid; лучше uuid)
- project_id
- title
- col (backlog|todo|doing|review|done)
- stage (например R0..R4+)
- assignee_user_id (nullable)
- track (nullable)
- agent (nullable)
- priority (int)
- hours (numeric)
- desc (text)
- notes (text)
- deps (text/json)
- created_at, updated_at

## task_events (аудит)
- id (uuid)
- project_id
- task_id
- actor_user_id
- event_type (create|update|move|comment|complete|...)
- payload (jsonb)
- created_at

## llm_requests
- id (uuid)
- project_id
- actor_user_id
- purpose
- provider
- model
- input_tokens, output_tokens
- cost_estimate
- status (ok|error)
- created_at

Миграции: хранить в `apps/api/migrations/` (SQL).

