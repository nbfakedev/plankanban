# API

## Auth Strategy
- Stateless JWT (Bearer token in `Authorization` header).
- JWT is signed with HS256 on backend only (`JWT_SECRET`), includes `sub`, `email`, `role`, `status`, `iat`, `exp`.
- Logout is client-side token discard. Endpoint exists for symmetric flow.

## Roles (RBAC)
- `admin`
- `techlead`
- `employee`

Route protection behavior:
- `/auth/me`, `/auth/logout`: any authenticated role with `status=active`.
- `/api/admin/*`: `admin` only.
- `/api/techlead/*`: `admin` or `techlead`.
- `/api/*` (other): any authenticated role.

## Auth Endpoints
POST `/auth/login`
- body: `{ "email": "string", "password": "string" }`
- 200:
```json
{
  "token": "jwt-token-string",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "admin|techlead|employee",
    "status": "active"
  }
}
```
- 400: `{ "error": "invalid_json|invalid_payload" }`
- 401: `{ "error": "invalid_credentials" }`
- 403: `{ "error": "account_inactive|forbidden" }`
- 500: `{ "error": "auth_unavailable" }`

Example:
```http
POST /auth/login
Content-Type: application/json

{"email":"admin@local.dev","password":"admin123"}
```

Windows PowerShell (`curl.exe` + stdin) example:
```powershell
@'
{"email":"admin@local.dev","password":"admin123"}
'@ | curl.exe -sS -X POST "http://localhost:3000/auth/login" `
  -H "Content-Type: application/json" `
  --data-binary @-
```

Windows PowerShell (`Invoke-RestMethod`) example:
```powershell
$body = @{
  email = "admin@local.dev"
  password = "admin123"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/auth/login" `
  -ContentType "application/json" `
  -Body $body
```

POST `/auth/logout`
- requires valid Bearer token
- 204
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive" }`

POST `/auth/change-password`
- requires valid Bearer token
- body: `{ "current_password": "string", "new_password": "string" }`
- 200: `{ "ok": true }`
- 400: `{ "error": "invalid_payload" }`
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "wrong_password" }` — текущий пароль неверный

GET `/auth/me`
- requires valid Bearer token
- 200:
```json
{
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "admin|techlead|employee",
    "status": "active"
  }
}
```
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive|forbidden" }`

Example:
```http
GET /auth/me
Authorization: Bearer <token>
```

Windows PowerShell (`curl.exe`) example:
```powershell
$token = "PASTE_TOKEN_HERE"
curl.exe -sS "http://localhost:3000/auth/me" ^
  -H "Authorization: Bearer $token"
```

## Health
GET `/health`
- 200: `{ "status": "ok" }`

## Projects API
All endpoints require `Authorization: Bearer <token>`.

GET `/projects`
- roles: `admin`, `techlead`, `employee`
- employee sees only projects where they have assigned tasks
- 200:
```json
{
  "active_project_id": "uuid|null",
  "projects": [
    {
      "id": "uuid",
      "name": "string",
      "created_by": "uuid",
      "llm_provider": null,
      "llm_model": null,
      "duration_weeks": 0,
      "budget_total": 0,
      "stages": ["A","R1","R1.1","R2","R3+","F"],
      "stage_settings": [
        { "name": "A", "budget": 200000, "color": "#4a9eff" }
      ],
      "created_at": "timestamp",
      "updated_at": "timestamp"
    }
  ]
}
```
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive|forbidden" }`
- 500: `{ "error": "projects_unavailable" }`

POST `/projects`
- roles: `admin`, `techlead`
- body:
```json
{
  "name": "string",
  "duration_weeks": 10,
  "budget_total": 5000000,
  "stages": ["A","R1","R1.1","R2","R3+","F"],
  "stage_settings": [
    { "name": "A", "budget": 1000000, "color": "#4a9eff" }
  ],
  "responsible_user_id": "uuid|null"
}
```
- `responsible_user_id` (optional): UUID зарегистрированного пользователя — ответственный за проект. По умолчанию используется `created_by`.
- 201:
```json
{
  "project": {
    "id": "uuid",
    "name": "string",
    "created_by": "uuid",
    "llm_provider": null,
    "llm_model": null,
    "duration_weeks": 10,
    "budget_total": 5000000,
    "stages": ["A","R1","R1.1","R2","R3+","F"],
    "stage_settings": [
      { "name": "A", "budget": 1000000, "color": "#4a9eff" }
    ],
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
- 400: `{ "error": "invalid_payload" }`
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive|forbidden" }`
- 500: `{ "error": "projects_unavailable" }`

GET `/projects/:id`
- roles: `admin`, `techlead`, `employee`
- employee can access only visible projects (where employee has assigned tasks)
- 200:
```json
{
  "project": {
    "id": "uuid",
    "name": "string",
    "created_by": "uuid",
    "llm_provider": null,
    "llm_model": null,
    "duration_weeks": 10,
    "budget_total": 5000000,
    "stages": ["A","R1","R1.1","R2","R3+","F"],
    "stage_settings": [
      { "name": "A", "budget": 1000000, "color": "#4a9eff" }
    ],
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
- 400: `{ "error": "invalid_project_id" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "projects_unavailable" }`

GET `/projects/:id/snapshot`
- roles: `admin`, `techlead`, `employee`
- Возвращает снапшот проекта в Markdown. Если снапшота нет — генерирует и сохраняет.
- 200:
```json
{
  "snapshot_md": "string",
  "snapshot_updated_at": "timestamp"
}
```
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "snapshot_unavailable" }`

POST `/projects/:id/snapshot/refresh`
- roles: `admin`, `techlead`, `employee`
- Принудительная регенерация снапшота.
- 200: `{ "snapshot_md": "string", "snapshot_updated_at": "timestamp" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "snapshot_unavailable" }`

GET `/tasks/:id/dependencies`
- roles: `admin`, `techlead`, `employee`
- Возвращает массив задач, от которых зависит данная задача.
- 200: `[{ "id": "uuid", "public_id": 1, "title": "string", "col": "string", "stage": "string" }, ...]`
- 404: `{ "error": "task_not_found|project_not_found" }`

POST `/tasks/:id/dependencies`
- roles: `admin`, `techlead`
- body: `{ "depends_on_task_id": "uuid" }`
- Добавляет зависимость. Проверка на циклы (BFS).
- 201: `{ "id": "uuid", "task_id": "uuid", "depends_on_task_id": "uuid", "created_at": "timestamp" }`
- 400: `{ "error": "invalid_payload" }` — некорректный или самозависимость
- 404: `{ "error": "task_not_found|depends_on_task_not_found|project_not_found" }`
- 409: `{ "error": "cyclic_dependency|already_exists" }`

DELETE `/tasks/:id/dependencies/:depId`
- roles: `admin`, `techlead`
- Удаляет зависимость. `depId` — UUID задачи, от которой зависели (`depends_on_task_id`).
- 204: No Content
- 404: `{ "error": "task_not_found|dependency_not_found|project_not_found" }`
- 500: `{ "error": "dependencies_unavailable" }`

PATCH `/projects/:id`
- roles: `admin`, `techlead`
- body: same as `POST /projects`
- 200: `{ "project": { ... } }`
- 400: `{ "error": "invalid_project_id|invalid_payload" }`
- 404: `{ "error": "project_not_found" }`
- 409: `{ "error": "stages_in_use", "stages": [{ "name": "A", "count": 3 }] }`
- 500: `{ "error": "projects_unavailable" }`

GET `/api/assignable-users`
- roles: `admin`, `techlead`
- Возвращает список пользователей для выбора ответственного за проект.
- 200: `{ "users": [{ "id": "uuid", "email": "string" }, ...] }`

PATCH `/projects/:id/assign`
- roles: `admin` only
- Назначить/сменить ответственного за проект. При смене права на метрики, историю и корзину передаются новому ответственному.
- body: `{ "responsible_user_id": "uuid|null" }`
- 200: `{ "project": { ... } }`
- 400: `{ "error": "invalid_project_id|invalid_user_id" }`
- 404: `{ "error": "project_not_found|user_not_found" }`

DELETE `/projects/:id`
- roles: `admin`, `techlead`
- body:
```json
{
  "confirm_name": "Exact Project Name"
}
```
- `confirm_name` must match project name exactly (100%).
- Deletes project and all linked tasks/events/active mappings via DB cascade.
- 200:
```json
{
  "deleted_project_id": "uuid",
  "deleted_project_name": "Exact Project Name",
  "deleted_tasks": 5
}
```
- 400: `{ "error": "invalid_project_id|invalid_payload" }`
- 404: `{ "error": "project_not_found" }`
- 409: `{ "error": "project_name_mismatch" }`
- 500: `{ "error": "projects_unavailable" }`

GET `/projects/active`
- roles: `admin`, `techlead`, `employee`
- returns active project resolved per user (fallback to first visible project)
- 200:
```json
{
  "id": "uuid|null",
  "name": "string",
  "duration_weeks": 10,
  "budget_total": 5000000,
  "stages": ["A","R1","R1.1","R2","R3+","F"],
  "stage_settings": [
    { "name": "A", "budget": 1000000, "color": "#4a9eff" }
  ]
}
```
- 500: `{ "error": "projects_unavailable" }`

POST `/projects/:id/recalculate-duration`
- roles: `admin`, `techlead`
- пересчитывает `duration_weeks` из суммы часов задач: `ceil(sum(hours) / 9)` (9 ч/неделю). Вызывается автоматически после импорта.
- 200: `{ "duration_weeks": N, "project": {...} }`

POST `/projects/activate`
- roles: `admin`, `techlead`, `employee`
- body: `{ "project_id": "uuid|null" }`
- 200:
```json
{
  "project": {
    "id": "uuid",
    "name": "string"
  }
}
```
- 400: `{ "error": "invalid_payload" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "projects_unavailable" }`

## Tasks API
All endpoints require `Authorization: Bearer <token>`.

### ID задачи (task_code) и зависимости (deps)

**ID задачи (task_code)** — опциональное поле задачи, короткий (до 10 символов) внутренний идентификатор **в рамках проекта**. Уникален в пределах одного проекта. Примеры: `E0-01`, `R1-042`. Используется для отображения на карточках и для указания зависимостей по коду.

**Зависимости (deps)** — объект вида `{ "blocks": ["uuid1", "uuid2", ...] }`. В запросах создания/обновления задачи в `blocks` можно передавать как UUID задач, так и их **коды (task_code)**; сервер разрешает коды в UUID в рамках того же проекта. Задача не может быть переведена в колонки `todo` или `doing`, пока все задачи из `deps.blocks` не находятся в колонке `done`; при попытке такого перемещения возвращается 409 `task_blocked_by_deps` с полем `message` для отображения пользователю.

Audit behavior for task mutations:
- `POST /projects/:projectId/tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/move`, `PATCH /tasks/reorder`, `DELETE /tasks/:id` write audit rows to `task_events`.
- event types for core task flow: `task_created`, `task_updated`, `task_moved`, `task_reordered`, `task_deleted`.
- Stored fields: `actor_user_id`, `event_type`, `payload` (+ legacy `action`, `before`, `after`), `created_at`.
- Task change and audit insert are committed in a single DB transaction.

GET `/projects/:projectId/tasks`
- roles: `admin`, `techlead`, `employee`
- employee sees only tasks where `assignee_user_id = current user id`
- order: `ORDER BY col, position, created_at`
- 200:
```json
{
  "tasks": [
    {
      "id": "uuid",
      "public_id": 123,
      "project_id": "uuid",
      "title": "string",
      "task_code": "E0-01",
      "col": "backlog|todo|doing|review|done",
      "position": 0,
      "stage": "string|null",
      "assignee_user_id": "uuid|null",
      "track": "string|null",
      "agent": "string|null",
      "priority": 0,
      "hours": 1.5,
      "size": "XS|S|M|L|XL|null",
      "descript": "string|null",
      "notes": "string|null",
      "deps": {},
      "created_at": "timestamp",
      "updated_at": "timestamp"
    }
  ]
}
```
- 400: `{ "error": "invalid_project_id" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "tasks_unavailable" }`

GET `/projects/:projectId/events`
- roles: `admin`, `techlead`
- query:
  - `limit` (optional, default `100`, max `500`)
  - `offset` (optional, default `0`)
  - `from` (optional, ISO date) — события с даты
  - `to` (optional, ISO date) — события по дату
  - `event_type` (optional) — один тип или `event_types` — несколько через запятую (task_created, task_updated, task_moved, task_reordered, task_deleted, agent_action)
  - `q` (optional) — поиск по event_type, task_id, payload
- 200:
```json
{
  "events": [
    {
      "event_type": "task_moved",
      "payload": { "from_col": "todo", "to_col": "doing" },
      "actor_user_id": "uuid",
      "actor_email": "user@example.com",
      "task_id": "uuid",
      "created_at": "timestamp",
      "before": {},
      "after": {}
    }
  ],
  "limit": 100,
  "offset": 0
}
```
- 400: `{ "error": "invalid_project_id|invalid_payload" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "events_unavailable" }`

POST `/projects/:projectId/history-retention`
- roles: `admin`, `techlead`
- body: `{ "retention_months": 3 | 6 | null }` — срок хранения истории (3, 6 месяцев или null = без ограничения)
- Обновляет настройку и **удаляет** события старше указанного срока. Раз в час для всех проектов выполняется автоочистка.
- 200: `{ "project": {...}, "deleted_events": N }`
- 400: `{ "error": "invalid_project_id|invalid_payload" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "schema_outdated|history_retention_unavailable" }`

GET `/projects/:projectId/metrics`
- roles: `admin`, `techlead`, `employee`
- 200:
```json
{
  "tasks_total": 120,
  "tasks_done": 45,
  "tasks_in_progress": 12,
  "completion_percent": 37.5,
  "velocity_tasks_per_week": 9.2,
  "avg_task_cycle_time_hours": 18.4,
  "tasks_created_last_week": 11,
  "tasks_completed_last_week": 9
}
```
- metrics are aggregated from `tasks`, `task_events` and timer state.
- 400: `{ "error": "invalid_project_id" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "metrics_unavailable" }`

POST `/projects/:projectId/tasks`
- roles: `admin`, `techlead`
- body (minimum):
```json
{
  "title": "Implement API",
  "col": "todo"
}
```
- `task_code`: optional `string`, max 10 chars; internal task ID within project (unique per project). Used for dependencies by code (e.g. `deps.blocks: ["E0-01","E0-02"]`).
- `status` can be used as alias for `col`
- `descript` is the canonical DB-backed description field.
- Backward compatibility: request payload can use `descript` or `description`.
- `descript`: optional `string`, max length `5000`.
- `deps.blocks`: array of task UUIDs or task codes; server resolves codes to UUIDs in the same project.
- 201: `{ "task": { ...task } }`
- 400: `{ "error": "invalid_project_id|invalid_payload|task_code_duplicate", "message": "ID задачи уже используется в этом проекте" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "tasks_unavailable" }`

PATCH `/tasks/:id`
- roles: `admin`, `techlead`
- body: any mutable task fields (`title`, `task_code`, `col`/`status`, `stage`, `assignee_user_id`, `track`, `agent`, `priority`, `hours`, `size`, `descript`, `description`, `notes`, `deps`)
- `task_code`: optional `string`, max 10 chars; unique per project.
- `descript`: optional `string`, max length `5000`.
- `deps.blocks`: array of task UUIDs or task codes; server resolves codes to UUIDs.
- 200: `{ "task": { ...task } }`
- 400: `{ "error": "invalid_task_id|invalid_payload|task_code_duplicate", "message": "ID задачи уже используется в этом проекте" }`
- 404: `{ "error": "task_not_found" }`
- 500: `{ "error": "tasks_unavailable" }`

PATCH `/tasks/reorder`
- roles: `admin`, `techlead`
- body:
```json
{
  "column": "todo",
  "order": ["uuid-1", "uuid-2", "uuid-3"]
}
```
- `column` supports same values as `col/status` (`backlog|todo|doing|review|done`, plus aliases).
- `order` must be UUID array of tasks from one project and one column.
- 200:
```json
{
  "column": "todo",
  "updated": 3
}
```
- 400: `{ "error": "invalid_payload" }`
- 404: `{ "error": "task_not_found" }`
- 409: `{ "error": "task_column_mismatch" }`
- 500: `{ "error": "tasks_unavailable" }`

GET `/tasks/:id/events`
- roles: `admin`, `techlead`
- 200:
```json
[
  {
    "event_type": "task_reordered",
    "payload": {
      "column": "todo",
      "order": ["uuid-1", "uuid-2", "uuid-3"],
      "position": 1
    },
    "actor_user_id": "uuid",
    "created_at": "timestamp"
  }
]
```
- 400: `{ "error": "invalid_task_id" }`
- 500: `{ "error": "events_unavailable" }`

## Task chat (persistent techlead chat per task)

GET `/tasks/:id/chat`
- roles: `admin`, `techlead`
- 200:
```json
{
  "messages": [
    {
      "id": "uuid",
      "role": "user|assistant",
      "content": "string",
      "action": { "col": "doing", "stage": "R1" } | null,
      "action_applied": false,
      "created_at": "timestamp"
    }
  ]
}
```
- 400: `{ "error": "invalid_task_id" }`
- 404: `{ "error": "task_not_found" }`
- 500: `{ "error": "chat_unavailable" }`

POST `/tasks/:id/chat`
- roles: `admin`, `techlead`
- body: `{ "content": "string" }`
- Saves user message, calls LLM with task context + history; assistant reply may include suggested task changes in `action` (JSON object of PATCH fields).
- 200:
```json
{
  "message": {
    "id": "uuid",
    "role": "assistant",
    "content": "string",
    "action": { "col": "doing" } | null,
    "action_applied": false,
    "created_at": "timestamp"
  }
}
```
- 400: `{ "error": "invalid_task_id|invalid_payload" }`
- 404: `{ "error": "task_not_found" }`
- 429: `{ "error": "rate_limited" }`
- 500: `{ "error": "chat_unavailable" }`

POST `/tasks/:id/chat/apply/:messageId`
- roles: `admin`, `techlead`
- Applies the `action` stored on the given chat message to the task (same as PATCH /tasks/:id with those fields), then sets `action_applied=true` on the message.
- 200: `{ "task": { ...task } }`
- 400: `{ "error": "invalid_task_id|invalid_payload" }`
- 404: `{ "error": "task_not_found|message_not_found" }`
- 409: `{ "error": "action_already_applied" }`
- 500: `{ "error": "tasks_unavailable" }`

DELETE `/tasks/:id`
- roles: `admin`, `techlead`
- moves task to `task_trash` archive before deleting from active board.
- 200:
```json
{
  "deleted_task_id": "uuid",
  "deleted_public_id": 123
}
```
- 400: `{ "error": "invalid_task_id" }`
- 404: `{ "error": "task_not_found" }`
- 500: `{ "error": "tasks_unavailable" }`

GET `/tasks/trash`
- roles: `admin`, `techlead`
- query params (optional):
  - `q`: full-text search by `id/title/descript/notes/stage/agent`
  - `project_id`: UUID
  - `stage`: stage name
  - `deleted_by`: deleter identifier/email/name
  - `deleted_from`: ISO date (`YYYY-MM-DD`)
  - `deleted_to`: ISO date (`YYYY-MM-DD`)
  - `limit`: integer (default `100`)
- 200:
```json
{
  "items": [
    {
      "id": "uuid",
      "public_id": 123,
      "title": "Task title",
      "col": "backlog|todo|doing|review|done",
      "stage": "A",
      "agent": "Claude",
      "size": "M",
      "hours": 8,
      "descript": "string|null",
      "notes": "string|null",
      "project_id": "uuid",
      "project_name": "Project name",
      "deleted_at": "timestamp",
      "deleted_by_name": "Admin"
    }
  ]
}
```
- 400: `{ "error": "invalid_payload" }`
- 500: `{ "error": "trash_unavailable" }`

POST `/tasks/:id/restore`
- roles: `admin`, `techlead`
- body:
```json
{
  "project_id": "uuid",
  "col": "backlog|todo|doing|review|done",
  "stage": "A",
  "create_stage_if_missing": false
}
```
- `project_id`, `col`, `stage` are required.
- if `create_stage_if_missing=true`, backend may create stage in target project settings before restore.
- 200:
```json
{
  "task": {
    "id": "uuid",
    "public_id": 123,
    "project_id": "uuid",
    "col": "doing",
    "stage": "A"
  }
}
```
- 400: `{ "error": "invalid_task_id|invalid_payload" }`
- 404: `{ "error": "task_not_found" }`
- 409: `{ "error": "stage_not_found" }`
- 500: `{ "error": "restore_unavailable" }`

DELETE `/tasks/:id/permanent`
- roles: `admin`, `techlead`
- permanently deletes task from trash storage.
- 200:
```json
{
  "deleted_task_id": "uuid"
}
```
- 400: `{ "error": "invalid_task_id" }`
- 404: `{ "error": "task_not_found" }`
- 500: `{ "error": "tasks_unavailable" }`

POST `/tasks/:id/move`
- roles: `admin`, `techlead`
- body: `{ "col": "doing" }` or `{ "status": "doing" }`
- Moving to `doing` or `todo` is blocked if the task has `deps.blocks` and any of those tasks are not in `done`. Then the API returns 409.
- 200: `{ "task": { ...task } }`
- 400: `{ "error": "invalid_task_id|invalid_payload" }`
- 404: `{ "error": "task_not_found" }`
- 409: `{ "error": "task_blocked_by_deps", "message": "Сначала завершите зависимости: E0-01, E0-02" }`
- 500: `{ "error": "tasks_unavailable" }`

PowerShell (`curl.exe`) examples:
```powershell
$token = "PASTE_TOKEN_HERE"
$projectId = "PASTE_PROJECT_ID"
$taskId = "PASTE_TASK_ID"

curl.exe -sS "http://localhost:3000/projects" `
  -H "Authorization: Bearer $token"

@'
{"name":"Backend Project"}
'@ | curl.exe -sS -X POST "http://localhost:3000/projects" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  --data-binary @-

curl.exe -sS "http://localhost:3000/projects/$projectId/tasks" `
  -H "Authorization: Bearer $token"

@'
{"title":"Implement tasks API","col":"todo","priority":1}
'@ | curl.exe -sS -X POST "http://localhost:3000/projects/$projectId/tasks" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  --data-binary @-

@'
{"title":"Implement tasks API (v2)","priority":2}
'@ | curl.exe -sS -X PATCH "http://localhost:3000/tasks/$taskId" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  --data-binary @-

@'
{"status":"doing"}
'@ | curl.exe -sS -X POST "http://localhost:3000/tasks/$taskId/move" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  --data-binary @-
```

## Header Stats API
All endpoints require `Authorization: Bearer <token>`.

GET `/stats/tasks`
- roles: `admin`, `techlead`, `employee`
- uses user active project (`/projects/active`)
- employee scope: counts only assigned tasks
- 200:
```json
{
  "backlog": 10,
  "in_work": 5,
  "done": 3
}
```
- 500: `{ "error": "stats_unavailable" }`

GET `/stats/budget`
- roles: `admin`, `techlead`, `employee`
- budget logic: each configured project stage contributes `budget_total / stages.length` when all tasks in that stage are `done`
- 200:
```json
{
  "earned": 1000000,
  "total": 5000000,
  "progress": 0.2
}
```
- 500: `{ "error": "stats_unavailable" }`

## Timer API
All endpoints require `Authorization: Bearer <token>`.

GET `/timer`
- roles: `admin`, `techlead`, `employee`
- 200:
```json
{
  "project_time": "P0DT12H35M10S",
  "client_delay_time": "P0DT1H11M3S",
  "project_time_ms": 45310000,
  "client_delay_time_ms": 4263000,
  "deadline": "2026-06-01T10:20:30.000Z",
  "status": "running|paused"
}
```

POST `/timer/start`
- roles: `admin`, `techlead`
- starts project timer on server; if paused, resumes and closes delay interval
- 200: same payload as `GET /timer`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "timer_unavailable" }`

POST `/timer/stop`
- roles: `admin`, `techlead`
- pauses project timer and starts/continues client delay timer
- 200: same payload as `GET /timer`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "timer_unavailable" }`

POST `/timer/complete`
- roles: `admin`, `techlead`
- freezes both project and client delay timers (used for "project completed" mode)
- 200: same payload as `GET /timer`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "timer_unavailable" }`

## Import and Task Dialog API
All endpoints require `Authorization: Bearer <token>`.

POST `/import/excel`
- roles: `admin`, `techlead`
- body:
```json
{
  "project_id": "uuid-optional",
  "file_name": "tasks.xlsx",
  "content": "parsed excel/text payload"
}
```
- flow: parse content via LLM (`purpose=import_parse`) and create backlog tasks
- 201:
```json
{
  "created": 12,
  "tasks": [ { "id": "uuid", "title": "..." } ]
}
```
- 400: `{ "error": "invalid_payload|empty_import" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "import_unavailable" }`

POST `/import/async`
- roles: `admin`, `techlead`
- body: same as `POST /import/excel` (project_id, file_name, content)
- запускает асинхронный импорт, возвращает job_id сразу
- 202: `{ "job_id": "uuid" }`
- 400/404/500: как у `/import/excel`

GET `/import/status/:jobId`
- roles: `admin`, `techlead`
- 200: `{ "status": "pending|running|done|error", "created": N, "error": "string|null" }`
- 404: `{ "error": "job_not_found" }`

GET `/import/jobs`
- roles: `admin`, `techlead`
- список последних заданий импорта
- 200: `{ "jobs": [ { "id": "uuid", "status": "...", "created_at": "timestamp", ... } ] }`

POST `/llm/task-dialog`
- roles: `admin`, `techlead` (`employee` gets `403`)
- body:
```json
{
  "project_id": "uuid-optional",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```
- 200:
```json
{
  "title": "string",
  "descript": "string",
  "stage": "string",
  "priority": 2
}
```
- 400: `{ "error": "invalid_payload" }`
- 403: `{ "error": "forbidden" }`
- 429: `{ "error": "rate_limited" }`
- 502: `{ "error": "llm_unavailable" }`
- 500: `{ "error": "internal_error" }`

## LLM Gateway API
All endpoints require `Authorization: Bearer <token>`.

Provider/model resolution:
- `provider` and `model` from request are used if provided.
- otherwise fallback to `LLM_DEFAULT_PROVIDER` and `LLM_DEFAULT_MODEL`.
- project-level provider/model settings are not used yet.
- `GET /api/llm/models?provider=anthropic` returns:
  - models from `LLM_ALLOWED_MODELS_ANTHROPIC` (CSV), if set
  - otherwise built-in minimal list.

Rate limit:
- in-memory per-user limit for `/api/llm/chat`
- default: `30` requests per minute (env: `LLM_RATE_LIMIT_PER_MINUTE`)
- over limit: `429 { "error": "rate_limited" }`

Provider adapter (anthropic):
- if `CLOUDFLARE_WORKER_URL` is set: POST `{CLOUDFLARE_WORKER_URL}/v1/messages`
  - headers: `x-kanban-secret`, `x-api-key`
- otherwise: POST `https://api.anthropic.com/v1/messages`
  - headers: `x-api-key`, `anthropic-version: 2023-06-01`
- `system` messages are joined into one `system` string; only `user|assistant` stay in `messages`.
- provider error body is not exposed to API clients.

Missing key + stub behavior:
- if `ANTHROPIC_API_KEY` is missing/empty and `LLM_STUB_MODE=1`:
  - `200 OK` with predictable `text = "LLM_STUB_OK"`
  - `llm_requests.status='ok'`, `response_meta.stub=true`
- if `ANTHROPIC_API_KEY` is missing/empty and stub mode is off:
  - `502 { "error": "llm_unavailable" }`
  - `llm_requests.status='error'`, `error_code='missing_api_key'`

POST `/api/llm/chat`
- roles:
  - `admin`, `techlead`: `purpose = new_task|import_parse|chat`
  - `employee`: `purpose = chat` only
- body:
```json
{
  "purpose": "chat",
  "project_id": "uuid-optional",
  "stream": false,
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Draft 3 task ideas." }
  ],
  "params": {
    "temperature": 0.2,
    "max_tokens": 512
  }
}
```
- 200:
```json
{
  "text": "assistant text",
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "usage": {
    "input_tokens": 123,
    "output_tokens": 45
  },
  "request_id": "uuid"
}
```
- 400: `{ "error": "invalid_payload" }`
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "forbidden|account_inactive" }`
- 429: `{ "error": "rate_limited" }`
- 502: `{ "error": "llm_unavailable" }`
- 500: `{ "error": "internal_error" }`

When `stream: true`, the response is `Content-Type: text/event-stream` with SSE events:
- `data: {"type":"delta","text":"..."}` — text chunks (provider-agnostic)
- `data: {"type":"done","text":"full text","provider":"...","model":"...","usage":{...},"request_id":"uuid"}` — final event

If the provider does not support streaming, the server falls back to a regular JSON response.

GET `/api/llm/models?provider=anthropic`
- roles: any authenticated role
- 200:
```json
{
  "provider": "anthropic",
  "models": [
    "claude-sonnet-4",
    "claude-3-5-sonnet-latest"
  ]
}
```
- 400: `{ "error": "invalid_payload" }`
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive|forbidden" }`

PowerShell (`curl.exe`) examples:
```powershell
$token = "PASTE_TOKEN_HERE"

curl.exe -sS "http://localhost:3000/api/llm/models?provider=anthropic" `
  -H "Authorization: Bearer $token"

@'
{
  "purpose": "chat",
  "messages": [
    { "role": "system", "content": "You are a concise PM assistant." },
    { "role": "user", "content": "Give me 3 backlog task ideas for auth hardening." }
  ],
  "params": { "temperature": 0.2, "max_tokens": 256 }
}
'@ | curl.exe -sS -X POST "http://localhost:3000/api/llm/chat" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  --data-binary @-
```

PowerShell (`Invoke-RestMethod`) examples:
```powershell
$token = "PASTE_TOKEN_HERE"
$headers = @{ Authorization = "Bearer $token" }

Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/api/llm/models?provider=anthropic" `
  -Headers $headers

$body = @{
  purpose = "chat"
  messages = @(
    @{ role = "system"; content = "You are a concise PM assistant." }
    @{ role = "user"; content = "Give me 3 backlog task ideas for auth hardening." }
  )
  params = @{
    temperature = 0.2
    max_tokens = 256
  }
} | ConvertTo-Json -Depth 6 -Compress

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/llm/chat" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

## Service Accounts API (Agent Access)
Service endpoints are backend-only and use user JWT auth for management.

POST `/api/service-accounts`
- auth: `Authorization: Bearer <admin-jwt>`
- body:
```json
{
  "name": "Codex Runner",
  "scopes": ["tasks:read", "tasks:comment", "tasks:move", "tasks:write", "events:read"]
}
```
- 201 (token is returned once):
```json
{
  "id": "uuid",
  "name": "Codex Runner",
  "scopes": ["tasks:read", "tasks:comment"],
  "token": "service-token"
}
```
- 400: `{ "error": "invalid_payload" }`
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive|forbidden" }`
- 500: `{ "error": "internal_error" }`

GET `/api/service-accounts`
- auth: `Authorization: Bearer <admin-jwt>`
- 200:
```json
{
  "service_accounts": [
    {
      "id": "uuid",
      "name": "Codex Runner",
      "scopes": ["tasks:read", "tasks:comment"],
      "created_at": "timestamp",
      "revoked_at": null
    }
  ]
}
```
- no token/token_hash in response.

PowerShell (`curl.exe`) create example:
```powershell
$adminToken = "PASTE_ADMIN_JWT"
@'
{
  "name": "Codex Runner",
  "scopes": ["tasks:read","tasks:comment","tasks:move","tasks:write","events:read"]
}
'@ | curl.exe -sS -X POST "http://localhost:3000/api/service-accounts" `
  -H "Authorization: Bearer $adminToken" `
  -H "Content-Type: application/json" `
  --data-binary @-
```

PowerShell (`Invoke-RestMethod`) create example:
```powershell
$adminToken = "PASTE_ADMIN_JWT"
$headers = @{ Authorization = "Bearer $adminToken" }
$body = @{
  name = "Codex Runner"
  scopes = @("tasks:read","tasks:comment","tasks:move","tasks:write","events:read")
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/service-accounts" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

## Agent IN Gateway
Agent endpoints use service token auth:
- header: `x-service-token: <service-token>`
- scope checks:
  - `tasks:read` -> `GET /api/agent/context`
  - `tasks:comment` -> `task_comment`, `task_link_artifact`
  - `tasks:move` -> `task_move`
  - `tasks:write` -> `task_patch`, `task_create`
  - `events:read` -> `GET /api/events`

POST `/api/agent/actions`
- auth: service token
- body:
```json
{
  "idempotency_key": "run-2026-03-05-001",
  "run_id": "uuid-optional",
  "agent": { "name": "codex", "role": "executor" },
  "actions": [
    {
      "type": "task_comment",
      "payload": {
        "task_id": "uuid",
        "text": "Started implementation",
        "format": "markdown",
        "tags": ["progress", "agent"]
      }
    }
  ]
}
```
- 200:
```json
{
  "gateway_request_id": "uuid",
  "results": [
    { "action_index": 0, "status": "ok", "task_id": "uuid" }
  ]
}
```
- idempotency: if `(service_account_id, idempotency_key)` exists, returns stored `response_json` without re-executing actions.
- errors: `400 invalid_payload`, `401 unauthorized`, `403 forbidden`, `500 internal_error`.

PowerShell (`curl.exe`) example:
```powershell
$serviceToken = "PASTE_SERVICE_TOKEN"
@'
{
  "idempotency_key": "demo-001",
  "agent": { "name": "codex", "role": "executor" },
  "actions": [
    {
      "type": "task_comment",
      "payload": {
        "task_id": "PASTE_TASK_UUID",
        "text": "Agent comment",
        "format": "text"
      }
    }
  ]
}
'@ | curl.exe -sS -X POST "http://localhost:3000/api/agent/actions" `
  -H "x-service-token: $serviceToken" `
  -H "Content-Type: application/json" `
  --data-binary @-
```

PowerShell (`Invoke-RestMethod`) example:
```powershell
$serviceToken = "PASTE_SERVICE_TOKEN"
$headers = @{ "x-service-token" = $serviceToken }
$body = @{
  idempotency_key = "demo-001"
  agent = @{ name = "codex"; role = "executor" }
  actions = @(
    @{
      type = "task_comment"
      payload = @{
        task_id = "PASTE_TASK_UUID"
        text = "Agent comment"
        format = "text"
      }
    }
  )
} | ConvertTo-Json -Depth 8 -Compress

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/api/agent/actions" `
  -Headers $headers `
  -ContentType "application/json" `
  -Body $body
```

GET `/api/agent/context?task_id=<uuid>`
- auth: service token + `tasks:read`
- 200:
```json
{
  "task": { "id": "uuid", "project_id": "uuid", "title": "..." },
  "project": { "id": "uuid", "name": "..." },
  "allowed_transitions": [],
  "capabilities": { "scopes": ["tasks:read"] }
}
```
- currently `allowed_transitions` is empty (`[]`) until explicit transitions model is added.

PowerShell (`curl.exe`) context example:
```powershell
$serviceToken = "PASTE_SERVICE_TOKEN"
$taskId = "PASTE_TASK_UUID"
curl.exe -sS "http://localhost:3000/api/agent/context?task_id=$taskId" `
  -H "x-service-token: $serviceToken"
```

PowerShell (`Invoke-RestMethod`) context example:
```powershell
$serviceToken = "PASTE_SERVICE_TOKEN"
$taskId = "PASTE_TASK_UUID"
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/api/agent/context?task_id=$taskId" `
  -Headers @{ "x-service-token" = $serviceToken }
```

## Events Feed (OUT Polling)
GET `/api/events?since=<timestamptz>&limit=<int>`
- auth: service token + `events:read`
- `limit`: default `50`, max `200`
- `since`: optional; filter `created_at > since`
- sort: `created_at ASC`
- 200:
```json
{
  "events": [
    {
      "id": "uuid",
      "type": "agent_action",
      "task_id": "uuid",
      "project_id": "uuid",
      "created_at": "timestamp",
      "meta": {}
    }
  ]
}
```
- errors: `400 invalid_payload`, `401 unauthorized`, `403 forbidden`, `500 internal_error`.

PowerShell (`curl.exe`) events example:
```powershell
$serviceToken = "PASTE_SERVICE_TOKEN"
curl.exe -sS "http://localhost:3000/api/events?limit=50" `
  -H "x-service-token: $serviceToken"
```

PowerShell (`Invoke-RestMethod`) events example:
```powershell
$serviceToken = "PASTE_SERVICE_TOKEN"
Invoke-RestMethod -Method Get `
  -Uri "http://localhost:3000/api/events?since=2026-03-05T00:00:00Z&limit=50" `
  -Headers @{ "x-service-token" = $serviceToken }
```

## Admin API
All admin endpoints require `Authorization: Bearer <admin-jwt>` and role `admin`.

### Пользователи
GET `/api/admin/users`
- 200: `{ "users": [ { "id": "uuid", "email": "string", "role": "string", "status": "string" }, ... ] }`

POST `/api/admin/users`
- body: `{ "email": "string", "password": "string", "role": "admin|techlead|employee" }`
- 201: `{ "user": { ... } }`

PATCH `/api/admin/users/:id`
- body: `{ "email": "string", "role": "string", "status": "string" }`
- 200: `{ "user": { ... } }`

POST `/api/admin/users/:id/transfer`
- перенос задач пользователя другому пользователю
- body: `{ "target_user_id": "uuid" }`

DELETE `/api/admin/users/:id`
- 200: `{ "deleted_user_id": "uuid" }`

### Очистка данных
DELETE `/api/admin/data/events` — очистка task_events
DELETE `/api/admin/data/trash` — очистка task_trash
DELETE `/api/admin/data/llm-stats` — очистка llm_requests
DELETE `/api/admin/data/projects` — удаление всех проектов и связанных данных
DELETE `/api/admin/data/all-stats` — агрегированная очистка событий, корзины, LLM-статистики

- 200: `{ "ok": true, ... }`
- 401/403: как обычно

### Аккаунт
DELETE `/api/admin/account`
- удаление текущего аккаунта админа (требует подтверждения)
