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


## Local run (updated)
1) `npm install` in repo root
2) `npm run dev` (API + static web on :3000)
3) `npm start` (normal start without watch)

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
