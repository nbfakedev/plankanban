const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { Pool } = require('pg');
const { verifyPassword } = require('./lib/password');

const PORT = Number(process.env.PORT) || 3000;
const webRoot = path.resolve(__dirname, '..', 'web');
const SESSION_COOKIE = 'kb_session';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_session_secret';
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS) || 24;
const SESSION_TTL_MS = SESSION_TTL_HOURS * 60 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 1024 * 1024;
const ALL_ROLES = ['admin', 'techlead', 'employee'];
const sessions = new Map();
const db = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
});

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendNoContent(res) {
  res.writeHead(204);
  res.end();
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > MAX_JSON_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(new Error('invalid_json'));
      }
    });

    req.on('error', reject);
  });
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function createSignature(value) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

function createSessionToken(sessionId) {
  return `${sessionId}.${createSignature(sessionId)}`;
}

function getSessionIdFromToken(token) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [sessionId, signature] = token.split('.', 2);
  if (!sessionId || !signature) {
    return null;
  }

  const expected = createSignature(sessionId);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  return sessionId;
}

function setSessionCookie(res, sessionId) {
  const token = createSessionToken(sessionId);
  const cookieParts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];

  if (process.env.NODE_ENV === 'production') {
    cookieParts.push('Secure');
  }

  res.setHeader('Set-Cookie', cookieParts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function createSession(user) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  sessions.set(sessionId, {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  return sessionId;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  const sessionId = getSessionIdFromToken(token);
  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return {
    id: sessionId,
    ...session,
  };
}

function deleteSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  const sessionId = getSessionIdFromToken(token);
  if (sessionId) {
    sessions.delete(sessionId);
  }
}

function requireSession(req, res, allowedRoles = ALL_ROLES) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }

  if (!allowedRoles.includes(session.user.role)) {
    sendJson(res, 403, { error: 'forbidden' });
    return null;
  }

  return session;
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
    'SELECT id, email, password_hash, role FROM users WHERE email = $1 LIMIT 1',
    [email]
  );
  return result.rows[0] || null;
}

async function handleLogin(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error.message === 'payload_too_large') {
      sendJson(res, 413, { error: 'payload_too_large' });
      return;
    }
    sendJson(res, 400, { error: 'invalid_json' });
    return;
  }

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
    console.error('Auth login failed:', error.message);
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

  const sessionId = createSession(user);
  setSessionCookie(res, sessionId);
  sendJson(res, 200, {
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
}

function resolveFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const safePath = decoded.replace(/\0/g, '');
  const joined = path.join(webRoot, safePath);
  const normalized = path.normalize(joined);
  if (!normalized.startsWith(webRoot)) {
    return null;
  }
  return normalized;
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  let filePath = resolveFilePath(urlPath);
  if (!filePath) {
    sendText(res, 400, 'Bad request');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        sendText(res, 404, 'Not found');
        return;
      }
      sendText(res, 500, 'Failed to read static file');
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.stat(filePath, (statErr, fileStats) => {
      if (statErr || !fileStats.isFile()) {
        if (statErr && statErr.code === 'ENOENT') {
          sendText(res, 404, 'Not found');
          return;
        }
        sendText(res, 500, 'Failed to read static file');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileStats.size,
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(filePath);
      stream.on('error', () => {
        if (!res.headersSent) {
          sendText(res, 500, 'Failed to stream static file');
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    });
  });
}

const server = http.createServer((req, res) => {
  (async () => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (url.pathname === '/auth/login') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }
      await handleLogin(req, res);
      return;
    }

    if (url.pathname === '/auth/logout') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }

      const session = requireSession(req, res);
      if (!session) {
        return;
      }

      deleteSession(req);
      clearSessionCookie(res);
      sendNoContent(res);
      return;
    }

    if (url.pathname === '/auth/me') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'method_not_allowed' });
        return;
      }

      const session = requireSession(req, res);
      if (!session) {
        return;
      }

      sendJson(res, 200, { user: session.user });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      const allowedRoles = getApiAllowedRoles(url.pathname);
      const session = requireSession(req, res, allowedRoles);
      if (!session) {
        return;
      }

      sendJson(res, 404, { error: 'not_implemented' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    serveStatic(req, res);
  })().catch((error) => {
    console.error('Unhandled request error:', error.message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'internal_error' });
      return;
    }
    res.end();
  });
});

server.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
