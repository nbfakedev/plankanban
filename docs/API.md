# API

## Auth Strategy
- Stateless JWT (Bearer token in `Authorization` header).
- JWT is signed with HS256 on backend only (`JWT_SECRET`), includes `sub`, `email`, `role`, `status`, `iat`, `exp`.
- Logout is client-side token discard. Endpoint exists for symmetric flow.

## Roles (RBAC)
- `admin`
- `techlead`
- `employee`

Route protection behavior:
- `/auth/me`, `/auth/logout`: any authenticated role with `status=active`.
- `/api/admin/*`: `admin` only.
- `/api/techlead/*`: `admin` or `techlead`.
- `/api/*` (other): any authenticated role.

## Auth Endpoints
POST `/auth/login`
- body: `{ "email": "string", "password": "string" }`
- 200:
```json
{
  "token": "jwt-token-string",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "admin|techlead|employee",
    "status": "active"
  }
}
```
- 400: `{ "error": "invalid_json|invalid_payload" }`
- 401: `{ "error": "invalid_credentials" }`
- 403: `{ "error": "account_inactive|forbidden" }`
- 500: `{ "error": "auth_unavailable" }`

Example:
```http
POST /auth/login
Content-Type: application/json

{"email":"admin@local.dev","password":"admin123"}
```

Windows PowerShell (`curl.exe` + stdin) example:
```powershell
@'
{"email":"admin@local.dev","password":"admin123"}
'@ | curl.exe -sS -X POST "http://localhost:3000/auth/login" `
  -H "Content-Type: application/json" `
  --data-binary @-
```

Windows PowerShell (`Invoke-RestMethod`) example:
```powershell
$body = @{
  email = "admin@local.dev"
  password = "admin123"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3000/auth/login" `
  -ContentType "application/json" `
  -Body $body
```

POST `/auth/logout`
- requires valid Bearer token
- 204
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive" }`

GET `/auth/me`
- requires valid Bearer token
- 200:
```json
{
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "admin|techlead|employee",
    "status": "active"
  }
}
```
- 401: `{ "error": "unauthorized" }`
- 403: `{ "error": "account_inactive|forbidden" }`

Example:
```http
GET /auth/me
Authorization: Bearer <token>
```

Windows PowerShell (`curl.exe`) example:
```powershell
$token = "PASTE_TOKEN_HERE"
curl.exe -sS "http://localhost:3000/auth/me" ^
  -H "Authorization: Bearer $token"
```

## Health
GET `/health`
- 200: `{ "status": "ok" }`

## Not Implemented Yet
- Tasks API
- Projects API
- LLM API
