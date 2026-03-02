# План работы PlanKanban (пошагово, под Codex в IDE)

## Принципы работы
- 1 шаг = 1 запрос к Codex = 1 измеримый результат (файл/дифф/инструкция проверки).
- Новый чат в Codex создавать:
  - при смене этапа (Repo → Backend → DB → Auth → Frontend → Deploy → Knowledge);
  - если контекст разросся и агент начинает “забывать” прочитанные файлы.
- Промпты к Codex: только на английском, короткие, директивные, без воды.
- Каждый промпт содержит:
  - модель Codex и уровень рассуждения;
  - указание “New chat: Yes/No”;
  - список файлов, которые прочитать;
  - требование “Output unified diff only”.

---

## Этап 1. Инициализация репозитория и базовая структура

### Шаг 1.1 — Инициализировать git-репозиторий из шаблона и открыть в IDE
- Codex: не нужен.
- Результат: папка проекта с файлами из архива, открыта в VS Code.

### Шаг 1.2 — Обновить README и базовые docs под текущие цели (сервер + БД + LLM gateway)
- Codex: **GPT-5.1-Codex-Mini**, Reasoning: **Low**
- New chat: **Yes** (Repo/Docs)
- Prompt (EN):
  - “Read README.md, docs/ARCHITECTURE.md, docs/PROJECT_TASKS.md. Update them to reflect the current plan: server-side storage (Postgres), multi-user auth (admin/techlead/employee), LLM gateway with provider/model selection, and VPS deployment with HTTPS. Keep it concise. Output a unified diff only.”
- Проверка: README и docs корректно описывают цель и этапы, без вставок кода “портянками”.

### Шаг 1.3 — Issue/PR шаблоны и правила для агента
- Codex: **GPT-5.1-Codex-Mini**, Reasoning: **Low**
- New chat: **No**
- Prompt (EN):
  - “Add GitHub templates: .github/ISSUE_TEMPLATE/* and PULL_REQUEST_TEMPLATE.md. Follow AGENTS.md rules: one task per PR, include manual test checklist, rollback notes. Output a unified diff only.”
- Проверка: появились шаблоны, PR-template содержит чеклист ручных тестов и rollback.

---

## Этап 2. Подключение GitHub репозитория

### Шаг 2.1 — Создать репозиторий на GitHub и запушить
- Codex: не нужен.
- Действия: создать новый repo (private), затем выполнить команды из `docs/GITHUB.md`.
- Результат: репозиторий на GitHub с первым коммитом.

---

## Этап 3. Локальный запуск “скелета” приложения (Web + API)

### Шаг 3.1 — Минимальный backend: статика + healthcheck
- Codex: **GPT-5.2-Codex**, Reasoning: **Medium**
- New chat: **Yes** (Backend)
- Prompt (EN):
  - “Inspect repository structure. Implement a minimal Node backend that serves apps/web as static files and exposes GET /health returning {status:'ok'}. Update package.json scripts (dev/start). Do not add database yet. Keep changes minimal. Output unified diff.”
- Проверка: локально открывается веб-страница; `/health` отвечает ok.

### Шаг 3.2 — Docker Compose для локалки (пока только backend)
- Codex: **GPT-5.1-Codex-Mini**, Reasoning: **Low**
- New chat: **No**
- Prompt (EN):
  - “Add a minimal docker-compose.yml to run the backend service. Add docs/DEVELOPMENT.md steps to run locally with and without Docker. Output unified diff.”
- Проверка: `docker compose up` поднимает backend; сайт открывается.

---

## Этап 4. Postgres и миграции

### Шаг 4.1 — Postgres в docker-compose + базовая миграция схемы
- Codex: **GPT-5.2-Codex**, Reasoning: **Medium**
- New chat: **Yes** (Database)
- Prompt (EN):
  - “Add Postgres to docker-compose. Implement DB connection config via env. Add a minimal migrations system (choose a simple library) and create the initial schema from docs/DATABASE.md: users, projects, tasks, task_events, llm_requests. Include rollback migration. Output unified diff.”
- Проверка: Postgres поднимается; миграции применяются; таблицы созданы.

### Шаг 4.2 — Seed (минимальные данные) и проверка подключения
- Codex: **GPT-5.1-Codex-Mini**, Reasoning: **Low**
- New chat: **No**
- Prompt (EN):
  - “Add a dev-only seed script to create an admin user and a default project. Document how to run it. Output unified diff.”
- Проверка: seed создаёт записи; повторный запуск идемпотентен.

---

## Этап 5. Аутентификация и роли (RBAC)

### Шаг 5.1 — Логин/пароль, сессии или JWT, роли admin/techlead/employee
- Codex: **GPT-5.3-Codex**, Reasoning: **High**
- New chat: **Yes** (Auth/RBAC)
- Prompt (EN):
  - “Implement authentication for the backend: password hashing, login endpoint, session or JWT (choose one and justify in comments). Add RBAC with roles admin, techlead, employee. Protect API routes accordingly. Add minimal endpoints: POST /auth/login, POST /auth/logout, GET /auth/me. Update docs/API.md. Output unified diff.”
- Проверка: логин работает; `/auth/me` работает; запреты по ролям работают.

---

## Этап 6. Серверное API для задач и проектов

### Шаг 6.1 — CRUD проектов и задач + аудит событий
- Codex: **GPT-5.3-Codex**, Reasoning: **High**
- New chat: **Yes** (Tasks API)
- Prompt (EN):
  - “Implement REST API per docs/API.md for projects and tasks: list/get/create/update/move status. Every task change must write to task_events. Enforce RBAC: employee can only see assigned tasks; techlead can create/edit tasks; admin full access. Add basic validation and consistent error format. Output unified diff.”
- Проверка: CRUD работает; `task_events` пишется; employee не видит чужие задачи.

---

## Этап 7. LLM Gateway: выбор provider/model в настройках

### Шаг 7.1 — Единый LLM endpoint + Anthropic через Worker
- Codex: **GPT-5.3-Codex**, Reasoning: **High**
- New chat: **Yes** (LLM Gateway)
- Prompt (EN):
  - “Implement LLM gateway endpoint POST /api/llm/chat. Add provider abstraction with provider='anthropic' first. Backend must call Cloudflare Worker URL from env and pass x-kanban-secret and x-api-key (server-side only). Store each request in llm_requests with estimated token/cost fields (if token usage is available). Add rate limit. Update docs/API.md and docs/DEPLOYMENT.md. Output unified diff.”
- Проверка: endpoint работает; ключ не утекает; запросы логируются.

### Шаг 7.2 — Настройки проекта: provider/model/preset
- Codex: **GPT-5.2-Codex**, Reasoning: **Medium**
- New chat: **No**
- Prompt (EN):
  - “Add project settings storage in DB for llm provider/model/preset. Expose endpoints to read/update these settings (admin/techlead only). LLM gateway should default to project settings if provider/model not explicitly passed. Output unified diff.”
- Проверка: настройки сохраняются и применяются.

---

## Этап 8. Cloudflare Worker (мост к Anthropic из РФ)

### Шаг 8.1 — Worker-код и инструкция деплоя
- Codex: **GPT-5.2-Codex**, Reasoning: **Medium**
- New chat: **Yes** (Worker)
- Prompt (EN):
  - “Create docs/CLOUDFLARE_WORKER.md with step-by-step setup in Cloudflare UI and a Worker script that proxies POST /v1/messages to api.anthropic.com/v1/messages. It must require a shared secret header (x-kanban-secret) and return JSON transparently. No browser CORS needed. Output unified diff.”
- Проверка: worker деплоится; backend успешно вызывает worker.

---

## Этап 9. Миграция фронтенда: localStorage → серверное API

### Шаг 9.1 — Авторизация в UI и загрузка данных с сервера
- Codex: **GPT-5.3-Codex**, Reasoning: **High**
- New chat: **Yes** (Frontend migration)
- Prompt (EN):
  - “Refactor apps/web/index.html to use server API instead of localStorage: login flow, fetch projects/tasks, persist task updates via API, keep UI state local (filters/search). Preserve existing UI behavior as much as possible. Add a minimal API client wrapper. Output unified diff.”
- Проверка: после логина задачи грузятся с сервера; изменения сохраняются; localStorage не используется для задач.

### Шаг 9.2 — 3 AI-функции перевести на /api/llm/chat
- Codex: **GPT-5.2-Codex**, Reasoning: **Medium**
- New chat: **No**
- Prompt (EN):
  - “Update the three AI-related functions to call POST /api/llm/chat with purpose values: new_task, chat, import_parse. Remove any direct anthropic calls and any client-side key usage. Output unified diff.”
- Проверка: AI-сценарии работают через сервер.

---

## Этап 10. Деплой на VPS (Timeweb) + HTTPS

### Шаг 10.1 — Nginx + Let’s Encrypt + процесс-менеджер + бэкапы
- Codex: **GPT-5.2-Codex**, Reasoning: **Medium**
- New chat: **Yes** (Deploy)
- Prompt (EN):
  - “Update docs/DEPLOYMENT.md for Timeweb Ubuntu: nginx reverse proxy, HTTPS via certbot, environment variables, process manager (pm2 or systemd), log rotation, backups for Postgres. Keep it step-by-step and copy-paste friendly. Output unified diff.”
- Проверка: сайт доступен по HTTPS; API работает; сервис переживает перезагрузку сервера.

---

## Этап 11. “Базы знаний” для Codex: где применять

### Применимость (кратко)
- Context7: включать сразу на Backend/Deploy/Worker этапах для актуальных доков.
- agent-orchestrator: подключать позже для параллельной работы несколькими агентами.
- n8n-mcp: подключать только если будете реально строить автоматизации в n8n.
- ui-ux-pro-max-skill + design-plugin: включать после стабилизации API/RBAC, когда пойдёт системная правка UX/UI.

### Шаг 11.1 — Документ “как использовать” эти базы с Codex
- Codex: **GPT-5.1-Codex-Mini**, Reasoning: **Low**
- New chat: **Yes** (Knowledge)
- Prompt (EN):
  - “Open docs/KNOWLEDGE_BASES.md. Rewrite it into a short operational guide: when to use Context7, Supermemory, agent-orchestrator, n8n-mcp, UI/UX skill repos; include exact copy-paste prompts for Codex to consult each source. Output unified diff.”
- Проверка: документ содержит короткие правила и готовые промпты.

---

## Порядок выполнения (строго)
1. Этап 1 + 2 (Repo + GitHub)
2. Этап 3 (Backend skeleton)
3. Этап 4 (Postgres + migrations)
4. Этап 5 (Auth/RBAC)
5. Этап 6 (Tasks API + audit)
6. Этап 7 + 8 (LLM gateway + Worker)
7. Этап 9 (Frontend migration)
8. Этап 10 (Deploy HTTPS)
9. Этап 11 (Knowledge интеграции для Codex)
