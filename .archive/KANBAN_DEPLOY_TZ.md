# ТЗ — Деплой PlanKanban на VPS с бэкенд-прокси для Claude API

---

## Цель

Перенести PlanKanban с Netlify на собственный VPS (Timeweb, Россия).
Убрать API ключ Anthropic из браузера — вынести на сервер.
Обеспечить работу Claude API из РФ через Cloudflare Workers.

---

## Итоговая архитектура

```
Браузер (пользователь)
    │  HTTP запрос к /api/claude
    ▼
Timeweb VPS (Россия)
    │  Node.js / Nginx
    │  API ключ хранится в .env — браузер его НЕ видит
    │  HTTP запрос к workers.dev
    ▼
Cloudflare Worker (CDN, Европа/США)
    │  Простой прокси — пересылает запрос
    ▼
api.anthropic.com
```

---

## Компоненты

### 1. Cloudflare Worker (прокси к Anthropic)

**Задача:** принимать запросы с VPS и пересылать в `api.anthropic.com`.

**Регистрация:** cloudflare.com → email → Workers & Pages → Create Worker.

**Код Worker:**
```javascript
export default {
  async fetch(request) {
    // Разрешаем только POST на /v1/messages
    const url = new URL(request.url);
    if (url.pathname !== '/v1/messages') {
      return new Response('Not found', { status: 404 });
    }

    const anthropicUrl = 'https://api.anthropic.com/v1/messages';

    const response = await fetch(anthropicUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
        'x-api-key': request.headers.get('x-api-key'),
      },
      body: request.body,
    });

    // CORS — чтобы VPS мог делать запросы
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  }
}
```

**Результат:** получаем URL вида `https://mossb-claude-proxy.YOUR_SUBDOMAIN.workers.dev`

---

### 2. Бэкенд на VPS — прокси-эндпоинт

**Стек:** Node.js + Express (минимально, ~50 строк)

**Задача:** принимать запросы от канбана (браузера), добавлять API ключ из переменной окружения, пересылать на Cloudflare Worker.

**Структура файлов на VPS:**
```
/var/www/kanban/
├── index.html          ← канбан (статика)
├── server.js           ← Express сервер
├── package.json
├── .env                ← ANTHROPIC_API_KEY (не в git!)
└── .gitignore
```

**server.js:**
```javascript
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));  // отдаём index.html

// Прокси-эндпоинт для Claude API
app.post('/api/claude', async (req, res) => {
  try {
    const response = await fetch(process.env.WORKER_URL + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kanban running on port ${PORT}`));
```

**.env:**
```
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
WORKER_URL=https://mossb-claude-proxy.YOUR_SUBDOMAIN.workers.dev
PORT=3000
```

**package.json:**
```json
{
  "name": "plankanban",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "dotenv": "^16.0.0",
    "express": "^4.18.0",
    "node-fetch": "^2.7.0"
  }
}
```

---

### 3. Изменения в канбане (index.html)

Три места где вызывается `api.anthropic.com` — заменить на `/api/claude`.

**Найти и заменить (3 вхождения):**
```javascript
// БЫЛО (везде одинаково):
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: '...', ... })
});

// СТАЛО (убрать заголовок x-api-key — ключ теперь на сервере):
const res = await fetch('/api/claude', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: '...', ... })
});
```

**Три функции где менять:**
1. `sendMsg()` — чат внутри задачи (строка ~1085)
2. `sendNewTask()` — создание задачи через Claude (строка ~1140)
3. `runImportParse()` — импорт через Claude (строка ~1380)

---

### 4. Nginx конфиг на VPS

```nginx
server {
    listen 80;
    server_name kanban.mossb.ru;  # или IP адрес

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

### 5. Запуск на VPS (PM2)

```bash
# Установка
cd /var/www/kanban
npm install
npm install -g pm2

# Запуск
pm2 start server.js --name kanban
pm2 save
pm2 startup  # автозапуск при перезагрузке сервера

# Nginx
sudo nginx -t
sudo systemctl reload nginx
```

---

## Порядок выполнения

1. Зарегистрироваться на cloudflare.com (email, без карты)
2. Создать Worker → вставить код → получить URL
3. На VPS: создать папку, скопировать index.html, создать server.js и .env
4. `npm install` → `pm2 start server.js`
5. Настроить Nginx
6. В index.html заменить 3 URL на `/api/claude`
7. Проверить: открыть канбан → создать задачу через Claude

---

## Безопасность

| Что | Статус после доработки |
|---|---|
| API ключ в браузере | ✅ Убран — только в .env на сервере |
| API ключ в git | ✅ .env в .gitignore |
| Открытый доступ к /api/claude | ⚠️ Базово — без авторизации. Достаточно если канбан только для тебя |
| HTTPS | Настроить Let's Encrypt через certbot (опционально) |

---

## Итого расходы

| Компонент | Стоимость |
|---|---|
| Timeweb VPS (уже есть) | ~2 000 ₽/мес |
| Cloudflare Worker | Бесплатно (100k запросов/день) |
| Anthropic API ключ | Pay-per-use (только канбан, расход минимальный) |
