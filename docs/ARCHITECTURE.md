# Architecture (goal)

## Components
1) **Web (browser)** — Kanban UI that only calls `/api/` endpoints for tasks, projects, assignments, and the LLM gateway.
2) **API (Timeweb VPS, Node.js)** — Postgres-backed server with session/JWT authentication, RBAC (admin/techlead/employee), projects/tasks/audit CRUD, multi-user bookkeeping, and an LLM gateway that dynamically selects provider/model, applies rate limits, and surfaces fail-state messaging.
3) **DB (Postgres)** — Persistent storage for users/roles, projects, tasks, task events (audit trail), LLM requests, and configuration metadata.
4) **LLM provider bridge** — API decides provider/model per request; optional worker or proxy enforces shared secrets, TLS, retry logic, and logs limited metadata.

## Data flows
A) UI → API → DB: user actions (auth, project/task CRUD, role assignment) persist via Postgres and return audit events.
B) UI → API (LLM gateway) → Provider: the gateway normalizes prompts/responses, records usage, and lets the API pick provider/model (Claude, OpenAI, etc.).

## Nonfunctional
- Server deployment lives on Timeweb VPS with nginx + HTTPS; TLS certificates, PM2, and rollback scripts are part of `infra/`.
- Postgres ensures server-side storage; RBAC keeps users scoped to admin/techlead/employee capabilities.
- LLM errors and provider limits are surfaced to users (no silent failures); logs avoid secrets and payload dumps.
