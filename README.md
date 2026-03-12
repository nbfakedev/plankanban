# PlanKanban (server edition)

Multi-user Kanban with Postgres storage, role-based auth (admin/techlead/employee), an LLM gateway that lets the API choose provider/model, and a Timeweb VPS deployment with HTTPS.

## Repository layout
- `apps/web/` — lightweight front-end: `index.html` (канбан), `login.html` (вход). Общение с `/api/`.
- `apps/api/` — Node.js backend: Postgres persistence, RBAC, projects/tasks/audit, and an LLM gateway with provider/model selection plus logging and fail-state reporting.
- `infra/` — Timeweb VPS helpers: nginx, TLS certificates, PM2, deployment scripts, and optional gateway proxies.
- `docs/` — requirements, architecture, API, DB/migration guidance (`MIGRATIONS.md`), deployment playbooks, scripts (`SCRIPTS.md`).

## Quick start (local/dev)
1. Install Node.js LTS, Docker, and Postgres tooling.
2. Copy `.env.example` → `.env` and fill credentials for the API, Postgres, and LLM providers.
3. Follow `docs/DEVELOPMENT.md` to run the API, front end, and Postgres locally.

## Deployment
See `docs/DEPLOYMENT.md` for the Timeweb VPS launch checklist (nginx + TLS, Postgres, PM2, LLM gateway) plus rollback guidance.

## Codex workflow (VS Code)
See `AGENTS.md` for branching, PR, testing, and shared UX rules.
