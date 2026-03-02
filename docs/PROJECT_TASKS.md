# Project Tasks (backlog)

## P0 — launch plan
- [ ] Repo bootstrap: structure, linting, CI, minimum docs (architecture/API/DB/deployment).
- [ ] Timeweb VPS deployment with nginx, HTTPS, PM2, rollback script, and deployment checklist.
- [ ] Postgres provisioning: schema, migrations, connection via API, and migration documentation.
- [ ] Multi-user auth: login/logout/me with RBAC (admin/techlead/employee) and role-aware session handling.
- [ ] Projects/Tasks/Audit CRUD: enforce RBAC, audit trail, and server-side storage.
- [ ] LLM gateway that selects provider/model per request, records usage, enforces rate limits, and surfaces provider errors.

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
