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
const TASK_TRASH_LIST_DEFAULT_LIMIT = 100;
const TASK_TRASH_LIST_MAX_LIMIT = 500;
const TASK_COLUMN_ALIASES = {
  backlog: 'backlog',
  todo: 'todo',
  doing: 'doing',
  inprogress: 'doing',
  in_progress: 'doing',
  review: 'review',
  done: 'done',
};
const DEFAULT_PROJECT_STAGES = ['A', 'R1', 'R1.1', 'R2', 'R3+', 'F'];
const DEFAULT_STAGE_COLOR_PALETTE = [
  '#4a9eff',
  '#a78bfa',
  '#fb923c',
  '#f87171',
  '#4ade80',
  '#22d3ee',
  '#f59e0b',
  '#f472b6',
];
const TIMER_WRITE_ROLES = ['admin', 'techlead'];
const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_change_me';
const JWT_TTL_HOURS = Number(process.env.JWT_TTL_HOURS) || 24;
const JWT_TTL_SECONDS = JWT_TTL_HOURS * 60 * 60;
const LLM_PURPOSES = ['new_task', 'chat', 'import_parse'];
const EMPLOYEE_LLM_PURPOSES = ['chat'];
const SERVICE_ACCOUNT_SCOPES = [
  'tasks:read',
  'tasks:comment',
  'tasks:move',
  'tasks:write',
  'events:read',
];
const AGENT_ACTION_TYPES = [
  'task_comment',
  'task_move',
  'task_patch',
  'task_create',
  'task_link_artifact',
];
const AGENT_ARTIFACT_KINDS = ['plan', 'diff', 'test_report', 'log', 'other'];
const AGENT_ACTION_SCOPES = {
  task_comment: 'tasks:comment',
  task_link_artifact: 'tasks:comment',
  task_move: 'tasks:move',
  task_patch: 'tasks:write',
  task_create: 'tasks:write',
};
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MAX_AGENT_EVENT_TEXT_CHARS = 20000;
const MAX_AGENT_EVENT_JSON_CHARS = 20000;
const MAX_AGENT_EVENT_JSON_PREVIEW_CHARS = 1000;
const MAX_TASK_DESCRIPT_LENGTH = 5000;
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
const LLM_STUB_MODE = process.env.LLM_STUB_MODE === '1';
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
  const workerUsed = Boolean(CLOUDFLARE_WORKER_URL);
  const endpoint = workerUsed
    ? `${CLOUDFLARE_WORKER_URL.replace(/\/+$/, '')}/v1/messages`
    : 'https://api.anthropic.com/v1/messages';

  const headers = {
    'content-type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
  };

  if (workerUsed) {
    headers['x-kanban-secret'] = WORKER_SHARED_SECRET || '';
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

function tryParseJsonBlock(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null;
  }

  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch (_) {
    // fallback: try first object/array fragment
  }

  const objectMatch = candidate.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch (_) {
      // ignore
    }
  }

  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]);
    } catch (_) {
      // ignore
    }
  }

  return null;
}

function ensureTaskDialogShape(value) {
  if (!isObjectPayload(value)) {
    return null;
  }

  const title =
    typeof value.title === 'string' ? value.title.trim() : '';
  const descript =
    typeof value.descript === 'string'
      ? value.descript.trim()
      : typeof value.description === 'string'
      ? value.description.trim()
      : '';
  const stage =
    typeof value.stage === 'string' ? value.stage.trim() : '';
  const priority = Number(value.priority);

  if (!title || !descript || !stage || !Number.isFinite(priority)) {
    return null;
  }

  return {
    title,
    descript,
    stage,
    priority: Math.max(0, Math.round(priority)),
  };
}

function buildFallbackDialogTask(messages) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user');
  const source = lastUserMessage ? lastUserMessage.content.trim() : '';
  const baseTitle = source ? source.split('\n')[0].slice(0, 80) : 'Новая задача';
  const lowered = source.toLowerCase();

  let stage = 'A';
  if (/(mvp|todo|реализац|фич|backend|frontend)/i.test(lowered)) {
    stage = 'R1';
  }
  if (/(запуск|релиз|production|prod)/i.test(lowered)) {
    stage = 'F';
  }

  let priority = 2;
  if (/(крит|сроч|urgent|asap|блокер)/i.test(lowered)) {
    priority = 3;
  } else if (/(minor|низк|косметич)/i.test(lowered)) {
    priority = 1;
  }

  return {
    title: baseTitle || 'Новая задача',
    descript: source || 'Описание не предоставлено',
    stage,
    priority,
  };
}

function normalizeImportedTasks(candidate) {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const tasks = [];
  for (const item of candidate) {
    if (!isObjectPayload(item)) {
      continue;
    }

    const title =
      typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) {
      continue;
    }

    const stage =
      typeof item.stage === 'string' && item.stage.trim()
        ? item.stage.trim()
        : 'A';
    const description =
      typeof item.description === 'string'
        ? item.description.trim()
        : typeof item.descript === 'string'
        ? item.descript.trim()
        : '';
    const notes =
      typeof item.notes === 'string' ? item.notes.trim() : null;
    const release =
      typeof item.release === 'string' ? item.release.trim() : null;
    const priority =
      Number.isInteger(item.priority) ? item.priority : 0;

    tasks.push({
      title,
      stage,
      description: description || null,
      notes,
      release,
      priority,
    });
  }

  return tasks;
}

function fallbackImportTasksFromContent(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const tasks = [];
  for (const line of lines.slice(0, 100)) {
    if (line.length < 4) {
      continue;
    }
    tasks.push({
      title: line.slice(0, 140),
      stage: 'A',
      description: line,
      notes: null,
      release: null,
      priority: 0,
    });
  }

  return tasks;
}

function formatDurationIso(msInput) {
  const totalMs = Math.max(0, Number(msInput) || 0);
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);
  return `P${days}DT${hours}H${minutes}M${seconds}S`;
}

function computeTimerSnapshot(timerRow) {
  if (!timerRow) {
    return {
      projectMs: 0,
      delayMs: 0,
      status: 'paused',
      deadline: null,
    };
  }

  const nowMs = Date.now();
  const projectStartedAtMs = timerRow.project_started_at
    ? Date.parse(timerRow.project_started_at)
    : null;
  const delayStartedAtMs = timerRow.client_delay_started_at
    ? Date.parse(timerRow.client_delay_started_at)
    : null;

  const projectMs =
    Number(timerRow.project_elapsed_ms || 0) +
    (timerRow.status === 'running' && projectStartedAtMs
      ? Math.max(0, nowMs - projectStartedAtMs)
      : 0);
  const delayMs =
    Number(timerRow.client_delay_elapsed_ms || 0) +
    (timerRow.status === 'paused' && delayStartedAtMs
      ? Math.max(0, nowMs - delayStartedAtMs)
      : 0);

  return {
    projectMs,
    delayMs,
    status: timerRow.status || 'paused',
    deadline: timerRow.deadline_at || null,
  };
}

async function findProjectTimerByProjectId(projectId, executor = db) {
  const result = await executor.query(
    `
      SELECT project_id, status, project_origin_started_at, project_started_at,
             project_elapsed_ms, client_delay_started_at, client_delay_elapsed_ms,
             deadline_at, created_at, updated_at
      FROM project_timers
      WHERE project_id = $1
      LIMIT 1
    `,
    [projectId]
  );
  return result.rows[0] || null;
}

async function requestLlmText(params) {
  const rateLimit = consumeLlmRateLimit(params.user.id);
  if (!rateLimit.allowed) {
    throw createAppError(429, 'rate_limited');
  }

  const payload = {
    purpose: params.purpose,
    project_id: params.projectId || null,
    provider: params.provider || LLM_DEFAULT_PROVIDER,
    model: params.model || LLM_DEFAULT_MODEL,
    messages: [
      { role: 'system', content: params.systemPrompt },
      ...params.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
    params: {
      max_tokens: params.maxTokens || 1200,
      temperature:
        params.temperature !== undefined ? params.temperature : 0.1,
    },
  };

  const resolved = resolveLlmProviderAndModel(payload);
  if (resolved.error || resolved.value.provider !== 'anthropic') {
    throw createAppError(400, 'invalid_payload');
  }

  const anthropicRequest = buildAnthropicRequest(payload, resolved.value.model);
  if (anthropicRequest.error) {
    throw createAppError(400, anthropicRequest.error);
  }

  const startedAt = Date.now();
  const requestMeta = {
    ...getLlmMessageMeta(payload.messages),
    params: payload.params,
    worker_used: Boolean(CLOUDFLARE_WORKER_URL),
  };

  if (!ANTHROPIC_API_KEY) {
    const status = LLM_STUB_MODE ? 'ok' : 'error';
    const errorCode = LLM_STUB_MODE ? null : 'missing_api_key';

    await writeLlmRequest({
      projectId: payload.project_id,
      actorUserId: params.user.id,
      purpose: params.purpose,
      provider: resolved.value.provider,
      model: resolved.value.model,
      requestMeta,
      responseMeta: {
        worker_used: Boolean(CLOUDFLARE_WORKER_URL),
        latency_ms: Date.now() - startedAt,
        provider_http_status: null,
        response_id: null,
        stop_reason: null,
        stub: LLM_STUB_MODE,
      },
      inputTokens: 0,
      outputTokens: 0,
      costEstimateUsd: null,
      status,
      errorCode,
    });

    if (LLM_STUB_MODE) {
      return 'LLM_STUB_OK';
    }

    throw createAppError(502, 'llm_unavailable');
  }

  const providerResult = await sendAnthropicRequest(anthropicRequest.value);
  if (!providerResult.ok) {
    await writeLlmRequest({
      projectId: payload.project_id,
      actorUserId: params.user.id,
      purpose: params.purpose,
      provider: resolved.value.provider,
      model: resolved.value.model,
      requestMeta,
      responseMeta: {
        worker_used: providerResult.workerUsed,
        latency_ms: Date.now() - startedAt,
        provider_http_status: providerResult.statusCode,
        response_id: null,
        stop_reason: null,
      },
      inputTokens: null,
      outputTokens: null,
      costEstimateUsd: null,
      status: 'error',
      errorCode: 'provider_request_failed',
    });
    throw createAppError(502, 'llm_unavailable');
  }

  const inputTokens = Number.isInteger(
    providerResult.body &&
      providerResult.body.usage &&
      providerResult.body.usage.input_tokens
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

  await writeLlmRequest({
    projectId: payload.project_id,
    actorUserId: params.user.id,
    purpose: params.purpose,
    provider: resolved.value.provider,
    model: resolved.value.model,
    requestMeta,
    responseMeta: {
      worker_used: providerResult.workerUsed,
      latency_ms: Date.now() - startedAt,
      provider_http_status: providerResult.statusCode,
      response_id:
        providerResult.body && typeof providerResult.body.id === 'string'
          ? providerResult.body.id
          : null,
      stop_reason:
        providerResult.body &&
        typeof providerResult.body.stop_reason === 'string'
          ? providerResult.body.stop_reason
          : null,
    },
    inputTokens,
    outputTokens,
    costEstimateUsd: null,
    status: 'ok',
    errorCode: null,
  });

  return extractAnthropicText(providerResult.body);
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

function normalizeRequiredString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function truncateString(value, maxChars) {
  if (typeof value !== 'string') {
    return '';
  }
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars);
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return null;
  }
}

function hashServiceToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createServiceToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sanitizeServiceScopes(scopes) {
  if (!Array.isArray(scopes)) {
    return null;
  }

  const normalized = [];
  const seen = new Set();
  for (const scope of scopes) {
    if (typeof scope !== 'string') {
      return null;
    }
    const value = scope.trim();
    if (!SERVICE_ACCOUNT_SCOPES.includes(value)) {
      return null;
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}

function hasServiceScope(service, scope) {
  return Array.isArray(service.scopes) && service.scopes.includes(scope);
}

function requireServiceScope(req, res, scope) {
  if (!req.service || !hasServiceScope(req.service, scope)) {
    sendJson(res, 403, { error: 'forbidden' });
    return false;
  }
  return true;
}

async function requireServiceAuth(req, res) {
  const rawToken = req.headers['x-service-token'];
  const token =
    typeof rawToken === 'string' ? rawToken.trim() : '';

  if (!token) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }

  const tokenHash = hashServiceToken(token);
  const result = await db.query(
    `
      SELECT id, name, scopes
      FROM service_accounts
      WHERE token_hash = $1
        AND revoked_at IS NULL
      LIMIT 1
    `,
    [tokenHash]
  );

  if (result.rowCount === 0) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }

  const row = result.rows[0];
  req.service = {
    id: row.id,
    name: row.name,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
  };
  return req.service;
}

function parseServiceAccountCreatePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const name = normalizeRequiredString(payload.name);
  if (!name) {
    return { error: 'invalid_payload' };
  }

  const scopes = sanitizeServiceScopes(payload.scopes);
  if (!scopes) {
    return { error: 'invalid_payload' };
  }

  return { value: { name, scopes } };
}

function parseAgentActionsPayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const idempotencyKey = normalizeRequiredString(payload.idempotency_key);
  if (
    !idempotencyKey ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH
  ) {
    return { error: 'invalid_payload' };
  }

  let runId = null;
  if (payload.run_id !== undefined && payload.run_id !== null) {
    if (!isUuid(payload.run_id)) {
      return { error: 'invalid_payload' };
    }
    runId = payload.run_id;
  }

  if (!isObjectPayload(payload.agent)) {
    return { error: 'invalid_payload' };
  }

  const agentName = normalizeRequiredString(payload.agent.name);
  const agentRole = normalizeRequiredString(payload.agent.role);
  if (!agentName || !agentRole) {
    return { error: 'invalid_payload' };
  }

  if (!Array.isArray(payload.actions) || payload.actions.length === 0) {
    return { error: 'invalid_payload' };
  }

  const actions = [];
  for (const action of payload.actions) {
    const parsedAction = parseSingleAgentAction(action);
    if (parsedAction.error) {
      return parsedAction;
    }
    actions.push(parsedAction.value);
  }

  return {
    value: {
      idempotencyKey,
      runId,
      agent: {
        name: agentName,
        role: agentRole,
      },
      actions,
    },
  };
}

function parseSingleAgentAction(action) {
  if (!isObjectPayload(action)) {
    return { error: 'invalid_payload' };
  }

  const actionType =
    typeof action.type === 'string' ? action.type.trim() : '';
  if (!AGENT_ACTION_TYPES.includes(actionType)) {
    return { error: 'invalid_payload' };
  }

  if (!isObjectPayload(action.payload)) {
    return { error: 'invalid_payload' };
  }

  if (actionType === 'task_comment') {
    return parseAgentTaskCommentAction(action.payload);
  }

  if (actionType === 'task_link_artifact') {
    return parseAgentTaskLinkArtifactAction(action.payload);
  }

  if (actionType === 'task_move') {
    return parseAgentTaskMoveAction(action.payload);
  }

  if (actionType === 'task_patch') {
    return parseAgentTaskPatchAction(action.payload);
  }

  if (actionType === 'task_create') {
    return parseAgentTaskCreateAction(action.payload);
  }

  return { error: 'invalid_payload' };
}

function parseAgentTaskCommentAction(payload) {
  if (!isUuid(payload.task_id)) {
    return { error: 'invalid_payload' };
  }

  const text = normalizeRequiredString(payload.text);
  if (!text) {
    return { error: 'invalid_payload' };
  }

  const format =
    typeof payload.format === 'string' ? payload.format.trim() : '';
  if (!['text', 'markdown'].includes(format)) {
    return { error: 'invalid_payload' };
  }

  let tags = [];
  if (payload.tags !== undefined) {
    if (!Array.isArray(payload.tags)) {
      return { error: 'invalid_payload' };
    }
    const normalizedTags = [];
    for (const tag of payload.tags) {
      const normalizedTag = normalizeRequiredString(tag);
      if (!normalizedTag) {
        return { error: 'invalid_payload' };
      }
      normalizedTags.push(normalizedTag);
    }
    tags = normalizedTags;
  }

  return {
    value: {
      type: 'task_comment',
      payload: {
        taskId: payload.task_id,
        text,
        format,
        tags,
      },
    },
  };
}

function parseAgentTaskLinkArtifactAction(payload) {
  if (!isUuid(payload.task_id)) {
    return { error: 'invalid_payload' };
  }

  const kind =
    typeof payload.kind === 'string' ? payload.kind.trim() : '';
  if (!AGENT_ARTIFACT_KINDS.includes(kind)) {
    return { error: 'invalid_payload' };
  }

  if (payload.data === undefined) {
    return { error: 'invalid_payload' };
  }

  const serialized = safeJsonStringify(payload.data);
  if (serialized === null) {
    return { error: 'invalid_payload' };
  }

  return {
    value: {
      type: 'task_link_artifact',
      payload: {
        taskId: payload.task_id,
        kind,
        data: payload.data,
      },
    },
  };
}

function parseAgentTaskMoveAction(payload) {
  if (!isUuid(payload.task_id)) {
    return { error: 'invalid_payload' };
  }

  const statusResult = normalizeTaskColumn(payload.to_status, undefined);
  if (statusResult.error || statusResult.value === undefined) {
    return { error: 'invalid_payload' };
  }

  const reason = normalizeRequiredString(payload.reason);
  if (!reason) {
    return { error: 'invalid_payload' };
  }

  return {
    value: {
      type: 'task_move',
      payload: {
        taskId: payload.task_id,
        toStatus: statusResult.value,
        reason,
      },
    },
  };
}

function parseAgentTaskPatchAction(payload) {
  if (!isUuid(payload.task_id)) {
    return { error: 'invalid_payload' };
  }

  const parsedPatch = parseTaskPatchPayload(payload.patch);
  if (parsedPatch.error) {
    return parsedPatch;
  }

  return {
    value: {
      type: 'task_patch',
      payload: {
        taskId: payload.task_id,
        patch: parsedPatch.value,
      },
    },
  };
}

function parseAgentTaskCreateAction(payload) {
  if (!isUuid(payload.project_id)) {
    return { error: 'invalid_payload' };
  }

  const createPayload = {
    title: payload.title,
  };

  if (payload.description !== undefined) {
    if (payload.description !== null && typeof payload.description !== 'string') {
      return { error: 'invalid_payload' };
    }
    createPayload.descript =
      payload.description === null
        ? null
        : normalizeNullableString(payload.description);
  }

  if (payload.status !== undefined) {
    createPayload.status = payload.status;
  }

  const parsedCreate = parseTaskCreatePayload(createPayload);
  if (parsedCreate.error) {
    return parsedCreate;
  }

  if (
    payload.meta !== undefined &&
    payload.meta !== null &&
    !isObjectPayload(payload.meta)
  ) {
    return { error: 'invalid_payload' };
  }

  return {
    value: {
      type: 'task_create',
      payload: {
        projectId: payload.project_id,
        create: parsedCreate.value,
        meta: payload.meta || {},
      },
    },
  };
}

function truncateJsonForAgentEvent(value) {
  const serialized = safeJsonStringify(value);
  if (serialized === null) {
    return {
      summary: {
        truncated: true,
        original_size_chars: null,
        preview: 'unserializable',
      },
    };
  }

  if (serialized.length <= MAX_AGENT_EVENT_JSON_CHARS) {
    return value;
  }

  return {
    summary: {
      truncated: true,
      original_size_chars: serialized.length,
      preview: truncateString(serialized, MAX_AGENT_EVENT_JSON_PREVIEW_CHARS),
    },
  };
}

function buildAgentEventMeta(context, actionType, details = {}) {
  return {
    source: 'agent',
    service_account_id: context.service.id,
    agent: {
      name: context.agent.name,
      role: context.agent.role,
    },
    run_id: context.runId,
    idempotency_key: context.idempotencyKey,
    action: {
      type: actionType,
    },
    ...details,
  };
}

function sanitizeTaskForAudit(task) {
  if (!task) {
    return {};
  }

  return {
    id: task.id,
    public_id: task.public_id,
    project_id: task.project_id,
    title: task.title,
    col: task.col,
    position: task.position,
    stage: task.stage,
    assignee_user_id: task.assignee_user_id,
    track: task.track,
    agent: task.agent,
    priority: task.priority,
    hours: task.hours,
    descript: task.descript,
    notes: task.notes,
    deps: task.deps,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

function normalizeProjectStages(rawStages) {
  if (rawStages === undefined) {
    return { value: undefined };
  }

  if (!Array.isArray(rawStages) || rawStages.length === 0) {
    return { error: 'invalid_payload' };
  }

  const stages = [];
  const seen = new Set();
  for (const stage of rawStages) {
    if (typeof stage !== 'string') {
      return { error: 'invalid_payload' };
    }
    const normalized = stage.trim();
    if (!normalized) {
      return { error: 'invalid_payload' };
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    stages.push(normalized);
  }

  if (stages.length === 0) {
    return { error: 'invalid_payload' };
  }

  return { value: stages };
}

function isValidHexColor(value) {
  return (
    typeof value === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(value.trim())
  );
}

function buildDefaultStageSettings(stages, budgetTotal) {
  const stageList = Array.isArray(stages) && stages.length > 0
    ? stages
    : DEFAULT_PROJECT_STAGES;
  const total = Number.isFinite(budgetTotal) ? Math.max(0, budgetTotal) : 0;
  const perStage = stageList.length > 0 ? Math.floor(total / stageList.length) : 0;
  let remainder = stageList.length > 0 ? total - perStage * stageList.length : 0;

  return stageList.map((stage, index) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder = Math.max(0, remainder - extra);
    return {
      name: stage,
      budget: perStage + extra,
      color: DEFAULT_STAGE_COLOR_PALETTE[index % DEFAULT_STAGE_COLOR_PALETTE.length],
    };
  });
}

function normalizeProjectStageSettings(rawSettings) {
  if (rawSettings === undefined) {
    return { value: undefined };
  }

  if (!Array.isArray(rawSettings) || rawSettings.length === 0) {
    return { error: 'invalid_payload' };
  }

  const normalized = [];
  const seen = new Set();
  for (const item of rawSettings) {
    if (!isObjectPayload(item)) {
      return { error: 'invalid_payload' };
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) {
      return { error: 'invalid_payload' };
    }

    const nameKey = name.toLowerCase();
    if (seen.has(nameKey)) {
      continue;
    }

    const budget = Number(item.budget);
    if (!Number.isFinite(budget) || budget < 0) {
      return { error: 'invalid_payload' };
    }

    const color = typeof item.color === 'string' ? item.color.trim() : '';
    if (!isValidHexColor(color)) {
      return { error: 'invalid_payload' };
    }

    seen.add(nameKey);
    normalized.push({
      name,
      budget: Math.round(budget),
      color: color.toLowerCase(),
    });
  }

  if (normalized.length === 0) {
    return { error: 'invalid_payload' };
  }

  return { value: normalized };
}

function parseProjectCreatePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!name) {
    return { error: 'invalid_payload' };
  }

  let durationWeeks = 0;
  if (payload.duration_weeks !== undefined) {
    if (
      !Number.isInteger(payload.duration_weeks) ||
      payload.duration_weeks < 0
    ) {
      return { error: 'invalid_payload' };
    }
    durationWeeks = payload.duration_weeks;
  }

  let budgetTotal = 0;
  if (payload.budget_total !== undefined) {
    if (
      !Number.isInteger(payload.budget_total) ||
      payload.budget_total < 0
    ) {
      return { error: 'invalid_payload' };
    }
    budgetTotal = payload.budget_total;
  }

  const stagesResult = normalizeProjectStages(payload.stages);
  if (stagesResult.error) {
    return stagesResult;
  }

  const stageSettingsResult = normalizeProjectStageSettings(payload.stage_settings);
  if (stageSettingsResult.error) {
    return stageSettingsResult;
  }

  const stages =
    stageSettingsResult.value
      ? stageSettingsResult.value.map((item) => item.name)
      : stagesResult.value || DEFAULT_PROJECT_STAGES;

  const stageSettings =
    stageSettingsResult.value ||
    buildDefaultStageSettings(stages, budgetTotal);
  const stageSettingsBudgetTotal = stageSettings.reduce(
    (sum, item) => sum + Math.max(0, Math.round(Number(item.budget || 0))),
    0
  );
  const resolvedBudgetTotal = stageSettingsBudgetTotal > 0
    ? stageSettingsBudgetTotal
    : budgetTotal;

  return {
    value: {
      name,
      duration_weeks: durationWeeks,
      budget_total: resolvedBudgetTotal,
      stages,
      stage_settings: stageSettings,
    },
  };
}

function parseProjectActivatePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  if (payload.project_id === null) {
    return { value: { project_id: null } };
  }

  if (!isUuid(payload.project_id)) {
    return { error: 'invalid_payload' };
  }

  return { value: { project_id: payload.project_id } };
}

function parseProjectDeletePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  if (typeof payload.confirm_name !== 'string') {
    return { error: 'invalid_payload' };
  }

  if (!payload.confirm_name.trim()) {
    return { error: 'invalid_payload' };
  }

  return {
    value: {
      confirm_name: payload.confirm_name,
    },
  };
}

function parseTaskDialogPayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  let projectId = null;
  if (payload.project_id !== undefined && payload.project_id !== null) {
    if (!isUuid(payload.project_id)) {
      return { error: 'invalid_payload' };
    }
    projectId = payload.project_id;
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return { error: 'invalid_payload' };
  }

  const messages = [];
  for (const message of payload.messages) {
    if (!isObjectPayload(message)) {
      return { error: 'invalid_payload' };
    }
    const role =
      typeof message.role === 'string' ? message.role.trim() : '';
    const content =
      typeof message.content === 'string' ? message.content.trim() : '';
    if (!['user', 'assistant'].includes(role) || !content) {
      return { error: 'invalid_payload' };
    }
    messages.push({ role, content });
  }

  return {
    value: {
      project_id: projectId,
      messages,
    },
  };
}

function parseImportExcelPayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  let projectId = null;
  if (payload.project_id !== undefined && payload.project_id !== null) {
    if (!isUuid(payload.project_id)) {
      return { error: 'invalid_payload' };
    }
    projectId = payload.project_id;
  }

  const content =
    typeof payload.content === 'string' ? payload.content.trim() : '';
  if (!content) {
    return { error: 'invalid_payload' };
  }

  const fileName =
    typeof payload.file_name === 'string'
      ? payload.file_name.trim()
      : null;

  return {
    value: {
      project_id: projectId,
      file_name: fileName || null,
      content,
    },
  };
}

function normalizeTaskColumn(col, status) {
  if (col !== undefined && status !== undefined && col !== status) {
    return { error: 'invalid_payload' };
  }

  const value = col !== undefined ? col : status;
  if (value === undefined) {
    return { value: undefined };
  }

  if (typeof value !== 'string') {
    return { error: 'invalid_payload' };
  }

  const key = value.trim().toLowerCase();
  const normalized = TASK_COLUMN_ALIASES[key];
  if (!normalized || !TASK_COLUMNS.includes(normalized)) {
    return { error: 'invalid_payload' };
  }

  return { value: normalized };
}

function normalizeTaskDescriptField(payload) {
  if (!isObjectPayload(payload)) {
    return { value: undefined };
  }

  const hasDescript = payload.descript !== undefined;
  const hasDescription = payload.description !== undefined;

  if (!hasDescript && !hasDescription) {
    return { value: undefined };
  }

  const value = hasDescript
    ? payload.descript
    : payload.description;

  if (value !== null && typeof value !== 'string') {
    return { error: 'invalid_payload' };
  }

  const normalized = normalizeNullableString(value);
  if (
    normalized !== null &&
    normalized.length > MAX_TASK_DESCRIPT_LENGTH
  ) {
    return { error: 'invalid_payload' };
  }

  return { value: normalized };
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

  const descriptResult = normalizeTaskDescriptField(payload);
  if (descriptResult.error) {
    return descriptResult;
  }
  if (descriptResult.value !== undefined) {
    updates.descript = descriptResult.value;
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

  const descriptResult = normalizeTaskDescriptField(payload);
  if (descriptResult.error) {
    return descriptResult;
  }
  if (descriptResult.value !== undefined) {
    updates.descript = descriptResult.value;
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

function parseTaskReorderPayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  const colResult = normalizeTaskColumn(
    payload.column !== undefined ? payload.column : payload.col,
    payload.status
  );
  if (colResult.error || colResult.value === undefined) {
    return { error: 'invalid_payload' };
  }

  if (!Array.isArray(payload.order)) {
    return { error: 'invalid_payload' };
  }

  const seen = new Set();
  const order = [];
  for (const taskId of payload.order) {
    if (!isUuid(taskId)) {
      return { error: 'invalid_payload' };
    }
    if (seen.has(taskId)) {
      continue;
    }
    seen.add(taskId);
    order.push(taskId);
  }

  return {
    value: {
      column: colResult.value,
      order,
    },
  };
}

function parseTaskRestorePayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }

  if (!isUuid(payload.project_id)) {
    return { error: 'invalid_payload' };
  }

  const colResult = normalizeTaskColumn(payload.col, payload.status);
  if (colResult.error || colResult.value === undefined) {
    return { error: 'invalid_payload' };
  }

  if (typeof payload.stage !== 'string' || !payload.stage.trim()) {
    return { error: 'invalid_payload' };
  }

  let createStageIfMissing = false;
  if (payload.create_stage_if_missing !== undefined) {
    if (typeof payload.create_stage_if_missing !== 'boolean') {
      return { error: 'invalid_payload' };
    }
    createStageIfMissing = payload.create_stage_if_missing;
  }

  return {
    value: {
      project_id: payload.project_id,
      col: colResult.value,
      stage: payload.stage.trim(),
      create_stage_if_missing: createStageIfMissing,
    },
  };
}

function parseTaskTrashQuery(query) {
  const parsed = {
    q: '',
    project_id: null,
    stage: '',
    deleted_by: '',
    deleted_from: null,
    deleted_to: null,
    limit: TASK_TRASH_LIST_DEFAULT_LIMIT,
  };

  if (query.q !== undefined) {
    if (typeof query.q !== 'string') {
      return { error: 'invalid_payload' };
    }
    parsed.q = query.q.trim();
  }

  if (query.project_id !== undefined) {
    if (typeof query.project_id !== 'string' || !isUuid(query.project_id)) {
      return { error: 'invalid_payload' };
    }
    parsed.project_id = query.project_id;
  }

  if (query.stage !== undefined) {
    if (typeof query.stage !== 'string') {
      return { error: 'invalid_payload' };
    }
    parsed.stage = query.stage.trim();
  }

  if (query.deleted_by !== undefined) {
    if (typeof query.deleted_by !== 'string') {
      return { error: 'invalid_payload' };
    }
    parsed.deleted_by = query.deleted_by.trim();
  }

  if (query.deleted_from !== undefined) {
    if (typeof query.deleted_from !== 'string' || !query.deleted_from.trim()) {
      return { error: 'invalid_payload' };
    }
    const fromDate = new Date(query.deleted_from);
    if (Number.isNaN(fromDate.getTime())) {
      return { error: 'invalid_payload' };
    }
    parsed.deleted_from = fromDate;
  }

  if (query.deleted_to !== undefined) {
    if (typeof query.deleted_to !== 'string' || !query.deleted_to.trim()) {
      return { error: 'invalid_payload' };
    }
    const toDate = new Date(query.deleted_to);
    if (Number.isNaN(toDate.getTime())) {
      return { error: 'invalid_payload' };
    }
    parsed.deleted_to = toDate;
  }

  if (query.limit !== undefined) {
    const limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      return { error: 'invalid_payload' };
    }
    parsed.limit = Math.min(TASK_TRASH_LIST_MAX_LIMIT, limit);
  }

  return { value: parsed };
}

async function findProjectById(projectId, executor = db) {
  const result = await executor.query(
    `
      SELECT id, name, created_by, llm_provider, llm_model,
             duration_weeks, budget_total, stages, stage_settings,
             created_at, updated_at
      FROM projects
      WHERE id = $1
      LIMIT 1
    `,
    [projectId]
  );
  return result.rows[0] || null;
}

async function listVisibleProjectsForUser(user, executor = db) {
  if (user.role === 'employee') {
    const result = await executor.query(
      `
        SELECT DISTINCT p.id, p.name, p.created_by, p.llm_provider, p.llm_model,
               p.duration_weeks, p.budget_total, p.stages, p.stage_settings,
               p.created_at, p.updated_at
        FROM projects p
        INNER JOIN tasks t ON t.project_id = p.id
        WHERE t.assignee_user_id = $1
        ORDER BY p.created_at DESC
      `,
      [user.id]
    );
    return result.rows;
  }

  const result = await executor.query(
    `
      SELECT id, name, created_by, llm_provider, llm_model,
             duration_weeks, budget_total, stages, stage_settings,
             created_at, updated_at
      FROM projects
      ORDER BY created_at DESC
    `
  );
  return result.rows;
}

async function findVisibleProjectById(projectId, user) {
  if (user.role === 'employee') {
    const result = await db.query(
      `
        SELECT p.id, p.name, p.created_by, p.llm_provider, p.llm_model,
               p.duration_weeks, p.budget_total, p.stages, p.stage_settings,
               p.created_at, p.updated_at
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

async function setUserActiveProject(userId, projectId, executor = db) {
  if (!projectId) {
    await executor.query(
      `
        DELETE FROM user_active_projects
        WHERE user_id = $1
      `,
      [userId]
    );
    return;
  }

  await executor.query(
    `
      INSERT INTO user_active_projects (user_id, project_id, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        updated_at = NOW()
    `,
    [userId, projectId]
  );
}

async function findUserActiveProject(user, executor = db) {
  const result = await executor.query(
    `
      SELECT p.id, p.name, p.created_by, p.llm_provider, p.llm_model,
             p.duration_weeks, p.budget_total, p.stages, p.stage_settings,
             p.created_at, p.updated_at
      FROM user_active_projects ap
      INNER JOIN projects p ON p.id = ap.project_id
      WHERE ap.user_id = $1
      LIMIT 1
    `,
    [user.id]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const project = result.rows[0];
  if (user.role !== 'employee') {
    return project;
  }

  const visible = await findVisibleProjectById(project.id, user);
  return visible;
}

async function resolveActiveProjectForUser(user, executor = db) {
  const active = await findUserActiveProject(user, executor);
  if (active) {
    return active;
  }

  const visibleProjects = await listVisibleProjectsForUser(user, executor);
  if (visibleProjects.length === 0) {
    return null;
  }

  const fallback = visibleProjects[0];
  await setUserActiveProject(user.id, fallback.id, executor);
  return fallback;
}

async function findTaskById(taskId, executor = db) {
  const result = await executor.query(
    `
      SELECT id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
             priority, hours, descript, notes, deps, position, created_at, updated_at
      FROM tasks
      WHERE id = $1
      LIMIT 1
    `,
    [taskId]
  );
  return result.rows[0] || null;
}

async function getNextTaskPosition(projectId, col, executor = db) {
  const result = await executor.query(
    `
      SELECT COALESCE(MAX(position), -1) + 1 AS next_position
      FROM tasks
      WHERE project_id = $1
        AND col = $2
    `,
    [projectId, col]
  );
  return Number((result.rows[0] && result.rows[0].next_position) || 0);
}

async function findTaskInTrashByTaskId(taskId, executor = db) {
  await ensureTaskTrashStorage(executor);
  const result = await executor.query(
    `
      SELECT id, task_id, public_id, project_id, deleted_project_name, title, col, stage,
             assignee_user_id, track, agent, priority, hours, descript, notes, deps,
             deleted_at, deleted_by_user_id, created_at, updated_at
      FROM task_trash
      WHERE task_id = $1
      LIMIT 1
    `,
    [taskId]
  );
  return result.rows[0] || null;
}

let taskTrashStorageInitPromise = null;
async function ensureTaskTrashStorage(executor = db) {
  if (!taskTrashStorageInitPromise) {
    taskTrashStorageInitPromise = (async () => {
      await executor.query(`
        CREATE TABLE IF NOT EXISTS task_trash (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          task_id UUID NOT NULL UNIQUE,
          public_id BIGINT,
          project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
          deleted_project_name TEXT,
          title TEXT NOT NULL,
          col TEXT CHECK (col IN ('backlog', 'todo', 'doing', 'review', 'done')),
          stage TEXT,
          assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          track TEXT,
          agent TEXT,
          priority INTEGER NOT NULL DEFAULT 0,
          hours NUMERIC,
          descript TEXT,
          notes TEXT,
          deps JSONB,
          deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS public_id BIGINT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS deleted_project_name TEXT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS col TEXT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS stage TEXT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS assignee_user_id UUID`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS track TEXT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS agent TEXT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS hours NUMERIC`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS descript TEXT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS notes TEXT`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS deps JSONB`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS deleted_by_user_id UUID`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`);
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

      await executor.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_task_trash_task_id
        ON task_trash (task_id)
      `);
      await executor.query(`
        CREATE INDEX IF NOT EXISTS idx_task_trash_deleted_at_desc
        ON task_trash (deleted_at DESC)
      `);
      await executor.query(`
        CREATE INDEX IF NOT EXISTS idx_task_trash_project_id
        ON task_trash (project_id)
      `);
      await executor.query(`
        CREATE INDEX IF NOT EXISTS idx_task_trash_stage
        ON task_trash (stage)
      `);
      await executor.query(`
        CREATE INDEX IF NOT EXISTS idx_task_trash_deleted_by_user_id
        ON task_trash (deleted_by_user_id)
      `);
      await executor.query(`
        CREATE INDEX IF NOT EXISTS idx_task_trash_public_id
        ON task_trash (public_id)
      `);
    })().catch((error) => {
      taskTrashStorageInitPromise = null;
      throw error;
    });
  }

  await taskTrashStorageInitPromise;
}

function pickNextStageColor(existingColors) {
  const used = new Set(
    (existingColors || []).map((item) => String(item || '').toLowerCase())
  );
  for (const color of DEFAULT_STAGE_COLOR_PALETTE) {
    if (!used.has(color.toLowerCase())) {
      return color;
    }
  }
  return DEFAULT_STAGE_COLOR_PALETTE[used.size % DEFAULT_STAGE_COLOR_PALETTE.length];
}

function normalizeProjectStageSettingsForUpdate(project) {
  const stageList = Array.isArray(project.stages)
    ? project.stages
        .map((stage) => (typeof stage === 'string' ? stage.trim() : ''))
        .filter((stage) => stage !== '')
    : [];
  const stageSettings = Array.isArray(project.stage_settings)
    ? project.stage_settings
        .filter(
          (item) =>
            item &&
            typeof item.name === 'string' &&
            item.name.trim() !== ''
        )
        .map((item) => ({
          name: item.name.trim(),
          budget: Number.isFinite(Number(item.budget))
            ? Math.max(0, Math.round(Number(item.budget)))
            : 0,
          color:
            typeof item.color === 'string' &&
            /^#[0-9a-fA-F]{6}$/.test(item.color.trim())
              ? item.color.trim().toLowerCase()
              : null,
        }))
    : [];

  if (stageSettings.length > 0) {
    return {
      stages: stageSettings.map((item) => item.name),
      stage_settings: stageSettings.map((item) => ({
        name: item.name,
        budget: item.budget,
        color: item.color || '#64748b',
      })),
    };
  }

  const fallback = stageList.length > 0 ? stageList : DEFAULT_PROJECT_STAGES;
  return {
    stages: fallback,
    stage_settings: buildDefaultStageSettings(
      fallback,
      Number(project.budget_total || 0)
    ),
  };
}

async function ensureProjectStageExists(project, stageName, executor = db) {
  const normalizedStage = String(stageName || '').trim();
  if (!normalizedStage) {
    return false;
  }

  const normalized = normalizeProjectStageSettingsForUpdate(project);
  const hasStage = normalized.stages.some(
    (stage) => stage.toLowerCase() === normalizedStage.toLowerCase()
  );
  if (hasStage) {
    return false;
  }

  const usedColors = normalized.stage_settings.map((item) => item.color);
  normalized.stages.push(normalizedStage);
  normalized.stage_settings.push({
    name: normalizedStage,
    budget: 0,
    color: pickNextStageColor(usedColors),
  });

  await executor.query(
    `
      UPDATE projects
      SET stages = $2::text[],
          stage_settings = $3::jsonb,
          updated_at = NOW()
      WHERE id = $1
    `,
    [project.id, normalized.stages, JSON.stringify(normalized.stage_settings)]
  );
  return true;
}

async function moveTaskRowToTrash(taskRow, options = {}, executor = db) {
  await ensureTaskTrashStorage(executor);
  await executor.query(
    `
      INSERT INTO task_trash (
        task_id,
        public_id,
        project_id,
        deleted_project_name,
        title,
        col,
        stage,
        assignee_user_id,
        track,
        agent,
        priority,
        hours,
        descript,
        notes,
        deps,
        deleted_at,
        deleted_by_user_id,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), $16, $17, NOW()
      )
      ON CONFLICT (task_id)
      DO UPDATE SET
        public_id = EXCLUDED.public_id,
        project_id = EXCLUDED.project_id,
        deleted_project_name = EXCLUDED.deleted_project_name,
        title = EXCLUDED.title,
        col = EXCLUDED.col,
        stage = EXCLUDED.stage,
        assignee_user_id = EXCLUDED.assignee_user_id,
        track = EXCLUDED.track,
        agent = EXCLUDED.agent,
        priority = EXCLUDED.priority,
        hours = EXCLUDED.hours,
        descript = EXCLUDED.descript,
        notes = EXCLUDED.notes,
        deps = EXCLUDED.deps,
        deleted_at = NOW(),
        deleted_by_user_id = EXCLUDED.deleted_by_user_id,
        created_at = EXCLUDED.created_at,
        updated_at = NOW()
    `,
    [
      taskRow.id,
      taskRow.public_id || null,
      taskRow.project_id || null,
      options.projectName || null,
      taskRow.title,
      taskRow.col || null,
      taskRow.stage || null,
      taskRow.assignee_user_id || null,
      taskRow.track || null,
      taskRow.agent || null,
      Number.isFinite(Number(taskRow.priority)) ? Number(taskRow.priority) : 0,
      taskRow.hours !== undefined ? taskRow.hours : null,
      taskRow.descript || null,
      taskRow.notes || null,
      taskRow.deps === undefined ? null : taskRow.deps,
      options.deletedByUserId || null,
      taskRow.created_at || new Date().toISOString(),
    ]
  );
}

async function writeTaskEvent(params, executor = db) {
  const beforeState = sanitizeTaskForAudit(params.before);
  const afterState = sanitizeTaskForAudit(params.after);
  const eventType = params.eventType || params.action;
  const action = params.action || eventType;
  const payload =
    params.payload !== undefined
      ? params.payload
      : { before: beforeState, after: afterState };

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
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb)
    `,
    [
      params.projectId,
      params.taskId,
      params.actorUserId || null,
      eventType,
      JSON.stringify(toJsonObject(payload)),
      action,
      JSON.stringify(beforeState),
      JSON.stringify(afterState),
    ]
  );
}

function buildTaskUpdateStatement(updates) {
  const fieldMap = {
    title: 'title',
    col: 'col',
    position: 'position',
    stage: 'stage',
    assignee_user_id: 'assignee_user_id',
    track: 'track',
    agent: 'agent',
    priority: 'priority',
    hours: 'hours',
    descript: 'descript',
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

async function findAgentIdempotencyResponse(
  serviceAccountId,
  idempotencyKey,
  executor = db
) {
  const result = await executor.query(
    `
      SELECT response_json
      FROM agent_idempotency
      WHERE service_account_id = $1
        AND idempotency_key = $2
      LIMIT 1
    `,
    [serviceAccountId, idempotencyKey]
  );

  return result.rowCount > 0 ? result.rows[0].response_json : null;
}

async function saveAgentIdempotencyResponse(
  serviceAccountId,
  idempotencyKey,
  responseJson,
  executor = db
) {
  await executor.query(
    `
      INSERT INTO agent_idempotency (
        service_account_id,
        idempotency_key,
        response_json
      )
      VALUES ($1, $2, $3::jsonb)
    `,
    [serviceAccountId, idempotencyKey, JSON.stringify(responseJson)]
  );
}

async function touchTask(taskId, executor = db) {
  const result = await executor.query(
    `
      UPDATE tasks
      SET updated_at = NOW()
      WHERE id = $1
      RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                priority, hours, descript, notes, deps, created_at, updated_at
    `,
    [taskId]
  );

  return result.rowCount > 0 ? result.rows[0] : null;
}

function ensureActionScope(service, actionType) {
  const requiredScope = AGENT_ACTION_SCOPES[actionType];
  if (!requiredScope || !hasServiceScope(service, requiredScope)) {
    throw createAppError(403, 'forbidden');
  }
}

async function applyAgentAction(context, action, actionIndex, executor = db) {
  if (action.type === 'task_comment') {
    return applyAgentTaskComment(context, action.payload, actionIndex, executor);
  }

  if (action.type === 'task_link_artifact') {
    return applyAgentTaskLinkArtifact(context, action.payload, actionIndex, executor);
  }

  if (action.type === 'task_move') {
    return applyAgentTaskMove(context, action.payload, actionIndex, executor);
  }

  if (action.type === 'task_patch') {
    return applyAgentTaskPatch(context, action.payload, actionIndex, executor);
  }

  if (action.type === 'task_create') {
    return applyAgentTaskCreate(context, action.payload, actionIndex, executor);
  }

  throw createAppError(400, 'invalid_payload');
}

async function applyAgentTaskComment(context, payload, actionIndex, executor = db) {
  const before = await findTaskById(payload.taskId, executor);
  if (!before) {
    throw createAppError(400, 'invalid_payload');
  }

  const after = await touchTask(payload.taskId, executor);
  if (!after) {
    throw createAppError(400, 'invalid_payload');
  }

  await writeTaskEvent(
    {
      projectId: after.project_id,
      taskId: after.id,
      actorUserId: null,
      eventType: 'agent_action',
      action: 'agent_action',
      before,
      after,
      payload: buildAgentEventMeta(context, 'task_comment', {
        text: truncateString(payload.text, MAX_AGENT_EVENT_TEXT_CHARS),
        format: payload.format,
        tags: payload.tags,
      }),
    },
    executor
  );

  return {
    action_index: actionIndex,
    status: 'ok',
    task_id: after.id,
  };
}

async function applyAgentTaskLinkArtifact(
  context,
  payload,
  actionIndex,
  executor = db
) {
  const before = await findTaskById(payload.taskId, executor);
  if (!before) {
    throw createAppError(400, 'invalid_payload');
  }

  const after = await touchTask(payload.taskId, executor);
  if (!after) {
    throw createAppError(400, 'invalid_payload');
  }

  await writeTaskEvent(
    {
      projectId: after.project_id,
      taskId: after.id,
      actorUserId: null,
      eventType: 'agent_action',
      action: 'agent_action',
      before,
      after,
      payload: buildAgentEventMeta(context, 'task_link_artifact', {
        kind: payload.kind,
        data: truncateJsonForAgentEvent(payload.data),
      }),
    },
    executor
  );

  return {
    action_index: actionIndex,
    status: 'ok',
    task_id: after.id,
  };
}

async function applyAgentTaskMove(context, payload, actionIndex, executor = db) {
  const before = await findTaskById(payload.taskId, executor);
  if (!before) {
    throw createAppError(400, 'invalid_payload');
  }

  const result = await executor.query(
    `
      UPDATE tasks
      SET col = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                priority, hours, descript, notes, deps, created_at, updated_at
    `,
    [payload.toStatus, payload.taskId]
  );

  if (result.rowCount === 0) {
    throw createAppError(400, 'invalid_payload');
  }

  const after = result.rows[0];

  await writeTaskEvent(
    {
      projectId: after.project_id,
      taskId: after.id,
      actorUserId: null,
      eventType: 'agent_action',
      action: 'agent_action',
      before,
      after,
      payload: buildAgentEventMeta(context, 'task_move', {
        reason: truncateString(payload.reason, MAX_AGENT_EVENT_TEXT_CHARS),
        to_status: payload.toStatus,
      }),
    },
    executor
  );

  return {
    action_index: actionIndex,
    status: 'ok',
    task_id: after.id,
  };
}

async function applyAgentTaskPatch(context, payload, actionIndex, executor = db) {
  const before = await findTaskById(payload.taskId, executor);
  if (!before) {
    throw createAppError(400, 'invalid_payload');
  }

  const update = buildTaskUpdateStatement(payload.patch);
  const result = await executor.query(
    `
      UPDATE tasks
      SET ${update.setClause}
      WHERE id = $${update.values.length + 1}
      RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                priority, hours, descript, notes, deps, created_at, updated_at
    `,
    [...update.values, payload.taskId]
  );

  if (result.rowCount === 0) {
    throw createAppError(400, 'invalid_payload');
  }

  const after = result.rows[0];

  await writeTaskEvent(
    {
      projectId: after.project_id,
      taskId: after.id,
      actorUserId: null,
      eventType: 'agent_action',
      action: 'agent_action',
      before,
      after,
      payload: buildAgentEventMeta(context, 'task_patch', {
        patch: truncateJsonForAgentEvent(payload.patch),
      }),
    },
    executor
  );

  return {
    action_index: actionIndex,
    status: 'ok',
    task_id: after.id,
  };
}

async function applyAgentTaskCreate(context, payload, actionIndex, executor = db) {
  const project = await findProjectById(payload.projectId, executor);
  if (!project) {
    throw createAppError(400, 'invalid_payload');
  }

  const created = await executor.query(
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
        descript,
        notes,
        deps
      )
      VALUES (
        $1, $2, COALESCE($3, 'backlog'), $4, $5, $6, $7, COALESCE($8, 0), $9, $10, $11, $12
      )
      RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                priority, hours, descript, notes, deps, created_at, updated_at
    `,
    [
      payload.projectId,
      payload.create.title,
      payload.create.col || null,
      payload.create.stage ?? null,
      payload.create.assignee_user_id ?? null,
      payload.create.track ?? null,
      payload.create.agent ?? null,
      payload.create.priority ?? null,
      payload.create.hours ?? null,
      payload.create.descript ?? null,
      payload.create.notes ?? null,
      payload.create.deps ?? null,
    ]
  );

  const after = created.rows[0];
  await writeTaskEvent(
    {
      projectId: after.project_id,
      taskId: after.id,
      actorUserId: null,
      eventType: 'agent_action',
      action: 'agent_action',
      before: {},
      after,
      payload: buildAgentEventMeta(context, 'task_create', {
        meta: truncateJsonForAgentEvent(payload.meta),
      }),
    },
    executor
  );

  return {
    action_index: actionIndex,
    status: 'ok',
    task_id: after.id,
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
    const [projects, activeProject] = await Promise.all([
      listVisibleProjectsForUser(user),
      findUserActiveProject(user),
    ]);
    sendJson(res, 200, {
      projects,
      active_project_id: activeProject ? activeProject.id : null,
    });
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
        INSERT INTO projects (name, created_by, duration_weeks, budget_total, stages, stage_settings)
        VALUES ($1, $2, $3, $4, $5::text[], $6::jsonb)
        RETURNING id, name, created_by, llm_provider, llm_model,
                  duration_weeks, budget_total, stages, stage_settings,
                  created_at, updated_at
      `,
      [
        parsed.value.name,
        user.id,
        parsed.value.duration_weeks,
        parsed.value.budget_total,
        parsed.value.stages,
        JSON.stringify(parsed.value.stage_settings),
      ]
    );
    const project = result.rows[0];
    await setUserActiveProject(user.id, project.id);
    sendJson(res, 201, { project });
  } catch (error) {
    console.error('POST /projects failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'projects_unavailable' });
  }
});

app.get('/projects/active', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const active = await resolveActiveProjectForUser(user);
    if (!active) {
      sendJson(res, 200, {
        id: null,
        name: 'Без проекта',
        duration_weeks: 0,
        budget_total: 0,
        stages: [],
        stage_settings: [],
      });
      return;
    }

    sendJson(res, 200, {
      id: active.id,
      name: active.name,
      duration_weeks: Number(active.duration_weeks || 0),
      budget_total: Number(active.budget_total || 0),
      stages: Array.isArray(active.stages) ? active.stages : [],
      stage_settings: Array.isArray(active.stage_settings)
        ? active.stage_settings
        : [],
    });
  } catch (error) {
    console.error('GET /projects/active failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'projects_unavailable' });
  }
});

app.post('/projects/activate', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = parseProjectActivatePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    if (parsed.value.project_id === null) {
      await setUserActiveProject(user.id, null);
      sendJson(res, 200, {
        project: null,
      });
      return;
    }

    const project = await findVisibleProjectById(parsed.value.project_id, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    await setUserActiveProject(user.id, project.id);
    sendJson(res, 200, { project });
  } catch (error) {
    console.error('POST /projects/activate failed:', error.message);
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

app.patch('/projects/:id', async (req, res) => {
  const user = requireAuth(req, res, PROJECT_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_project_id' });
    return;
  }

  const parsed = parseProjectCreatePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const existing = await findProjectById(id);
    if (!existing) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const normalizedStages = parsed.value.stages.map((stage) =>
      String(stage).trim().toLowerCase()
    );
    const stageUsage = await db.query(
      `
        SELECT stage, COUNT(*)::int AS count
        FROM tasks
        WHERE project_id = $1
          AND stage IS NOT NULL
          AND lower(stage) <> ALL($2::text[])
        GROUP BY stage
        ORDER BY count DESC
      `,
      [id, normalizedStages]
    );
    if (stageUsage.rowCount > 0) {
      sendJson(res, 409, {
        error: 'stages_in_use',
        stages: stageUsage.rows.map((row) => ({
          name: row.stage,
          count: Number(row.count || 0),
        })),
      });
      return;
    }

    const result = await db.query(
      `
        UPDATE projects
        SET name = $1,
            duration_weeks = $2,
            budget_total = $3,
            stages = $4::text[],
            stage_settings = $5::jsonb,
            updated_at = NOW()
        WHERE id = $6
        RETURNING id, name, created_by, llm_provider, llm_model,
                  duration_weeks, budget_total, stages, stage_settings,
                  created_at, updated_at
      `,
      [
        parsed.value.name,
        parsed.value.duration_weeks,
        parsed.value.budget_total,
        parsed.value.stages,
        JSON.stringify(parsed.value.stage_settings),
        id,
      ]
    );

    sendJson(res, 200, { project: result.rows[0] });
  } catch (error) {
    console.error('PATCH /projects/:id failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'projects_unavailable' });
  }
});

app.delete('/projects/:id', async (req, res) => {
  const user = requireAuth(req, res, PROJECT_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_project_id' });
    return;
  }

  const parsed = parseProjectDeletePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const result = await runInTransaction(async (tx) => {
      await ensureTaskTrashStorage(tx);
      const project = await findProjectById(id, tx);
      if (!project) {
        throw createAppError(404, 'project_not_found');
      }

      if (project.name !== parsed.value.confirm_name) {
        throw createAppError(409, 'project_name_mismatch');
      }

      const tasksCountResult = await tx.query(
        `
          SELECT COUNT(*)::int AS count
          FROM tasks
          WHERE project_id = $1
        `,
        [id]
      );
      const deletedTasks = Number(
        (tasksCountResult.rows[0] && tasksCountResult.rows[0].count) || 0
      );

      await tx.query(
        `
          INSERT INTO task_trash (
            task_id,
            public_id,
            project_id,
            deleted_project_name,
            title,
            col,
            stage,
            assignee_user_id,
            track,
            agent,
            priority,
            hours,
            descript,
            notes,
            deps,
            deleted_at,
            deleted_by_user_id,
            created_at,
            updated_at
          )
          SELECT
            t.id,
            t.public_id,
            t.project_id,
            $2,
            t.title,
            t.col,
            t.stage,
            t.assignee_user_id,
            t.track,
            t.agent,
            t.priority,
            t.hours,
            t.descript,
            t.notes,
            t.deps,
            NOW(),
            $3,
            t.created_at,
            NOW()
          FROM tasks t
          WHERE t.project_id = $1
          ON CONFLICT (task_id)
          DO UPDATE SET
            public_id = EXCLUDED.public_id,
            project_id = EXCLUDED.project_id,
            deleted_project_name = EXCLUDED.deleted_project_name,
            title = EXCLUDED.title,
            col = EXCLUDED.col,
            stage = EXCLUDED.stage,
            assignee_user_id = EXCLUDED.assignee_user_id,
            track = EXCLUDED.track,
            agent = EXCLUDED.agent,
            priority = EXCLUDED.priority,
            hours = EXCLUDED.hours,
            descript = EXCLUDED.descript,
            notes = EXCLUDED.notes,
            deps = EXCLUDED.deps,
            deleted_at = NOW(),
            deleted_by_user_id = EXCLUDED.deleted_by_user_id,
            created_at = EXCLUDED.created_at,
            updated_at = NOW()
        `,
        [id, project.name, user.id]
      );

      await tx.query(
        `
          DELETE FROM projects
          WHERE id = $1
        `,
        [id]
      );

      return {
        deleted_project_id: id,
        deleted_project_name: project.name,
        deleted_tasks: deletedTasks,
      };
    });

    sendJson(res, 200, result);
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }
    console.error('DELETE /projects/:id failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'projects_unavailable' });
  }
});

app.get('/projects/:projectId/events', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { projectId } = req.params;
  if (!isUuid(projectId)) {
    sendJson(res, 400, { error: 'invalid_project_id' });
    return;
  }

  let limit = 100;
  if (req.query.limit !== undefined) {
    const parsedLimit = Number(req.query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    limit = Math.min(parsedLimit, 500);
  }

  let offset = 0;
  if (req.query.offset !== undefined) {
    const parsedOffset = Number(req.query.offset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    offset = parsedOffset;
  }

  try {
    const project = await findProjectById(projectId);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const result = await db.query(
      `
        SELECT event_type, payload, actor_user_id, task_id, created_at
        FROM task_events
        WHERE project_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2
        OFFSET $3
      `,
      [projectId, limit, offset]
    );

    sendJson(res, 200, { events: result.rows, limit, offset });
  } catch (error) {
    console.error('GET /projects/:projectId/events failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'events_unavailable' });
  }
});

app.get('/projects/:projectId/metrics', async (req, res) => {
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

    const taskValues = [projectId];
    const taskFilter =
      user.role === 'employee'
        ? ` AND assignee_user_id = $${taskValues.push(user.id)}`
        : '';
    const taskCounts = await db.query(
      `
        SELECT
          COUNT(*)::int AS tasks_total,
          COUNT(*) FILTER (WHERE col = 'done')::int AS tasks_done,
          COUNT(*) FILTER (WHERE col IN ('todo', 'doing', 'review'))::int AS tasks_in_progress
        FROM tasks
        WHERE project_id = $1
        ${taskFilter}
      `,
      taskValues
    );

    const eventValues = [projectId];
    const eventFilter =
      user.role === 'employee'
        ? ` AND EXISTS (
              SELECT 1
              FROM tasks t
              WHERE t.id = te.task_id
                AND t.project_id = $1
                AND t.assignee_user_id = $${eventValues.push(user.id)}
            )`
        : '';

    const weeklyFlow = await db.query(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE te.event_type = 'task_created'
              AND te.created_at >= NOW() - INTERVAL '7 days'
          )::int AS tasks_created_last_week,
          COUNT(*) FILTER (
            WHERE te.event_type = 'task_moved'
              AND COALESCE(te.payload->>'to_col', '') = 'done'
              AND te.created_at >= NOW() - INTERVAL '7 days'
          )::int AS tasks_completed_last_week
        FROM task_events te
        WHERE te.project_id = $1
        ${eventFilter}
      `,
      eventValues
    );

    const cycle = await db.query(
      `
        WITH created_events AS (
          SELECT te.task_id, MIN(te.created_at) AS created_at
          FROM task_events te
          WHERE te.project_id = $1
            AND te.event_type = 'task_created'
            ${eventFilter}
          GROUP BY te.task_id
        ),
        done_events AS (
          SELECT te.task_id, MIN(te.created_at) AS done_at
          FROM task_events te
          WHERE te.project_id = $1
            AND te.event_type = 'task_moved'
            AND COALESCE(te.payload->>'to_col', '') = 'done'
            ${eventFilter}
          GROUP BY te.task_id
        )
        SELECT
          COALESCE(
            AVG(EXTRACT(EPOCH FROM (done_events.done_at - created_events.created_at)) / 3600.0),
            0
          )::float AS avg_task_cycle_time_hours
        FROM created_events
        INNER JOIN done_events
          ON done_events.task_id = created_events.task_id
         AND done_events.done_at >= created_events.created_at
      `,
      eventValues
    );

    const counts = taskCounts.rows[0] || {};
    const flow = weeklyFlow.rows[0] || {};
    const cycleRow = cycle.rows[0] || {};

    const tasksTotal = Number(counts.tasks_total || 0);
    const tasksDone = Number(counts.tasks_done || 0);
    const tasksInProgress = Number(counts.tasks_in_progress || 0);
    const completionPercent =
      tasksTotal > 0 ? Number(((tasksDone / tasksTotal) * 100).toFixed(1)) : 0;

    const timerRow = await findProjectTimerByProjectId(project.id);
    const timerSnapshot = computeTimerSnapshot(timerRow);
    const elapsedWeeks = timerSnapshot.projectMs / (7 * 24 * 60 * 60 * 1000);
    const tasksCompletedLastWeek = Number(flow.tasks_completed_last_week || 0);
    const velocity =
      elapsedWeeks > 0
        ? tasksDone / elapsedWeeks
        : tasksCompletedLastWeek;
    const avgCycleHoursRaw = Number(cycleRow.avg_task_cycle_time_hours || 0);
    const avgCycleHours = Number.isFinite(avgCycleHoursRaw)
      ? avgCycleHoursRaw
      : 0;

    sendJson(res, 200, {
      tasks_total: tasksTotal,
      tasks_done: tasksDone,
      tasks_in_progress: tasksInProgress,
      completion_percent: completionPercent,
      velocity_tasks_per_week: Number(velocity.toFixed(1)),
      avg_task_cycle_time_hours: Number(avgCycleHours.toFixed(1)),
      tasks_created_last_week: Number(flow.tasks_created_last_week || 0),
      tasks_completed_last_week: tasksCompletedLastWeek,
    });
  } catch (error) {
    console.error('GET /projects/:projectId/metrics failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'metrics_unavailable' });
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
          SELECT id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                 priority, hours, descript, notes, deps, position, created_at, updated_at
          FROM tasks
          WHERE project_id = $1
            AND assignee_user_id = $2
          ORDER BY col ASC, position ASC, created_at ASC
        `,
        [projectId, user.id]
      );
    } else {
      result = await db.query(
        `
          SELECT id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                 priority, hours, descript, notes, deps, position, created_at, updated_at
          FROM tasks
          WHERE project_id = $1
          ORDER BY col ASC, position ASC, created_at ASC
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
      const targetCol = payload.col || 'backlog';
      const nextPosition = await getNextTaskPosition(projectId, targetCol, tx);
      const created = await tx.query(
        `
          INSERT INTO tasks (
            project_id,
            title,
            col,
            position,
            stage,
            assignee_user_id,
            track,
            agent,
            priority,
            hours,
            descript,
            notes,
            deps
          )
          VALUES (
            $1, $2, COALESCE($3, 'backlog'), $4, $5, $6, $7, $8, COALESCE($9, 0), $10, $11, $12, $13
          )
          RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                    priority, hours, descript, notes, deps, position, created_at, updated_at
        `,
        [
          projectId,
          payload.title,
          payload.col || null,
          nextPosition,
          payload.stage ?? null,
          payload.assignee_user_id ?? null,
          payload.track ?? null,
          payload.agent ?? null,
          payload.priority ?? null,
          payload.hours ?? null,
          payload.descript ?? null,
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
          eventType: 'task_created',
          action: 'create',
          before: {},
          after: createdTask,
          payload: {
            title: createdTask.title,
            stage: createdTask.stage,
            col: createdTask.col,
          },
        },
        tx
      );

      return createdTask;
    });

    sendJson(res, 201, { task });
  } catch (error) {
    if (error && (error.code === '23503' || error.code === '23514')) {
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

app.patch('/tasks/reorder', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const parsed = parseTaskReorderPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  const { column, order } = parsed.value;

  try {
    const result = await runInTransaction(async (tx) => {
      if (order.length === 0) {
        return { column, updated: 0 };
      }

      const existing = await tx.query(
        `
          SELECT id, project_id, col
          FROM tasks
          WHERE id = ANY($1::uuid[])
          FOR UPDATE
        `,
        [order]
      );

      if (existing.rowCount !== order.length) {
        throw createAppError(404, 'task_not_found');
      }

      const projectIds = new Set(existing.rows.map((row) => row.project_id));
      if (projectIds.size !== 1) {
        throw createAppError(400, 'invalid_payload');
      }

      const invalidColumn = existing.rows.some((row) => row.col !== column);
      if (invalidColumn) {
        throw createAppError(409, 'task_column_mismatch');
      }

      await tx.query(
        `
          WITH ordered AS (
            SELECT task_id, ord
            FROM unnest($1::uuid[]) WITH ORDINALITY AS input(task_id, ord)
          )
          UPDATE tasks t
          SET position = ordered.ord - 1,
              updated_at = NOW()
          FROM ordered
          WHERE t.id = ordered.task_id
        `,
        [order]
      );

      const projectId = existing.rows[0].project_id;
      for (let index = 0; index < order.length; index += 1) {
        await writeTaskEvent(
          {
            projectId,
            taskId: order[index],
            actorUserId: user.id,
            eventType: 'task_reordered',
            action: 'reorder',
            before: {},
            after: {},
            payload: {
              column,
              order,
              position: index,
            },
          },
          tx
        );
      }

      return { column, updated: order.length };
    });

    sendJson(res, 200, result);
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }

    console.error('PATCH /tasks/reorder failed:', error.message);
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

      const updates = { ...parsed.value };
      if (
        updates.col !== undefined &&
        updates.col !== null &&
        updates.col !== before.col &&
        updates.position === undefined
      ) {
        updates.position = await getNextTaskPosition(
          before.project_id,
          updates.col,
          tx
        );
      }

      const update = buildTaskUpdateStatement(updates);
      const result = await tx.query(
        `
          UPDATE tasks
          SET ${update.setClause}
          WHERE id = $${update.values.length + 1}
          RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                    priority, hours, descript, notes, deps, position, created_at, updated_at
        `,
        [...update.values, id]
      );
      const updatedTask = result.rows[0];

      await writeTaskEvent(
        {
          projectId: updatedTask.project_id,
          taskId: updatedTask.id,
          actorUserId: user.id,
          eventType: 'task_updated',
          action: 'update',
          before,
          after: updatedTask,
          payload: {
            fields_changed: Object.keys(parsed.value).sort(),
          },
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

    if (error && (error.code === '23503' || error.code === '23514')) {
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

app.get('/tasks/:id/events', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  try {
    const result = await db.query(
      `
        SELECT event_type, payload, actor_user_id, created_at
        FROM task_events
        WHERE task_id = $1
        ORDER BY created_at DESC, id DESC
      `,
      [id]
    );

    sendJson(res, 200, result.rows);
  } catch (error) {
    console.error('GET /tasks/:id/events failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'events_unavailable' });
  }
});

app.delete('/tasks/:id', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  try {
    const result = await runInTransaction(async (tx) => {
      const before = await findTaskById(id, tx);
      if (!before) {
        throw createAppError(404, 'task_not_found');
      }

      const project = await findProjectById(before.project_id, tx);
      await moveTaskRowToTrash(
        before,
        {
          projectName: project ? project.name : null,
          deletedByUserId: user.id,
        },
        tx
      );

      await writeTaskEvent(
        {
          projectId: before.project_id,
          taskId: before.id,
          actorUserId: user.id,
          eventType: 'task_deleted',
          action: 'delete',
          before,
          after: {},
          payload: {
            title: before.title,
            stage: before.stage,
            col: before.col,
          },
        },
        tx
      );

      await tx.query(
        `
          DELETE FROM tasks
          WHERE id = $1
        `,
        [id]
      );

      return {
        deleted_task_id: before.id,
        deleted_public_id: before.public_id,
      };
    });

    sendJson(res, 200, result);
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }

    console.error('DELETE /tasks/:id failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'tasks_unavailable' });
  }
});

app.get('/tasks/trash', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const parsed = parseTaskTrashQuery(req.query || {});
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    await ensureTaskTrashStorage();
    const query = parsed.value;
    const where = [];
    const values = [];

    if (query.project_id) {
      where.push(`tt.project_id = $${values.push(query.project_id)}`);
    }
    if (query.stage) {
      where.push(
        `LOWER(COALESCE(tt.stage, '')) = LOWER($${values.push(query.stage)})`
      );
    }
    if (query.deleted_by) {
      const like = `%${query.deleted_by}%`;
      where.push(
        `(
          COALESCE(u.email, '') ILIKE $${values.push(like)}
          OR COALESCE(tt.deleted_by_user_id::text, '') ILIKE $${values.push(like)}
        )`
      );
    }
    if (query.deleted_from) {
      where.push(`tt.deleted_at >= $${values.push(query.deleted_from.toISOString())}::timestamptz`);
    }
    if (query.deleted_to) {
      const toInclusive = new Date(query.deleted_to.getTime() + 24 * 60 * 60 * 1000);
      where.push(`tt.deleted_at < $${values.push(toInclusive.toISOString())}::timestamptz`);
    }
    if (query.q) {
      const like = `%${query.q}%`;
      const qTaskId = isUuid(query.q) ? query.q : null;
      const qPublicId = Number(query.q);
      const qConditions = [
        `tt.title ILIKE $${values.push(like)}`,
        `COALESCE(tt.descript, '') ILIKE $${values.push(like)}`,
        `COALESCE(tt.notes, '') ILIKE $${values.push(like)}`,
        `COALESCE(tt.stage, '') ILIKE $${values.push(like)}`,
        `COALESCE(tt.agent, '') ILIKE $${values.push(like)}`,
        `COALESCE(p.name, tt.deleted_project_name, '') ILIKE $${values.push(like)}`,
      ];
      if (qTaskId) {
        qConditions.push(`tt.task_id = $${values.push(qTaskId)}`);
      }
      if (Number.isInteger(qPublicId) && qPublicId > 0) {
        qConditions.push(`tt.public_id = $${values.push(qPublicId)}`);
      }
      where.push(`(${qConditions.join(' OR ')})`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    values.push(query.limit);
    const limitParam = values.length;

    const result = await db.query(
      `
        SELECT
          tt.task_id AS id,
          tt.public_id,
          tt.project_id,
          COALESCE(p.name, tt.deleted_project_name) AS project_name,
          tt.title,
          tt.col,
          tt.stage,
          tt.assignee_user_id,
          tt.track,
          tt.agent,
          tt.priority,
          tt.hours,
          tt.descript,
          tt.notes,
          tt.deps,
          tt.deleted_at,
          COALESCE(u.email, 'unknown') AS deleted_by_name
        FROM task_trash tt
        LEFT JOIN users u ON u.id = tt.deleted_by_user_id
        LEFT JOIN projects p ON p.id = tt.project_id
        ${whereClause}
        ORDER BY tt.deleted_at DESC
        LIMIT $${limitParam}
      `,
      values
    );

    sendJson(res, 200, { items: result.rows });
  } catch (error) {
    console.error('GET /tasks/trash failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'trash_unavailable' });
  }
});

app.post('/tasks/:id/restore', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  const parsed = parseTaskRestorePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const restored = await runInTransaction(async (tx) => {
      const trashed = await findTaskInTrashByTaskId(id, tx);
      if (!trashed) {
        throw createAppError(404, 'task_not_found');
      }

      const project = await findProjectById(parsed.value.project_id, tx);
      if (!project) {
        throw createAppError(404, 'project_not_found');
      }

      const projectStages = Array.isArray(project.stages)
        ? project.stages.map((stage) => String(stage || '').trim()).filter((stage) => stage !== '')
        : [];
      const hasStage = projectStages.some(
        (stage) => stage.toLowerCase() === parsed.value.stage.toLowerCase()
      );
      if (!hasStage) {
        if (!parsed.value.create_stage_if_missing) {
          throw createAppError(409, 'stage_not_found');
        }
        await ensureProjectStageExists(project, parsed.value.stage, tx);
      }

      const restorePosition = await getNextTaskPosition(
        parsed.value.project_id,
        parsed.value.col,
        tx
      );

      const inserted = await tx.query(
        `
          INSERT INTO tasks (
            id,
            public_id,
            project_id,
            title,
            col,
            position,
            stage,
            assignee_user_id,
            track,
            agent,
            priority,
            hours,
            descript,
            notes,
            deps,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, 0), $12, $13, $14, $15, $16, NOW()
          )
          RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                    priority, hours, descript, notes, deps, position, created_at, updated_at
        `,
        [
          trashed.task_id,
          trashed.public_id,
          parsed.value.project_id,
          trashed.title,
          parsed.value.col,
          restorePosition,
          parsed.value.stage,
          trashed.assignee_user_id,
          trashed.track,
          trashed.agent,
          trashed.priority,
          trashed.hours,
          trashed.descript,
          trashed.notes,
          trashed.deps,
          trashed.created_at || new Date().toISOString(),
        ]
      );
      const task = inserted.rows[0];

      await writeTaskEvent(
        {
          projectId: task.project_id,
          taskId: task.id,
          actorUserId: user.id,
          action: 'restore',
          before: {},
          after: task,
          eventType: 'restore',
        },
        tx
      );

      await tx.query(
        `
          DELETE FROM task_trash
          WHERE task_id = $1
        `,
        [trashed.task_id]
      );

      return task;
    });

    sendJson(res, 200, { task: restored });
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }
    if (error && error.code === '23505') {
      sendJson(res, 409, { error: 'task_conflict' });
      return;
    }
    if (error && (error.code === '23503' || error.code === '23514')) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    console.error('POST /tasks/:id/restore failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'restore_unavailable' });
  }
});

app.delete('/tasks/:id/permanent', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  try {
    const result = await runInTransaction(async (tx) => {
      const trashed = await findTaskInTrashByTaskId(id, tx);
      if (!trashed) {
        throw createAppError(404, 'task_not_found');
      }

      await tx.query(
        `
          DELETE FROM task_trash
          WHERE task_id = $1
        `,
        [id]
      );

      return {
        deleted_task_id: id,
      };
    });

    sendJson(res, 200, result);
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }
    console.error('DELETE /tasks/:id/permanent failed:', error.message);
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

      const targetCol = parsed.value.col;
      const currentPosition = Number.isFinite(Number(before.position))
        ? Number(before.position)
        : 0;
      const targetPosition =
        before.col === targetCol
          ? currentPosition
          : await getNextTaskPosition(before.project_id, targetCol, tx);

      const moved = await tx.query(
        `
          UPDATE tasks
          SET col = $1,
              position = $2,
              updated_at = NOW()
          WHERE id = $3
          RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                    priority, hours, descript, notes, deps, position, created_at, updated_at
        `,
        [targetCol, targetPosition, id]
      );
      const movedTask = moved.rows[0];

      await writeTaskEvent(
        {
          projectId: movedTask.project_id,
          taskId: movedTask.id,
          actorUserId: user.id,
          eventType: 'task_moved',
          action: 'move',
          before,
          after: movedTask,
          payload: {
            from_col: before.col,
            to_col: movedTask.col,
          },
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

app.get('/stats/tasks', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const project = await resolveActiveProjectForUser(user);
    if (!project) {
      sendJson(res, 200, { backlog: 0, in_work: 0, done: 0 });
      return;
    }

    const values = [project.id];
    const employeeFilter =
      user.role === 'employee'
        ? ` AND assignee_user_id = $${values.push(user.id)}`
        : '';

    const result = await db.query(
      `
        SELECT
          COUNT(*) FILTER (WHERE col = 'backlog')::int AS backlog,
          COUNT(*) FILTER (WHERE col IN ('todo', 'doing', 'review'))::int AS in_work,
          COUNT(*) FILTER (WHERE col = 'done')::int AS done
        FROM tasks
        WHERE project_id = $1
        ${employeeFilter}
      `,
      values
    );

    const row = result.rows[0] || {};
    sendJson(res, 200, {
      backlog: Number(row.backlog || 0),
      in_work: Number(row.in_work || 0),
      done: Number(row.done || 0),
    });
  } catch (error) {
    console.error('GET /stats/tasks failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'stats_unavailable' });
  }
});

app.get('/stats/budget', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const project = await resolveActiveProjectForUser(user);
    if (!project) {
      sendJson(res, 200, { earned: 0, total: 0, progress: 0 });
      return;
    }

    const configuredStageSettings = Array.isArray(project.stage_settings)
      ? project.stage_settings
      : [];
    const validStageSettings = configuredStageSettings.filter(
      (item) =>
        item &&
        typeof item.name === 'string' &&
        item.name.trim() !== '' &&
        Number.isFinite(Number(item.budget)) &&
        Number(item.budget) >= 0
    );
    const totalFromStageSettings = validStageSettings.reduce(
      (sum, item) => sum + Math.round(Number(item.budget)),
      0
    );
    const total = Math.max(
      0,
      totalFromStageSettings || Number(project.budget_total || 0)
    );
    const stages = validStageSettings.length > 0
      ? validStageSettings.map((item) => item.name.trim())
      : Array.isArray(project.stages) && project.stages.length > 0
      ? project.stages
      : DEFAULT_PROJECT_STAGES;
    const values = [project.id];
    const employeeFilter =
      user.role === 'employee'
        ? ` AND assignee_user_id = $${values.push(user.id)}`
        : '';

    const taskResult = await db.query(
      `
        SELECT stage, col
        FROM tasks
        WHERE project_id = $1
        ${employeeFilter}
      `,
      values
    );

    const stageBudgetMap = new Map();
    if (validStageSettings.length > 0) {
      for (const item of validStageSettings) {
        stageBudgetMap.set(item.name.trim(), Math.round(Number(item.budget)));
      }
    } else {
      const stageShare = stages.length > 0 ? Math.floor(total / stages.length) : 0;
      let remainder = stages.length > 0 ? total - stageShare * stages.length : 0;
      for (const stage of stages) {
        const extra = remainder > 0 ? 1 : 0;
        remainder = Math.max(0, remainder - extra);
        stageBudgetMap.set(stage, stageShare + extra);
      }
    }

    let earned = 0;
    const allTasks = taskResult.rows;
    if (
      allTasks.length > 0 &&
      allTasks.every((task) => task.col === 'done')
    ) {
      sendJson(res, 200, {
        earned: total,
        total,
        progress: total > 0 ? 1 : 0,
      });
      return;
    }

    for (const stage of stages) {
      const stageTasks = taskResult.rows.filter((task) => task.stage === stage);
      if (stageTasks.length === 0) {
        continue;
      }
      if (stageTasks.every((task) => task.col === 'done')) {
        earned += Number(stageBudgetMap.get(stage) || 0);
      }
    }

    const earnedRounded = Math.round(earned);
    sendJson(res, 200, {
      earned: earnedRounded,
      total,
      progress: total > 0 ? Number((earnedRounded / total).toFixed(4)) : 0,
    });
  } catch (error) {
    console.error('GET /stats/budget failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'stats_unavailable' });
  }
});

app.get('/timer', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  try {
    const project = await resolveActiveProjectForUser(user);
    if (!project) {
      sendJson(res, 200, {
        project_time: formatDurationIso(0),
        client_delay_time: formatDurationIso(0),
        project_time_ms: 0,
        client_delay_time_ms: 0,
        deadline: null,
        status: 'paused',
      });
      return;
    }

    const timerRow = await findProjectTimerByProjectId(project.id);
    const snapshot = computeTimerSnapshot(timerRow);
    sendJson(res, 200, {
      project_time: formatDurationIso(snapshot.projectMs),
      client_delay_time: formatDurationIso(snapshot.delayMs),
      project_time_ms: snapshot.projectMs,
      client_delay_time_ms: snapshot.delayMs,
      deadline: snapshot.deadline,
      status: snapshot.status,
    });
  } catch (error) {
    console.error('GET /timer failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'timer_unavailable' });
  }
});

app.post('/timer/start', async (req, res) => {
  const user = requireAuth(req, res, TIMER_WRITE_ROLES);
  if (!user) {
    return;
  }

  try {
    const project = await resolveActiveProjectForUser(user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const responseRow = await runInTransaction(async (tx) => {
      let row = await findProjectTimerByProjectId(project.id, tx);
      const now = new Date();
      const nowMs = now.getTime();

      if (!row) {
        const inserted = await tx.query(
          `
            INSERT INTO project_timers (
              project_id,
              status,
              project_origin_started_at,
              project_started_at,
              project_elapsed_ms,
              client_delay_started_at,
              client_delay_elapsed_ms,
              deadline_at,
              updated_at
            )
            VALUES (
              $1,
              'running',
              $2,
              $2,
              0,
              NULL,
              0,
              $3,
              NOW()
            )
            RETURNING project_id, status, project_origin_started_at, project_started_at,
                      project_elapsed_ms, client_delay_started_at, client_delay_elapsed_ms,
                      deadline_at, created_at, updated_at
          `,
          [
            project.id,
            now.toISOString(),
            project.duration_weeks > 0
              ? new Date(nowMs + Number(project.duration_weeks) * 7 * 24 * 60 * 60 * 1000).toISOString()
              : null,
          ]
        );
        return inserted.rows[0];
      }

      if (row.status === 'running') {
        return row;
      }

      const delayStartedAtMs = row.client_delay_started_at
        ? Date.parse(row.client_delay_started_at)
        : null;
      const delayDelta = delayStartedAtMs ? Math.max(0, nowMs - delayStartedAtMs) : 0;
      const originStartedAt = row.project_origin_started_at || now.toISOString();
      const originStartedAtMs = Date.parse(originStartedAt);
      const deadlineAt =
        Number(project.duration_weeks || 0) > 0
          ? new Date(
              originStartedAtMs +
                Number(project.duration_weeks) * 7 * 24 * 60 * 60 * 1000
            ).toISOString()
          : null;

      const updated = await tx.query(
        `
          UPDATE project_timers
          SET status = 'running',
              project_origin_started_at = $2,
              project_started_at = $3,
              client_delay_started_at = NULL,
              client_delay_elapsed_ms = client_delay_elapsed_ms + $4,
              deadline_at = $5,
              updated_at = NOW()
          WHERE project_id = $1
          RETURNING project_id, status, project_origin_started_at, project_started_at,
                    project_elapsed_ms, client_delay_started_at, client_delay_elapsed_ms,
                    deadline_at, created_at, updated_at
        `,
        [project.id, originStartedAt, now.toISOString(), delayDelta, deadlineAt]
      );
      return updated.rows[0];
    });

    const snapshot = computeTimerSnapshot(responseRow);
    sendJson(res, 200, {
      project_time: formatDurationIso(snapshot.projectMs),
      client_delay_time: formatDurationIso(snapshot.delayMs),
      project_time_ms: snapshot.projectMs,
      client_delay_time_ms: snapshot.delayMs,
      deadline: snapshot.deadline,
      status: snapshot.status,
    });
  } catch (error) {
    console.error('POST /timer/start failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'timer_unavailable' });
  }
});

app.post('/timer/stop', async (req, res) => {
  const user = requireAuth(req, res, TIMER_WRITE_ROLES);
  if (!user) {
    return;
  }

  try {
    const project = await resolveActiveProjectForUser(user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const responseRow = await runInTransaction(async (tx) => {
      let row = await findProjectTimerByProjectId(project.id, tx);
      const now = new Date();
      const nowMs = now.getTime();

      if (!row) {
        const inserted = await tx.query(
          `
            INSERT INTO project_timers (
              project_id,
              status,
              project_origin_started_at,
              project_started_at,
              project_elapsed_ms,
              client_delay_started_at,
              client_delay_elapsed_ms,
              deadline_at,
              updated_at
            )
            VALUES (
              $1,
              'paused',
              NULL,
              NULL,
              0,
              $2,
              0,
              NULL,
              NOW()
            )
            RETURNING project_id, status, project_origin_started_at, project_started_at,
                      project_elapsed_ms, client_delay_started_at, client_delay_elapsed_ms,
                      deadline_at, created_at, updated_at
          `,
          [project.id, now.toISOString()]
        );
        return inserted.rows[0];
      }

      const projectStartedAtMs = row.project_started_at
        ? Date.parse(row.project_started_at)
        : null;
      const projectDelta =
        row.status === 'running' && projectStartedAtMs
          ? Math.max(0, nowMs - projectStartedAtMs)
          : 0;
      const delayStartAt =
        row.client_delay_started_at || now.toISOString();

      const updated = await tx.query(
        `
          UPDATE project_timers
          SET status = 'paused',
              project_started_at = NULL,
              project_elapsed_ms = project_elapsed_ms + $2,
              client_delay_started_at = $3,
              updated_at = NOW()
          WHERE project_id = $1
          RETURNING project_id, status, project_origin_started_at, project_started_at,
                    project_elapsed_ms, client_delay_started_at, client_delay_elapsed_ms,
                    deadline_at, created_at, updated_at
        `,
        [project.id, projectDelta, delayStartAt]
      );
      return updated.rows[0];
    });

    const snapshot = computeTimerSnapshot(responseRow);
    sendJson(res, 200, {
      project_time: formatDurationIso(snapshot.projectMs),
      client_delay_time: formatDurationIso(snapshot.delayMs),
      project_time_ms: snapshot.projectMs,
      client_delay_time_ms: snapshot.delayMs,
      deadline: snapshot.deadline,
      status: snapshot.status,
    });
  } catch (error) {
    console.error('POST /timer/stop failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'timer_unavailable' });
  }
});

app.post('/timer/complete', async (req, res) => {
  const user = requireAuth(req, res, TIMER_WRITE_ROLES);
  if (!user) {
    return;
  }

  try {
    const project = await resolveActiveProjectForUser(user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const responseRow = await runInTransaction(async (tx) => {
      const now = new Date();
      const nowMs = now.getTime();
      let row = await findProjectTimerByProjectId(project.id, tx);

      if (!row) {
        const inserted = await tx.query(
          `
            INSERT INTO project_timers (
              project_id,
              status,
              project_origin_started_at,
              project_started_at,
              project_elapsed_ms,
              client_delay_started_at,
              client_delay_elapsed_ms,
              deadline_at,
              updated_at
            )
            VALUES (
              $1,
              'paused',
              NULL,
              NULL,
              0,
              NULL,
              0,
              NULL,
              NOW()
            )
            RETURNING project_id, status, project_origin_started_at, project_started_at,
                      project_elapsed_ms, client_delay_started_at, client_delay_elapsed_ms,
                      deadline_at, created_at, updated_at
          `,
          [project.id]
        );
        return inserted.rows[0];
      }

      const projectStartedAtMs = row.project_started_at
        ? Date.parse(row.project_started_at)
        : null;
      const projectDelta =
        row.status === 'running' && projectStartedAtMs
          ? Math.max(0, nowMs - projectStartedAtMs)
          : 0;

      const delayStartedAtMs = row.client_delay_started_at
        ? Date.parse(row.client_delay_started_at)
        : null;
      const delayDelta =
        row.status !== 'running' && delayStartedAtMs
          ? Math.max(0, nowMs - delayStartedAtMs)
          : 0;

      const updated = await tx.query(
        `
          UPDATE project_timers
          SET status = 'paused',
              project_started_at = NULL,
              project_elapsed_ms = project_elapsed_ms + $2,
              client_delay_started_at = NULL,
              client_delay_elapsed_ms = client_delay_elapsed_ms + $3,
              updated_at = NOW()
          WHERE project_id = $1
          RETURNING project_id, status, project_origin_started_at, project_started_at,
                    project_elapsed_ms, client_delay_started_at, client_delay_elapsed_ms,
                    deadline_at, created_at, updated_at
        `,
        [project.id, projectDelta, delayDelta]
      );
      return updated.rows[0];
    });

    const snapshot = computeTimerSnapshot(responseRow);
    sendJson(res, 200, {
      project_time: formatDurationIso(snapshot.projectMs),
      client_delay_time: formatDurationIso(snapshot.delayMs),
      project_time_ms: snapshot.projectMs,
      client_delay_time_ms: snapshot.delayMs,
      deadline: snapshot.deadline,
      status: snapshot.status,
    });
  } catch (error) {
    console.error('POST /timer/complete failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'timer_unavailable' });
  }
});

app.post('/llm/task-dialog', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  const parsed = parseTaskDialogPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  if (!isPurposeAllowedForUser(user, 'new_task')) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  try {
    const resolvedProjectId =
      parsed.value.project_id ||
      ((await resolveActiveProjectForUser(user)) || {}).id ||
      null;
    const systemPrompt =
      'Ты технический лид PlanKanban. На основе диалога выдай строго JSON-объект без markdown: ' +
      '{"title":"...","descript":"...","stage":"...","priority":0}. ' +
      'Если данных мало, заполни консервативно и кратко.';

    const llmText = await requestLlmText({
      user,
      purpose: 'new_task',
      projectId: resolvedProjectId,
      systemPrompt,
      messages: parsed.value.messages,
      maxTokens: 700,
      temperature: 0.1,
    });
    const candidate = tryParseJsonBlock(llmText);
    const normalized = ensureTaskDialogShape(candidate);
    if (!normalized) {
      sendJson(res, 200, buildFallbackDialogTask(parsed.value.messages));
      return;
    }
    sendJson(res, 200, normalized);
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }
    console.error('POST /llm/task-dialog failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.post('/import/excel', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const parsed = parseImportExcelPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const activeProject = await resolveActiveProjectForUser(user);
    const projectId = parsed.value.project_id || (activeProject && activeProject.id);
    if (!projectId) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const project = await findVisibleProjectById(projectId, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    if (!isPurposeAllowedForUser(user, 'import_parse')) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }

    const systemPrompt =
      'Ты парсер задач PlanKanban. Верни только JSON-массив объектов формата: ' +
      '[{"title":"...","stage":"...","description":"...","release":"...","notes":"...","priority":0}]. ' +
      'Никакого markdown и пояснений.';

    let parsedTasks = [];
    try {
      const llmText = await requestLlmText({
        user,
        purpose: 'import_parse',
        projectId: project.id,
        systemPrompt,
        messages: [
          {
            role: 'user',
            content: parsed.value.content,
          },
        ],
        maxTokens: 1800,
        temperature: 0.1,
      });
      parsedTasks = normalizeImportedTasks(tryParseJsonBlock(llmText));
    } catch (error) {
      if (isAppError(error) && error.errorCode === 'llm_unavailable') {
        parsedTasks = [];
      } else {
        throw error;
      }
    }

    if (parsedTasks.length === 0) {
      parsedTasks = fallbackImportTasksFromContent(parsed.value.content);
    }
    if (parsedTasks.length === 0) {
      sendJson(res, 400, { error: 'empty_import' });
      return;
    }

    const createdTasks = await runInTransaction(async (tx) => {
      const inserted = [];
      for (const item of parsedTasks) {
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
              descript,
              notes,
              deps
            )
            VALUES (
              $1, $2, 'backlog', $3, NULL, $4, NULL, $5, NULL, $6, $7, NULL
            )
            RETURNING id, public_id, project_id, title, col, stage, assignee_user_id, track, agent,
                      priority, hours, descript, notes, deps, created_at, updated_at
          `,
          [
            project.id,
            item.title,
            item.stage,
            item.release || null,
            item.priority,
            item.description,
            item.notes,
          ]
        );
        const createdTask = created.rows[0];
        inserted.push(createdTask);
        await writeTaskEvent(
          {
            projectId: project.id,
            taskId: createdTask.id,
            actorUserId: user.id,
            action: 'create',
            before: {},
            after: createdTask,
            payload: {
              source: 'import_excel',
              file_name: parsed.value.file_name,
            },
          },
          tx
        );
      }
      return inserted;
    });

    sendJson(res, 201, {
      created: createdTasks.length,
      tasks: createdTasks,
    });
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }
    console.error('POST /import/excel failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'import_unavailable' });
  }
});

app.post('/api/service-accounts', async (req, res) => {
  const user = requireAuth(req, res, ['admin']);
  if (!user) {
    return;
  }

  const parsed = parseServiceAccountCreatePayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  const token = createServiceToken();
  const tokenHash = hashServiceToken(token);

  try {
    const result = await db.query(
      `
        INSERT INTO service_accounts (name, scopes, token_hash)
        VALUES ($1, $2, $3)
        RETURNING id, name, scopes
      `,
      [parsed.value.name, parsed.value.scopes, tokenHash]
    );

    sendJson(res, 201, {
      id: result.rows[0].id,
      name: result.rows[0].name,
      scopes: result.rows[0].scopes,
      token,
    });
  } catch (error) {
    console.error('POST /api/service-accounts failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.get('/api/service-accounts', async (req, res) => {
  const user = requireAuth(req, res, ['admin']);
  if (!user) {
    return;
  }

  try {
    const result = await db.query(
      `
        SELECT id, name, scopes, created_at, revoked_at
        FROM service_accounts
        ORDER BY created_at DESC
      `
    );

    sendJson(res, 200, { service_accounts: result.rows });
  } catch (error) {
    console.error('GET /api/service-accounts failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.post('/api/agent/actions', async (req, res) => {
  let service;
  try {
    service = await requireServiceAuth(req, res);
  } catch (error) {
    console.error('POST /api/agent/actions auth failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
    return;
  }
  if (!service) {
    return;
  }

  const parsed = parseAgentActionsPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  try {
    const responseJson = await runInTransaction(async (tx) => {
      const existing = await findAgentIdempotencyResponse(
        service.id,
        parsed.value.idempotencyKey,
        tx
      );
      if (existing) {
        return existing;
      }

      const executionContext = {
        service,
        idempotencyKey: parsed.value.idempotencyKey,
        runId: parsed.value.runId,
        agent: parsed.value.agent,
      };

      const results = [];
      for (let index = 0; index < parsed.value.actions.length; index += 1) {
        const action = parsed.value.actions[index];
        ensureActionScope(service, action.type);
        const result = await applyAgentAction(executionContext, action, index, tx);
        results.push(result);
      }

      const responsePayload = {
        gateway_request_id: crypto.randomUUID(),
        results,
      };

      await saveAgentIdempotencyResponse(
        service.id,
        parsed.value.idempotencyKey,
        responsePayload,
        tx
      );

      return responsePayload;
    });

    sendJson(res, 200, responseJson);
  } catch (error) {
    if (error && error.code === '23505') {
      try {
        const existing = await findAgentIdempotencyResponse(
          service.id,
          parsed.value.idempotencyKey
        );
        if (existing) {
          sendJson(res, 200, existing);
          return;
        }
      } catch (readError) {
        console.error('POST /api/agent/actions idempotency read failed:', readError.message);
        if (isDevelopment() && readError.stack) {
          console.error(readError.stack);
        }
      }
    }

    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }

    if (error && (error.code === '23503' || error.code === '22P02')) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }

    console.error('POST /api/agent/actions failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.get('/api/agent/context', async (req, res) => {
  let service;
  try {
    service = await requireServiceAuth(req, res);
  } catch (error) {
    console.error('GET /api/agent/context auth failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
    return;
  }
  if (!service) {
    return;
  }

  if (!requireServiceScope(req, res, 'tasks:read')) {
    return;
  }

  const taskId = typeof req.query.task_id === 'string' ? req.query.task_id.trim() : '';
  if (!isUuid(taskId)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  try {
    const task = await findTaskById(taskId);
    if (!task) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }

    const project = await findProjectById(task.project_id);
    if (!project) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }

    sendJson(res, 200, {
      task,
      project,
      allowed_transitions: [],
      capabilities: {
        scopes: service.scopes,
      },
    });
  } catch (error) {
    console.error('GET /api/agent/context failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.get('/api/events', async (req, res) => {
  let service;
  try {
    service = await requireServiceAuth(req, res);
  } catch (error) {
    console.error('GET /api/events auth failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
    return;
  }
  if (!service) {
    return;
  }

  if (!requireServiceScope(req, res, 'events:read')) {
    return;
  }

  let since = null;
  if (req.query.since !== undefined) {
    if (typeof req.query.since !== 'string') {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    const rawSince = req.query.since.trim();
    if (rawSince !== '') {
      const parsedSince = new Date(rawSince);
      if (Number.isNaN(parsedSince.getTime())) {
        sendJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      since = parsedSince.toISOString();
    }
  }

  let limit = 50;
  if (req.query.limit !== undefined) {
    const parsedLimit = Number(req.query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    limit = Math.min(parsedLimit, 200);
  }

  try {
    const values = [];
    const whereClauses = [];
    if (since) {
      values.push(since);
      whereClauses.push(`created_at > $${values.length}`);
    }
    values.push(limit);
    const whereSql =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const limitPlaceholder = `$${values.length}`;

    const result = await db.query(
      `
        SELECT id, event_type AS type, task_id, project_id, created_at, payload AS meta
        FROM task_events
        ${whereSql}
        ORDER BY created_at ASC, id ASC
        LIMIT ${limitPlaceholder}
      `,
      values
    );

    sendJson(res, 200, { events: result.rows });
  } catch (error) {
    console.error('GET /api/events failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'internal_error' });
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

  if (!ANTHROPIC_API_KEY) {
    const responseMeta = {
      worker_used: workerUsed,
      latency_ms: Date.now() - startedAt,
      provider_http_status: null,
      response_id: null,
      stop_reason: null,
      stub: LLM_STUB_MODE,
    };

    if (LLM_STUB_MODE) {
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
          inputTokens: 0,
          outputTokens: 0,
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

      sendJson(res, 200, {
        text: 'LLM_STUB_OK',
        provider: resolved.value.provider,
        model: resolved.value.model,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
        request_id: requestId,
      });
      return;
    }

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
        errorCode: 'missing_api_key',
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
