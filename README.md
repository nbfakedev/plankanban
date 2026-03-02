# PlanKanban (server edition)

Single-user / small-team kanban, исходно single-file HTML, далее — серверная версия: авторизация, роли, база данных, LLM gateway (Claude/OpenAI/др) без ключей в браузере.

## Репозиторий
- `apps/web/` — фронтенд (пока: `index.html` = текущий kanban).
- `apps/api/` — backend API (Node.js): auth, RBAC, проекты, задачи, аудит, LLM gateway.
- `infra/` — nginx, TLS, деплой.
- `docs/` — требования, архитектура, API, БД, ADR.

## Быстрый старт (локально, dev)
1. Установить Node.js LTS и Docker.
2. Скопировать `.env.example` → `.env` и заполнить переменные.
3. Запуск dev-окружения: см. `docs/DEVELOPMENT.md`.

## Деплой
См. `docs/DEPLOYMENT.md` (VPS + nginx + HTTPS + PM2 + Postgres + Cloudflare Worker для Anthropic).

## Правила работы через Codex (VS Code)
См. `AGENTS.md` (как резать задачи, как делать PR, как проверять, как не ломать UX).

