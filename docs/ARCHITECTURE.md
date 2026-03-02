# Архитектура (целевая)

## Компоненты
1) Web (browser)
- Kanban UI.
- Делает запросы только к вашему домену (`/api/...`).

2) API (VPS, Node.js)
- Auth (login/password), сессии/JWT.
- RBAC (admin, techlead, employee).
- Projects/Tasks/Audit CRUD.
- LLM Gateway: единый endpoint `/api/llm/chat`, адаптеры провайдеров, лимиты, аудит.

3) DB (Postgres)
- Users, Projects, Tasks, TaskEvents (аудит), LlmRequests (учёт токенов/стоимости).

4) LLM Provider bridge (опционально)
- Cloudflare Worker как “мост” к Anthropic из РФ (сервер-сервер).
- Worker закрыт shared-secret-ом (не публичный прокси).

## Потоки
A) UI → API → DB
- пользовательские действия: доска, задачи, проекты, роли.

B) UI → API (LLM gateway) → (Worker) → Provider
- генерация задачи, чат, импорт-парсинг.

## Нефункциональные требования (минимум)
- Безопасность: ключи только на сервере, HTTPS обязательно, rate limit на LLM.
- Надёжность: бэкапы Postgres, ротация логов.
- Производительность: 100–300 задач в проекте без лагов; сервер отвечает за хранение/права, не за рендер.

