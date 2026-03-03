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
  "projects": [
    {
      "id": "uuid",
      "name": "string",
      "created_by": "uuid",
      "llm_provider": null,
      "llm_model": null,
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
- body: `{ "name": "string" }`
- 201:
```json
{
  "project": {
    "id": "uuid",
    "name": "string",
    "created_by": "uuid",
    "llm_provider": null,
    "llm_model": null,
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
    "created_at": "timestamp",
    "updated_at": "timestamp"
  }
}
```
- 400: `{ "error": "invalid_project_id" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "projects_unavailable" }`

## Tasks API
All endpoints require `Authorization: Bearer <token>`.

Audit behavior for task mutations:
- `POST /projects/:projectId/tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/move` write one row to `task_events`.
- Stored fields: `actor_user_id`, `action` (`create|update|move`), `before` (JSON), `after` (JSON), `created_at`.
- Task change and audit insert are committed in a single DB transaction.

GET `/projects/:projectId/tasks`
- roles: `admin`, `techlead`, `employee`
- employee sees only tasks where `assignee_user_id = current user id`
- 200:
```json
{
  "tasks": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "title": "string",
      "col": "backlog|todo|doing|review|done",
      "stage": "string|null",
      "assignee_user_id": "uuid|null",
      "track": "string|null",
      "agent": "string|null",
      "priority": 0,
      "hours": 1.5,
      "desc": "string|null",
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

POST `/projects/:projectId/tasks`
- roles: `admin`, `techlead`
- body (minimum):
```json
{
  "title": "Implement API",
  "col": "todo"
}
```
- `status` can be used as alias for `col`
- 201: `{ "task": { ...task } }`
- 400: `{ "error": "invalid_project_id|invalid_payload" }`
- 404: `{ "error": "project_not_found" }`
- 500: `{ "error": "tasks_unavailable" }`

PATCH `/tasks/:id`
- roles: `admin`, `techlead`
- body: any mutable task fields (`title`, `col`/`status`, `stage`, `assignee_user_id`, `track`, `agent`, `priority`, `hours`, `desc`, `notes`, `deps`)
- 200: `{ "task": { ...task } }`
- 400: `{ "error": "invalid_task_id|invalid_payload" }`
- 404: `{ "error": "task_not_found" }`
- 500: `{ "error": "tasks_unavailable" }`

POST `/tasks/:id/move`
- roles: `admin`, `techlead`
- body: `{ "col": "doing" }` or `{ "status": "doing" }`
- 200: `{ "task": { ...task } }`
- 400: `{ "error": "invalid_task_id|invalid_payload" }`
- 404: `{ "error": "task_not_found" }`
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

## Not Implemented Yet
- LLM API
