# Разработка (локально)

## Зависимости
- Node.js LTS
- Docker + docker-compose

## Конфигурация
- `.env` в корне (не коммитить). См. `.env.example`.

## Локальный запуск (рекомендуемый)
1) `docker compose up -d db`
2) `npm install` в `apps/api`
3) `npm run dev` в `apps/api` (поднимает API на :3000)
4) Web раздаёт API (dev): либо через API статику, либо отдельный http-server.

## Стиль коммитов
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`.

## Проверка перед PR
- ручные тесты по чек-листу в `AGENTS.md`
- обновить `docs/API.md` и `docs/DATABASE.md` если менялись контракты/схема

## Скрипты
См. `docs/SCRIPTS.md` — список npm-скриптов и CLI-утилит (`set-admin-password`, `llm:prices:fetch`).

## Local run (updated)
1) `npm install` in repo root
2) `docker compose up -d db` (если ещё не запущен Postgres)
3) `npm run db:migrate` и `npm run db:seed`
4) `npm run dev` (API + static web on :3000)
5) Открыть http://localhost:3000 — редирект на `/login.html`, вход: `admin@local.dev` / `admin123`
6) `npm start` (normal start without watch)

## Docker development
- `docker compose up --force-recreate api`
- `docker compose down`

## Local Postgres + migrations
1) `cp .env.example .env`
2) `docker compose up -d db`
3) `docker compose ps db` (wait for `running`)
4) `npm install`
5) `npm run db:migrate`
6) `npm run db:seed`
7) `npm run dev`

Rollback the latest migration:
- `npm run db:rollback`

Stop local services:
- `docker compose down`

## DB connectivity checklist
1) Confirm Postgres container is up:
   - `docker compose ps db`
2) Verify DB responds inside container:
   - `docker compose exec db psql -U kanban -d kanban -c "select 1;"`
3) Verify app env values are present:
   - `DATABASE_URL` OR all of `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
4) Re-run schema/data setup:
   - `npm run db:migrate`
   - `npm run db:seed`
5) Start API with env file:
   - `npm run dev`

## LLM Gateway local test
1) Set env vars in `.env`:
   - `LLM_DEFAULT_PROVIDER=anthropic`
   - `LLM_DEFAULT_MODEL=claude-sonnet-4`
   - `LLM_RATE_LIMIT_PER_MINUTE=30`
   - `LLM_ALLOWED_MODELS_ANTHROPIC=claude-sonnet-4,claude-3-5-sonnet-latest`
   - `LLM_STUB_MODE=1` (for local tests without real key)
   - `ANTHROPIC_API_KEY=` (can stay empty in stub mode)
   - optional Worker mode:
      - `CLOUDFLARE_WORKER_URL=https://<worker-host>`
      - `WORKER_SHARED_SECRET=<shared_secret>`
2) Run migrations and start API:
   - `npm run db:migrate`
   - `npm run dev`
3) Call LLM gateway (`purpose=chat`):
   - `curl.exe -sS -X POST "http://localhost:3000/api/llm/chat" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" --data "{\"purpose\":\"chat\",\"messages\":[{\"role\":\"user\",\"content\":\"Give me 2 sprint tasks\"}]}" `
4) Verify `llm_requests` insert in stub mode (`status='ok'`, `response_meta.stub=true`):
   - `docker compose exec db psql -U kanban -d kanban -c "select id, status, error_code, response_meta from llm_requests order by created_at desc limit 3;"`
5) Disable stub (`LLM_STUB_MODE=0`) with empty key and retry `/api/llm/chat`:
   - expected: `502 {"error":"llm_unavailable"}`
   - DB audit: `status='error'`, `error_code='missing_api_key'`

## Manual API checklist (Projects/Tasks)
1) Login as admin and save token:
   - `curl.exe -sS -X POST "http://localhost:3000/auth/login" -H "Content-Type: application/json" --data "{\"email\":\"admin@local.dev\",\"password\":\"admin123\"}"`
2) Create project (admin/techlead only):
   - `curl.exe -sS -X POST "http://localhost:3000/projects" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" --data "{\"name\":\"Backend Project\"}"`
3) List visible projects:
   - `curl.exe -sS "http://localhost:3000/projects" -H "Authorization: Bearer <TOKEN>"`
4) Create task in project (admin/techlead only):
   - `curl.exe -sS -X POST "http://localhost:3000/projects/<PROJECT_ID>/tasks" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" --data "{\"title\":\"Implement API\",\"col\":\"todo\"}"`
5) Update task fields:
   - `curl.exe -sS -X PATCH "http://localhost:3000/tasks/<TASK_ID>" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" --data "{\"priority\":2,\"notes\":\"updated\"}"`
6) Move task between columns:
   - `curl.exe -sS -X POST "http://localhost:3000/tasks/<TASK_ID>/move" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" --data "{\"status\":\"doing\"}"`
7) RBAC check:
   - employee token gets `403 forbidden` on project/task create-update-move, and sees only assigned tasks in `GET /projects/<PROJECT_ID>/tasks`.

## Manual API checklist (LLM Gateway)
1) Login and save token:
   - `curl.exe -sS -X POST "http://localhost:3000/auth/login" -H "Content-Type: application/json" --data "{\"email\":\"admin@local.dev\",\"password\":\"admin123\"}"`
2) Call `/api/llm/chat` with `purpose=chat`:
   - `curl.exe -sS -X POST "http://localhost:3000/api/llm/chat" -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" --data "{\"purpose\":\"chat\",\"messages\":[{\"role\":\"user\",\"content\":\"Return 1 short idea\"}]}" `
3) Verify DB audit row is inserted:
   - stub mode: `status='ok'` and `response_meta->>'stub' = 'true'`
   - no-stub + empty key: `status='error'` and `error_code='missing_api_key'`
   - `docker compose exec db psql -U kanban -d kanban -c "select id, purpose, provider, model, status, error_code, response_meta, created_at from llm_requests order by created_at desc limit 5;"`
4) Verify RBAC restrictions for employee:
   - employee call with `purpose=new_task` or `purpose=import_parse` returns `403 forbidden`.

## Agent integration local test
1) Login as admin and save JWT:
   - `curl.exe -sS -X POST "http://localhost:3000/auth/login" -H "Content-Type: application/json" --data "{\"email\":\"admin@local.dev\",\"password\":\"admin123\"}"`
2) Create service account and save `token` (`x-service-token`):
   - `curl.exe -sS -X POST "http://localhost:3000/api/service-accounts" -H "Authorization: Bearer <ADMIN_JWT>" -H "Content-Type: application/json" --data "{\"name\":\"Agent Runner\",\"scopes\":[\"tasks:read\",\"tasks:comment\",\"events:read\"]}"`
3) Check agent context (`tasks:read`):
   - `curl.exe -sS "http://localhost:3000/api/agent/context?task_id=<TASK_ID>" -H "x-service-token: <SERVICE_TOKEN>"`
4) Check `task_comment` via gateway and verify audit row:
   - `curl.exe -sS -X POST "http://localhost:3000/api/agent/actions" -H "x-service-token: <SERVICE_TOKEN>" -H "Content-Type: application/json" --data "{\"idempotency_key\":\"agent-demo-1\",\"agent\":{\"name\":\"codex\",\"role\":\"executor\"},\"actions\":[{\"type\":\"task_comment\",\"payload\":{\"task_id\":\"<TASK_ID>\",\"text\":\"Agent test comment\",\"format\":\"text\"}}]}"`
   - verify in DB:
   - `docker compose exec db psql -U kanban -d kanban -c "select id, event_type, task_id, payload, created_at from task_events order by created_at desc limit 5;"`
5) Check scope enforcement for `task_move`:
   - with service account without `tasks:move`, call `task_move` action and confirm `403 {"error":"forbidden"}`.
6) Check idempotency:
   - repeat the exact same `/api/agent/actions` request with identical `idempotency_key`; confirm same response and no duplicate `task_events`.
7) Check events feed:
   - `curl.exe -sS "http://localhost:3000/api/events?limit=20" -H "x-service-token: <SERVICE_TOKEN>"`
