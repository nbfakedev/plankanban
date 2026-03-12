# Architecture

## Components
1) **Web (browser)** — Kanban UI (`index.html`) и страница входа (`login.html`). Вызывает `/api/` для задач, проектов, таймеров, LLM. JWT в `localStorage` (`pk24_token`).
2) **API (Timeweb VPS, Node.js)** — Postgres-backed server with session/JWT authentication, RBAC (admin/techlead/employee), projects/tasks/audit CRUD, multi-user bookkeeping, and an LLM gateway that dynamically selects provider/model, applies rate limits, and surfaces fail-state messaging.
3) **DB (Postgres)** — Persistent storage: users/roles, projects, tasks (в т.ч. task_code), task_events, task_trash, task_chats, llm_requests, service_accounts, project_timers.
4) **LLM provider bridge** — API decides provider/model per request; optional worker or proxy enforces shared secrets, TLS, retry logic, and logs limited metadata.

## Data flows
A) UI → API → DB: user actions (auth, project/task CRUD, role assignment) persist via Postgres and return audit events.
B) UI → API (LLM gateway) → Provider: the gateway normalizes prompts/responses, records usage, and lets the API pick provider/model (Claude, OpenAI, etc.).
C) Agent (service token) → API (Agent IN Gateway) → task_comment, task_move, task_patch; idempotency via agent_idempotency.

## Nonfunctional
- Server deployment lives on Timeweb VPS with nginx + HTTPS; TLS certificates, PM2, and rollback scripts are part of `infra/`.
- Postgres ensures server-side storage; RBAC keeps users scoped to admin/techlead/employee capabilities.
- LLM errors and provider limits are surfaced to users (no silent failures); logs avoid secrets and payload dumps.
