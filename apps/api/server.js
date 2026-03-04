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
const PROJECT_WRITE_ROLES = ['admin', 'techlead'];
const TASK_WRITE_ROLES = ['admin', 'techlead'];
const TASK_COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done'];
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
const JWT_TTL_HOURS = Number(process.env.JWT_TTL_HOURS) || 24;
const JWT_TTL_SECONDS = JWT_TTL_HOURS * 60 * 60;
const LLM_PURPOSES = ['new_task', 'chat', 'import_parse'];
const EMPLOYEE_LLM_PURPOSES = ['chat'];
const LLM_DEFAULT_PROVIDER = (
  process.env.LLM_DEFAULT_PROVIDER || 'anthropic'
)
  .trim()
  .toLowerCase();
const LLM_DEFAULT_MODEL = (process.env.LLM_DEFAULT_MODEL || 'claude-sonnet-4')
  .trim();
const LLM_RATE_LIMIT_PER_MINUTE = parsePositiveInteger(
  process.env.LLM_RATE_LIMIT_PER_MINUTE,
  30
);
const CLOUDFLARE_WORKER_URL = normalizeNullableString(
  process.env.CLOUDFLARE_WORKER_URL || process.env.CF_WORKER_URL
);
const WORKER_SHARED_SECRET = normalizeNullableString(
  process.env.WORKER_SHARED_SECRET || process.env.CF_WORKER_SECRET
);
const ANTHROPIC_API_KEY = normalizeNullableString(process.env.ANTHROPIC_API_KEY);
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_DEFAULT_MODELS = ['claude-sonnet-4', 'claude-3-5-sonnet-latest'];
const ANTHROPIC_ALLOWED_MODELS = (() => {
  const parsed = parseCsvList(process.env.LLM_ALLOWED_MODELS_ANTHROPIC);
  return parsed.length > 0 ? parsed : ANTHROPIC_DEFAULT_MODELS;
})();
const llmRateLimitBuckets = new Map();
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

async function runInTransaction(work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      // ignore rollback failures, surface original error
    }
    throw error;
  } finally {
    client.release();
  }
}

function createAppError(statusCode, errorCode) {
  const error = new Error(errorCode);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  return error;
}

function isAppError(error) {
  return (
    error &&
    Number.isInteger(error.statusCode) &&
    typeof error.errorCode === 'string'
  );
}

function parsePositiveInteger(rawValue, fallback) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseCsvList(rawValue) {
  if (typeof rawValue !== 'string') {
    return [];
  }

  return rawValue
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function getLlmAllowedModels(provider) {
  if (provider === 'anthropic') {
    return ANTHROPIC_ALLOWED_MODELS;
  }
  return [];
}

function consumeLlmRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const record = llmRateLimitBuckets.get(userId);

  if (!record || now - record.windowStartedAt >= windowMs) {
    llmRateLimitBuckets.set(userId, {
      windowStartedAt: now,
      count: 1,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (record.count >= LLM_RATE_LIMIT_PER_MINUTE) {
    const retryAfterMs = Math.max(0, record.windowStartedAt + windowMs - now);
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  record.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function parseLlmChatPayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const purpose =
    typeof payload.purpose === 'string' ? payload.purpose.trim() : '';
  if (!LLM_PURPOSES.includes(purpose)) {
    return { error: 'invalid_payload' };
  }

  const parsed = {
    purpose,
  };

  if (payload.project_id !== undefined) {
    if (payload.project_id !== null && !isUuid(payload.project_id)) {
      return { error: 'invalid_payload' };
    }
    parsed.project_id = payload.project_id;
  }

  if (payload.provider !== undefined) {
    if (typeof payload.provider !== 'string' || !payload.provider.trim()) {
      return { error: 'invalid_payload' };
    }
    parsed.provider = payload.provider.trim().toLowerCase();
  }

  if (payload.model !== undefined) {
    if (typeof payload.model !== 'string' || !payload.model.trim()) {
      return { error: 'invalid_payload' };
    }
    parsed.model = payload.model.trim();
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return { error: 'invalid_payload' };
  }

  const messages = [];
  for (const message of payload.messages) {
    if (!isObjectPayload(message)) {
      return { error: 'invalid_payload' };
    }

    const role = typeof message.role === 'string' ? message.role.trim() : '';
    const content =
      typeof message.content === 'string' ? message.content : null;

    if (!['system', 'user', 'assistant'].includes(role) || content === null) {
      return { error: 'invalid_payload' };
    }

    if (!content.trim()) {
      return { error: 'invalid_payload' };
    }

    messages.push({ role, content });
  }

  parsed.messages = messages;

  if (payload.params !== undefined) {
    if (!isObjectPayload(payload.params)) {
      return { error: 'invalid_payload' };
    }

    const params = {};
    if (payload.params.temperature !== undefined) {
      if (!Number.isFinite(payload.params.temperature)) {
        return { error: 'invalid_payload' };
      }
      params.temperature = payload.params.temperature;
    }

    if (payload.params.max_tokens !== undefined) {
      if (
        !Number.isInteger(payload.params.max_tokens) ||
        payload.params.max_tokens <= 0
      ) {
        return { error: 'invalid_payload' };
      }
      params.max_tokens = payload.params.max_tokens;
    }

    parsed.params = params;
  } else {
    parsed.params = {};
  }

  return { value: parsed };
}

function resolveLlmProviderAndModel(parsedPayload) {
  const provider = (
    parsedPayload.provider || LLM_DEFAULT_PROVIDER || 'anthropic'
  ).toLowerCase();
  const model = parsedPayload.model || LLM_DEFAULT_MODEL;

  if (!provider || !model) {
    return { error: 'invalid_payload' };
  }

  const allowedModels = getLlmAllowedModels(provider);
  if (allowedModels.length === 0 || !allowedModels.includes(model)) {
    return { error: 'invalid_payload' };
  }

  return { value: { provider, model } };
}

function buildAnthropicRequest(parsedPayload, resolvedModel) {
  const systemMessages = [];
  const requestMessages = [];

  for (const message of parsedPayload.messages) {
    if (message.role === 'system') {
      systemMessages.push(message.content);
      continue;
    }

    requestMessages.push({
      role: message.role,
      content: message.content,
    });
  }

  if (requestMessages.length === 0) {
    return { error: 'invalid_payload' };
  }

  const params = parsedPayload.params || {};
  const body = {
    model: resolvedModel,
    messages: requestMessages,
    max_tokens:
      params.max_tokens !== undefined
        ? params.max_tokens
        : ANTHROPIC_DEFAULT_MAX_TOKENS,
  };

  if (params.temperature !== undefined) {
    body.temperature = params.temperature;
  }

  if (systemMessages.length > 0) {
    body.system = systemMessages.join('\n\n');
  }

  return { value: body };
}

function extractAnthropicText(responseBody) {
  if (!responseBody || !Array.isArray(responseBody.content)) {
    return '';
  }

  const parts = responseBody.content
    .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text);

  return parts.join('\n\n').trim();
}

function getLlmMessageMeta(messages) {
  let totalChars = 0;
  let hasSystem = false;

  for (const message of messages) {
    if (message.role === 'system') {
      hasSystem = true;
    }
    totalChars += message.content.length;
  }

  return {
    message_count: messages.length,
    total_chars: totalChars,
    has_system: hasSystem,
  };
}

function toJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return {};
}

async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

function isPurposeAllowedForUser(user, purpose) {
  if (user.role === 'employee') {
    return EMPLOYEE_LLM_PURPOSES.includes(purpose);
  }

  return LLM_PURPOSES.includes(purpose);
}

async function writeLlmRequest(params, executor = db) {
  const result = await executor.query(
    `
      INSERT INTO llm_requests (
        project_id,
        actor_user_id,
        purpose,
        provider,
        model,
        request_meta,
        response_meta,
        input_tokens,
        output_tokens,
        cost_estimate_usd,
        status,
        error_code
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12)
      RETURNING id
    `,
    [
      params.projectId || null,
      params.actorUserId,
      params.purpose,
      params.provider,
      params.model,
      JSON.stringify(toJsonObject(params.requestMeta)),
      JSON.stringify(toJsonObject(params.responseMeta)),
      params.inputTokens ?? null,
      params.outputTokens ?? null,
      params.costEstimateUsd ?? null,
      params.status,
      params.errorCode ?? null,
    ]
  );

  return result.rows[0].id;
}

async function sendAnthropicRequest(body) {
  if (!ANTHROPIC_API_KEY) {
    throw createAppError(502, 'llm_unavailable');
  }

  const workerUsed = Boolean(CLOUDFLARE_WORKER_URL);
  const endpoint = workerUsed
    ? `${CLOUDFLARE_WORKER_URL.replace(/\/+$/, '')}/v1/messages`
    : 'https://api.anthropic.com/v1/messages';

  const headers = {
    'content-type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
  };

  if (workerUsed) {
    if (WORKER_SHARED_SECRET) {
      headers['x-kanban-secret'] = WORKER_SHARED_SECRET;
    }
  } else {
    headers['anthropic-version'] = ANTHROPIC_API_VERSION;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseBody = await readJsonSafely(response);

    return {
      workerUsed,
      statusCode: response.status,
      ok: response.ok,
      body: responseBody,
    };
  } catch (error) {
    throw createAppError(502, 'llm_unavailable');
  } finally {
    clearTimeout(timeout);
  }
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

function isObjectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}

function normalizeNullableString(value) {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function sanitizeTaskForAudit(task) {
  if (!task) {
    return {};
  }

  return {
    id: task.id,
    project_id: task.project_id,
    title: task.title,
    col: task.col,
    stage: task.stage,
    assignee_user_id: task.assignee_user_id,
    track: task.track,
    agent: task.agent,
    priority: task.priority,
    hours: task.hours,
    desc: task.desc,
    notes: task.notes,
    deps: task.deps,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

function parseProjectCreatePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    return { error: 'invalid_payload' };
  }

  return { value: { name } };
}

function normalizeTaskColumn(col, status) {
  if (col !== undefined && status !== undefined && col !== status) {
    return { error: 'invalid_payload' };
  }

  const value = col !== undefined ? col : status;
  if (value === undefined) {
    return { value: undefined };
  }

  if (typeof value !== 'string' || !TASK_COLUMNS.includes(value)) {
    return { error: 'invalid_payload' };
  }

  return { value };
}

function parseTaskCreatePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title) {
    return { error: 'invalid_payload' };
  }

  const colResult = normalizeTaskColumn(payload.col, payload.status);
  if (colResult.error) {
    return colResult;
  }

  const updates = {
    title,
  };

  if (colResult.value !== undefined) {
    updates.col = colResult.value;
  }

  if (payload.stage !== undefined) {
    if (payload.stage !== null && typeof payload.stage !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.stage = normalizeNullableString(payload.stage);
  }

  if (payload.assignee_user_id !== undefined) {
    if (
      payload.assignee_user_id !== null &&
      !isUuid(payload.assignee_user_id)
    ) {
      return { error: 'invalid_payload' };
    }
    updates.assignee_user_id = payload.assignee_user_id;
  }

  if (payload.track !== undefined) {
    if (payload.track !== null && typeof payload.track !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.track = normalizeNullableString(payload.track);
  }

  if (payload.agent !== undefined) {
    if (payload.agent !== null && typeof payload.agent !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.agent = normalizeNullableString(payload.agent);
  }

  if (payload.priority !== undefined) {
    if (!Number.isInteger(payload.priority)) {
      return { error: 'invalid_payload' };
    }
    updates.priority = payload.priority;
  }

  if (payload.hours !== undefined) {
    if (payload.hours !== null && !Number.isFinite(payload.hours)) {
      return { error: 'invalid_payload' };
    }
    updates.hours = payload.hours;
  }

  if (payload.desc !== undefined) {
    if (payload.desc !== null && typeof payload.desc !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.desc = normalizeNullableString(payload.desc);
  }

  if (payload.notes !== undefined) {
    if (payload.notes !== null && typeof payload.notes !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.notes = normalizeNullableString(payload.notes);
  }

  if (payload.deps !== undefined) {
    updates.deps = payload.deps;
  }

  return { value: updates };
}

function parseTaskPatchPayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const colResult = normalizeTaskColumn(payload.col, payload.status);
  if (colResult.error) {
    return colResult;
  }

  const updates = {};
  if (payload.title !== undefined) {
    const title = typeof payload.title === 'string' ? payload.title.trim() : '';
    if (!title) {
      return { error: 'invalid_payload' };
    }
    updates.title = title;
  }

  if (colResult.value !== undefined) {
    updates.col = colResult.value;
  }

  if (payload.stage !== undefined) {
    if (payload.stage !== null && typeof payload.stage !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.stage = normalizeNullableString(payload.stage);
  }

  if (payload.assignee_user_id !== undefined) {
    if (
      payload.assignee_user_id !== null &&
      !isUuid(payload.assignee_user_id)
    ) {
      return { error: 'invalid_payload' };
    }
    updates.assignee_user_id = payload.assignee_user_id;
  }

  if (payload.track !== undefined) {
    if (payload.track !== null && typeof payload.track !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.track = normalizeNullableString(payload.track);
  }

  if (payload.agent !== undefined) {
    if (payload.agent !== null && typeof payload.agent !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.agent = normalizeNullableString(payload.agent);
  }

  if (payload.priority !== undefined) {
    if (!Number.isInteger(payload.priority)) {
      return { error: 'invalid_payload' };
    }
    updates.priority = payload.priority;
  }

  if (payload.hours !== undefined) {
    if (payload.hours !== null && !Number.isFinite(payload.hours)) {
      return { error: 'invalid_payload' };
    }
    updates.hours = payload.hours;
  }

  if (payload.desc !== undefined) {
    if (payload.desc !== null && typeof payload.desc !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.desc = normalizeNullableString(payload.desc);
  }

  if (payload.notes !== undefined) {
    if (payload.notes !== null && typeof payload.notes !== 'string') {
      return { error: 'invalid_payload' };
    }
    updates.notes = normalizeNullableString(payload.notes);
  }

  if (payload.deps !== undefined) {
    updates.deps = payload.deps;
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'invalid_payload' };
  }

  return { value: updates };
}

function parseTaskMovePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const colResult = normalizeTaskColumn(payload.col, payload.status);
  if (colResult.error || colResult.value === undefined) {
    return { error: 'invalid_payload' };
  }

  return { value: { col: colResult.value } };
}

async function findProjectById(projectId, executor = db) {
  const result = await executor.query(
    `
      SELECT id, name, created_by, llm_provider, llm_model, created_at, updated_at
      FROM projects
      WHERE id = $1
      LIMIT 1
    `,
    [projectId]
  );
  return result.rows[0] || null;
}

async function findVisibleProjectById(projectId, user) {
  if (user.role === 'employee') {
    const result = await db.query(
      `
        SELECT p.id, p.name, p.created_by, p.llm_provider, p.llm_model, p.created_at, p.updated_at
        FROM projects p
        WHERE p.id = $1
          AND EXISTS (
            SELECT 1
            FROM tasks t
            WHERE t.project_id = p.id
              AND t.assignee_user_id = $2
          )
        LIMIT 1
      `,
      [projectId, user.id]
    );
    return result.rows[0] || null;
  }

  return findProjectById(projectId);
}

async function findTaskById(taskId, executor = db) {
  const result = await executor.query(
    `
      SELECT id, project_id, title, col, stage, assignee_user_id, track, agent,
             priority, hours, "desc", notes, deps, created_at, updated_at
      FROM tasks
      WHERE id = $1
      LIMIT 1
    `,
    [taskId]
  );
  return result.rows[0] || null;
}

async function writeTaskEvent(params, executor = db) {
  const beforeState = sanitizeTaskForAudit(params.before);
  const afterState = sanitizeTaskForAudit(params.after);
  await executor.query(
    `
      INSERT INTO task_events (
        project_id,
        task_id,
        actor_user_id,
        event_type,
        payload,
        action,
        "before",
        "after"
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $4, $6::jsonb, $7::jsonb)
    `,
    [
      params.projectId,
      params.taskId,
      params.actorUserId,
      params.action,
      JSON.stringify({ before: beforeState, after: afterState }),
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
    ]
  );
}

function buildTaskUpdateStatement(updates) {
  const fieldMap = {
    title: 'title',
    col: 'col',
    stage: 'stage',
    assignee_user_id: 'assignee_user_id',
    track: 'track',
    agent: 'agent',
    priority: 'priority',
    hours: 'hours',
    desc: '"desc"',
    notes: 'notes',
    deps: 'deps',
  };

  const keys = Object.keys(updates);
  const assignments = [];
  const values = [];

  keys.forEach((key, index) => {
    const column = fieldMap[key];
    if (!column) {
      return;
    }
    values.push(updates[key]);
    assignments.push(`${column} = $${index + 1}`);
  });

  assignments.push(`updated_at = NOW()`);

  return {
    setClause: assignments.join(', '),
    values,
  };
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

app.get('/projects', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  try {
    let result;
    if (user.role === 'employee') {
      result = await db.query(
        `
          SELECT DISTINCT p.id, p.name, p.created_by, p.llm_provider, p.llm_model, p.created_at, p.updated_at
          FROM projects p
          INNER JOIN tasks t ON t.project_id = p.id
          WHERE t.assignee_user_id = $1
          ORDER BY p.created_at DESC
        `,
        [user.id]
      );
    } else {
      result = await db.query(
        `
          SELECT id, name, created_by, llm_provider, llm_model, created_at, updated_at
          FROM projects
          ORDER BY created_at DESC
        `
      );
    }

    sendJson(res, 200, { projects: result.rows });
  } catch (error) {
    console.error('GET /projects failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'projects_unavailable' });
  }
});

app.post('/projects', async (req, res) => {
  const user = requireAuth(req, res, PROJECT_WRITE_ROLES);
  if (!user) {
    return;
  }

  const parsed = parseProjectCreatePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const result = await db.query(
      `
        INSERT INTO projects (name, created_by)
        VALUES ($1, $2)
        RETURNING id, name, created_by, llm_provider, llm_model, created_at, updated_at
      `,
      [parsed.value.name, user.id]
    );

    sendJson(res, 201, { project: result.rows[0] });
  } catch (error) {
    console.error('POST /projects failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'projects_unavailable' });
  }
});

app.get('/projects/:id', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_project_id' });
    return;
  }

  try {
    const project = await findVisibleProjectById(id, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    sendJson(res, 200, { project });
  } catch (error) {
    console.error('GET /projects/:id failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'projects_unavailable' });
  }
});

app.get('/projects/:projectId/tasks', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  const { projectId } = req.params;
  if (!isUuid(projectId)) {
    sendJson(res, 400, { error: 'invalid_project_id' });
    return;
  }

  try {
    const project = await findVisibleProjectById(projectId, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    let result;
    if (user.role === 'employee') {
      result = await db.query(
        `
          SELECT id, project_id, title, col, stage, assignee_user_id, track, agent,
                 priority, hours, "desc", notes, deps, created_at, updated_at
          FROM tasks
          WHERE project_id = $1
            AND assignee_user_id = $2
          ORDER BY created_at ASC
        `,
        [projectId, user.id]
      );
    } else {
      result = await db.query(
        `
          SELECT id, project_id, title, col, stage, assignee_user_id, track, agent,
                 priority, hours, "desc", notes, deps, created_at, updated_at
          FROM tasks
          WHERE project_id = $1
          ORDER BY created_at ASC
        `,
        [projectId]
      );
    }

    sendJson(res, 200, { tasks: result.rows });
  } catch (error) {
    console.error('GET /projects/:projectId/tasks failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'tasks_unavailable' });
  }
});

app.post('/projects/:projectId/tasks', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { projectId } = req.params;
  if (!isUuid(projectId)) {
    sendJson(res, 400, { error: 'invalid_project_id' });
    return;
  }

  const parsed = parseTaskCreatePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const project = await findProjectById(projectId);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const payload = parsed.value;
    const task = await runInTransaction(async (tx) => {
      const created = await tx.query(
        `
          INSERT INTO tasks (
            project_id,
            title,
            col,
            stage,
            assignee_user_id,
            track,
            agent,
            priority,
            hours,
            "desc",
            notes,
            deps
          )
          VALUES (
            $1, $2, COALESCE($3, 'backlog'), $4, $5, $6, $7, COALESCE($8, 0), $9, $10, $11, $12
          )
          RETURNING id, project_id, title, col, stage, assignee_user_id, track, agent,
                    priority, hours, "desc", notes, deps, created_at, updated_at
        `,
        [
          projectId,
          payload.title,
          payload.col || null,
          payload.stage ?? null,
          payload.assignee_user_id ?? null,
          payload.track ?? null,
          payload.agent ?? null,
          payload.priority ?? null,
          payload.hours ?? null,
          payload.desc ?? null,
          payload.notes ?? null,
          payload.deps ?? null,
        ]
      );

      const createdTask = created.rows[0];
      await writeTaskEvent(
        {
          projectId,
          taskId: createdTask.id,
          actorUserId: user.id,
          action: 'create',
          before: {},
          after: createdTask,
        },
        tx
      );

      return createdTask;
    });

    sendJson(res, 201, { task });
  } catch (error) {
    if (error && error.code === '23503') {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    console.error('POST /projects/:projectId/tasks failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'tasks_unavailable' });
  }
});

app.patch('/tasks/:id', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  const parsed = parseTaskPatchPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const after = await runInTransaction(async (tx) => {
      const before = await findTaskById(id, tx);
      if (!before) {
        throw createAppError(404, 'task_not_found');
      }

      const update = buildTaskUpdateStatement(parsed.value);
      const result = await tx.query(
        `
          UPDATE tasks
          SET ${update.setClause}
          WHERE id = $${update.values.length + 1}
          RETURNING id, project_id, title, col, stage, assignee_user_id, track, agent,
                    priority, hours, "desc", notes, deps, created_at, updated_at
        `,
        [...update.values, id]
      );
      const updatedTask = result.rows[0];

      await writeTaskEvent(
        {
          projectId: updatedTask.project_id,
          taskId: updatedTask.id,
          actorUserId: user.id,
          action: 'update',
          before,
          after: updatedTask,
        },
        tx
      );

      return updatedTask;
    });

    sendJson(res, 200, { task: after });
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }

    if (error && error.code === '23503') {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    console.error('PATCH /tasks/:id failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'tasks_unavailable' });
  }
});

app.post('/tasks/:id/move', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  const parsed = parseTaskMovePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const after = await runInTransaction(async (tx) => {
      const before = await findTaskById(id, tx);
      if (!before) {
        throw createAppError(404, 'task_not_found');
      }

      const moved = await tx.query(
        `
          UPDATE tasks
          SET col = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING id, project_id, title, col, stage, assignee_user_id, track, agent,
                    priority, hours, "desc", notes, deps, created_at, updated_at
        `,
        [parsed.value.col, id]
      );
      const movedTask = moved.rows[0];

      await writeTaskEvent(
        {
          projectId: movedTask.project_id,
          taskId: movedTask.id,
          actorUserId: user.id,
          action: 'move',
          before,
          after: movedTask,
        },
        tx
      );

      return movedTask;
    });

    sendJson(res, 200, { task: after });
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }

    console.error('POST /tasks/:id/move failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'tasks_unavailable' });
  }
});

app.get('/api/llm/models', (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  const requestedProvider =
    typeof req.query.provider === 'string'
      ? req.query.provider.trim().toLowerCase()
      : '';
  const provider = requestedProvider || LLM_DEFAULT_PROVIDER;
  const models = getLlmAllowedModels(provider);
  if (models.length === 0) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  sendJson(res, 200, { provider, models });
});

app.post('/api/llm/chat', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = parseLlmChatPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  if (!isPurposeAllowedForUser(user, parsed.value.purpose)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  const rateLimit = consumeLlmRateLimit(user.id);
  if (!rateLimit.allowed) {
    if (rateLimit.retryAfterSeconds > 0) {
      res.set('Retry-After', String(rateLimit.retryAfterSeconds));
    }
    sendJson(res, 429, { error: 'rate_limited' });
    return;
  }

  const resolved = resolveLlmProviderAndModel(parsed.value);
  if (resolved.error) {
    sendJson(res, 400, { error: resolved.error });
    return;
  }

  if (resolved.value.provider !== 'anthropic') {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  const anthropicRequest = buildAnthropicRequest(parsed.value, resolved.value.model);
  if (anthropicRequest.error) {
    sendJson(res, 400, { error: anthropicRequest.error });
    return;
  }

  const startedAt = Date.now();
  const messageMeta = getLlmMessageMeta(parsed.value.messages);
  const requestMeta = {
    ...messageMeta,
    params: {
      max_tokens: anthropicRequest.value.max_tokens,
      ...(anthropicRequest.value.temperature !== undefined
        ? { temperature: anthropicRequest.value.temperature }
        : {}),
    },
    worker_used: Boolean(CLOUDFLARE_WORKER_URL),
  };

  let providerStatusCode = null;
  let workerUsed = Boolean(CLOUDFLARE_WORKER_URL);

  try {
    const providerResult = await sendAnthropicRequest(anthropicRequest.value);
    providerStatusCode = providerResult.statusCode;
    workerUsed = providerResult.workerUsed;

    const inputTokens = Number.isInteger(
      providerResult.body && providerResult.body.usage && providerResult.body.usage.input_tokens
    )
      ? providerResult.body.usage.input_tokens
      : null;
    const outputTokens = Number.isInteger(
      providerResult.body &&
        providerResult.body.usage &&
        providerResult.body.usage.output_tokens
    )
      ? providerResult.body.usage.output_tokens
      : null;
    const responseMeta = {
      worker_used: workerUsed,
      latency_ms: Date.now() - startedAt,
      provider_http_status: providerStatusCode,
      response_id:
        providerResult.body && typeof providerResult.body.id === 'string'
          ? providerResult.body.id
          : null,
      stop_reason:
        providerResult.body &&
        typeof providerResult.body.stop_reason === 'string'
          ? providerResult.body.stop_reason
          : null,
    };

    if (!providerResult.ok) {
      const providerErrorCode =
        providerResult.body &&
        providerResult.body.error &&
        typeof providerResult.body.error.type === 'string'
          ? providerResult.body.error.type
          : `provider_http_${providerStatusCode}`;

      try {
        await writeLlmRequest({
          projectId: parsed.value.project_id || null,
          actorUserId: user.id,
          purpose: parsed.value.purpose,
          provider: resolved.value.provider,
          model: resolved.value.model,
          requestMeta,
          responseMeta,
          inputTokens,
          outputTokens,
          costEstimateUsd: null,
          status: 'error',
          errorCode: providerErrorCode,
        });
      } catch (error) {
        console.error('LLM request audit write failed:', error.message);
        if (isDevelopment() && error.stack) {
          console.error(error.stack);
        }
        sendJson(res, 500, { error: 'internal_error' });
        return;
      }

      sendJson(res, 502, { error: 'llm_unavailable' });
      return;
    }

    const text = extractAnthropicText(providerResult.body);
    let requestId;
    try {
      requestId = await writeLlmRequest({
        projectId: parsed.value.project_id || null,
        actorUserId: user.id,
        purpose: parsed.value.purpose,
        provider: resolved.value.provider,
        model: resolved.value.model,
        requestMeta,
        responseMeta,
        inputTokens,
        outputTokens,
        costEstimateUsd: null,
        status: 'ok',
        errorCode: null,
      });
    } catch (error) {
      console.error('LLM request audit write failed:', error.message);
      if (isDevelopment() && error.stack) {
        console.error(error.stack);
      }
      sendJson(res, 500, { error: 'internal_error' });
      return;
    }

    const usage = {};
    if (inputTokens !== null) {
      usage.input_tokens = inputTokens;
    }
    if (outputTokens !== null) {
      usage.output_tokens = outputTokens;
    }

    sendJson(res, 200, {
      text,
      provider: resolved.value.provider,
      model:
        providerResult.body && typeof providerResult.body.model === 'string'
          ? providerResult.body.model
          : resolved.value.model,
      usage,
      request_id: requestId,
    });
  } catch (error) {
    const responseMeta = {
      worker_used: workerUsed,
      latency_ms: Date.now() - startedAt,
      provider_http_status: providerStatusCode,
      response_id: null,
      stop_reason: null,
    };

    try {
      await writeLlmRequest({
        projectId: parsed.value.project_id || null,
        actorUserId: user.id,
        purpose: parsed.value.purpose,
        provider: resolved.value.provider,
        model: resolved.value.model,
        requestMeta,
        responseMeta,
        inputTokens: null,
        outputTokens: null,
        costEstimateUsd: null,
        status: 'error',
        errorCode: isAppError(error) ? error.errorCode : 'provider_request_failed',
      });
    } catch (auditError) {
      console.error('LLM request audit write failed:', auditError.message);
      if (isDevelopment() && auditError.stack) {
        console.error(auditError.stack);
      }
      sendJson(res, 500, { error: 'internal_error' });
      return;
    }

    if (isAppError(error) && error.errorCode === 'llm_unavailable') {
      sendJson(res, 502, { error: 'llm_unavailable' });
      return;
    }

    console.error('POST /api/llm/chat failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
  }
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
