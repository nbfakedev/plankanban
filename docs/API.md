# API

## Auth Strategy
- Session-based auth with an HttpOnly cookie (`kb_session`).
- Chosen for local MVP: simple server-side invalidation on logout and no token revocation flow.

## Roles (RBAC)
- `admin`
- `techlead`
- `employee`

Route protection behavior:
- `/auth/me`, `/auth/logout`: any authenticated role.
- `/api/admin/*`: `admin` only.
- `/api/techlead/*`: `admin` or `techlead`.
- `/api/*` (other): any authenticated role.

## Auth Endpoints
POST `/auth/login`
- body: `{ "email": "string", "password": "string" }`
- 200: `{ "user": { "id": "uuid", "email": "string", "role": "admin|techlead|employee" } }` + sets HttpOnly session cookie
- 400: `{ "error": "invalid_json|invalid_payload" }`
- 401: `{ "error": "invalid_credentials" }`
- 500: `{ "error": "auth_unavailable" }`

POST `/auth/logout`
- requires authenticated session
- 204
- 401: `{ "error": "unauthorized" }`

GET `/auth/me`
- requires authenticated session
- 200: `{ "user": { "id": "uuid", "email": "string", "role": "admin|techlead|employee" } }`
- 401: `{ "error": "unauthorized" }`

## Health
GET `/health`
- 200: `{ "status": "ok" }`

## Not Implemented Yet
- Tasks API
- Projects API
- LLM API