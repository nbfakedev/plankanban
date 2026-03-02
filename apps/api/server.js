const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const { verifyPassword } = require('./lib/password');
const {
  createDbConfigFromEnv,
  createDbConnectionInfo,
} = require('./lib/db-config');

const PORT = Number(process.env.PORT) || 3000;
const webRoot = path.resolve(__dirname, '..', 'web');
const MAX_JSON_BODY = '1mb';
const ALL_ROLES = ['admin', 'techlead', 'employee'];
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
const JWT_TTL_HOURS = Number(process.env.JWT_TTL_HOURS) || 24;
const JWT_TTL_SECONDS = JWT_TTL_HOURS * 60 * 60;
const dbConfigState = createDbConfigFromEnv(process.env);
const dbConfig = dbConfigState.config;
const dbConnectionInfo = createDbConnectionInfo(dbConfig);
const db = new Pool(dbConfig);

const app = express();

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function sendText(res, statusCode, text) {
  res.status(statusCode).type('text/plain; charset=utf-8').send(text);
}

function sendNoContent(res) {
  res.status(204).end();
}

function createSignature(value) {
  return crypto
    .createHmac('sha256', JWT_SECRET)
    .update(value)
    .digest('base64url');
}

function decodeBase64Json(value) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function createJwt(user) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    iat,
    exp: iat + JWT_TTL_SECONDS,
  };
  const headerPart = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${headerPart}.${payloadPart}`;
  const signaturePart = createSignature(signingInput);
  return `${signingInput}.${signaturePart}`;
}

function verifyJwt(token) {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    return null;
  }

  const signingInput = `${headerPart}.${payloadPart}`;
  const expected = createSignature(signingInput);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signaturePart, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  const header = decodeBase64Json(headerPart);
  const payload = decodeBase64Json(payloadPart);
  if (!header || !payload) {
    return null;
  }

  if (header.alg !== 'HS256' || header.typ !== 'JWT') {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return null;
  }

  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.role !== 'string'
  ) {
    return null;
  }

  return {
    id: payload.sub,
    email: payload.email,
    role: payload.role,
    status: payload.status,
  };
}

function getBearerToken(req) {
  const authorization = req.headers.authorization;
  if (typeof authorization !== 'string') {
    return null;
  }

  const [scheme, token] = authorization.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token.trim() || null;
}

function requireAuth(req, res, allowedRoles = ALL_ROLES) {
  const token = getBearerToken(req);
  const user = verifyJwt(token);
  if (!user) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }

  if (user.status !== 'active') {
    sendJson(res, 403, { error: 'account_inactive' });
    return null;
  }

  if (!allowedRoles.includes(user.role)) {
    sendJson(res, 403, { error: 'forbidden' });
    return null;
  }

  return user;
}

function getApiAllowedRoles(pathname) {
  if (pathname.startsWith('/api/admin/')) {
    return ['admin'];
  }

  if (pathname.startsWith('/api/techlead/')) {
    return ['admin', 'techlead'];
  }

  return ALL_ROLES;
}

async function findUserByEmail(email) {
  const result = await db.query(
    'SELECT id, email, password_hash, role, status FROM users WHERE email = $1 LIMIT 1',
    [email]
  );
  return result.rows[0] || null;
}

function isDevelopment() {
  return process.env.NODE_ENV === 'development';
}

function formatDbValue(value) {
  if (value === undefined || value === null || value === '') {
    return '<unset>';
  }
  return String(value);
}

function logAuthDbError(error) {
  if (!isDevelopment()) {
    return;
  }

  const message = error && error.message ? error.message : 'unknown error';
  const host = formatDbValue(dbConnectionInfo.host);
  const port = formatDbValue(dbConnectionInfo.port);
  const database = formatDbValue(dbConnectionInfo.database);
  const user = formatDbValue(dbConnectionInfo.user);

  console.error(
    'Auth login DB failure (%s) host=%s port=%s database=%s user=%s',
    message,
    host,
    port,
    database,
    user
  );

  if (error && error.stack) {
    console.error(error.stack);
  }
}

function logDbStartupDiagnostics() {
  if (!isDevelopment()) {
    return;
  }

  const host = formatDbValue(dbConnectionInfo.host);
  const port = formatDbValue(dbConnectionInfo.port);
  const database = formatDbValue(dbConnectionInfo.database);
  const user = formatDbValue(dbConnectionInfo.user);

  console.log(
    '[db] config source=%s host=%s port=%s database=%s user=%s',
    dbConfigState.source,
    host,
    port,
    database,
    user
  );

  if (dbConfigState.missingEnvVars.length > 0) {
    console.error(
      '[db] missing env vars: %s',
      dbConfigState.missingEnvVars.join(', ')
    );
  }

  if (dbConnectionInfo.parseError) {
    console.error('[db] invalid DATABASE_URL: %s', dbConnectionInfo.parseError);
  }
}

async function checkDbConnectivity() {
  if (!isDevelopment()) {
    return;
  }

  let client;
  try {
    client = await db.connect();
    await client.query('SELECT 1');
    console.log('[db] connectivity check passed');
  } catch (error) {
    console.error('[db] connectivity check failed: %s', error.message);
    if (error && error.stack) {
      console.error(error.stack);
    }
  } finally {
    if (client) {
      client.release();
    }
  }
}

function getBodyPreview(value) {
  if (typeof value === 'string') {
    return `string(length=${value.length})`;
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value).slice(0, 5);
    return `object(keys=${keys.length ? keys.join(',') : 'none'})`;
  }

  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }

  return typeof value;
}

function normalizeLoginPayload(rawBody) {
  if (rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)) {
    return { payload: rawBody };
  }

  if (typeof rawBody !== 'string') {
    return { payload: {} };
  }

  const source = rawBody.trim();
  if (!source) {
    return { payload: {} };
  }

  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { payload: parsed };
    }
    return { payload: {} };
  } catch (_) {
    return { error: 'invalid_json' };
  }
}

async function handleLogin(req, res) {
  if (isDevelopment()) {
    console.debug(
      '[auth/login] content-type=%s content-length=%s body=%s',
      req.headers['content-type'] || '',
      req.headers['content-length'] || '',
      getBodyPreview(req.body)
    );
  }

  const normalized = normalizeLoginPayload(req.body);
  if (normalized.error) {
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }

  const payload = normalized.payload;

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const password =
    typeof payload.password === 'string' ? payload.password : '';

  if (!email || !password) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  let user;
  try {
    user = await findUserByEmail(email);
  } catch (error) {
    if (isDevelopment()) {
      logAuthDbError(error);
    } else {
      console.error('Auth login failed:', error.message);
    }
    sendJson(res, 500, { error: 'auth_unavailable' });
    return;
  }

  if (!user || !verifyPassword(password, user.password_hash)) {
    sendJson(res, 401, { error: 'invalid_credentials' });
    return;
  }

  if (!ALL_ROLES.includes(user.role)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  if (user.status !== 'active') {
    sendJson(res, 403, { error: 'account_inactive' });
    return;
  }

  const token = createJwt(user);
  sendJson(res, 200, {
    token,
    token_type: 'Bearer',
    expires_in: JWT_TTL_SECONDS,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  });
}

app.use(express.json({ limit: MAX_JSON_BODY, strict: false }));
app.use(express.urlencoded({ extended: false }));

app.get('/health', (req, res) => {
  sendJson(res, 200, { status: 'ok' });
});
app.all('/health', (req, res) => {
  sendJson(res, 405, { error: 'method_not_allowed' });
});

app.post('/auth/login', express.text({ type: 'text/plain', limit: MAX_JSON_BODY }), (req, res) => {
  handleLogin(req, res).catch((error) => {
    console.error('Unhandled auth login error:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  });
});
app.all('/auth/login', (req, res) => {
  sendJson(res, 405, { error: 'method_not_allowed' });
});

app.post('/auth/logout', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }
  sendNoContent(res);
});
app.all('/auth/logout', (req, res) => {
  sendJson(res, 405, { error: 'method_not_allowed' });
});

app.get('/auth/me', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  sendJson(res, 200, { user });
});
app.all('/auth/me', (req, res) => {
  sendJson(res, 405, { error: 'method_not_allowed' });
});

app.all(/^\/api(\/|$)/, (req, res) => {
  const allowedRoles = getApiAllowedRoles(req.path);
  const user = requireAuth(req, res, allowedRoles);
  if (!user) {
    return;
  }

  sendJson(res, 404, { error: 'not_implemented' });
});

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return;
  }

  next();
});

app.use(express.static(webRoot));

app.use((req, res) => {
  sendText(res, 404, 'Not found');
});

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error && error.type === 'entity.too.large') {
    sendJson(res, 413, { error: 'payload_too_large' });
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }

  console.error('Unhandled request error:', error.message);
  sendJson(res, 500, { error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  logDbStartupDiagnostics();
  checkDbConnectivity().catch((error) => {
    console.error('[db] connectivity check failed unexpectedly: %s', error.message);
    if (error && error.stack) {
      console.error(error.stack);
    }
  });
});
