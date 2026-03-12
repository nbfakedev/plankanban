# Скрипты и CLI

## npm-скрипты (корень репозитория)

| Команда | Описание |
|---------|----------|
| `npm run dev` | Запуск API с watch (автоперезагрузка при изменении файлов) |
| `npm start` | Запуск API без watch |
| `npm run db:migrate` | Применить все неприменённые миграции |
| `npm run db:rollback` | Откатить последнюю миграцию |
| `npm run db:seed` | Заполнить БД начальными данными (admin, проект) |
| `npm run llm:prices:fetch` | Загрузить актуальные цены LLM из llm-prices.com в `llm_model_pricing` |
| `npm run test:descript` | Тест валидации поля descript |
| `npm run test:smoke` | Дымовой тест API (по умолчанию `http://localhost:3000`) |

## Node.js-скрипты (apps/api)

| Файл | Назначение |
|------|------------|
| `scripts/migrate.js` | Применение миграций (вызов через `npm run db:migrate`) |
| `scripts/rollback.js` | Откат миграций |
| `scripts/seed.js` | Сид: admin@local.dev, пароль из seed или .env |
| `scripts/fetch-llm-prices.js` | Загрузка цен LLM (npm run llm:prices:fetch) |
| `scripts/set-admin-password.js` | Смена пароля admin из командной строки |
| `scripts/cleanup.js` | Очистка данных (при наличии) |

### set-admin-password

```bash
# Вариант 1: пароль аргументом
node apps/api/scripts/set-admin-password.js newPassword123

# Вариант 2: через переменную окружения
ADMIN_NEW_PASSWORD=newPassword123 node apps/api/scripts/set-admin-password.js
```

Требуется `DATABASE_URL` или переменные `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`.
