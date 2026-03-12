# Project Tasks (backlog)

## P0 — launch plan ✅ (done)
- [x] Repo bootstrap: structure, linting, CI, minimum docs (architecture/API/DB/deployment).
- [x] Timeweb VPS deployment with nginx, HTTPS, PM2, rollback script, and deployment checklist.
- [x] Postgres provisioning: schema, migrations (001–021), connection via API, docs `MIGRATIONS.md`.
- [x] Multi-user auth: login/logout/me/change-password, JWT, RBAC (admin/techlead/employee), `login.html`.
- [x] Projects/Tasks/Audit CRUD: enforce RBAC, audit trail, task_trash, task_chats, server-side storage.
- [x] LLM gateway: provider/model selection, rate limits, stub mode, llm_requests logging.

## P1 — usability
- [ ] LLM tuning: allow switching provider/model from the UI with clear guidance on limits.
- [ ] Filters: agent/track/assignee views.
- [ ] CSV/XLSX export/import for tasks.
- [ ] Dependency links: blocked/blocks relationships.

## P2 — future polish
- [ ] Column/pagination customization for boards.
- [ ] Project membership roles for tasks + RBAC refinements.
- [ ] Task history viewer and export in the front end.

Each task becomes a separate issue with acceptance criteria and a manual test checklist.
