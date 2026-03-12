# Миграции БД

Миграции хранятся в `apps/api/migrations/` в формате `NNN_name.up.sql` и `NNN_name.down.sql`.

## Применение и откат

```bash
# Применить все неприменённые миграции
npm run db:migrate

# Откатить последнюю миграцию
npm run db:rollback
```

## Список миграций (001–026)

| № | Имя | Описание |
|---|-----|----------|
| 001 | init | Базовая схема: users, projects, project_members, tasks, task_events |
| 002 | users_status | Поле status для users |
| 003 | task_events_audit_columns | Расширение task_events (event_type, payload) |
| 004 | llm_requests_gateway_schema | llm_requests, llm_model_pricing |
| 005 | agent_service_accounts | service_accounts, agent_idempotency |
| 006 | tasks_desc_to_descript | Переименование desc → descript |
| 007 | tasks_descript_length_check | Ограничение descript до 5000 символов |
| 008 | project_runtime_features | project_timers, user_active_projects, llm настройки в projects |
| 009 | tasks_public_id_and_stage_settings | public_id для задач, stage_settings в projects |
| 010 | task_trash_storage | task_trash для корзины удалённых задач |
| 011 | tasks_position_ordering | position для сортировки задач в колонках |
| 012 | task_events_keep_history | Сохранение task_id в task_events после удаления задачи |
| 013 | task_chats | task_chats — персистентный чат техлида по задаче |
| 014 | import_events | События импорта |
| 015 | llm_provider_settings | Таблица настроек LLM (провайдер/модель по умолчанию) |
| 016 | import_jobs | Асинхронный импорт задач |
| 017 | roles_and_project_owner | Роли, ответственный за проект |
| 018 | llm_individual_override | Индивидуальные настройки LLM для пользователей |
| 019 | tasks_size | Поле size (XS\|S\|M\|L\|XL) для задач |
| 020 | llm_model_pricing | Расширенная таблица llm_model_pricing, обновление цен |
| 021 | task_code | task_code (varchar 10) — внутренний ID задачи в проекте, unique per project; task_trash.task_code |
| 022 | task_dependencies_and_snapshot | task_dependencies; projects.snapshot_md, snapshot_updated_at |
| 023 | llm_user_api_keys | API-ключи LLM для пользователей |
| 024 | project_agent_settings | agent_settings в projects |
| 025 | history_retention | projects.history_retention_months — срок хранения истории (3, 6 мес. или null) |
| 026 | project_task_field_options | priority_options, size_options, column_settings в projects |

## Последние изменения

**026_project_task_field_options** (март 2026):
- `projects.priority_options` — массив {value, label} для приоритетов в формах задач.
- `projects.size_options` — массив {id, label} для размеров (XS, S, M, L, XL или кастомные).
- `projects.column_settings` — массив {id, label, visible, locked} для колонок. backlog и done всегда видны (locked).

**025_history_retention** (март 2026):
- `projects.history_retention_months` — 3, 6 или null. При 3/6 — автоудаление task_events старше срока (раз в час + при смене настройки).

**022_task_dependencies_and_snapshot** (март 2026):
- `task_dependencies` — таблица зависимостей задач (task_id → depends_on_task_id).
- `projects.snapshot_md`, `projects.snapshot_updated_at` — снапшот проекта в Markdown.

**021_task_code** (март 2026):
- `tasks.task_code` — опциональный внутренний идентификатор задачи в рамках проекта (до 10 символов), уникален per project.
- В `task_trash` сохраняется snapshot task_code при удалении.
- Индекс `idx_tasks_project_task_code` для уникальности.
