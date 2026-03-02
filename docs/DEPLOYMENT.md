# Деплой (VPS + HTTPS + Postgres + LLM bridge)

См. также `docs/KANBAN_DEPLOY_TZ.md` (исходный план).

## 1) VPS: пакеты
- nginx
- Node.js LTS
- Postgres 15+
- pm2

## 2) HTTPS
- Let’s Encrypt (certbot) + автообновление
- Nginx: принудительный редирект HTTP → HTTPS, HSTS

## 3) Процессы
- `apps/api` запускается под pm2
- статика web отдаётся nginx или самим API (первый вариант предпочтительнее)

## 4) Бэкапы
- ежедневный pg_dump
- хранение бэкапов вне VPS

## 5) LLM bridge (Anthropic через Cloudflare Worker)
- Worker приватный (shared secret)
- API ходит на Worker; браузер — никогда

