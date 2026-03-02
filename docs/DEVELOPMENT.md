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
