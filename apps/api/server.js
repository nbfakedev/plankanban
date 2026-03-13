const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const { verifyPassword, hashPassword } = require('./lib/password');
const {
  createDbConfigFromEnv,
  createDbConnectionInfo,
} = require('./lib/db-config');
const {
  fetchAndStoreLlmPrices,
  loadPricingCache,
  getPriceFromCache,
  getFallbackPrice,
} = require('./lib/llm-pricing');

const PORT = Number(process.env.PORT) || 3000;
const webRoot = path.resolve(__dirname, '..', 'web');
const MAX_JSON_BODY = '5mb';
const ALL_ROLES = ['admin', 'techlead', 'manager', 'employee'];
const PROJECT_WRITE_ROLES = ['admin', 'techlead'];
const TASK_WRITE_ROLES = ['admin', 'techlead'];
const ADMIN_ONLY = ['admin'];
const LLM_ROLES = ['admin', 'techlead'];
const TRASH_LIST_ROLES = ['admin', 'techlead', 'manager'];
const EVENTS_LIST_ROLES = ['admin', 'techlead', 'manager'];
const TASK_COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done'];
const TASK_TRASH_LIST_DEFAULT_LIMIT = 100;
const TASK_TRASH_LIST_MAX_LIMIT = 500;
const TASK_COLUMN_ALIASES = {
  backlog: 'backlog',
  'back log': 'backlog',
  todo: 'todo',
  'to do': 'todo',
  'to-do': 'todo',
  doing: 'doing',
  inprogress: 'doing',
  in_progress: 'doing',
  'in progress': 'doing',
  'in-progress': 'doing',
  review: 'review',
  done: 'done',
};
const NO_STAGE = 'Без этапа';
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
const LLM_PURPOSES = ['new_task', 'chat', 'import_parse', 'techlead'];
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
const ANTHROPIC_API_KEY_RAW = normalizeNullableString(process.env.ANTHROPIC_API_KEY);
const LLM_KEY_PLACEHOLDERS = /^(change_me|your[_-]?key|sk-ant-placeholder|sk-proj-placeholder)$/i;
const ANTHROPIC_API_KEY = (ANTHROPIC_API_KEY_RAW && !LLM_KEY_PLACEHOLDERS.test(ANTHROPIC_API_KEY_RAW.trim()))
  ? ANTHROPIC_API_KEY_RAW
  : null;
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_DEFAULT_MODELS = [
  'claude-sonnet-4-6',
  'claude-sonnet-4',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-5-20251001',
  'claude-3-5-sonnet-latest',
];
const ANTHROPIC_ALLOWED_MODELS = (() => {
  const parsed = parseCsvList(process.env.LLM_ALLOWED_MODELS_ANTHROPIC);
  return parsed.length > 0 ? parsed : ANTHROPIC_DEFAULT_MODELS;
})();

/** Единый список всех поддерживаемых LLM-провайдеров (в т.ч. для настроек и отчётов). */
const ALL_LLM_PROVIDERS = [
  'anthropic',
  'openai',
  'deepseek',
  'groq',
  'qwen',
  'google',
  'custom',
];

/** Провайдеры с OpenAI-совместимым API (не Anthropic). */
const OPENAI_COMPATIBLE_PROVIDERS = [
  'openai',
  'deepseek',
  'groq',
  'qwen',
  'google',
  'custom',
];

const OPENAI_DEFAULT_MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
];
const DEEPSEEK_DEFAULT_MODELS = ['deepseek-chat', 'deepseek-coder'];
const GROQ_DEFAULT_MODELS = [
  'llama-3.1-8b-instant',
  'llama-3.1-70b-versatile',
  'mixtral-8x7b-32768',
];
const QWEN_DEFAULT_MODELS = ['qwen-turbo', 'qwen-plus', 'qwen-max'];
const GOOGLE_DEFAULT_MODELS = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'];

/** Имя параметра лимита токенов: различается по провайдерам. */
function getMaxTokensParamName(provider) {
  const p = (provider || '').toLowerCase();
  if (p === 'openai') return 'max_completion_tokens';
  if (p === 'anthropic') return 'max_tokens';
  return 'max_tokens';
}

const llmRateLimitBuckets = new Map();
const dbConfigState = createDbConfigFromEnv(process.env);
const dbConfig = dbConfigState.config;
const dbConnectionInfo = createDbConnectionInfo(dbConfig);
const db = new Pool(dbConfig);

const LLM_USER_KEYS_SECRET =
  normalizeNullableString(process.env.LLM_USER_KEYS_ENCRYPTION_SECRET) ||
  normalizeNullableString(process.env.JWT_SECRET) ||
  '';

function encryptLlmUserKey(plainText) {
  if (!plainText || typeof plainText !== 'string') return null;
  if (!LLM_USER_KEYS_SECRET) return null;
  try {
    const crypto = require('crypto');
    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(LLM_USER_KEYS_SECRET, 'salt', 32);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(plainText, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return iv.toString('base64') + ':' + encrypted;
  } catch (e) {
    return null;
  }
}

function decryptLlmUserKey(cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return null;
  if (!LLM_USER_KEYS_SECRET) return null;
  try {
    const crypto = require('crypto');
    const parts = cipherText.split(':');
    if (parts.length < 2) return null;
    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = parts.slice(1).join(':');
    const key = crypto.scryptSync(LLM_USER_KEYS_SECRET, 'salt', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (e) {
    return null;
  }
}

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

function createAppError(statusCode, errorCode, meta) {
  const error = new Error(errorCode);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  if (meta && typeof meta === 'object') {
    if (meta.hint) error.hint = meta.hint;
    if (meta.message) error.message = meta.message;
  }
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
  const p = (provider || '').toLowerCase();
  switch (p) {
    case 'anthropic':
      return ANTHROPIC_ALLOWED_MODELS;
    case 'openai':
      return OPENAI_DEFAULT_MODELS;
    case 'deepseek':
      return DEEPSEEK_DEFAULT_MODELS;
    case 'groq':
      return GROQ_DEFAULT_MODELS;
    case 'qwen':
      return QWEN_DEFAULT_MODELS;
    case 'google':
      return GOOGLE_DEFAULT_MODELS;
    case 'custom':
      return ['custom'];
    default:
      return [];
  }
}

function isOpenAiCompatibleProvider(provider) {
  return (
    provider &&
    OPENAI_COMPATIBLE_PROVIDERS.includes(String(provider).toLowerCase())
  );
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

  if (payload.stream === true) {
    parsed.stream = true;
  }

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
  const model = (parsedPayload.model || LLM_DEFAULT_MODEL || '').trim();

  if (!provider || !model) {
    return { error: 'invalid_payload' };
  }

  const allowedModels = getLlmAllowedModels(provider);
  const allowed =
    allowedModels.length > 0 &&
    (allowedModels.includes(model) ||
      (isOpenAiCompatibleProvider(provider) && model));
  if (!allowed) {
    return { error: 'invalid_payload' };
  }

  return { value: { provider, model } };
}

const LLM_PROVIDER_SETTINGS_PURPOSES = ['import_parse', 'new_task', 'chat', 'techlead'];
const LLM_PROVIDER_SETTINGS_PROVIDERS = ALL_LLM_PROVIDERS;

function parseProviderSettingPayload(payload, forUpdate) {
  if (!isObjectPayload(payload)) return { error: 'invalid_payload' };
  const purpose =
    typeof payload.purpose === 'string' ? payload.purpose.trim() : '';
  if (!LLM_PROVIDER_SETTINGS_PURPOSES.includes(purpose))
    return { error: 'invalid_payload' };
  const provider =
    typeof payload.provider === 'string'
      ? payload.provider.trim().toLowerCase()
      : '';
  if (!LLM_PROVIDER_SETTINGS_PROVIDERS.includes(provider))
    return { error: 'invalid_payload' };
  const model = typeof payload.model === 'string' ? payload.model.trim() : '';
  if (!model) return { error: 'invalid_payload' };
  const apiKey =
    typeof payload.api_key === 'string' ? payload.api_key.trim() : null;
  const baseUrl =
    typeof payload.base_url === 'string' ? payload.base_url.trim() || null : null;
  const isEnabled =
    payload.is_enabled !== undefined ? Boolean(payload.is_enabled) : true;
  const isIndividualOverride =
    payload.is_individual_override === true;
  return {
    value: {
      purpose,
      provider,
      model,
      api_key: apiKey,
      base_url: baseUrl,
      is_enabled: isEnabled,
      is_individual_override: isIndividualOverride,
    },
  };
}

async function getLlmBaseConfigForUser(userId) {
  try {
    const result = await db.query(
      `SELECT id, purpose, provider, model, api_key_encrypted, base_url
       FROM llm_provider_settings
       WHERE user_id = $1 AND is_enabled = true
         AND (is_individual_override = false OR is_individual_override IS NULL)
       ORDER BY CASE purpose WHEN 'import_parse' THEN 1 WHEN 'new_task' THEN 2 WHEN 'chat' THEN 3 END
       LIMIT 1`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      const fallback = await db.query(
        `SELECT id, purpose, provider, model, api_key_encrypted, base_url
         FROM llm_provider_settings WHERE user_id = $1 AND is_enabled = true
         ORDER BY purpose LIMIT 1`,
        [userId]
      );
      const r = fallback.rows[0];
      if (!r) return null;
      return { id: r.id, purpose: r.purpose, provider: r.provider, model: r.model, api_key: null, base_url: r.base_url };
    }
    return { id: row.id, purpose: row.purpose, provider: row.provider, model: row.model, api_key: null, base_url: row.base_url };
  } catch (e) {
    return null;
  }
}

async function getLlmUserSettingForPurpose(userId, purpose) {
  try {
    const result = await db.query(
      `SELECT id, purpose, provider, model, api_key_encrypted, base_url, is_enabled
       FROM llm_provider_settings
       WHERE user_id = $1 AND purpose = $2 AND is_enabled = true`,
      [userId, purpose]
    );
    const row = result.rows[0];
    if (row) {
      return {
        id: row.id,
        purpose: row.purpose,
        provider: row.provider,
        model: row.model,
        api_key: null,
        base_url: row.base_url,
      };
    }
    const baseConfig = await getLlmBaseConfigForUser(userId);
    return baseConfig;
  } catch (e) {
    return null;
  }
}

async function getLlmApiKeyForProvider(userId, provider) {
  try {
    const result = await db.query(
      `SELECT api_key_encrypted, base_url FROM llm_user_api_keys WHERE user_id = $1 AND provider = $2`,
      [userId, provider]
    );
    const row = result.rows[0];
    if (!row || !row.api_key_encrypted) return null;
    const apiKey = decryptLlmUserKey(row.api_key_encrypted);
    if (!apiKey) return null;
    return { api_key: apiKey, base_url: row.base_url || undefined };
  } catch (e) {
    return null;
  }
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
  const maxVal = params.max_tokens !== undefined ? params.max_tokens : ANTHROPIC_DEFAULT_MAX_TOKENS;
  const body = { model: resolvedModel, messages: requestMessages };
  body[getMaxTokensParamName('anthropic')] = maxVal;

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

let llmPricingCache = new Map();

function estimateLlmCostUsd(provider, model, inputTokens, outputTokens) {
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    (inputTokens <= 0 && outputTokens <= 0)
  ) {
    return null;
  }
  const inM = (inputTokens || 0) / 1e6;
  const outM = (outputTokens || 0) / 1e6;
  let price = getPriceFromCache(llmPricingCache, provider, model);
  if (!price) {
    price = getFallbackPrice(provider, model);
  }
  if (!price || !Number.isFinite(price.input) || !Number.isFinite(price.output)) {
    return null;
  }
  const cost = inM * price.input + outM * price.output;
  return cost > 0 ? Math.round(cost * 1e8) / 1e8 : null;
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

async function sendAnthropicRequest(body, options) {
  const apiKey = options && options.apiKey ? options.apiKey : null;
  if (!apiKey || !apiKey.trim()) {
    throw createAppError(502, 'llm_unavailable', { hint: 'missing_api_key' });
  }
  const baseUrlOverride = options && options.baseUrl;
  const workerUsed = Boolean(CLOUDFLARE_WORKER_URL && !baseUrlOverride);
  const endpoint = baseUrlOverride
    ? `${String(baseUrlOverride).replace(/\/+$/, '')}/v1/messages`
    : workerUsed
      ? `${CLOUDFLARE_WORKER_URL.replace(/\/+$/, '')}/v1/messages`
      : 'https://api.anthropic.com/v1/messages';

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };

  if (workerUsed) {
    headers['x-kanban-secret'] = WORKER_SHARED_SECRET || '';
  } else {
    headers['anthropic-version'] = ANTHROPIC_API_VERSION;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 60000);

  const maxAttempts = 3;
  const delayMs = 2000;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log('[Anthropic] endpoint:', endpoint, attempt > 1 ? `(attempt ${attempt}/${maxAttempts})` : '');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        clearTimeout(timeout);
        const responseBody = await readJsonSafely(response);
        throw createAppError(
          response.status >= 500 ? 502 : 400,
          'llm_unavailable',
          { hint: 'provider_error', status: response.status, body: responseBody }
        );
      }

      const responseBody = await readJsonSafely(response);
      clearTimeout(timeout);
      return {
        workerUsed,
        statusCode: response.status,
        ok: response.ok,
        body: responseBody,
      };
    } catch (error) {
      lastError = error;
      if (isAppError(error) && (error.statusCode === 400 || error.statusCode === 502)) {
        clearTimeout(timeout);
        throw error;
      }
      if (attempt < maxAttempts) {
        console.warn('[Anthropic] attempt', attempt, 'failed:', error.message, '- retrying in', delayMs, 'ms');
        await new Promise((r) => setTimeout(r, delayMs));
      } else {
        clearTimeout(timeout);
        console.error('[Anthropic] request failed after', maxAttempts, 'attempts:', error.message, error.code || '');
        if (process.env.NODE_ENV === 'development' && error.stack) {
          console.error(error.stack);
        }
        throw createAppError(502, 'llm_unavailable', { hint: 'request_failed' });
      }
    }
  }

  clearTimeout(timeout);
  throw createAppError(502, 'llm_unavailable', { hint: 'request_failed' });
}

function getOpenAiCompatibleBaseUrl(provider, userSetting) {
  const override = userSetting && userSetting.base_url && userSetting.base_url.trim();
  if (override) return override.replace(/\/+$/, '');
  const p = (provider || '').toLowerCase();
  switch (p) {
    case 'openai':
      return 'https://api.openai.com';
    case 'deepseek':
      return 'https://api.deepseek.com';
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'qwen':
      return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    case 'google':
      return null;
    case 'custom':
      return null;
    default:
      return null;
  }
}

async function fetchModelsFromProvider(provider, apiKey, baseUrl) {
  const p = (provider || '').toLowerCase();
  if (p === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_API_VERSION,
        'content-type': 'application/json',
      },
    });
    const data = await readJsonSafely(response);
    if (!response.ok) return { error: 'request_failed' };
    const models = Array.isArray(data && data.data)
      ? data.data.map((m) => (m && typeof m.id === 'string' ? m.id : null)).filter(Boolean)
      : [];
    return { models };
  }
  const base = baseUrl && baseUrl.trim()
    ? baseUrl.replace(/\/+$/, '')
    : getOpenAiCompatibleBaseUrl(provider, { base_url: null });
  if (!base) return { error: 'invalid_provider_config' };
  const url = base + '/v1/models';
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
    },
  });
  const data = await readJsonSafely(response);
  if (!response.ok) return { error: 'request_failed' };
  const raw = Array.isArray(data && data.data) ? data.data : [];
  const models = raw
    .map((m) => (m && typeof m.id === 'string' ? m.id : null))
    .filter(Boolean)
    .sort();
  return { models };
}

async function sendOpenAiCompatibleChat(parsedPayload, resolved, userSetting) {
  const apiKey = userSetting && userSetting.api_key && userSetting.api_key.trim();
  if (!apiKey) {
    return { error: 'missing_api_key', statusCode: 502 };
  }

  const baseUrl = getOpenAiCompatibleBaseUrl(resolved.provider, userSetting);
  if (!baseUrl) {
    return { error: 'invalid_provider_config', statusCode: 400 };
  }

  const messages = [];
  for (const m of parsedPayload.messages || []) {
    if (m.role === 'system') {
      messages.push({ role: 'system', content: m.content || '' });
      continue;
    }
    messages.push({ role: m.role, content: m.content || '' });
  }
  if (messages.length === 0) {
    return { error: 'invalid_payload', statusCode: 400 };
  }

  const params = parsedPayload.params || {};
  const maxVal = params.max_tokens !== undefined ? params.max_tokens : 1024;
  const provider = resolved && resolved.provider ? resolved.provider : 'openai';
  const body = { model: resolved.model, messages };
  body[getMaxTokensParamName(provider)] = maxVal;
  const modelId = (resolved.model || '').toLowerCase();
  const noTemperature = modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('gpt-5');
  if (params.temperature !== undefined && !noTemperature) body.temperature = params.temperature;

  const url = `${baseUrl}/v1/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const responseBody = await readJsonSafely(res);

    if (!res.ok) {
      let errMsg = null;
      if (responseBody) {
        if (typeof responseBody.error === 'string') errMsg = responseBody.error;
        else if (responseBody.error && typeof responseBody.error.message === 'string') errMsg = responseBody.error.message;
        else if (typeof responseBody.message === 'string') errMsg = responseBody.message;
      }
      if (!errMsg) errMsg = res.statusText || 'provider_error';
      return {
        error: typeof errMsg === 'string' ? errMsg : 'provider_error',
        statusCode: res.status,
      };
    }

    const text =
      responseBody &&
      responseBody.choices &&
      responseBody.choices[0] &&
      responseBody.choices[0].message &&
      typeof responseBody.choices[0].message.content === 'string'
        ? responseBody.choices[0].message.content
        : '';
    const usage = responseBody && responseBody.usage ? responseBody.usage : {};
    const inputTokens =
      typeof usage.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : typeof usage.input_tokens === 'number'
          ? usage.input_tokens
          : null;
    const outputTokens =
      typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : typeof usage.output_tokens === 'number'
          ? usage.output_tokens
          : null;
    const finishReason =
      responseBody &&
      responseBody.choices &&
      responseBody.choices[0] &&
      responseBody.choices[0].finish_reason;
    const responseId = responseBody && responseBody.id ? responseBody.id : null;

    return {
      text,
      inputTokens,
      outputTokens,
      statusCode: res.status,
      responseId,
      stopReason: finishReason || null,
    };
  } catch (err) {
    clearTimeout(timeout);
    console.error('[OpenAI-compatible] request failed:', err.message);
    return {
      error: err.name === 'TimeoutError' || err.name === 'AbortError' ? 'timeout' : 'request_failed',
      statusCode: 502,
    };
  }
}

function sseLine(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function* streamAnthropicLlm(body, options) {
  const apiKey = options && options.apiKey ? options.apiKey : null;
  if (!apiKey || !apiKey.trim()) {
    throw createAppError(502, 'llm_unavailable', { hint: 'missing_api_key' });
  }
  const baseUrlOverride = options && options.baseUrl;
  const workerUsed = Boolean(CLOUDFLARE_WORKER_URL && !baseUrlOverride);
  const endpoint = baseUrlOverride
    ? `${String(baseUrlOverride).replace(/\/+$/, '')}/v1/messages`
    : workerUsed
      ? `${CLOUDFLARE_WORKER_URL.replace(/\/+$/, '')}/v1/messages`
      : 'https://api.anthropic.com/v1/messages';

  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };
  if (workerUsed) {
    headers['x-kanban-secret'] = WORKER_SHARED_SECRET || '';
  } else {
    headers['anthropic-version'] = ANTHROPIC_API_VERSION;
  }

  const reqBody = { ...body, stream: true };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errBody = await readJsonSafely(response);
    throw createAppError(response.status >= 500 ? 502 : 400, 'llm_unavailable', {
      hint: 'provider_error',
      status: response.status,
      body: errBody,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let usage = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data);
            if (obj.type === 'content_block_delta' && obj.delta && obj.delta.type === 'text_delta' && typeof obj.delta.text === 'string') {
              yield { type: 'delta', text: obj.delta.text };
            } else if (obj.type === 'message_delta' && obj.usage) {
              usage = obj.usage;
            }
          } catch (_) { /* ignore */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: 'done', usage };
}

async function* streamOpenAiCompatibleLlm(body, resolved, userSetting) {
  const apiKey = userSetting && userSetting.api_key && userSetting.api_key.trim();
  if (!apiKey) {
    throw createAppError(502, 'llm_unavailable', { hint: 'missing_api_key' });
  }
  const baseUrl = getOpenAiCompatibleBaseUrl(resolved.provider, userSetting);
  if (!baseUrl) {
    throw createAppError(400, 'invalid_provider_config');
  }

  const messages = [];
  for (const m of body.messages || []) {
    if (m.role === 'system') messages.push({ role: 'system', content: m.content || '' });
    else messages.push({ role: m.role, content: m.content || '' });
  }
  if (messages.length === 0) throw createAppError(400, 'invalid_payload');

  const params = body.params || {};
  const maxVal = params.max_tokens !== undefined ? params.max_tokens : 1024;
  const provider = resolved.provider || 'openai';
  const reqBody = {
    model: resolved.model,
    messages,
    stream: true,
  };
  reqBody[getMaxTokensParamName(provider)] = maxVal;
  const modelId = (resolved.model || '').toLowerCase();
  const noTemp = modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('gpt-5');
  if (params.temperature !== undefined && !noTemp) reqBody.temperature = params.temperature;

  const url = `${baseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    const errBody = await readJsonSafely(response);
    let errMsg = errBody && (errBody.error || errBody.message);
    throw createAppError(response.status >= 500 ? 502 : 400, 'llm_unavailable', {
      hint: 'provider_error',
      status: response.status,
      body: errMsg,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let usage = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split('\n');
      buf = chunks.pop() || '';
      for (const chunk of chunks) {
        if (chunk.startsWith('data: ')) {
          const data = chunk.slice(6);
          if (data === '[DONE]') continue;
          try {
            const obj = JSON.parse(data);
            const content = obj.choices?.[0]?.delta?.content;
            if (typeof content === 'string') yield { type: 'delta', text: content };
            if (obj.usage) usage = obj.usage;
          } catch (_) { /* ignore */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  yield { type: 'done', usage };
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

function buildFallbackDialogTask(messages, firstProjectStage) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user');
  const source = lastUserMessage ? lastUserMessage.content.trim() : '';
  const baseTitle = source ? source.split('\n')[0].slice(0, 80) : 'Новая задача';
  const lowered = source.toLowerCase();
  const stage =
    typeof firstProjectStage === 'string' && firstProjectStage.trim()
      ? firstProjectStage.trim()
      : '';

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
        : NO_STAGE;
    const description =
      typeof item.description === 'string'
        ? item.description.trim()
        : typeof item.descript === 'string'
        ? item.descript.trim()
        : '';
    const notes =
      typeof item.notes === 'string' ? item.notes.trim() : null;
    const size =
      typeof item.size === 'string' && item.size.trim() && ['XS', 'S', 'M', 'L', 'XL'].includes(String(item.size).trim().toUpperCase())
        ? String(item.size).trim().toUpperCase()
        : null;
    const release =
      typeof item.release === 'string' ? item.release.trim() : null;
    // priority: 1=low, 2=mid, 3=high, 4=critical. Поддержка EN и RU из документа. Не распознано → 2 (medium).
    let priority = 2;
    if (Number.isInteger(item.priority) && item.priority >= 1 && item.priority <= 4) {
      priority = item.priority;
    } else if (typeof item.priority === 'string' && item.priority.trim()) {
      const key = item.priority.trim().toLowerCase().replace(/\s+/g, ' ');
      const map = {
        low: 1, mid: 2, medium: 2, high: 3, critical: 4,
        низкий: 1, средний: 2, высокий: 3, критический: 4,
        'низкий приоритет': 1, 'средний приоритет': 2, 'высокий приоритет': 3, 'критический приоритет': 4,
      };
      const firstWord = (key.split(/\s/)[0] || '').toLowerCase();
      const parsed = map[key] != null ? map[key] : (firstWord && map[firstWord] != null ? map[firstWord] : null);
      if (parsed != null) priority = parsed;
    }
    // hours — затраченное/планируемое время (часы). size — объём задачи (XS/S/M/L/XL), отдельно; не конвертируем.
    let hours = null;
    if (Number.isFinite(item.hours) && item.hours >= 0) {
      hours = item.hours;
    }
    // deps: строка "id1,id2", массив или объект — нормализуем в объект для JSONB
    let deps = null;
    if (item.deps != null) {
      if (typeof item.deps === 'string' && item.deps.trim()) {
        const ids = item.deps.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
        deps = ids.length ? { blocks: ids } : null;
      } else if (Array.isArray(item.deps)) {
        const ids = item.deps.filter((x) => typeof x === 'string' && x.trim()).map((x) => String(x).trim());
        deps = ids.length ? { blocks: ids } : null;
      } else if (typeof item.deps === 'object' && item.deps !== null && !Array.isArray(item.deps)) {
        deps = item.deps;
      }
    }

    tasks.push({
      title,
      stage,
      description: description || null,
      notes,
      release,
      priority,
      hours,
      size,
      deps,
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
      stage: NO_STAGE,
      description: line,
      notes: null,
      release: null,
      priority: 0,
    });
  }

  return tasks;
}

/** Virtual import parser for stub mode: rich tasks (stages, priority, size, hours) from line-by-line content. Up to 200 tasks. */
function virtualImportTasksFromContent(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const VIRTUAL_STAGES = ['A', 'R1', 'R2', 'F'];
  const VIRTUAL_SIZES = ['XS', 'S', 'M', 'L'];
  const VIRTUAL_HOURS = [2, 4, 8, 16, 24];

  const tasks = [];
  for (let i = 0; i < Math.min(lines.length, 200); i++) {
    const line = lines[i];
    if (line.length < 4) {
      continue;
    }
    tasks.push({
      title: line.slice(0, 140),
      stage: VIRTUAL_STAGES[i % VIRTUAL_STAGES.length],
      description: line,
      notes: null,
      release: null,
      priority: (i % 4) + 1,
      hours: VIRTUAL_HOURS[i % VIRTUAL_HOURS.length],
      size: VIRTUAL_SIZES[i % VIRTUAL_SIZES.length],
      deps: null,
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

  let resolved = null;
  let userSetting = await getLlmUserSettingForPurpose(params.user.id, params.purpose);
  if (userSetting && userSetting.model) {
    const prov = (userSetting.provider || '').toLowerCase();
    const hasKey = Boolean(userSetting.api_key && userSetting.api_key.trim());
    if (hasKey) {
      resolved = { value: { provider: prov, model: userSetting.model } };
    }
  }
  if (!resolved) {
    resolved = resolveLlmProviderAndModel(payload);
  }
  if (resolved.error) {
    throw createAppError(400, 'invalid_payload');
  }
  if (!userSetting) {
    const keyRow = await getLlmApiKeyForProvider(params.user.id, resolved.value.provider);
    if (keyRow) {
      userSetting = { api_key: keyRow.api_key, base_url: keyRow.base_url };
    }
  }

  const provider = resolved.value.provider;
  const startedAt = Date.now();
  const requestMeta = {
    ...getLlmMessageMeta(payload.messages),
    params: payload.params,
    worker_used: Boolean(CLOUDFLARE_WORKER_URL),
  };

  if (provider !== 'anthropic') {
    const openAiResult = await sendOpenAiCompatibleChat(payload, resolved.value, userSetting);
    if (openAiResult.error) {
      await writeLlmRequest({
        projectId: payload.project_id,
        actorUserId: params.user.id,
        purpose: params.purpose,
        provider,
        model: resolved.value.model,
        requestMeta,
        responseMeta: {
          worker_used: false,
          latency_ms: Date.now() - startedAt,
          provider_http_status: openAiResult.statusCode || null,
          response_id: null,
          stop_reason: null,
        },
        inputTokens: null,
        outputTokens: null,
        costEstimateUsd: null,
        status: 'error',
        errorCode: 'provider_request_failed',
      });
      throw createAppError(openAiResult.statusCode || 502, 'llm_unavailable');
    }
    const inputTokens = openAiResult.inputTokens;
    const outputTokens = openAiResult.outputTokens;
    const costEstimateUsd = estimateLlmCostUsd(
      provider,
      resolved.value.model,
      inputTokens,
      outputTokens
    );
    await writeLlmRequest({
      projectId: payload.project_id,
      actorUserId: params.user.id,
      purpose: params.purpose,
      provider,
      model: resolved.value.model,
      requestMeta,
      responseMeta: {
        worker_used: false,
        latency_ms: Date.now() - startedAt,
        provider_http_status: openAiResult.statusCode || 200,
        response_id: openAiResult.responseId || null,
        stop_reason: openAiResult.stopReason || null,
      },
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
      costEstimateUsd,
      status: 'ok',
      errorCode: null,
    });
    return openAiResult.text || '';
  }

  const anthropicRequest = buildAnthropicRequest(payload, resolved.value.model);
  if (anthropicRequest.error) {
    throw createAppError(400, anthropicRequest.error);
  }

  const apiKey = userSetting && userSetting.api_key ? userSetting.api_key : null;
  if (!apiKey) {
    await writeLlmRequest({
      projectId: payload.project_id,
      actorUserId: params.user.id,
      purpose: params.purpose,
      provider,
      model: resolved.value.model,
      requestMeta,
      responseMeta: {
        worker_used: Boolean(CLOUDFLARE_WORKER_URL),
        latency_ms: Date.now() - startedAt,
        provider_http_status: null,
        response_id: null,
        stop_reason: null,
      },
      inputTokens: 0,
      outputTokens: 0,
      costEstimateUsd: null,
      status: 'error',
      errorCode: 'missing_api_key',
    });
    throw createAppError(502, 'llm_unavailable', { hint: 'missing_api_key' });
  }

  const providerResult = await sendAnthropicRequest(anthropicRequest.value, {
    apiKey,
    baseUrl: userSetting && userSetting.base_url ? userSetting.base_url.trim() : undefined,
  });
  if (!providerResult.ok) {
    await writeLlmRequest({
      projectId: payload.project_id,
      actorUserId: params.user.id,
      purpose: params.purpose,
      provider,
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
    console.log('[Anthropic] non-ok response:', providerResult.statusCode, JSON.stringify(providerResult.body)?.substring(0, 300));
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
  const costEstimateUsd = estimateLlmCostUsd(
    provider,
    resolved.value.model,
    inputTokens,
    outputTokens
  );

  await writeLlmRequest({
    projectId: payload.project_id,
    actorUserId: params.user.id,
    purpose: params.purpose,
    provider,
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
    costEstimateUsd,
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
    size: task.size,
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

  if (!Array.isArray(rawStages)) {
    return { error: 'invalid_payload' };
  }
  if (rawStages.length === 0) {
    return { value: [] };
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
    : [];
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

  if (!Array.isArray(rawSettings)) {
    return { error: 'invalid_payload' };
  }
  if (rawSettings.length === 0) {
    return { value: [] };
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

const AGENT_TYPES = ['ai', 'human'];

function normalizeProjectAgentSettings(rawSettings) {
  if (rawSettings === undefined) {
    return { value: undefined };
  }
  if (rawSettings === null || !Array.isArray(rawSettings)) {
    return { value: [] };
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
    const type = typeof item.type === 'string' ? item.type.trim().toLowerCase() : 'human';
    if (!AGENT_TYPES.includes(type)) {
      return { error: 'invalid_payload' };
    }
    const color = typeof item.color === 'string' ? item.color.trim() : '';
    if (!color || !isValidHexColor(color)) {
      return { error: 'invalid_payload' };
    }
    seen.add(nameKey);
    normalized.push({
      name,
      type,
      color: color.toLowerCase(),
    });
  }
  const NO_AGENT_LABEL = 'Без агента';
  const hasNoAgent = normalized.some(function (item) { return item.name.toLowerCase() === NO_AGENT_LABEL.toLowerCase(); });
  if (!hasNoAgent) {
    normalized.unshift({
      name: NO_AGENT_LABEL,
      type: 'ai',
      color: '#6b7280',
    });
  } else {
    const idx = normalized.findIndex(function (item) { return item.name.toLowerCase() === NO_AGENT_LABEL.toLowerCase(); });
    if (idx > 0) {
      const item = normalized.splice(idx, 1)[0];
      normalized.unshift(item);
    }
  }
  return { value: normalized };
}

const DEFAULT_PRIORITY_COLORS = { 1: '#6B7280', 2: '#3B82F6', 3: '#F59E0B', 4: '#EF4444' };
const DEFAULT_PRIORITY_OPTIONS = [
  { value: 1, label: 'Low', color: '#6B7280' },
  { value: 2, label: 'Medium', color: '#3B82F6' },
  { value: 3, label: 'High', color: '#F59E0B' },
  { value: 4, label: 'Critical', color: '#EF4444' },
];

const DEFAULT_SIZE_COLORS = { XS: '#6B7280', S: '#3B82F6', M: '#10B981', L: '#F59E0B', XL: '#EF4444' };
const DEFAULT_SIZE_OPTIONS = [
  { id: 'XS', label: 'XS', color: '#6B7280' },
  { id: 'S', label: 'S', color: '#3B82F6' },
  { id: 'M', label: 'M', color: '#10B981' },
  { id: 'L', label: 'L', color: '#F59E0B' },
  { id: 'XL', label: 'XL', color: '#EF4444' },
];

const DEFAULT_COLUMN_IDS = ['backlog', 'todo', 'doing', 'review', 'done'];
const LOCKED_COLUMNS = ['backlog', 'done'];
const DEFAULT_COL_LABELS = { backlog: 'Backlog', todo: 'To Do', doing: 'In Progress', review: 'Review', done: 'Done' };

function buildDefaultColumnSettings() {
  return DEFAULT_COLUMN_IDS.map(function (cid) {
    return {
      id: cid,
      label: DEFAULT_COL_LABELS[cid] || cid,
      visible: true,
      locked: LOCKED_COLUMNS.includes(cid),
    };
  });
}

function normalizePriorityOptions(raw) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || !Array.isArray(raw)) return { value: DEFAULT_PRIORITY_OPTIONS };
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!isObjectPayload(item)) return { error: 'invalid_payload' };
    const v = Number(item.value);
    if (!Number.isInteger(v) || v < 0) return { error: 'invalid_payload' };
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) return { error: 'invalid_payload' };
    if (seen.has(v)) continue;
    seen.add(v);
    const color = typeof item.color === 'string' && isValidHexColor(item.color) ? item.color.trim().toLowerCase() : (DEFAULT_PRIORITY_COLORS[v] || '#6B7280');
    out.push({ value: v, label, color });
  }
  return { value: out.length > 0 ? out.sort((a, b) => a.value - b.value) : DEFAULT_PRIORITY_OPTIONS };
}

function normalizeSizeOptions(raw) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || !Array.isArray(raw)) return { value: DEFAULT_SIZE_OPTIONS };
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!isObjectPayload(item)) return { error: 'invalid_payload' };
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (!id) return { error: 'invalid_payload' };
    const label = typeof item.label === 'string' ? item.label.trim() : id;
    const key = id.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const color = typeof item.color === 'string' && isValidHexColor(item.color) ? item.color.trim().toLowerCase() : (DEFAULT_SIZE_COLORS[key] || '#6B7280');
    out.push({ id: id.toUpperCase(), label: label || id.toUpperCase(), color });
  }
  return { value: out.length > 0 ? out : DEFAULT_SIZE_OPTIONS };
}

function normalizeColumnSettings(raw) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || !Array.isArray(raw)) return { value: undefined };
  const order = DEFAULT_COLUMN_IDS;
  const byId = {};
  for (const item of raw) {
    if (!isObjectPayload(item)) return { error: 'invalid_payload' };
    const id = typeof item.id === 'string' ? String(item.id).toLowerCase().trim() : '';
    if (!id || !order.includes(id)) continue;
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const locked = LOCKED_COLUMNS.includes(id);
    const visible = locked ? true : (item.visible !== false);
    byId[id] = { id, label: label || id, visible, locked };
  }
  const out = order.map(function (cid) {
    const existing = byId[cid];
    if (existing) return existing;
    return {
      id: cid,
      label: DEFAULT_COL_LABELS[cid] || cid,
      visible: true,
      locked: LOCKED_COLUMNS.includes(cid),
    };
  });
  return { value: out };
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

  const agentSettingsResult = normalizeProjectAgentSettings(payload.agent_settings);
  if (agentSettingsResult.error) {
    return agentSettingsResult;
  }

  const priorityOpts = normalizePriorityOptions(payload.priority_options);
  if (priorityOpts.error) return priorityOpts;
  const sizeOpts = normalizeSizeOptions(payload.size_options);
  if (sizeOpts.error) return sizeOpts;
  const colOpts = normalizeColumnSettings(payload.column_settings);
  if (colOpts.error) return colOpts;

  const stages =
    stageSettingsResult.value
      ? stageSettingsResult.value.map((item) => item.name)
      : stagesResult.value !== undefined
        ? stagesResult.value
        : [];

  let stageSettings =
    stageSettingsResult.value ||
    buildDefaultStageSettings(stages, budgetTotal);
  const hasNoStage = stageSettings.some(
    (s) => String(s?.name || '').trim().toLowerCase() === NO_STAGE.toLowerCase()
  );
  if (!hasNoStage) {
    stageSettings = [
      { name: NO_STAGE, budget: 0, color: '#64748b' },
      ...stageSettings,
    ];
  }
  const stagesFinal = stageSettings.map((s) => s.name);
  const stageSettingsBudgetTotal = stageSettings.reduce(
    (sum, item) => sum + Math.max(0, Math.round(Number(item.budget || 0))),
    0
  );
  const resolvedBudgetTotal = stageSettingsBudgetTotal > 0
    ? stageSettingsBudgetTotal
    : budgetTotal;

  let responsibleUserId = null;
  if (payload.responsible_user_id !== undefined) {
    if (payload.responsible_user_id === null) {
      responsibleUserId = null;
    } else if (typeof payload.responsible_user_id === 'string' && isUuid(payload.responsible_user_id)) {
      responsibleUserId = payload.responsible_user_id;
    } else {
      return { error: 'invalid_payload' };
    }
  }

  return {
    value: {
      name,
      duration_weeks: durationWeeks,
      budget_total: resolvedBudgetTotal,
      stages: stagesFinal,
      stage_settings: stageSettings,
      agent_settings: agentSettingsResult.value,
      priority_options: priorityOpts.value ?? DEFAULT_PRIORITY_OPTIONS,
      size_options: sizeOpts.value ?? DEFAULT_SIZE_OPTIONS,
      column_settings: colOpts.value ?? buildDefaultColumnSettings(),
      responsible_user_id: responsibleUserId,
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

  const provider =
    typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : null;
  const model = typeof payload.model === 'string' ? payload.model.trim() : null;

  return {
    value: {
      project_id: projectId,
      messages,
      provider: provider || null,
      model: model || null,
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

  const provider =
    typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : null;
  const model = typeof payload.model === 'string' ? payload.model.trim() : null;

  return {
    value: {
      project_id: projectId,
      file_name: fileName || null,
      content,
      provider: provider || null,
      model: model || null,
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

const PRIORITY_LABELS_TO_NUM = {
  low: 1,
  mid: 2,
  medium: 2,
  high: 3,
  critical: 4,
};

function normalizeChatActionForApply(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return action;
  }
  const out = { ...action };
  // status -> col
  if (out.status !== undefined && out.col === undefined) {
    out.col = out.status;
    delete out.status;
  }
  // description -> descript
  if (out.description !== undefined && out.descript === undefined) {
    out.descript = out.description;
    delete out.description;
  }
  // col: normalize alias (e.g. "in progress" -> "doing")
  if (typeof out.col === 'string') {
    const key = out.col.trim().toLowerCase();
    const norm = TASK_COLUMN_ALIASES[key] ?? TASK_COLUMN_ALIASES[key.replace(/\s+/g, ' ')];
    if (norm) out.col = norm;
  }
  // priority: string label -> number; drop if unknown
  if (typeof out.priority === 'string') {
    const key = out.priority.trim().toLowerCase();
    const num = PRIORITY_LABELS_TO_NUM[key];
    if (num !== undefined) {
      out.priority = num;
    } else {
      const n = Number(out.priority);
      if (Number.isInteger(n) && n >= 1 && n <= 4) out.priority = n;
      else delete out.priority;
    }
  }
  // hours: string -> number; drop if invalid
  if (out.hours !== undefined && out.hours !== null && typeof out.hours !== 'number') {
    const n = Number(out.hours);
    if (Number.isFinite(n) && n >= 0) {
      out.hours = n;
    } else {
      delete out.hours;
    }
  }
  // agent, track, stage: ensure string or drop
  for (const k of ['agent', 'track', 'stage']) {
    if (out[k] !== undefined && out[k] !== null && typeof out[k] !== 'string') {
      const s = String(out[k]).trim();
      out[k] = s || null;
    }
  }
  // descript: if object/array, drop (LLM occasionally returns wrong type)
  if (out.descript !== undefined && out.descript !== null && typeof out.descript !== 'string') {
    delete out.descript;
  }
  return out;
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

  let task_code = null;
  if (payload.task_code !== undefined && payload.task_code !== null && payload.task_code !== '') {
    if (typeof payload.task_code !== 'string') {
      return { error: 'invalid_payload' };
    }
    const code = payload.task_code.trim().slice(0, 10);
    if (code) task_code = code;
  }

  const updates = {
    title,
    task_code,
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

  if (payload.size !== undefined) {
    if (payload.size !== null && typeof payload.size === 'string' && payload.size.trim()) {
      const s = String(payload.size).trim().toUpperCase();
      if (['XS', 'S', 'M', 'L', 'XL'].includes(s)) updates.size = s;
      else updates.size = null;
    } else {
      updates.size = null;
    }
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

  if (payload.task_code !== undefined) {
    const raw = payload.task_code;
    if (raw === null || raw === '') {
      updates.task_code = null;
    } else if (typeof raw === 'string') {
      const code = raw.trim().slice(0, 10);
      updates.task_code = code || null;
    } else {
      return { error: 'invalid_payload' };
    }
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

  if (payload.size !== undefined) {
    if (payload.size !== null && typeof payload.size === 'string' && payload.size.trim()) {
      const s = String(payload.size).trim().toUpperCase();
      if (['XS', 'S', 'M', 'L', 'XL'].includes(s)) updates.size = s;
      else updates.size = null;
    } else {
      updates.size = null;
    }
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

  if (payload.task_code !== undefined) {
    const raw = payload.task_code;
    if (raw === null || raw === '') {
      updates.task_code = null;
    } else if (typeof raw === 'string') {
      const code = raw.trim().slice(0, 10);
      updates.task_code = code || null;
    } else {
      return { error: 'invalid_payload' };
    }
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
      SELECT id, name, created_by, responsible_user_id, llm_provider, llm_model,
             duration_weeks, budget_total, stages, stage_settings, agent_settings,
             priority_options, size_options, column_settings, history_retention_months, created_at, updated_at
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
        SELECT DISTINCT p.id, p.name, p.created_by, p.responsible_user_id, p.llm_provider, p.llm_model,
               p.duration_weeks, p.budget_total, p.stages, p.stage_settings, p.agent_settings,
               p.priority_options, p.size_options, p.column_settings, p.history_retention_months, p.created_at, p.updated_at
        FROM projects p
        INNER JOIN tasks t ON t.project_id = p.id
        WHERE t.assignee_user_id = $1
        ORDER BY p.created_at DESC
      `,
      [user.id]
    );
    return result.rows;
  }

  if (user.role === 'manager') {
    const result = await executor.query(
      `
        SELECT id, name, created_by, responsible_user_id, llm_provider, llm_model,
               duration_weeks, budget_total, stages, stage_settings, agent_settings,
               priority_options, size_options, column_settings, history_retention_months, created_at, updated_at
        FROM projects
        WHERE responsible_user_id = $1 OR created_by = $1
        ORDER BY created_at DESC
      `,
      [user.id]
    );
    return result.rows;
  }

  const result = await executor.query(
    `
      SELECT id, name, created_by, responsible_user_id, llm_provider, llm_model,
             duration_weeks, budget_total, stages, stage_settings, agent_settings,
             priority_options, size_options, column_settings, history_retention_months, created_at, updated_at
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
        SELECT p.id, p.name, p.created_by, p.responsible_user_id, p.llm_provider, p.llm_model,
               p.duration_weeks, p.budget_total, p.stages, p.stage_settings, p.agent_settings,
               p.priority_options, p.size_options, p.column_settings, p.history_retention_months, p.created_at, p.updated_at
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

  if (user.role === 'manager') {
    const result = await db.query(
      `
        SELECT p.id, p.name, p.created_by, p.responsible_user_id, p.llm_provider, p.llm_model,
               p.duration_weeks, p.budget_total, p.stages, p.stage_settings, p.agent_settings,
               p.priority_options, p.size_options, p.column_settings, p.history_retention_months, p.created_at, p.updated_at
        FROM projects p
        WHERE p.id = $1 AND (p.responsible_user_id = $2 OR p.created_by = $2)
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
      SELECT p.id, p.name, p.created_by, p.responsible_user_id, p.llm_provider, p.llm_model,
             p.duration_weeks, p.budget_total, p.stages, p.stage_settings, p.agent_settings,
             p.priority_options, p.size_options, p.column_settings, p.history_retention_months, p.created_at, p.updated_at
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
  if (user.role === 'admin' || user.role === 'techlead') {
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
      SELECT id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
             priority, hours, size, descript, notes, deps, position, created_at, updated_at
      FROM tasks
      WHERE id = $1
      LIMIT 1
    `,
    [taskId]
  );
  return result.rows[0] || null;
}

/** Resolve deps.blocks: replace task_code or public_id (non-UUID) with task id from same project. */
async function resolveDepsBlocksForProject(projectId, deps, executor = db) {
  if (!deps || !deps.blocks || !Array.isArray(deps.blocks) || deps.blocks.length === 0) {
    return deps;
  }
  const resolved = [];
  for (const idOrCode of deps.blocks) {
    const s = typeof idOrCode === 'string' ? idOrCode.trim() : (typeof idOrCode === 'number' ? String(idOrCode) : '');
    if (!s) continue;
    if (isUuid(s)) {
      resolved.push(s);
      continue;
    }
    let row = await executor.query(
      'SELECT id FROM tasks WHERE project_id = $1 AND task_code = $2 LIMIT 1',
      [projectId, s]
    );
    if (!row.rows[0] && /^\d+$/.test(s)) {
      row = await executor.query(
        'SELECT id FROM tasks WHERE project_id = $1 AND public_id = $2 LIMIT 1',
        [projectId, parseInt(s, 10)]
      );
    }
    if (row.rows[0]) resolved.push(row.rows[0].id);
  }
  return { ...deps, blocks: resolved };
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

const PRIORITY_LABELS = { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Critical' };
function priorityToLabel(p) {
  return PRIORITY_LABELS[Number(p)] || String(p ?? 0);
}

/** Generate project snapshot MD and save to projects. Returns snapshot_md. */
async function generateProjectSnapshot(projectId, executor = db) {
  const proj = await executor.query(
    'SELECT id, name, stages, snapshot_md, snapshot_updated_at FROM projects WHERE id = $1',
    [projectId]
  );
  const project = proj.rows[0];
  if (!project) return null;

  let tasksWithDeps;
  try {
    tasksWithDeps = await executor.query(
      `
        SELECT t.id, t.public_id, t.title, t.task_code, t.col, t.stage, t.agent,
               t.priority, t.descript, t.position,
               COALESCE(
                 array_agg(td.depends_on_task_id) FILTER (WHERE td.depends_on_task_id IS NOT NULL),
                 ARRAY[]::uuid[]
               ) AS dep_ids
        FROM tasks t
        LEFT JOIN task_dependencies td ON td.task_id = t.id
        WHERE t.project_id = $1
        GROUP BY t.id
        ORDER BY t.stage NULLS LAST, t.position NULLS LAST, t.created_at
      `,
      [projectId]
    );
  } catch (err) {
    if (err.code === '42P01' && /task_dependencies/.test(err.message)) {
      return null;
    }
    throw err;
  }

  const tasks = tasksWithDeps.rows || [];
  const depIds = [...new Set(tasks.flatMap((t) => (t.dep_ids || []).filter(Boolean)))];
  const idToPublicId = new Map();
  if (depIds.length > 0) {
    const mapRes = await executor.query(
      'SELECT id, public_id FROM tasks WHERE id = ANY($1::uuid[])',
      [depIds]
    );
    for (const r of mapRes.rows || []) {
      idToPublicId.set(r.id, r.public_id);
    }
  }

  const stages = Array.isArray(project.stages) ? project.stages : [];
  const byStage = new Map();
  for (const t of tasks) {
    const stage = (t.stage || '').trim() || '(без этапа)';
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(t);
  }
  const stageOrder = [...new Set([...stages.map((s) => (s || '').trim()).filter(Boolean), ...byStage.keys()].filter(Boolean))];

  const lines = [];
  lines.push(`# Проект: ${(project.name || '').trim() || 'Без названия'}`);
  lines.push(`Этапы: ${stageOrder.length ? stageOrder.join(', ') : '—'}`);
  lines.push(`Задач: ${tasks.length}`);
  lines.push(`Обновлено: ${new Date().toISOString()}`);
  lines.push('');

  for (const stage of stageOrder.length ? stageOrder : [...byStage.keys()]) {
    const stageTasks = byStage.get(stage) || [];
    if (stageTasks.length === 0 && stageOrder.includes(stage)) continue;
    lines.push(`## ${stage}`);
    lines.push('');
    for (const t of stageTasks) {
      const priorityLabel = priorityToLabel(t.priority);
      const agentStr = (t.agent || '').trim() ? t.agent : '—';
      lines.push(`- ${t.public_id} | ${(t.title || '').trim() || 'Без названия'} | ${priorityLabel} | ${agentStr}`);
      if (t.descript && String(t.descript).trim()) {
        lines.push(`  Описание: ${String(t.descript).trim().replace(/\n/g, ' ').slice(0, 200)}${String(t.descript).length > 200 ? '…' : ''}`);
      }
      const depPubIds = (t.dep_ids || [])
        .map((id) => idToPublicId.get(id))
        .filter((v) => v != null);
      if (depPubIds.length > 0) {
        lines.push(`  Зависит от: ${depPubIds.join(', ')}`);
      }
      lines.push('');
    }
  }

  const snapshotMd = lines.join('\n').trim();
  await executor.query(
    'UPDATE projects SET snapshot_md = $1, snapshot_updated_at = NOW() WHERE id = $2',
    [snapshotMd, projectId]
  );
  return snapshotMd;
}

async function findTaskInTrashByTaskId(taskId, executor = db) {
  await ensureTaskTrashStorage(executor);
  const result = await executor.query(
    `
      SELECT id, task_id, public_id, project_id, deleted_project_name, title, task_code, col, stage,
             assignee_user_id, track, agent, priority, hours, size, descript, notes, deps,
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
      await executor.query(`ALTER TABLE task_trash ADD COLUMN IF NOT EXISTS size TEXT`);
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

  const fallback = stageList.length > 0 ? stageList : [];
  return {
    stages: fallback,
    stage_settings: buildDefaultStageSettings(
      fallback,
      Number(project.budget_total || 0)
    ),
  };
}

const HOURS_PER_WEEK_FOR_DURATION = 9;

async function recalculateProjectDuration(projectId, executor = db) {
  const sumResult = await executor.query(
    `SELECT COALESCE(SUM(hours::float), 0) AS total FROM tasks WHERE project_id = $1`,
    [projectId]
  );
  const total = Number(sumResult.rows[0]?.total || 0);
  const durationWeeks = total > 0 ? Math.ceil(total / HOURS_PER_WEEK_FOR_DURATION) : 0;
  await executor.query(
    `UPDATE projects SET duration_weeks = $1, updated_at = NOW() WHERE id = $2`,
    [durationWeeks, projectId]
  );
  return durationWeeks;
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
        task_code,
        col,
        stage,
        assignee_user_id,
        track,
        agent,
        priority,
        hours,
        size,
        descript,
        notes,
        deps,
        deleted_at,
        deleted_by_user_id,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18, $19, NOW()
      )
      ON CONFLICT (task_id)
      DO UPDATE SET
        public_id = EXCLUDED.public_id,
        project_id = EXCLUDED.project_id,
        deleted_project_name = EXCLUDED.deleted_project_name,
        title = EXCLUDED.title,
        task_code = EXCLUDED.task_code,
        col = EXCLUDED.col,
        stage = EXCLUDED.stage,
        assignee_user_id = EXCLUDED.assignee_user_id,
        track = EXCLUDED.track,
        agent = EXCLUDED.agent,
        priority = EXCLUDED.priority,
        hours = EXCLUDED.hours,
        size = EXCLUDED.size,
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
      taskRow.task_code ?? null,
      taskRow.col || null,
      taskRow.stage || null,
      taskRow.assignee_user_id || null,
      taskRow.track || null,
      taskRow.agent || null,
      Number.isFinite(Number(taskRow.priority)) ? Number(taskRow.priority) : 0,
      taskRow.hours !== undefined ? taskRow.hours : null,
      taskRow.size && ['XS', 'S', 'M', 'L', 'XL'].includes(String(taskRow.size).toUpperCase()) ? String(taskRow.size).trim().toUpperCase() : null,
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
    task_code: 'task_code',
    col: 'col',
    position: 'position',
    stage: 'stage',
    assignee_user_id: 'assignee_user_id',
    track: 'track',
    agent: 'agent',
    priority: 'priority',
    hours: 'hours',
    size: 'size',
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
                priority, hours, size, descript, notes, deps, created_at, updated_at
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
                priority, hours, size, descript, notes, deps, created_at, updated_at
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
                priority, hours, size, descript, notes, deps, created_at, updated_at
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
        task_code,
        col,
        stage,
        assignee_user_id,
        track,
        agent,
        priority,
        hours,
        size,
        descript,
        notes,
        deps
      )
      VALUES (
        $1, $2, $3, COALESCE($4, 'backlog'), $5, $6, $7, $8, COALESCE($9, 0), $10, $11, $12, $13, $14
      )
      RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                priority, hours, size, descript, notes, deps, created_at, updated_at
    `,
    [
      payload.projectId,
      payload.create.title,
      payload.create.task_code ?? null,
      payload.create.col || null,
      payload.create.stage ?? null,
      payload.create.assignee_user_id ?? null,
      payload.create.track ?? null,
      payload.create.agent ?? null,
      payload.create.priority ?? null,
      payload.create.hours ?? null,
      payload.create.size && ['XS','S','M','L','XL'].includes(String(payload.create.size).trim().toUpperCase()) ? String(payload.create.size).trim().toUpperCase() : null,
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

async function findUserById(userId) {
  if (!userId || !isUuid(userId)) {
    return null;
  }
  const result = await db.query(
    'SELECT id, email, role, status FROM users WHERE id = $1 LIMIT 1',
    [userId]
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
    if (error.message && /agent_settings|column.*does not exist/i.test(error.message)) {
      sendJson(res, 500, { error: 'schema_outdated', hint: 'Выполните миграцию: npm run db:migrate' });
      return;
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

  const responsibleUserId = parsed.value.responsible_user_id ?? user.id;
  try {
    const userCheck = responsibleUserId
      ? await db.query('SELECT id FROM users WHERE id = $1', [responsibleUserId])
      : { rowCount: 0 };
    if (responsibleUserId && userCheck.rowCount === 0) {
      sendJson(res, 400, { error: 'invalid_user_id' });
      return;
    }
    const po = parsed.value.priority_options;
    const so = parsed.value.size_options;
    const cs = parsed.value.column_settings;
    const result = await db.query(
      `
        INSERT INTO projects (name, created_by, responsible_user_id, duration_weeks, budget_total, stages, stage_settings, agent_settings, priority_options, size_options, column_settings)
        VALUES ($1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb)
        RETURNING id, name, created_by, responsible_user_id, llm_provider, llm_model,
                  duration_weeks, budget_total, stages, stage_settings, agent_settings,
                  priority_options, size_options, column_settings, created_at, updated_at
      `,
      [
        parsed.value.name,
        user.id,
        responsibleUserId || user.id,
        parsed.value.duration_weeks,
        parsed.value.budget_total,
        parsed.value.stages,
        JSON.stringify(parsed.value.stage_settings),
        JSON.stringify(parsed.value.agent_settings ?? []),
        JSON.stringify(po != null ? po : DEFAULT_PRIORITY_OPTIONS),
        JSON.stringify(so != null ? so : DEFAULT_SIZE_OPTIONS),
        JSON.stringify(cs != null ? cs : buildDefaultColumnSettings()),
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
        agent_settings: [],
        priority_options: null,
        size_options: null,
        column_settings: null,
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
      agent_settings: Array.isArray(active.agent_settings)
        ? active.agent_settings
        : [],
      priority_options: active.priority_options != null ? active.priority_options : null,
      size_options: active.size_options != null ? active.size_options : null,
      column_settings: active.column_settings != null ? active.column_settings : null,
      history_retention_months: active.history_retention_months != null ? Number(active.history_retention_months) : null,
    });
  } catch (error) {
    console.error('GET /projects/active failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    if (error.message && /agent_settings|column.*does not exist/i.test(error.message)) {
      sendJson(res, 500, { error: 'schema_outdated', hint: 'Выполните миграцию: npm run db:migrate' });
      return;
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

app.get('/projects/:id/snapshot', async (req, res) => {
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

    const snapRow = await db.query(
      'SELECT snapshot_md, snapshot_updated_at FROM projects WHERE id = $1',
      [id]
    );
    let snapshotMd = snapRow.rows[0]?.snapshot_md ?? null;
    let snapshotUpdatedAt = snapRow.rows[0]?.snapshot_updated_at ?? null;

    if (snapshotMd == null || snapshotMd === '') {
      snapshotMd = await generateProjectSnapshot(id);
      if (snapshotMd != null) {
        const updated = await db.query(
          'SELECT snapshot_md, snapshot_updated_at FROM projects WHERE id = $1',
          [id]
        );
        snapshotUpdatedAt = updated.rows[0]?.snapshot_updated_at ?? new Date().toISOString();
      }
    }

    sendJson(res, 200, { snapshot_md: snapshotMd, snapshot_updated_at: snapshotUpdatedAt });
  } catch (error) {
    console.error('GET /projects/:id/snapshot failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'snapshot_unavailable' });
  }
});

app.post('/projects/:id/snapshot/refresh', async (req, res) => {
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

    const snapshotMd = await generateProjectSnapshot(id);
    const updated = await db.query(
      'SELECT snapshot_md, snapshot_updated_at FROM projects WHERE id = $1',
      [id]
    );
    const row = updated.rows[0] || {};
    sendJson(res, 200, {
      snapshot_md: row.snapshot_md ?? snapshotMd,
      snapshot_updated_at: row.snapshot_updated_at,
    });
  } catch (error) {
    console.error('POST /projects/:id/snapshot/refresh failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'snapshot_unavailable' });
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
    if (normalizedStages.length > 0) {
      const stageUsage = await db.query(
        `
          SELECT stage, COUNT(*)::int AS count
          FROM tasks
          WHERE project_id = $1
            AND stage IS NOT NULL
            AND trim(stage) <> ''
            AND lower(trim(stage)) <> ALL($2::text[])
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
    }

    const agentSettings = parsed.value.agent_settings !== undefined
      ? parsed.value.agent_settings
      : (Array.isArray(existing.agent_settings) ? existing.agent_settings : []);

    const columnSettings = parsed.value.column_settings;
    if (columnSettings && Array.isArray(columnSettings)) {
      const toHide = columnSettings.filter(function (c) {
        return c && !c.locked && c.visible === false;
      });
      if (toHide.length > 0) {
        const colIds = toHide.map(function (c) { return c.id; });
        const apiColMap = { backlog: 'backlog', todo: 'todo', doing: 'doing', inprogress: 'doing', in_progress: 'doing', review: 'review', done: 'done' };
        const apiCols = colIds.map(function (c) { return apiColMap[c] || c; });
        const taskCount = await db.query(
          `SELECT col, COUNT(*)::int AS cnt FROM tasks WHERE project_id = $1 AND col = ANY($2::text[]) GROUP BY col`,
          [id, apiCols]
        );
        if (taskCount.rowCount > 0) {
          const details = taskCount.rows.map(function (r) { return r.col + ': ' + r.cnt; });
          sendJson(res, 409, {
            error: 'column_has_tasks',
            message: 'В колонках есть задачи. Сначала освободите колонки или перенесите задачи.',
            columns: taskCount.rows,
          });
          return;
        }
      }
    }

    const priorityOptions = parsed.value.priority_options !== undefined
      ? parsed.value.priority_options
      : (existing.priority_options || DEFAULT_PRIORITY_OPTIONS);
    const sizeOptions = parsed.value.size_options !== undefined
      ? parsed.value.size_options
      : (existing.size_options || DEFAULT_SIZE_OPTIONS);
    const finalColumnSettings = columnSettings !== undefined
      ? columnSettings
      : (existing.column_settings || buildDefaultColumnSettings());

    const result = await db.query(
      `
        UPDATE projects
        SET name = $1,
            duration_weeks = $2,
            budget_total = $3,
            stages = $4::text[],
            stage_settings = $5::jsonb,
            agent_settings = $6::jsonb,
            priority_options = $8::jsonb,
            size_options = $9::jsonb,
            column_settings = $10::jsonb,
            updated_at = NOW()
        WHERE id = $7
        RETURNING id, name, created_by, responsible_user_id, llm_provider, llm_model,
                  duration_weeks, budget_total, stages, stage_settings, agent_settings,
                  priority_options, size_options, column_settings, created_at, updated_at
      `,
      [
        parsed.value.name,
        parsed.value.duration_weeks,
        parsed.value.budget_total,
        parsed.value.stages,
        JSON.stringify(parsed.value.stage_settings),
        JSON.stringify(agentSettings),
        id,
        JSON.stringify(priorityOptions),
        JSON.stringify(sizeOptions),
        JSON.stringify(finalColumnSettings),
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

app.post('/projects/:id/recalculate-duration', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) return;

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

    const durationWeeks = await recalculateProjectDuration(id);
    const updated = await findProjectById(id);
    sendJson(res, 200, { duration_weeks: durationWeeks, project: updated });
  } catch (error) {
    console.error('POST /projects/:id/recalculate-duration failed:', error.message);
    if (isDevelopment() && error.stack) console.error(error.stack);
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
            task_code,
            col,
            stage,
            assignee_user_id,
            track,
            agent,
            priority,
            hours,
            size,
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
            t.task_code,
            t.col,
            t.stage,
            t.assignee_user_id,
            t.track,
            t.agent,
            t.priority,
            t.hours,
            t.size,
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
            task_code = EXCLUDED.task_code,
            col = EXCLUDED.col,
            stage = EXCLUDED.stage,
            assignee_user_id = EXCLUDED.assignee_user_id,
            track = EXCLUDED.track,
            agent = EXCLUDED.agent,
            priority = EXCLUDED.priority,
            hours = EXCLUDED.hours,
            size = EXCLUDED.size,
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
  const user = requireAuth(req, res, EVENTS_LIST_ROLES);
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
    const project = await findVisibleProjectById(projectId, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const where = ['te.project_id = $1'];
    const values = [projectId];
    if (user.role === 'manager') {
      where.push(`te.actor_user_id = $${values.push(user.id)}`);
    }

    const eventTypesParam = req.query.event_types || req.query.event_type;
    if (eventTypesParam) {
      const types = typeof eventTypesParam === 'string'
        ? eventTypesParam.split(',').map((s) => s.trim()).filter(Boolean)
        : Array.isArray(eventTypesParam) ? eventTypesParam.filter(Boolean) : [];
      if (types.length === 1) {
        where.push(`te.event_type = $${values.push(types[0])}`);
      } else if (types.length > 1) {
        where.push(`te.event_type = ANY($${values.push(types)}::text[])`);
      }
    }
    if (req.query.from) {
      const fromDate = new Date(req.query.from);
      if (!isNaN(fromDate.getTime())) {
        where.push(`te.created_at >= $${values.push(fromDate.toISOString())}::timestamptz`);
      }
    }
    if (req.query.to) {
      const toDate = new Date(req.query.to);
      if (!isNaN(toDate.getTime())) {
        const toInclusive = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
        where.push(`te.created_at < $${values.push(toInclusive.toISOString())}::timestamptz`);
      }
    }
    if (req.query.q) {
      const like = `%${req.query.q}%`;
      where.push(`(
        te.event_type ILIKE $${values.push(like)}
        OR te.task_id::text ILIKE $${values.push(like)}
        OR COALESCE(te.payload::text, '') ILIKE $${values.push(like)}
      )`);
    }

    values.push(limit);
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const result = await db.query(
      `
        SELECT te.event_type, te.payload, te.actor_user_id, te.task_id, te.created_at, te.before, te.after,
               u.email AS actor_email
        FROM task_events te
        LEFT JOIN users u ON u.id = te.actor_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY te.created_at DESC, te.id DESC
        LIMIT $${limitIdx}
        OFFSET $${offsetIdx}
      `,
      values
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

app.post('/projects/:projectId/history-retention', async (req, res) => {
  const user = requireAuth(req, res, PROJECT_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { projectId } = req.params;
  if (!isUuid(projectId)) {
    sendJson(res, 400, { error: 'invalid_project_id' });
    return;
  }

  const retention = req.body?.retention_months;
  let retentionMonths = null;
  if (retention === 3 || retention === '3') {
    retentionMonths = 3;
  } else if (retention === 6 || retention === '6') {
    retentionMonths = 6;
  } else if (retention === null || retention === undefined || retention === 'all' || retention === '') {
    retentionMonths = null;
  } else {
    sendJson(res, 400, { error: 'invalid_payload', message: 'retention_months: 3, 6 or null (keep all)' });
    return;
  }

  try {
    const project = await findVisibleProjectById(projectId, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    await db.query(
      'UPDATE projects SET history_retention_months = $1, updated_at = NOW() WHERE id = $2',
      [retentionMonths, projectId]
    );

    let deletedCount = 0;
    if (retentionMonths) {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - retentionMonths);
      const cutoffIso = cutoff.toISOString();
      const del = await db.query(
        'DELETE FROM task_events WHERE project_id = $1 AND created_at < $2',
        [projectId, cutoffIso]
      );
      deletedCount = del.rowCount || 0;
    }

    const updated = await findProjectById(projectId);
    sendJson(res, 200, {
      project: updated,
      deleted_events: deletedCount,
    });
  } catch (error) {
    if (error.message && /column.*does not exist/i.test(error.message)) {
      sendJson(res, 500, { error: 'schema_outdated', hint: 'Выполните миграцию: npm run db:migrate' });
      return;
    }
    console.error('POST /projects/:projectId/history-retention failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'history_retention_unavailable' });
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
          SELECT id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                 priority, hours, size, descript, notes, deps, position, created_at, updated_at
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
          SELECT id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                 priority, hours, size, descript, notes, deps, position, created_at, updated_at
          FROM tasks
          WHERE project_id = $1
          ORDER BY col ASC, position ASC, created_at ASC
        `,
        [projectId]
      );
    }

    sendJson(res, 200, { tasks: result.rows });
  } catch (error) {
    if (error && error.code === '42703') {
      console.error('GET /projects/:projectId/tasks failed: column missing, run migrations:', error.message);
      sendJson(res, 500, { error: 'schema_outdated', hint: 'Выполните миграцию: npm run db:migrate' });
      return;
    }
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
      const resolvedDeps = await resolveDepsBlocksForProject(projectId, payload.deps ?? null, tx);
      const created = await tx.query(
        `
          INSERT INTO tasks (
            project_id,
            title,
            task_code,
            col,
            position,
            stage,
            assignee_user_id,
            track,
            agent,
            priority,
            hours,
            size,
            descript,
            notes,
            deps
          )
          VALUES (
            $1, $2, $3, COALESCE($4, 'backlog'), $5, $6, $7, $8, $9, COALESCE($10, 0), $11, $12, $13, $14, $15
          )
          RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                    priority, hours, size, descript, notes, deps, position, created_at, updated_at
        `,
        [
          projectId,
          payload.title,
          payload.task_code ?? null,
          payload.col || null,
          nextPosition,
          (payload.stage && String(payload.stage).trim()) ? payload.stage.trim() : NO_STAGE,
          payload.assignee_user_id ?? null,
          payload.track ?? null,
          payload.agent ?? null,
          payload.priority ?? null,
          payload.hours ?? null,
          payload.size && ['XS','S','M','L','XL'].includes(String(payload.size).trim().toUpperCase()) ? String(payload.size).trim().toUpperCase() : null,
          payload.descript ?? null,
          payload.notes ?? null,
          resolvedDeps,
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
    generateProjectSnapshot(projectId).catch((err) =>
      console.error('[snapshot] failed:', err.message)
    );
  } catch (error) {
    if (error && error.code === '23505') {
      sendJson(res, 400, { error: 'task_code_duplicate', message: 'ID задачи уже используется в этом проекте' });
      return;
    }
    if (error && (error.code === '23503' || error.code === '23514')) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    if (error && error.code === '42703') {
      console.error('POST /projects/:projectId/tasks failed: column missing, run migrations:', error.message);
      sendJson(res, 500, { error: 'schema_outdated', hint: 'Выполните миграцию: npm run db:migrate' });
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

      return { column, updated: order.length, projectId: existing.rows[0].project_id };
    });

    sendJson(res, 200, { column: result.column, updated: result.updated });
    if (result.projectId) {
      generateProjectSnapshot(result.projectId).catch((err) =>
        console.error('[snapshot] failed:', err.message)
      );
    }
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
      if (updates.deps !== undefined) {
        updates.deps = await resolveDepsBlocksForProject(before.project_id, updates.deps, tx);
      }
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
          RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                    priority, hours, size, descript, notes, deps, position, created_at, updated_at
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
    generateProjectSnapshot(after.project_id).catch((err) =>
      console.error('[snapshot] failed:', err.message)
    );
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }

    if (error && error.code === '23505') {
      sendJson(res, 400, { error: 'task_code_duplicate', message: 'ID задачи уже используется в этом проекте' });
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

// ----- Task chat (persistent techlead chat per task) -----
let taskChatsTableInitPromise = null;
async function ensureTaskChatsTable(executor = db) {
  if (!taskChatsTableInitPromise) {
    taskChatsTableInitPromise = executor.query(`
      CREATE TABLE IF NOT EXISTS task_chats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL DEFAULT '',
        action JSONB,
        action_applied BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).then(() => {
      return executor.query(`
        CREATE INDEX IF NOT EXISTS task_chats_task_id_created_at_idx
        ON task_chats (task_id, created_at)
      `).catch(() => {});
    });
  }
  return taskChatsTableInitPromise;
}

function parseTaskChatPostPayload(payload) {
  if (!isObjectPayload(payload)) {
    return { error: 'invalid_payload' };
  }
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  if (!content) {
    return { error: 'invalid_payload' };
  }
  const provider =
    typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : null;
  const model = typeof payload.model === 'string' ? payload.model.trim() : null;
  return { value: { content, provider: provider || null, model: model || null } };
}

function extractActionFromTechleadResponse(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { text, action: null };
  }
  const match = text.match(/\s*ACTION_JSON::\s*([\s\S]*)\s*$/);
  if (!match) {
    return { text: text.trim(), action: null };
  }
  const raw = match[1].trim();
  const action = tryParseJsonBlock(raw);
  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return { text: text.trim(), action: null };
  }
  const cleanText = text.replace(/\s*ACTION_JSON::\s*[\s\S]*\s*$/, '').trim();
  return { text: cleanText, action };
}

app.get('/tasks/:id/dependencies', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  try {
    const task = await findTaskById(id);
    if (!task) {
      sendJson(res, 404, { error: 'task_not_found' });
      return;
    }

    const project = await findVisibleProjectById(task.project_id, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const deps = await db.query(
      `
        SELECT t.id, t.public_id, t.title, t.col, t.stage
        FROM task_dependencies td
        INNER JOIN tasks t ON t.id = td.depends_on_task_id
        WHERE td.task_id = $1
      `,
      [id]
    );

    sendJson(res, 200, deps.rows);
  } catch (error) {
    if (error && error.code === '42P01') {
      sendJson(res, 200, []);
      return;
    }
    console.error('GET /tasks/:id/dependencies failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'dependencies_unavailable' });
  }
});

app.post('/tasks/:id/dependencies', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  const body = req.body || {};
  const dependsOnTaskId = typeof body.depends_on_task_id === 'string' ? body.depends_on_task_id.trim() : null;
  if (!dependsOnTaskId || !isUuid(dependsOnTaskId)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  if (id === dependsOnTaskId) {
    sendJson(res, 400, { error: 'invalid_payload', message: 'Задача не может зависеть от самой себя' });
    return;
  }

  try {
    const task = await findTaskById(id);
    if (!task) {
      sendJson(res, 404, { error: 'task_not_found' });
      return;
    }

    const depTask = await findTaskById(dependsOnTaskId);
    if (!depTask || depTask.project_id !== task.project_id) {
      sendJson(res, 404, { error: 'depends_on_task_not_found' });
      return;
    }

    const project = await findVisibleProjectById(task.project_id, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const reachable = await db.query(
      `
        WITH RECURSIVE reachable AS (
          SELECT depends_on_task_id AS node
          FROM task_dependencies
          WHERE task_id = $1
          UNION
          SELECT td.depends_on_task_id
          FROM task_dependencies td
          INNER JOIN reachable r ON td.task_id = r.node
        )
        SELECT node FROM reachable
      `,
      [dependsOnTaskId]
    );
    const wouldCreateCycle = (reachable.rows || []).some((r) => r.node && String(r.node) === id);
    if (wouldCreateCycle) {
      sendJson(res, 409, { error: 'cyclic_dependency', message: 'Добавление зависимости создаст цикл' });
      return;
    }

    const inserted = await db.query(
      `
        INSERT INTO task_dependencies (task_id, depends_on_task_id)
        VALUES ($1, $2)
        ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
        RETURNING id, task_id, depends_on_task_id, created_at
      `,
      [id, dependsOnTaskId]
    );

    if (inserted.rowCount === 0) {
      sendJson(res, 200, {
        dependency: { task_id: id, depends_on_task_id: dependsOnTaskId },
        already_exists: true,
      });
      return;
    }

    const row = inserted.rows[0];
    sendJson(res, 201, {
      id: row.id,
      task_id: row.task_id,
      depends_on_task_id: row.depends_on_task_id,
      created_at: row.created_at,
    });

    generateProjectSnapshot(task.project_id).catch((err) =>
      console.error('[snapshot] failed:', err.message)
    );
  } catch (error) {
    if (error && error.code === '42P01') {
      sendJson(res, 500, { error: 'schema_outdated', hint: 'Выполните миграцию: npm run db:migrate' });
      return;
    }
    if (error && error.code === '23503') {
      sendJson(res, 404, { error: 'depends_on_task_not_found' });
      return;
    }
    if (error && error.code === '23505') {
      sendJson(res, 409, { error: 'already_exists' });
      return;
    }
    console.error('POST /tasks/:id/dependencies failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'dependencies_unavailable' });
  }
});

app.delete('/tasks/:id/dependencies/:depId', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id, depId } = req.params;
  if (!isUuid(id) || !isUuid(depId)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  try {
    const task = await findTaskById(id);
    if (!task) {
      sendJson(res, 404, { error: 'task_not_found' });
      return;
    }

    const project = await findVisibleProjectById(task.project_id, user);
    if (!project) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }

    const deleted = await db.query(
      `
        DELETE FROM task_dependencies
        WHERE task_id = $1 AND depends_on_task_id = $2
      `,
      [id, depId]
    );

    if (deleted.rowCount === 0) {
      sendJson(res, 404, { error: 'dependency_not_found' });
      return;
    }

    sendNoContent(res);

    generateProjectSnapshot(task.project_id).catch((err) =>
      console.error('[snapshot] failed:', err.message)
    );
  } catch (error) {
    if (error && error.code === '42P01') {
      sendJson(res, 500, { error: 'schema_outdated', hint: 'Выполните миграцию: npm run db:migrate' });
      return;
    }
    console.error('DELETE /tasks/:id/dependencies/:depId failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'dependencies_unavailable' });
  }
});

app.get('/tasks/:id/chat', async (req, res) => {
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
    await ensureTaskChatsTable();
    const task = await findTaskById(id);
    if (!task) {
      sendJson(res, 404, { error: 'task_not_found' });
      return;
    }

    const result = await db.query(
      `
        SELECT id, role, content, action, action_applied, created_at
        FROM task_chats
        WHERE task_id = $1
        ORDER BY created_at ASC
      `,
      [id]
    );

    sendJson(res, 200, {
      messages: result.rows.map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        action: row.action,
        action_applied: row.action_applied,
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    console.error('GET /tasks/:id/chat failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'chat_unavailable' });
  }
});

app.post('/tasks/:id/chat', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id } = req.params;
  if (!isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  const parsed = parseTaskChatPostPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
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

  try {
    await ensureTaskChatsTable();
    const task = await findTaskById(id);
    if (!task) {
      sendJson(res, 404, { error: 'task_not_found' });
      return;
    }

    const content = parsed.value.content;

    await db.query(
      `
        INSERT INTO task_chats (task_id, role, content)
        VALUES ($1, 'user', $2)
      `,
      [id, content]
    );

    const historyResult = await db.query(
      `
        SELECT role, content
        FROM task_chats
        WHERE task_id = $1
        ORDER BY created_at ASC
      `,
      [id]
    );

    const messages = historyResult.rows.map((r) => ({
      role: r.role,
      content: r.content,
    }));

    const pr = task.priority ?? 0;
    const prLabel = (typeof priorityToLabel === 'function' ? priorityToLabel(pr) : String(pr));
    const taskContext =
      `Задача: id=${task.id}, title=${task.title || ''}, col=${task.col || 'backlog'}, ` +
      `stage=${task.stage || ''}, agent=${task.agent || ''}, priority=${pr} (${prLabel}), ` +
      `hours=${task.hours ?? ''}, descript=${(task.descript || '').slice(0, 1500)}.`;

    let snapshotMd = '';
    let projectName = '';
    if (task.project_id) {
      const projRow = await db.query(
        'SELECT name, snapshot_md FROM projects WHERE id = $1',
        [task.project_id]
      );
      if (projRow.rows.length) {
        projectName = projRow.rows[0].name || '';
        snapshotMd = (projRow.rows[0].snapshot_md || '').slice(0, 8000);
      }
    }

    const systemPrompt = `Ты — Senior TechLead в проекте "${projectName || 'без названия'}".
Работаешь в системе управления задачами PlanKanban. Отвечаешь на языке запроса (если пишут по русски, то отвечаешь по русски, если по английски, то по английски и т.д.

## Твоя роль
Ты технический советник и ментор команды. Твои задачи:
- Декомпозиция сложных задач на подзадачи
- Оценка трудозатрат и рисков
- Выявление технических зависимостей между задачами
- Предложение архитектурных решений
- Code review и улучшение описаний задач
- Выявление блокеров и неясностей в постановке

## Текущая задача
${taskContext}

## Снапшот проекта (все задачи и зависимости)
${snapshotMd || 'Снапшот недоступен'}

## Правила ответа
1. Отвечай кратко и конкретно — без воды и общих фраз
2. Если задача неясна — задай ОДИН уточняющий вопрос
3. Если видишь риск или блокер — обозначь явно: "⚠️ Риск:" или "🔒 Блокер:"
4. Если задача зависит от другой — укажи явно с ID: "Зависит от T-000XXX"
5. При декомпозиции — нумеруй подзадачи, указывай этап и оценку в часах
6. Не повторяй условие задачи обратно пользователю

## Изменение задачи
Если пользователь просит изменить задачу — в конце ответа добавь строку:
ACTION_JSON::{"field":"value"}
Допустимые поля: title, col, stage, agent, priority, hours, descript, notes
Значения col: backlog, todo, inprogress, review, done
Приоритет — число 1–4: 1=Low, 2=Medium, 3=High, 4=Critical. «Повысить» = увеличить число (2→3), «понизить» = уменьшить (3→2).
Один объект, без markdown, без пояснений после.

## Декомпозиция на подзадачи
Если пользователь просит разложить задачу на подзадачи и создать новые задачи:
ACTION_JSON::{"subtasks":[{"title":"Название подзадачи","stage":"Этап","hours":8},{"title":"...","stage":"...","hours":6}],"subtask_deps":{"2":[1],"3":[1]}}
- subtasks: массив объектов, каждый — {title (обязательно), stage?, hours?, size?, agent?, descript?}
- subtask_deps: необязательно. Ключи — номера подзадач (1-based). Значения — массивы номеров, от которых зависит эта подзадача. Пример: "2":[1] — подзадача 2 зависит от 1; "3":[1] — подзадача 3 зависит от 1.

## Чего НЕ делать
- Не придумывать технологии не упомянутые в задаче
- Не предлагать изменения если пользователь просто спрашивает
- Не отвечать на вопросы НЕ связанные с задачей, проектом или разработкой ПО
- Если вопрос не по работе — ответь одной из этих фраз (выбери случайно): "Это не по моей части — чем могу помочь по работе?" / "Не мой профиль. Что делаем дальше?" / "Мимо кассы. Давай по делу?" / "Это к другому специалисту. У нас что-то в работе?" / "Не в моей компетенции. Что стоит в очереди?" / "Пас. Чем могу помочь реально?" / "Не та область. Что на повестке?" / "Это не ко мне. Что нужно сделать?" / "Выходит за рамки моих задач. Что планируем?" / "Не моя тема. Чем займёмся?" Ничего не добавляй к фразе.
- Не задавать уточняющих вопросов по посторонним темам — это трактуется как согласие обсуждать их`;

    let llmText;
    try {
      llmText = await requestLlmText({
        user,
        purpose: 'chat',
        projectId: task.project_id,
        systemPrompt,
        messages,
        maxTokens: 700,
        temperature: 0.2,
        provider: parsed.value.provider || undefined,
        model: parsed.value.model || undefined,
      });
    } catch (llmError) {
      if (isAppError(llmError)) {
        const body = { error: llmError.errorCode };
        if (llmError.hint) body.hint = llmError.hint;
        sendJson(res, llmError.statusCode, body);
        return;
      }
      throw llmError;
    }

    const { text: assistantText, action } = extractActionFromTechleadResponse(llmText);

    const insertAssistant = await db.query(
      `
        INSERT INTO task_chats (task_id, role, content, action)
        VALUES ($1, 'assistant', $2, $3::jsonb)
        RETURNING id, role, content, action, action_applied, created_at
      `,
      [id, assistantText, action ? JSON.stringify(action) : null]
    );

    const row = insertAssistant.rows[0];
    sendJson(res, 200, {
      message: {
        id: row.id,
        role: row.role,
        content: row.content,
        action: row.action,
        action_applied: row.action_applied,
        created_at: row.created_at,
      },
    });
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }
    console.error('POST /tasks/:id/chat failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'chat_unavailable' });
  }
});

app.post('/tasks/:id/chat/apply/:messageId', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const { id: taskId, messageId } = req.params;
  if (!isUuid(taskId) || !isUuid(messageId)) {
    sendJson(res, 400, { error: 'invalid_task_id' });
    return;
  }

  try {
    const msgResult = await db.query(
      `
        SELECT id, task_id, action, action_applied
        FROM task_chats
        WHERE id = $1 AND task_id = $2
        LIMIT 1
      `,
      [messageId, taskId]
    );

    if (msgResult.rows.length === 0) {
      sendJson(res, 404, { error: 'message_not_found' });
      return;
    }

    const row = msgResult.rows[0];
    if (row.action_applied) {
      sendJson(res, 409, { error: 'action_already_applied' });
      return;
    }

    const action = row.action;
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      sendJson(res, 400, {
        error: 'invalid_payload',
        message: 'Запрос ещё раз оформить задачу — предыдущий ответ ассистента не содержит применимых изменений.',
      });
      return;
    }

    const rawSubtasks =
      action.subtasks ||
      action.create_subtasks ||
      action.tasks ||
      action.new_tasks ||
      action.subtask_list;
    const subtasks = Array.isArray(rawSubtasks) ? rawSubtasks : null;
    const subtaskDeps =
      action.subtask_deps && typeof action.subtask_deps === 'object' && !Array.isArray(action.subtask_deps)
        ? action.subtask_deps
        : null;

    if (subtasks && subtasks.length > 0) {
      const before = await findTaskById(taskId);
      if (!before) {
        sendJson(res, 404, { error: 'task_not_found' });
        return;
      }
      const projectId = before.project_id;
      const createdTaskIds = [];
      const createdTasks = await runInTransaction(async (tx) => {
        for (let i = 0; i < subtasks.length; i++) {
          const st = subtasks[i];
          if (!st || typeof st !== 'object') continue;
          const title = (typeof st.title === 'string' ? st.title.trim() : '') ||
            (typeof st.name === 'string' ? st.name.trim() : '') ||
            (typeof st.task === 'string' ? st.task.trim() : '');
          if (!title) continue;
          const createPayload = {
            title,
            col: st.col || 'backlog',
            stage: st.stage != null ? String(st.stage).trim() : before.stage || NO_STAGE,
            hours: typeof st.hours === 'number' && st.hours >= 0 ? st.hours : (typeof st.hours === 'string' ? parseInt(st.hours, 10) : null) || 8,
            agent: st.agent != null ? String(st.agent).trim() : before.agent || null,
            size: st.size && ['XS', 'S', 'M', 'L', 'XL'].includes(String(st.size).trim().toUpperCase()) ? String(st.size).trim().toUpperCase() : 'M',
            priority: Number.isInteger(st.priority) && st.priority >= 1 && st.priority <= 4 ? st.priority : 2,
          };
          const parsed = parseTaskCreatePayload(createPayload);
          if (parsed.error) continue;
          const payload = parsed.value;
          const targetCol = payload.col || 'backlog';
          const nextPosition = await getNextTaskPosition(projectId, targetCol, tx);
          const stageVal = (payload.stage && String(payload.stage).trim()) || NO_STAGE;
          const sizeVal = payload.size && ['XS', 'S', 'M', 'L', 'XL'].includes(String(payload.size).toUpperCase()) ? String(payload.size).toUpperCase() : 'M';
          const created = await tx.query(
            `
            INSERT INTO tasks (project_id, title, task_code, col, position, stage, agent, priority, hours, size, descript, notes, deps)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                      priority, hours, size, descript, notes, deps, position, created_at, updated_at
            `,
            [
              projectId,
              payload.title,
              payload.task_code ?? null,
              targetCol,
              nextPosition,
              stageVal,
              payload.agent ?? null,
              payload.priority ?? 2,
              payload.hours ?? 8,
              sizeVal,
              (typeof st.descript === 'string' ? st.descript.trim() : null) || null,
              null,
              null,
            ]
          );
          const createdTask = created.rows[0];
          createdTaskIds.push(createdTask.id);
          await writeTaskEvent(
            {
              projectId,
              taskId: createdTask.id,
              actorUserId: user.id,
              eventType: 'task_created',
              action: 'create',
              before: {},
              after: createdTask,
              payload: { title: createdTask.title, stage: stageVal, col: targetCol, source: 'task_chat_apply_subtasks' },
            },
            tx
          );
        }
        if (subtaskDeps && createdTaskIds.length > 0) {
          for (const key of Object.keys(subtaskDeps)) {
            const depIdx = parseInt(key, 10);
            if (!Number.isInteger(depIdx) || depIdx < 1 || depIdx > createdTaskIds.length) continue;
            const depsOn = subtaskDeps[key];
            const depsArr = Array.isArray(depsOn) ? depsOn : [depsOn];
            const blockIds = [];
            for (const idx of depsArr) {
              const i = parseInt(idx, 10);
              if (Number.isInteger(i) && i >= 1 && i <= createdTaskIds.length) {
                blockIds.push(createdTaskIds[i - 1]);
              }
            }
            if (blockIds.length === 0) continue;
            const taskIdToUpdate = createdTaskIds[depIdx - 1];
            await tx.query(
              `UPDATE tasks SET deps = $1::jsonb WHERE id = $2`,
              [JSON.stringify({ blocks: blockIds }), taskIdToUpdate]
            );
          }
        }
        await tx.query(
          `UPDATE task_chats SET action_applied = true WHERE id = $1 AND task_id = $2`,
          [messageId, taskId]
        );
        return { created: createdTaskIds.length, task_ids: createdTaskIds };
      });
      generateProjectSnapshot(projectId).catch((err) => console.error('[snapshot] failed:', err.message));
      sendJson(res, 200, { task: before, created_count: createdTasks.created, created_task_ids: createdTasks.task_ids });
      return;
    }
    if (rawSubtasks && Array.isArray(rawSubtasks) && rawSubtasks.length === 0) {
      await db.query(
        `UPDATE task_chats SET action_applied = true WHERE id = $1 AND task_id = $2`,
        [messageId, taskId]
      );
      const before = await findTaskById(taskId);
      sendJson(res, 200, { task: before || null, created_count: 0, created_task_ids: [] });
      return;
    }

    const patchOnly = { ...action };
    delete patchOnly.subtasks;
    delete patchOnly.create_subtasks;
    delete patchOnly.tasks;
    delete patchOnly.new_tasks;
    delete patchOnly.subtask_list;
    delete patchOnly.subtask_deps;
    const normalizedAction = normalizeChatActionForApply(patchOnly);
    const parsed = parseTaskPatchPayload(normalizedAction);
    if (parsed.error) {
      if (isDevelopment()) {
        console.warn('[chat/apply] invalid_payload:', {
          raw: action,
          normalized: normalizedAction,
          error: parsed.error,
        });
      }
      sendJson(res, 400, {
        error: parsed.error,
        message: parsed.error === 'invalid_payload' ? 'patch_validation_failed' : parsed.error,
      });
      return;
    }

    const after = await runInTransaction(async (tx) => {
      const before = await findTaskById(taskId, tx);
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
          RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                    priority, hours, size, descript, notes, deps, position, created_at, updated_at
        `,
        [...update.values, taskId]
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
            source: 'task_chat_apply',
          },
        },
        tx
      );

      await tx.query(
        `
          UPDATE task_chats
          SET action_applied = true
          WHERE id = $1 AND task_id = $2
        `,
        [messageId, taskId]
      );

      return updatedTask;
    });

    sendJson(res, 200, { task: after });
  } catch (error) {
    if (isAppError(error)) {
      sendJson(res, error.statusCode, { error: error.errorCode });
      return;
    }
    console.error('POST /tasks/:id/chat/apply/:messageId failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'tasks_unavailable' });
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
        project_id: before.project_id,
      };
    });

    sendJson(res, 200, { deleted_task_id: result.deleted_task_id, deleted_public_id: result.deleted_public_id });
    if (result.project_id) {
      generateProjectSnapshot(result.project_id).catch((err) =>
        console.error('[snapshot] failed:', err.message)
      );
    }
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
  const user = requireAuth(req, res, TRASH_LIST_ROLES);
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
    if (user.role === 'manager') {
      where.push(`tt.deleted_by_user_id = $${values.push(user.id)}`);
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
          tt.size,
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

    const usersResult =
      user.role === 'manager'
        ? await db.query(
            `SELECT DISTINCT COALESCE(u.email, 'unknown') AS email
             FROM task_trash tt LEFT JOIN users u ON u.id = tt.deleted_by_user_id
             WHERE tt.deleted_by_user_id = $1
             ORDER BY email`,
            [user.id]
          )
        : await db.query(
            `SELECT DISTINCT COALESCE(u.email, 'unknown') AS email
             FROM task_trash tt LEFT JOIN users u ON u.id = tt.deleted_by_user_id
             ORDER BY email`
          );
    const deleted_by_users = usersResult.rows.map(r => r.email);

    sendJson(res, 200, { items: result.rows, deleted_by_users });
  } catch (error) {
    console.error('GET /tasks/trash failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    sendJson(res, 500, { error: 'trash_unavailable' });
  }
});

app.post('/tasks/:id/restore', async (req, res) => {
  const user = requireAuth(req, res, TRASH_LIST_ROLES);
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

  if (user.role === 'manager') {
    const visibleProj = await findVisibleProjectById(parsed.value.project_id, user);
    if (!visibleProj) {
      sendJson(res, 404, { error: 'project_not_found' });
      return;
    }
  }

  try {
    const restored = await runInTransaction(async (tx) => {
      const trashed = await findTaskInTrashByTaskId(id, tx);
      if (!trashed) {
        throw createAppError(404, 'task_not_found');
      }
      if (user.role === 'manager' && trashed.deleted_by_user_id !== user.id) {
        throw createAppError(403, 'forbidden');
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
            task_code,
            col,
            position,
            stage,
            assignee_user_id,
            track,
            agent,
            priority,
            hours,
            size,
            descript,
            notes,
            deps,
            created_at,
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 0), $13, $14, $15, $16, $17, $18, NOW()
          )
          RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                    priority, hours, size, descript, notes, deps, position, created_at, updated_at
        `,
        [
          trashed.task_id,
          trashed.public_id,
          parsed.value.project_id,
          trashed.title,
          trashed.task_code ?? null,
          parsed.value.col,
          restorePosition,
          parsed.value.stage,
          trashed.assignee_user_id,
          trashed.track,
          trashed.agent,
          trashed.priority,
          trashed.hours,
          trashed.size ?? null,
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
    generateProjectSnapshot(restored.project_id).catch((err) =>
      console.error('[snapshot] failed:', err.message)
    );
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
  const user = requireAuth(req, res, TRASH_LIST_ROLES);
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
      if (user.role === 'manager' && trashed.deleted_by_user_id !== user.id) {
        throw createAppError(403, 'forbidden');
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
      const movingForward = targetCol !== 'backlog';
      if (movingForward && before.deps && before.deps.blocks && Array.isArray(before.deps.blocks) && before.deps.blocks.length > 0) {
        const resolvedDeps = await resolveDepsBlocksForProject(before.project_id, before.deps, tx);
        const blockIds = (resolvedDeps && resolvedDeps.blocks || [])
          .filter((x) => typeof x === 'string' && isUuid(x.trim()))
          .map((x) => x.trim());
        if (blockIds.length > 0) {
          const notDone = await tx.query(
            `
              SELECT id, task_code FROM tasks
              WHERE project_id = $1 AND id = ANY($2::uuid[]) AND (col IS NULL OR col != 'done')
            `,
            [before.project_id, blockIds]
          );
          if (notDone.rows.length > 0) {
            const codes = notDone.rows.map((r) => r.task_code || r.id).join(', ');
            throw createAppError(409, 'task_blocked_by_deps', { message: `Задача заблокирована: выполните зависимости (${codes}). Разрешён только откат в Backlog.` });
          }
        }
      }

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
          RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                    priority, hours, size, descript, notes, deps, position, created_at, updated_at
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
    generateProjectSnapshot(after.project_id).catch((err) =>
      console.error('[snapshot] failed:', err.message)
    );
  } catch (error) {
    if (isAppError(error)) {
      const body = { error: error.errorCode };
      if (error.message) body.message = error.message;
      sendJson(res, error.statusCode, body);
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
    const backlog = Number(row.backlog || 0);
    const inWork = Number(row.in_work || 0);
    const done = Number(row.done || 0);
    const total = backlog + inWork + done;
    const all_tasks_done = total > 0 && inWork === 0 && backlog === 0;
    sendJson(res, 200, {
      backlog,
      in_work: inWork,
      done,
      all_tasks_done: all_tasks_done,
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
    const projectBudgetTotal = Number(project.budget_total || 0);
    const total =
      projectBudgetTotal > 0
        ? Math.max(0, totalFromStageSettings || projectBudgetTotal)
        : 0;
    const stages = validStageSettings.length > 0
      ? validStageSettings.map((item) => item.name.trim())
      : Array.isArray(project.stages) && project.stages.length > 0
      ? project.stages
      : [];
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
    if (total > 0) {
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
      provider: parsed.value.provider || undefined,
      model: parsed.value.model || undefined,
    });
    const candidate = tryParseJsonBlock(llmText);
    const normalized = ensureTaskDialogShape(candidate);
    if (!normalized) {
      let firstStage = '';
      if (resolvedProjectId) {
        const proj = await findProjectById(resolvedProjectId);
        const stages = Array.isArray(proj && proj.stages) ? proj.stages : [];
        const settings = Array.isArray(proj && proj.stage_settings) ? proj.stage_settings : [];
        firstStage = settings[0] && settings[0].name ? settings[0].name : (stages[0] || '');
      }
      sendJson(res, 200, buildFallbackDialogTask(parsed.value.messages, firstStage));
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

app.post('/api/import/events', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const body = req.body;
  const event = typeof body.event === 'string' ? body.event.trim() : '';
  if (!['import_started', 'import_completed', 'import_failed'].includes(event)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  const projectId = body.project_id != null && isUuid(body.project_id) ? body.project_id : null;
  const payload = isObjectPayload(body.payload) ? body.payload : {};

  try {
    await db.query(
      `INSERT INTO import_events (project_id, actor_user_id, event, payload)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [projectId, user.id, event, JSON.stringify(payload)]
    );
    sendJson(res, 204);
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 501, { error: 'import_events_unavailable' });
      return;
    }
    console.error('POST /api/import/events failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.post('/import/excel', async (req, res) => {
  console.log("[import] request received, body size:", JSON.stringify(req.body)?.length);
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

    const contentLen = parsed.value.content.length;
    const CHUNK_SIZE = 10000;
    const chunks = [];
    for (let i = 0; i < parsed.value.content.length; i += CHUNK_SIZE) {
      chunks.push(parsed.value.content.substring(i, i + CHUNK_SIZE));
    }

    const systemPrompt =
      'Ты — парсер задач. Верни ТОЛЬКО JSON-массив без markdown, без пояснений, без текста до или после. ' +
      'Формат каждого объекта: {"title":"...","stage":"название этапа из документа","description":"...","priority":1|2|3|4,"hours":число или null,"size":"XS|S|M|L|XL","deps":"id1,id2" или []}. ' +
      'priority — число: 1=Low, 2=Medium, 3=High, 4=Critical. Ищи в колонке с любым названием, указывающим на приоритет/срочность/важность: priority, urgency, importance, significance, vital, crucial, critical, necessity, essential, indispensable, приоритет, срочность, важность и т.п. (текст или цвет). ' +
      'hours — затраченное время в часах. size — объём XS|S|M|L|XL. deps — зависимости (ID через запятую). Извлекай все из таблицы. ' +
      'Если задач нет — верни пустой массив []. ' +
      'Первый символ ответа должен быть [, последний — ].';

    let allTasks = [];
    for (const chunk of chunks) {
      try {
        const llmText = await requestLlmText({
          user,
          purpose: 'import_parse',
          projectId: project.id,
          systemPrompt,
          messages: [{ role: 'user', content: chunk }],
          maxTokens: 8192,
          temperature: 0.1,
          provider: parsed.value.provider || undefined,
          model: parsed.value.model || undefined,
        });
        const chunkTasks = normalizeImportedTasks(tryParseJsonBlock(llmText));
        allTasks = allTasks.concat(chunkTasks);
      } catch (err) {
        if (isAppError(err) && err.errorCode === 'llm_unavailable') continue;
        throw err;
      }
    }
    let parsedTasks = allTasks;

    if (parsedTasks.length === 0) {
      parsedTasks = fallbackImportTasksFromContent(parsed.value.content);
    }
    if (parsedTasks.length === 0) {
      sendJson(res, 400, {
        error: 'empty_import',
        hint: 'llm_parse_failed',
        content_length: contentLen,
      });
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
              task_code,
              col,
              stage,
              assignee_user_id,
              track,
              agent,
              priority,
              hours,
              size,
              descript,
              notes,
              deps
            )
            VALUES (
              $1, $2, NULL, 'backlog', $3, NULL, $4, NULL, $5, $6, $7, $8, $9, $10::jsonb
            )
            RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                      priority, hours, size, descript, notes, deps, created_at, updated_at
          `,
          [
            project.id,
            item.title,
            item.stage,
            item.release || null,
            item.priority,
            item.hours ?? null,
            item.size ?? null,
            item.description || null,
            item.notes || null,
            item.deps ?? null,
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

    await recalculateProjectDuration(project.id);

    sendJson(res, 201, {
      created: createdTasks.length,
      tasks: createdTasks,
    });
    generateProjectSnapshot(project.id).catch((err) =>
      console.error('[snapshot] failed:', err.message)
    );
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

async function processImportJobAsync(payload) {
  const { jobId, projectId, actorUserId, content, fileName, provider, model } = payload;
  const CHUNK_SIZE = 10000;
  const lines = content.split('\n');
  const chunks = [];
  let currentChunk = '';
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > CHUNK_SIZE && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
    currentChunk += (currentChunk ? '\n' : '') + line;
  }
  if (currentChunk) chunks.push(currentChunk);

  const systemPrompt =
    'Ты — парсер задач. Верни ТОЛЬКО JSON-массив без markdown, без пояснений, без текста до или после. ' +
    'Формат каждого объекта: {"title":"...","stage":"название этапа из документа","description":"...","priority":1|2|3|4,"hours":число или null,"size":"XS|S|M|L|XL","deps":"id1,id2" или []}. ' +
    'priority: 1=Low, 2=Medium, 3=High, 4=Critical. Ищи в колонке с любым названием: priority, urgency, importance, significance, vital, crucial, critical, necessity, essential, indispensable, приоритет, срочность, важность и т.п. hours, size, deps — извлекай из таблицы. ' +
    'Если задач нет — верни пустой массив []. ' +
    'Первый символ ответа должен быть [, последний — ].';

  try {
    await db.query(
      'UPDATE import_jobs SET status = $1, total_chunks = $2, updated_at = now() WHERE id = $3',
      ['processing', chunks.length, jobId]
    );

    const user = await findUserById(actorUserId);
    if (!user) {
      await db.query(
        'UPDATE import_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3',
        ['failed', 'User not found', jobId]
      );
      return;
    }

    const project = await findVisibleProjectById(projectId, user);
    if (!project) {
      await db.query(
        'UPDATE import_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3',
        ['failed', 'Project not found', jobId]
      );
      return;
    }

    let allTasks = [];
    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      try {
        const llmText = await requestLlmText({
          user,
          purpose: 'import_parse',
          projectId: project.id,
          systemPrompt,
          messages: [{ role: 'user', content: chunk }],
          maxTokens: 8192,
          temperature: 0.1,
          provider: provider || undefined,
          model: model || undefined,
        });
        const chunkTasks = normalizeImportedTasks(tryParseJsonBlock(llmText));
        allTasks = allTasks.concat(chunkTasks);
      } catch (err) {
        if (isAppError(err) && err.errorCode === 'llm_unavailable') {
          // skip chunk
        } else {
          throw err;
        }
      }

      await db.query(
        'UPDATE import_jobs SET processed_chunks = $1, updated_at = now() WHERE id = $2',
        [idx + 1, jobId]
      );
    }

    const seen = new Set();
    allTasks = allTasks.filter((t) => {
      const key = t.title.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let totalTasksCreated = 0;
    if (allTasks.length > 0) {
      const inserted = await runInTransaction(async (tx) => {
        const inserted = [];
        for (const item of allTasks) {
          const created = await tx.query(
            `
              INSERT INTO tasks (
                project_id,
                title,
                task_code,
                col,
                stage,
                assignee_user_id,
                track,
                agent,
                priority,
                hours,
                size,
                descript,
                notes,
                deps
              )
              VALUES (
                $1, $2, NULL, 'backlog', $3, NULL, $4, NULL, $5, $6, $7, $8, $9, $10::jsonb
              )
              RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                        priority, hours, size, descript, notes, deps, created_at, updated_at
            `,
            [
              project.id,
              item.title,
              item.stage,
              item.release || null,
              item.priority,
              item.hours ?? null,
              item.size ?? null,
              item.description || null,
              item.notes || null,
              item.deps ?? null,
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
                file_name: fileName,
              },
            },
            tx
          );
        }
        return inserted;
      });
      totalTasksCreated = inserted.length;
      await db.query(
        'UPDATE import_jobs SET tasks_created = $1, updated_at = now() WHERE id = $2',
        [totalTasksCreated, jobId]
      );
      await recalculateProjectDuration(project.id);
    }

    const fallbackTasks =
      totalTasksCreated === 0
        ? (LLM_STUB_MODE ? virtualImportTasksFromContent(content) : fallbackImportTasksFromContent(content))
        : [];
    if (fallbackTasks.length > 0) {
      const inserted = await runInTransaction(async (tx) => {
        const inserted = [];
        for (const item of fallbackTasks) {
          const created = await tx.query(
            `
              INSERT INTO tasks (
                project_id,
                title,
                task_code,
                col,
                stage,
                assignee_user_id,
                track,
                agent,
                priority,
                hours,
                size,
                descript,
                notes,
                deps
              )
              VALUES (
                $1, $2, NULL, 'backlog', $3, NULL, $4, NULL, $5, NULL, NULL, $6, $7, NULL
              )
              RETURNING id, public_id, project_id, title, task_code, col, stage, assignee_user_id, track, agent,
                        priority, hours, size, descript, notes, deps, created_at, updated_at
            `,
            [
              project.id,
              item.title,
              item.stage,
              item.release || null,
              item.priority,
              item.description || null,
              item.notes || null,
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
                file_name: fileName,
              },
            },
            tx
          );
        }
        return inserted;
      });
      totalTasksCreated += inserted.length;
      await recalculateProjectDuration(project.id);
    }

    if (totalTasksCreated > 0) {
      generateProjectSnapshot(projectId).catch((err) =>
        console.error('[snapshot] failed:', err.message)
      );
    }

    await db.query(
      'UPDATE import_jobs SET status = $1, tasks_created = $2, result_meta = $3, updated_at = now() WHERE id = $4',
      ['done', totalTasksCreated, JSON.stringify({}), jobId]
    );
  } catch (error) {
    const message = error && error.message ? String(error.message) : 'Unknown error';
    await db.query(
      'UPDATE import_jobs SET status = $1, error = $2, updated_at = now() WHERE id = $3',
      ['failed', message, jobId]
    ).catch((err) => {
      console.error('[import] failed to update job on error:', err.message);
    });
  }
}

app.post('/import/async', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const parsed = parseImportExcelPayload(req.body);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

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

  try {
    const job = await db.query(
      `INSERT INTO import_jobs (project_id, actor_user_id, status, total_chunks, processed_chunks, tasks_created)
       VALUES ($1, $2, 'pending', 0, 0, 0)
       RETURNING id, status, created_at`,
      [project.id, user.id]
    );
    const jobId = job.rows[0].id;

    setImmediate(() => {
      processImportJobAsync({
        jobId,
        projectId: project.id,
        actorUserId: user.id,
        content: parsed.value.content,
        fileName: parsed.value.file_name,
        provider: parsed.value.provider || undefined,
        model: parsed.value.model || undefined,
      }).catch((err) => {
        console.error('[import] async job failed:', err.message);
      });
    });

    sendJson(res, 202, {
      job_id: jobId,
      status: 'pending',
    });
  } catch (error) {
    console.error('POST /import/async failed:', error.message);
    sendJson(res, 500, { error: 'import_unavailable' });
  }
});

app.get('/import/status/:jobId', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const jobId = req.params.jobId;
  if (!jobId || !isUuid(jobId)) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const job = await db.query(
    'SELECT id, project_id, actor_user_id, status, total_chunks, processed_chunks, tasks_created, error, result_meta, created_at, updated_at FROM import_jobs WHERE id = $1',
    [jobId]
  );
  if (!job.rows[0]) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  const row = job.rows[0];
  if (row.actor_user_id !== user.id) {
    sendJson(res, 404, { error: 'not_found' });
    return;
  }

  sendJson(res, 200, {
    job_id: row.id,
    project_id: row.project_id,
    status: row.status,
    total_chunks: row.total_chunks,
    processed_chunks: row.processed_chunks,
    tasks_created: row.tasks_created,
    error: row.error,
    result_meta: row.result_meta,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
});

app.get('/import/jobs', async (req, res) => {
  const user = requireAuth(req, res, TASK_WRITE_ROLES);
  if (!user) {
    return;
  }

  const jobs = await db.query(
    `SELECT id, project_id, actor_user_id, status, total_chunks, processed_chunks, tasks_created, error, created_at, updated_at
     FROM import_jobs
     WHERE actor_user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [user.id]
  );

  sendJson(res, 200, {
    jobs: jobs.rows.map((row) => ({
      job_id: row.id,
      project_id: row.project_id,
      status: row.status,
      total_chunks: row.total_chunks,
      processed_chunks: row.processed_chunks,
      tasks_created: row.tasks_created,
      error: row.error,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  });
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

app.post('/api/llm/verify-key', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const body = req.body;
  const provider =
    typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
  const baseUrl = typeof body.base_url === 'string' ? body.base_url.trim() : '';
  if (!provider || !apiKey) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  try {
    if (provider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/models', {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'content-type': 'application/json',
        },
      });
      const data = await readJsonSafely(response);
      if (!response.ok) {
        const errMsg =
          data && data.error && typeof data.error.message === 'string'
            ? data.error.message
            : 'invalid_key';
        sendJson(res, 200, { valid: false, error: errMsg });
        return;
      }
      const models = Array.isArray(data && data.data)
        ? data.data.map(function (m) {
            return m && typeof m.id === 'string' ? m.id : null;
          }).filter(Boolean)
        : [];
      refreshLlmPricingCache().catch(() => {});
      sendJson(res, 200, { valid: true, models: models.length ? models : ANTHROPIC_ALLOWED_MODELS.slice() });
      return;
    }

    if (!ALL_LLM_PROVIDERS.includes(provider)) {
      sendJson(res, 400, { error: 'invalid_payload', message: 'Неизвестный провайдер' });
      return;
    }

    const userSetting = baseUrl ? { base_url: baseUrl } : null;
    const base = getOpenAiCompatibleBaseUrl(provider, userSetting);
    if (!base) {
      sendJson(res, 200, { valid: false, error: 'Для этого провайдера укажите base_url' });
      return;
    }
    const response = await fetch(base + '/v1/models', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
      },
    });
    const data = await readJsonSafely(response);
    if (!response.ok) {
      const errMsg =
        data && data.error && typeof data.error.message === 'string'
          ? data.error.message
          : data && typeof data.error === 'string'
            ? data.error
            : 'invalid_key';
      sendJson(res, 200, { valid: false, error: errMsg });
      return;
    }
    const raw = Array.isArray(data && data.data) ? data.data : [];
    const models = raw
      .map((m) => (m && typeof m.id === 'string' ? m.id : null))
      .filter(Boolean)
      .sort();
    const fallback = getLlmAllowedModels(provider);
    refreshLlmPricingCache().catch(() => {});
    sendJson(res, 200, { valid: true, models: models.length ? models : (fallback.length ? fallback : []) });
  } catch (err) {
    console.error('POST /api/llm/verify-key failed:', err.message);
    sendJson(res, 200, { valid: false, error: 'request_failed' });
  }
});

app.get('/api/llm/provider-settings', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) {
    return;
  }

  try {
    const result = await db.query(
      `SELECT id, user_id, purpose, provider, model, base_url, is_enabled,
              COALESCE(is_individual_override, false) AS is_individual_override,
              created_at, updated_at
       FROM llm_provider_settings
       WHERE user_id = $1
       ORDER BY purpose`,
      [user.id]
    );
    const countIndiv = await db.query(
      `SELECT COUNT(*)::int AS c FROM llm_provider_settings
       WHERE user_id = $1 AND is_enabled = true AND is_individual_override = true`,
      [user.id]
    ).catch(function () { return { rows: [{ c: 0 }] }; });
    const allPurposesIndividual = Number((countIndiv.rows[0] && countIndiv.rows[0].c) || 0) >= 3;
    sendJson(res, 200, { settings: result.rows, all_purposes_individual: allPurposesIndividual });
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 200, { settings: [] });
      return;
    }
    console.error('GET /api/llm/provider-settings failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.post('/api/llm/provider-settings', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const parsed = parseProviderSettingPayload(req.body, false);
  if (parsed.error) {
    sendJson(res, 400, { error: parsed.error });
    return;
  }

  const { purpose, provider, model, api_key, base_url, is_enabled, is_individual_override } = parsed.value;
  const setIndividual = is_individual_override === true;
  const apiKeyEncrypted = api_key ? encryptLlmUserKey(api_key) : null;
  if (api_key && !apiKeyEncrypted) {
    sendJson(res, 500, { error: 'encryption_unavailable' });
    return;
  }

  if (!setIndividual) {
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS c FROM llm_provider_settings
       WHERE user_id = $1 AND is_enabled = true AND is_individual_override = true`,
      [user.id]
    );
    const indivCount = Number((countResult.rows[0] && countResult.rows[0].c) || 0);
    if (indivCount >= 3) {
      sendJson(res, 409, { error: 'all_purposes_individual', message: 'Все три блока имеют индивидуальные настройки. Снимите галочку с одного блока в Индивидуальных настройках, чтобы разблокировать Базовые.' });
      return;
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO llm_provider_settings (user_id, purpose, provider, model, api_key_encrypted, base_url, is_enabled, is_individual_override, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (user_id, purpose) DO UPDATE SET
         provider = EXCLUDED.provider,
         model = EXCLUDED.model,
         api_key_encrypted = COALESCE(EXCLUDED.api_key_encrypted, llm_provider_settings.api_key_encrypted),
         base_url = EXCLUDED.base_url,
         is_enabled = EXCLUDED.is_enabled,
         is_individual_override = EXCLUDED.is_individual_override,
         updated_at = now()
       RETURNING id, user_id, purpose, provider, model, base_url, is_enabled, created_at, updated_at`,
      [user.id, purpose, provider, model, apiKeyEncrypted, base_url, is_enabled, setIndividual]
    );
    const row = result.rows[0];
    sendJson(res, 201, { setting: row });
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 501, { error: 'provider_settings_unavailable' });
      return;
    }
    console.error('POST /api/llm/provider-settings failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.patch('/api/llm/provider-settings/:id', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const id = req.params.id;
  if (!id || !isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  const body = req.body;
  const updates = [];
  const values = [];
  let idx = 1;

  if (body.provider !== undefined) {
    const p = String(body.provider).trim().toLowerCase();
    if (!LLM_PROVIDER_SETTINGS_PROVIDERS.includes(p)) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    updates.push(`provider = $${idx++}`);
    values.push(p);
  }
  if (body.model !== undefined) {
    const m = String(body.model).trim();
    if (!m) {
      sendJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    updates.push(`model = $${idx++}`);
    values.push(m);
  }
  if (body.base_url !== undefined) {
    updates.push(`base_url = $${idx++}`);
    values.push(
      body.base_url === null || body.base_url === ''
        ? null
        : String(body.base_url).trim()
    );
  }
  if (body.is_enabled !== undefined) {
    updates.push(`is_enabled = $${idx++}`);
    values.push(Boolean(body.is_enabled));
  }
  if (body.is_individual_override !== undefined) {
    updates.push(`is_individual_override = $${idx++}`);
    values.push(Boolean(body.is_individual_override));
  }
  if (typeof body.api_key === 'string' && body.api_key.trim()) {
    const enc = encryptLlmUserKey(body.api_key.trim());
    if (!enc) {
      sendJson(res, 500, { error: 'encryption_unavailable' });
      return;
    }
    updates.push(`api_key_encrypted = $${idx++}`);
    values.push(enc);
  }

  if (updates.length === 0) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  updates.push('updated_at = now()');
  values.push(id, user.id);

  try {
    const result = await db.query(
      `UPDATE llm_provider_settings SET ${updates.join(', ')}
       WHERE id = $${idx} AND user_id = $${idx + 1}
       RETURNING id, user_id, purpose, provider, model, base_url, is_enabled, created_at, updated_at`,
      values
    );
    if (result.rows.length === 0) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    sendJson(res, 200, { setting: result.rows[0] });
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 501, { error: 'provider_settings_unavailable' });
      return;
    }
    console.error('PATCH /api/llm/provider-settings/:id failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/llm/provider-settings/:id', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const id = req.params.id;
  if (!id || !isUuid(id)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  try {
    const result = await db.query(
      'DELETE FROM llm_provider_settings WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, user.id]
    );
    if (result.rows.length === 0) {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    sendNoContent(res);
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 501, { error: 'provider_settings_unavailable' });
      return;
    }
    console.error('DELETE /api/llm/provider-settings/:id failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

// ---- LLM API keys (per user, per provider) ----
const LLM_API_KEYS_PROVIDERS = ['anthropic', 'openai', 'deepseek', 'groq', 'qwen', 'custom'];

app.get('/api/llm/api-keys', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  try {
    const result = await db.query(
      `SELECT provider FROM llm_user_api_keys WHERE user_id = $1`,
      [user.id]
    );
    const configured = new Set(result.rows.map((r) => r.provider));
    const keys = LLM_API_KEYS_PROVIDERS.map((p) => ({ provider: p, has_key: configured.has(p) }));
    sendJson(res, 200, { keys });
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 501, { error: 'api_keys_unavailable' });
      return;
    }
    console.error('GET /api/llm/api-keys failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.post('/api/llm/api-keys', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const body = req.body || {};
  const provider =
    typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : null;
  const baseUrl =
    typeof body.base_url === 'string' ? body.base_url.trim() || null : null;

  if (!LLM_API_KEYS_PROVIDERS.includes(provider)) {
    sendJson(res, 400, { error: 'invalid_payload', message: 'Invalid provider' });
    return;
  }
  if (!apiKey) {
    sendJson(res, 400, { error: 'invalid_payload', message: 'api_key required' });
    return;
  }
  if (provider === 'custom' && !baseUrl) {
    sendJson(res, 400, { error: 'invalid_payload', message: 'base_url required for custom' });
    return;
  }

  const enc = encryptLlmUserKey(apiKey);
  if (!enc) {
    sendJson(res, 500, { error: 'encryption_unavailable' });
    return;
  }

  try {
    await db.query(
      `INSERT INTO llm_user_api_keys (user_id, provider, api_key_encrypted, base_url, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, provider) DO UPDATE SET
         api_key_encrypted = EXCLUDED.api_key_encrypted,
         base_url = EXCLUDED.base_url,
         updated_at = now()`,
      [user.id, provider, enc, baseUrl]
    );
    sendJson(res, 201, { ok: true, provider });
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 501, { error: 'api_keys_unavailable' });
      return;
    }
    console.error('POST /api/llm/api-keys failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/llm/api-keys/:provider', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const provider =
    typeof req.params.provider === 'string'
      ? req.params.provider.trim().toLowerCase()
      : '';

  if (!LLM_API_KEYS_PROVIDERS.includes(provider)) {
    sendJson(res, 400, { error: 'invalid_payload', message: 'Invalid provider' });
    return;
  }

  try {
    const result = await db.query(
      `DELETE FROM llm_user_api_keys WHERE user_id = $1 AND provider = $2 RETURNING id`,
      [user.id, provider]
    );
    sendJson(res, 200, { ok: true, deleted: result.rowCount > 0 });
  } catch (err) {
    if (err.code === '42P01') {
      sendJson(res, 501, { error: 'api_keys_unavailable' });
      return;
    }
    console.error('DELETE /api/llm/api-keys/:provider failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.get('/api/llm/usage', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 500);
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

  try {
    const rowsResult = await db.query(
      `SELECT id, project_id, purpose, provider, model, request_meta, response_meta,
              input_tokens, output_tokens, cost_estimate_usd, status, error_code, created_at
       FROM llm_requests
       WHERE actor_user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [user.id, limit, offset]
    );
    const summaryResult = await db.query(
      `SELECT
         COUNT(*) AS total_requests,
         COUNT(*) FILTER (WHERE status = 'ok') AS ok_count,
         COUNT(*) FILTER (WHERE status = 'error') AS error_count,
         COALESCE(SUM(input_tokens), 0)::bigint AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS total_output_tokens,
         COALESCE(SUM(cost_estimate_usd), 0)::numeric AS total_cost_usd
       FROM llm_requests WHERE actor_user_id = $1`,
      [user.id]
    );
    const byModelResult = await db.query(
      `SELECT provider, model,
         COUNT(*) AS count,
         COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
         COALESCE(SUM(cost_estimate_usd), 0)::numeric AS cost_usd
       FROM llm_requests WHERE actor_user_id = $1
       GROUP BY provider, model ORDER BY count DESC, provider, model`,
      [user.id]
    );
    const byPurposeResult = await db.query(
      `SELECT purpose,
         COUNT(*) AS count,
         COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
         COALESCE(SUM(cost_estimate_usd), 0)::numeric AS cost_usd
       FROM llm_requests WHERE actor_user_id = $1
       GROUP BY purpose ORDER BY count DESC`,
      [user.id]
    );

    const summary = summaryResult.rows[0] || {};
    sendJson(res, 200, {
      rows: rowsResult.rows.map((r) => ({
        id: r.id,
        project_id: r.project_id,
        purpose: r.purpose,
        provider: r.provider,
        model: r.model,
        request_meta: r.request_meta,
        response_meta: r.response_meta,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cost_estimate_usd: r.cost_estimate_usd != null ? String(r.cost_estimate_usd) : null,
        status: r.status,
        error_code: r.error_code,
        created_at: r.created_at,
      })),
      summary: {
        total_requests: parseInt(summary.total_requests, 10) || 0,
        ok_count: parseInt(summary.ok_count, 10) || 0,
        error_count: parseInt(summary.error_count, 10) || 0,
        total_input_tokens: parseInt(summary.total_input_tokens, 10) || 0,
        total_output_tokens: parseInt(summary.total_output_tokens, 10) || 0,
        total_cost_usd: summary.total_cost_usd != null ? String(summary.total_cost_usd) : '0',
      },
      by_model: byModelResult.rows.map((r) => ({
        provider: r.provider,
        model: r.model,
        count: parseInt(r.count, 10),
        input_tokens: parseInt(r.input_tokens, 10) || 0,
        output_tokens: parseInt(r.output_tokens, 10) || 0,
        cost_usd: r.cost_usd != null ? String(r.cost_usd) : '0',
      })),
      by_purpose: byPurposeResult.rows.map((r) => ({
        purpose: r.purpose,
        count: parseInt(r.count, 10),
        input_tokens: parseInt(r.input_tokens, 10) || 0,
        output_tokens: parseInt(r.output_tokens, 10) || 0,
        cost_usd: r.cost_usd != null ? String(r.cost_usd) : '0',
      })),
    });
  } catch (err) {
    console.error('GET /api/llm/usage failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/llm/usage', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  try {
    const result = await db.query(
      'DELETE FROM llm_requests WHERE actor_user_id = $1 RETURNING id',
      [user.id]
    );
    sendJson(res, 200, { deleted: result.rowCount || 0 });
  } catch (err) {
    console.error('DELETE /api/llm/usage failed:', err.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.get('/api/llm/models', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) {
    return;
  }

  const requestedProvider =
    typeof req.query.provider === 'string'
      ? req.query.provider.trim().toLowerCase()
      : '';
  const provider = requestedProvider || LLM_DEFAULT_PROVIDER;
  if (!LLM_API_KEYS_PROVIDERS.includes(provider)) {
    sendJson(res, 400, { error: 'invalid_payload' });
    return;
  }

  const keyRow = await getLlmApiKeyForProvider(user.id, provider);
  if (!keyRow || !keyRow.api_key) {
    sendJson(res, 200, { provider, models: [] });
    return;
  }

  try {
    const result = await fetchModelsFromProvider(
      provider,
      keyRow.api_key,
      keyRow.base_url || ''
    );
    if (result.error) {
      sendJson(res, 200, { provider, models: [], error: result.error });
      return;
    }
    sendJson(res, 200, { provider, models: result.models || [] });
  } catch (err) {
    console.error('GET /api/llm/models fetch failed:', err.message);
    sendJson(res, 200, { provider, models: [], error: 'request_failed' });
  }
});

app.post('/api/llm/models/list', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const body = req.body || {};
  const provider =
    typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : (typeof body.api_key === 'string' ? body.api_key.trim() : '');
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';

  if (!provider || !apiKey) {
    sendJson(res, 400, { error: 'invalid_payload', message: 'provider and apiKey required' });
    return;
  }

  try {
    const result = await fetchModelsFromProvider(provider, apiKey, baseUrl);
    if (result.error) {
      sendJson(res, 200, { error: result.error });
      return;
    }
    sendJson(res, 200, { models: result.models || [] });
  } catch (err) {
    console.error('POST /api/llm/models/list failed:', err.message);
    sendJson(res, 200, { error: 'request_failed' });
  }
});

app.post('/api/llm/chat', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
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

  let resolved = null;
  let userSetting = null;
  const payloadHasExplicitProvider = parsed.value.provider && parsed.value.model;
  if (payloadHasExplicitProvider) {
    resolved = resolveLlmProviderAndModel(parsed.value);
    if (resolved.error) {
      sendJson(res, 400, { error: resolved.error });
      return;
    }
  }
  if (!resolved) {
    const userSettingRow = await getLlmUserSettingForPurpose(user.id, parsed.value.purpose);
    if (userSettingRow && userSettingRow.model) {
      const prov = (userSettingRow.provider || '').toLowerCase();
      const hasKey = Boolean(userSettingRow.api_key && userSettingRow.api_key.trim());
      if (hasKey) {
        userSetting = userSettingRow;
        resolved = { value: { provider: prov, model: userSettingRow.model } };
      }
    }
  }
  if (!resolved) {
    resolved = resolveLlmProviderAndModel(parsed.value);
    if (resolved.error) {
      sendJson(res, 400, { error: resolved.error });
      return;
    }
  }
  if (userSetting && resolved.value.model !== userSetting.model) {
    resolved.value.model = userSetting.model;
  }
  // When no purpose-based setting, try api-keys table for resolved provider
  if (!userSetting) {
    const keyRow = await getLlmApiKeyForProvider(user.id, resolved.value.provider);
    if (keyRow) {
      userSetting = { api_key: keyRow.api_key, base_url: keyRow.base_url };
    }
  }

  const provider = resolved.value.provider;
  const startedAt = Date.now();
  const messageMeta = getLlmMessageMeta(parsed.value.messages);

  if (parsed.value.stream === true) {
    if (!(userSetting && userSetting.api_key)) {
      sendJson(res, 502, { error: 'llm_unavailable', hint: 'missing_api_key' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();

    let fullText = '';
    let lastUsage = null;
    let streamErr = null;

    try {
      if (provider === 'anthropic') {
        const anthropicRequest = buildAnthropicRequest(parsed.value, resolved.value.model);
        if (anthropicRequest.error) {
          res.write(sseLine({ type: 'error', error: anthropicRequest.error }));
          res.end();
          return;
        }
        const requestOptions = {
          apiKey: userSetting.api_key,
          baseUrl: userSetting.base_url || undefined,
        };
        for await (const ev of streamAnthropicLlm(anthropicRequest.value, requestOptions)) {
          if (ev.type === 'delta' && ev.text) {
            fullText += ev.text;
            res.write(sseLine({ type: 'delta', text: ev.text }));
          } else if (ev.type === 'done' && ev.usage) {
            lastUsage = ev.usage;
          }
        }
      } else {
        const openAiBody = {
          messages: parsed.value.messages,
          params: parsed.value.params || {},
        };
        for await (const ev of streamOpenAiCompatibleLlm(openAiBody, resolved.value, userSetting)) {
          if (ev.type === 'delta' && ev.text) {
            fullText += ev.text;
            res.write(sseLine({ type: 'delta', text: ev.text }));
          } else if (ev.type === 'done' && ev.usage) {
            lastUsage = ev.usage;
          }
        }
      }
    } catch (err) {
      streamErr = err;
      const hint = isAppError(err) ? (err.hint || 'provider_error') : 'provider_error';
      res.write(sseLine({ type: 'error', error: 'llm_unavailable', hint }));
    }

    const inputTokens = lastUsage
      ? (Number.isInteger(lastUsage.input_tokens) ? lastUsage.input_tokens : Number.isInteger(lastUsage.prompt_tokens) ? lastUsage.prompt_tokens : null)
      : null;
    const outputTokens = lastUsage
      ? (Number.isInteger(lastUsage.output_tokens) ? lastUsage.output_tokens : Number.isInteger(lastUsage.completion_tokens) ? lastUsage.completion_tokens : null)
      : null;
    const costEstimateUsd = estimateLlmCostUsd(provider, resolved.value.model, inputTokens, outputTokens || 0);

    let requestId = null;
    if (!streamErr) {
      try {
        requestId = await writeLlmRequest({
          projectId: parsed.value.project_id || null,
          actorUserId: user.id,
          purpose: parsed.value.purpose,
          provider,
          model: resolved.value.model,
          requestMeta: { ...messageMeta, params: parsed.value.params || {}, worker_used: false },
          responseMeta: {
            worker_used: false,
            latency_ms: Date.now() - startedAt,
            provider_http_status: 200,
            response_id: null,
            stop_reason: null,
          },
          inputTokens,
          outputTokens,
          costEstimateUsd,
          status: 'ok',
          errorCode: null,
        });
      } catch (auditErr) {
        console.error('LLM stream audit write failed:', auditErr.message);
      }
    }

    const usage = {};
    if (inputTokens != null) usage.input_tokens = inputTokens;
    if (outputTokens != null) usage.output_tokens = outputTokens;
    res.write(sseLine({
      type: 'done',
      text: fullText,
      provider,
      model: resolved.value.model,
      usage,
      request_id: requestId,
    }));
    res.end();
    return;
  }

  if (provider !== 'anthropic') {
    const openAiResult = await sendOpenAiCompatibleChat(parsed.value, resolved.value, userSetting);
    if (openAiResult.error) {
      sendJson(res, openAiResult.statusCode || 502, { error: openAiResult.error });
      return;
    }
    const inputTokens = openAiResult.inputTokens;
    const outputTokens = openAiResult.outputTokens;
    const costEstimateUsd = estimateLlmCostUsd(provider, resolved.value.model, inputTokens, outputTokens);
    const requestMeta = { ...messageMeta, params: parsed.value.params || {}, worker_used: false };
    const responseMeta = {
      worker_used: false,
      latency_ms: Date.now() - startedAt,
      provider_http_status: openAiResult.statusCode || 200,
      response_id: openAiResult.responseId || null,
      stop_reason: openAiResult.stopReason || null,
    };
    let requestId;
    try {
      requestId = await writeLlmRequest({
        projectId: parsed.value.project_id || null,
        actorUserId: user.id,
        purpose: parsed.value.purpose,
        provider,
        model: resolved.value.model,
        requestMeta,
        responseMeta,
        inputTokens: inputTokens ?? null,
        outputTokens: outputTokens ?? null,
        costEstimateUsd: costEstimateUsd,
        status: 'ok',
        errorCode: null,
      });
    } catch (err) {
      console.error('LLM request audit write failed:', err.message);
      sendJson(res, 500, { error: 'internal_error' });
      return;
    }
    const usage = {};
    if (inputTokens != null) usage.input_tokens = inputTokens;
    if (outputTokens != null) usage.output_tokens = outputTokens;
    sendJson(res, 200, {
      text: openAiResult.text || '',
      provider,
      model: resolved.value.model,
      usage,
      request_id: requestId,
    });
    return;
  }

  const anthropicRequest = buildAnthropicRequest(parsed.value, resolved.value.model);
  if (anthropicRequest.error) {
    sendJson(res, 400, { error: anthropicRequest.error });
    return;
  }

  const requestMeta = {
    ...messageMeta,
    params: {
      max_tokens: anthropicRequest.value.max_tokens ?? anthropicRequest.value.max_completion_tokens,
      ...(anthropicRequest.value.temperature !== undefined
        ? { temperature: anthropicRequest.value.temperature }
        : {}),
    },
    worker_used: Boolean(CLOUDFLARE_WORKER_URL),
  };

  let providerStatusCode = null;
  let workerUsed = Boolean(CLOUDFLARE_WORKER_URL);

  if (!(userSetting && userSetting.api_key)) {
    const responseMeta = {
      worker_used: workerUsed,
      latency_ms: Date.now() - startedAt,
      provider_http_status: null,
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

    sendJson(res, 502, {
      error: 'llm_unavailable',
      hint: 'missing_api_key',
    });
    return;
  }

  try {
    const requestOptions = userSetting && userSetting.api_key
      ? {
          apiKey: userSetting.api_key,
          baseUrl: userSetting.base_url || undefined,
        }
      : undefined;
    const providerResult = await sendAnthropicRequest(
      anthropicRequest.value,
      requestOptions
    );
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

      sendJson(res, 502, {
        error: 'llm_unavailable',
        hint: 'provider_error',
      });
      return;
    }

    const text = extractAnthropicText(providerResult.body);
    const costEstimateUsd = estimateLlmCostUsd(
      resolved.value.provider,
      resolved.value.model,
      inputTokens,
      outputTokens
    );
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
        costEstimateUsd: costEstimateUsd,
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
      sendJson(res, 502, {
        error: 'llm_unavailable',
        hint: error.hint || 'provider_error',
      });
      return;
    }

    console.error('POST /api/llm/chat failed:', error.message);
    if (isDevelopment() && error.stack) {
      console.error(error.stack);
    }
    const payload = { error: 'internal_error' };
    if (isDevelopment() && error && typeof error.message === 'string' && error.message.length < 300) {
      payload.message = error.message;
    }
    sendJson(res, 500, payload);
  }
});

app.post('/api/llm/settings/test', async (req, res) => {
  const user = requireAuth(req, res, LLM_ROLES);
  if (!user) return;

  const body = req.body || {};
  const provider =
    typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const model = typeof body.model === 'string' ? body.model.trim() : '';
  const apiKey =
    typeof body.apiKey === 'string'
      ? body.apiKey.trim()
      : typeof body.api_key === 'string'
        ? body.api_key.trim()
        : '';
  const baseUrl =
    typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : '';

  const allowed = ['anthropic', 'openai', 'deepseek', 'groq', 'qwen', 'custom'];
  if (!provider || !allowed.includes(provider)) {
    sendJson(res, 400, { ok: false, error: 'Недопустимый провайдер' });
    return;
  }
  if (!model) {
    sendJson(res, 400, { ok: false, error: 'Укажите модель' });
    return;
  }
  if (!apiKey) {
    sendJson(res, 400, { ok: false, error: 'Укажите API-ключ' });
    return;
  }
  const hasNonAscii = /[^\x00-\x7F]/.test(apiKey);
  if (hasNonAscii) {
    sendJson(res, 400, { ok: false, error: 'API-ключ содержит недопустимые символы. Скопируйте ключ заново, убедитесь что не попали лишние символы.' });
    return;
  }
  if (provider === 'custom' && !baseUrl) {
    sendJson(res, 400, { ok: false, error: 'Для custom укажите baseUrl' });
    return;
  }

  const getDefaultBase = () => {
    switch (provider) {
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'openai':
        return 'https://api.openai.com';
      case 'deepseek':
        return 'https://api.deepseek.com';
      case 'groq':
        return 'https://api.groq.com/openai';
      case 'qwen':
        return 'https://dashscope.aliyuncs.com/compatible-mode';
      default:
        return baseUrl || '';
    }
  };
  const base = baseUrl || getDefaultBase();
  if (!base) {
    sendJson(res, 400, { ok: false, error: 'Не задан baseUrl' });
    return;
  }

  const isAnthropicNative =
    provider === 'anthropic' &&
    (!baseUrl || base === 'https://api.anthropic.com');
  const isOpenAiCompatible =
    ['openai', 'deepseek', 'groq', 'qwen', 'custom'].includes(provider) || !isAnthropicNative;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    if (isAnthropicNative) {
      const endpoint = `${base}/v1/messages`;
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify((() => {
          const b = { model, messages: [{ role: 'user', content: 'Say hi' }] };
          b[getMaxTokensParamName(provider)] = 5;
          return b;
        })()),
      });
      clearTimeout(timeout);
      const data = await readJsonSafely(response);
      if (!response.ok) {
        const errMsg =
          data && data.error && typeof data.error.message === 'string'
            ? data.error.message
            : data && typeof data.error === 'string'
              ? data.error
              : `HTTP ${response.status}`;
        sendJson(res, 200, { ok: false, error: errMsg });
        return;
      }
      sendJson(res, 200, { ok: true, model });
      return;
    }

    if (isOpenAiCompatible) {
      const endpoint = `${base}/v1/chat/completions`;
      const body = { model, messages: [{ role: 'user', content: 'Say hi' }] };
      body[getMaxTokensParamName(provider)] = 5;
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timeout);
      const data = await readJsonSafely(response);
      if (!response.ok) {
        const errMsg =
          data && data.error && typeof data.error.message === 'string'
            ? data.error.message
            : data && data.error && typeof data.error === 'object' && typeof data.error.message === 'string'
              ? data.error.message
              : data && typeof data.error === 'string'
                ? data.error
                : `HTTP ${response.status}`;
        sendJson(res, 200, { ok: false, error: errMsg });
        return;
      }
      sendJson(res, 200, { ok: true, model });
    }
  } catch (err) {
    clearTimeout(timeout);
    const msg = err.name === 'AbortError' ? 'Таймаут запроса' : (err.message || 'Ошибка запроса');
    sendJson(res, 200, { ok: false, error: msg });
  }
});

// ── Assignable users (for project responsible selection) ─────────────

app.get('/api/assignable-users', async (req, res) => {
  const user = requireAuth(req, res, PROJECT_WRITE_ROLES);
  if (!user) return;
  try {
    const result = await db.query(
      `SELECT id, email FROM users WHERE status = 'active' ORDER BY email ASC`
    );
    sendJson(res, 200, { users: result.rows });
  } catch (error) {
    console.error('GET /api/assignable-users failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

// ── Admin: User management ──────────────────────────────────────────

app.get('/api/admin/users', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  try {
    const result = await db.query(
      `SELECT id, email, role, status, created_at, updated_at FROM users ORDER BY created_at ASC`
    );
    sendJson(res, 200, { users: result.rows });
  } catch (error) {
    console.error('GET /api/admin/users failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.post('/api/admin/users', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  const { email, password, role } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    sendJson(res, 400, { error: 'invalid_email' }); return;
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    sendJson(res, 400, { error: 'password_too_short' }); return;
  }
  const validRoles = ['admin', 'manager'];
  if (!role || !validRoles.includes(role)) {
    sendJson(res, 400, { error: 'invalid_role' }); return;
  }
  try {
    const exists = await db.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (exists.rowCount > 0) {
      sendJson(res, 409, { error: 'email_already_exists' }); return;
    }
    const passwordHash = hashPassword(password);
    const result = await db.query(
      `INSERT INTO users (email, password_hash, role, status) VALUES ($1, $2, $3, 'active') RETURNING id, email, role, status, created_at`,
      [email.trim().toLowerCase(), passwordHash, role]
    );
    sendJson(res, 201, { user: result.rows[0] });
  } catch (error) {
    console.error('POST /api/admin/users failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.patch('/api/admin/users/:id', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  const { id } = req.params;
  if (!isUuid(id)) { sendJson(res, 400, { error: 'invalid_user_id' }); return; }
  const { email, role, status, password } = req.body || {};
  try {
    const existing = await db.query('SELECT id, email, role FROM users WHERE id = $1', [id]);
    if (existing.rowCount === 0) { sendJson(res, 404, { error: 'user_not_found' }); return; }
    const sets = [];
    const vals = [];
    if (email && typeof email === 'string' && email.includes('@')) {
      sets.push(`email = $${vals.push(email.trim().toLowerCase())}`);
    }
    const validRoles = ['admin', 'manager'];
    if (role && validRoles.includes(role)) {
      sets.push(`role = $${vals.push(role)}`);
    }
    if (status && ['active', 'disabled'].includes(status)) {
      sets.push(`status = $${vals.push(status)}`);
    }
    if (password && typeof password === 'string' && password.length >= 6) {
      sets.push(`password_hash = $${vals.push(hashPassword(password))}`);
    }
    if (sets.length === 0) { sendJson(res, 400, { error: 'nothing_to_update' }); return; }
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const result = await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, email, role, status, created_at, updated_at`,
      vals
    );
    sendJson(res, 200, { user: result.rows[0] });
  } catch (error) {
    console.error('PATCH /api/admin/users/:id failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.post('/api/admin/users/:id/transfer', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  const { id } = req.params;
  const { target_user_id } = req.body || {};
  if (!isUuid(id) || !isUuid(target_user_id)) {
    sendJson(res, 400, { error: 'invalid_user_id' }); return;
  }
  if (id === target_user_id) {
    sendJson(res, 400, { error: 'cannot_transfer_to_self' }); return;
  }
  try {
    const source = await db.query('SELECT id FROM users WHERE id = $1', [id]);
    const target = await db.query('SELECT id FROM users WHERE id = $1', [target_user_id]);
    if (source.rowCount === 0) { sendJson(res, 404, { error: 'source_user_not_found' }); return; }
    if (target.rowCount === 0) { sendJson(res, 404, { error: 'target_user_not_found' }); return; }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE projects SET responsible_user_id = $1 WHERE responsible_user_id = $2', [target_user_id, id]);
      await client.query('UPDATE projects SET created_by = $1 WHERE created_by = $2', [target_user_id, id]);
      await client.query('UPDATE tasks SET assignee_user_id = $1 WHERE assignee_user_id = $2', [target_user_id, id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('POST /api/admin/users/:id/transfer failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  const { id } = req.params;
  if (!isUuid(id)) { sendJson(res, 400, { error: 'invalid_user_id' }); return; }
  if (id === user.id) { sendJson(res, 400, { error: 'cannot_delete_self' }); return; }
  try {
    const existing = await db.query('SELECT id, email FROM users WHERE id = $1', [id]);
    if (existing.rowCount === 0) { sendJson(res, 404, { error: 'user_not_found' }); return; }
    const ownedProjects = await db.query('SELECT id FROM projects WHERE responsible_user_id = $1 OR created_by = $1 LIMIT 1', [id]);
    const ownedTasks = await db.query('SELECT id FROM tasks WHERE assignee_user_id = $1 LIMIT 1', [id]);
    if (ownedProjects.rowCount > 0 || ownedTasks.rowCount > 0) {
      sendJson(res, 409, { error: 'transfer_required', message: 'Transfer projects and tasks before deleting user' }); return;
    }
    await db.query('DELETE FROM user_active_projects WHERE user_id = $1', [id]);
    await db.query('DELETE FROM llm_provider_settings WHERE user_id = $1', [id]);
    await db.query('DELETE FROM users WHERE id = $1', [id]);
    sendJson(res, 200, { ok: true, deleted_user_id: id });
  } catch (error) {
    console.error('DELETE /api/admin/users/:id failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

// ── Admin: Assign project responsibility ─────────────────────────────

app.patch('/projects/:id/assign', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  const { id } = req.params;
  const { responsible_user_id } = req.body || {};
  if (!isUuid(id)) { sendJson(res, 400, { error: 'invalid_project_id' }); return; }
  if (responsible_user_id !== null && !isUuid(responsible_user_id)) {
    sendJson(res, 400, { error: 'invalid_user_id' }); return;
  }
  try {
    if (responsible_user_id) {
      const userExists = await db.query('SELECT id FROM users WHERE id = $1', [responsible_user_id]);
      if (userExists.rowCount === 0) { sendJson(res, 404, { error: 'user_not_found' }); return; }
    }
    const result = await db.query(
      `UPDATE projects SET responsible_user_id = $1, updated_at = NOW() WHERE id = $2
       RETURNING id, name, responsible_user_id, created_by, stages, stage_settings, created_at, updated_at`,
      [responsible_user_id, id]
    );
    if (result.rowCount === 0) { sendJson(res, 404, { error: 'project_not_found' }); return; }
    sendJson(res, 200, { project: result.rows[0] });
  } catch (error) {
    console.error('PATCH /projects/:id/assign failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

// ── Admin: Data deletion endpoints ───────────────────────────────────

app.delete('/api/admin/data/events', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  try {
    await db.query('DELETE FROM task_events');
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/data/events failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/admin/data/trash', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  try {
    await ensureTaskTrashStorage();
    await db.query('DELETE FROM task_trash');
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/data/trash failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/admin/data/llm-stats', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  try {
    await db.query('DELETE FROM llm_requests');
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/data/llm-stats failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/admin/data/projects', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM task_chats');
      await client.query('DELETE FROM task_events');
      await client.query('DELETE FROM task_trash');
      await client.query('DELETE FROM import_events');
      await client.query('DELETE FROM import_jobs');
      await client.query('DELETE FROM project_timers');
      await client.query('DELETE FROM user_active_projects');
      await client.query('DELETE FROM tasks');
      await client.query('DELETE FROM projects');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/data/projects failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/admin/data/all-stats', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM task_events');
      await client.query('DELETE FROM task_trash');
      await client.query('DELETE FROM llm_requests');
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/data/all-stats failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

app.delete('/api/admin/account', async (req, res) => {
  const user = requireAuth(req, res, ADMIN_ONLY);
  if (!user) return;
  const { confirm_email } = req.body || {};
  if (!confirm_email || confirm_email !== user.email) {
    sendJson(res, 400, { error: 'confirmation_mismatch', message: 'Type your email to confirm account deletion' });
    return;
  }
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM user_active_projects WHERE user_id = $1', [user.id]);
      await client.query('DELETE FROM llm_provider_settings WHERE user_id = $1', [user.id]);
      await client.query('UPDATE projects SET responsible_user_id = NULL WHERE responsible_user_id = $1', [user.id]);
      await client.query('UPDATE tasks SET assignee_user_id = NULL WHERE assignee_user_id = $1', [user.id]);
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('DELETE /api/admin/account failed:', error.message);
    sendJson(res, 500, { error: 'internal_error' });
  }
});

// ── Auth: Change own password ────────────────────────────────────────

app.post('/auth/change-password', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    sendJson(res, 400, { error: 'missing_fields' }); return;
  }
  if (typeof new_password !== 'string' || new_password.length < 6) {
    sendJson(res, 400, { error: 'password_too_short' }); return;
  }
  try {
    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (result.rowCount === 0) { sendJson(res, 404, { error: 'user_not_found' }); return; }
    if (!verifyPassword(current_password, result.rows[0].password_hash)) {
      sendJson(res, 403, { error: 'wrong_password' }); return;
    }
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashPassword(new_password), user.id]);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('POST /auth/change-password failed:', error.message);
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

async function refreshLlmPricingCache() {
  try {
    const result = await fetchAndStoreLlmPrices(db);
    if (result.error) {
      console.warn('[LLM] pricing fetch failed:', result.error);
    } else if (result.updated > 0) {
      console.log('[LLM] pricing updated:', result.updated, 'models');
    }
    const cache = await loadPricingCache(db);
    llmPricingCache = cache;
  } catch (err) {
    console.warn('[LLM] pricing refresh failed:', err.message);
  }
}

async function initLlmPricing() {
  try {
    llmPricingCache = await loadPricingCache(db);
    if (llmPricingCache.size === 0) {
      await refreshLlmPricingCache();
    }
  } catch (err) {
    console.warn('[LLM] pricing init failed (using fallback):', err.message);
  }
}

const LLM_PRICES_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

app.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log('[LLM] ANTHROPIC_API_KEY:', ANTHROPIC_API_KEY ? 'set' : 'not set');
  if (CLOUDFLARE_WORKER_URL) {
    console.log('[LLM] CLOUDFLARE_WORKER_URL: set (requests go to worker)');
  }
  logDbStartupDiagnostics();
  checkDbConnectivity().catch((error) => {
    console.error('[db] connectivity check failed unexpectedly: %s', error.message);
    if (error && error.stack) {
      console.error(error.stack);
    }
  });
  initLlmPricing().catch(() => {});
  setInterval(() => refreshLlmPricingCache().catch(() => {}), LLM_PRICES_REFRESH_INTERVAL_MS);

  const HISTORY_RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const rows = await db.query(
        'SELECT id, history_retention_months FROM projects WHERE history_retention_months IS NOT NULL'
      );
      for (const row of rows.rows || []) {
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - Number(row.history_retention_months || 3));
        await db.query(
          'DELETE FROM task_events WHERE project_id = $1 AND created_at < $2',
          [row.id, cutoff.toISOString()]
        );
      }
    } catch (err) {
      if (err.message && !/column.*does not exist/i.test(err.message)) {
        console.error('[history-retention] cleanup failed:', err.message);
      }
    }
  }, HISTORY_RETENTION_CLEANUP_INTERVAL_MS);
});
