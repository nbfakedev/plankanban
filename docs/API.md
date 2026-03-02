# API (черновой контракт)

## Auth
POST `/api/auth/login`
- body: { email, password }
- 200: { user }
- 401: invalid_credentials

POST `/api/auth/logout`
- 204

GET `/api/auth/me`
- 200: { user }

## Projects
GET `/api/projects`
POST `/api/projects`
PATCH `/api/projects/:id`
DELETE `/api/projects/:id`

## Tasks
GET `/api/projects/:projectId/tasks?stage=&q=&assignee=&track=&agent=`
POST `/api/projects/:projectId/tasks`
PATCH `/api/tasks/:id`
POST `/api/tasks/:id/move` (col/stage)
POST `/api/tasks/:id/complete`

## Audit
GET `/api/projects/:projectId/audit?from=&to=`

## LLM (единый шлюз)
POST `/api/llm/chat`
- body: {
  purpose: "new_task"|"chat"|"import_parse",
  provider: "anthropic"|"openai"|"...",   // можно не передавать, если берём из настроек проекта
  model: "string",
  messages: [{ role: "system"|"user"|"assistant", content: "text" }],
  params: { temperature?: number, max_tokens?: number }
}
- 200: { text, usage?, cost_estimate? }
- 4xx/5xx: { error, details? }

Все изменения контракта фиксировать здесь до реализации.

