'use strict';

/**
 * LLM pricing: загрузка актуальных цен из llm-prices.com,
 * хранение в БД, использование в estimateLlmCostUsd.
 * Обновление: при первом подключении API, ежедневно по cron.
 */

const LLM_PRICES_URL = 'https://www.llm-prices.com/current-v1.json';

/** vendor (llm-prices) -> provider (наш) */
const VENDOR_TO_PROVIDER = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  deepseek: 'deepseek',
  groq: 'groq',
  qwen: 'qwen',
  mistral: 'mistral',
  xai: 'xai',
  amazon: 'amazon',
  minimax: 'minimax',
  'moonshot-ai': 'moonshot',
};

/** Fallback: провайдер -> { input, output } $/1M. Используется если в БД нет. */
const FALLBACK_PRICES = {
  anthropic: { opus: [15, 75], sonnet: [3, 15], default: [1, 5] },
  openai: {
    'gpt-5': [1.75, 14],
    'gpt-5.2': [1.75, 14],
    'gpt-4o': [2.5, 10],
    'gpt-4': [10, 30],
    default: [0.5, 1.5],
  },
  deepseek: { default: [0.14, 0.28] },
  groq: { default: [0.05, 0.08] },
  qwen: { default: [0.002, 0.006] },
  google: { default: [0.075, 0.3] },
};

/** Нормализует model для сопоставления с model_id из справочника. */
function normalizeModelForLookup(model) {
  if (!model || typeof model !== 'string') return '';
  let m = model.trim().toLowerCase().replace(/_/g, '.');
  m = m.replace(/-[0-9]{4}(-[0-9]{2}){0,2}$/, ''); // убрать суффикс -2025-12-11
  return m;
}

/** model_id совпадает если exact или model_id — префикс modelNormalized (наша модель уточняет). */
function matchModel(modelNormalized, modelId) {
  if (!modelNormalized || !modelId) return false;
  if (modelNormalized === modelId) return true;
  if (modelNormalized.startsWith(modelId)) return true;
  return false;
}

/**
 * Загружает цены из llm-prices.com и сохраняет в БД.
 * @param {object} db - pg Pool или Client
 * @returns {Promise<{ updated: number, error?: string }>}
 */
async function fetchAndStoreLlmPrices(db) {
  try {
    const res = await fetch(LLM_PRICES_URL);
    if (!res.ok) {
      return { updated: 0, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const prices = Array.isArray(data.prices) ? data.prices : [];
    const now = new Date().toISOString();
    let updated = 0;

    for (const p of prices) {
      const provider = VENDOR_TO_PROVIDER[(p.vendor || '').toLowerCase()];
      if (!provider) continue;

      const input = Number(p.input);
      const output = Number(p.output);
      if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;

      const modelId = String(p.id || '').trim().toLowerCase();
      if (!modelId) continue;

      const inputCached = p.input_cached != null && Number.isFinite(Number(p.input_cached))
        ? Number(p.input_cached)
        : null;

      await db.query(
        `INSERT INTO llm_model_pricing (
          provider, model_id, model_display_name, input_price_per_1m, output_price_per_1m,
          input_cached_price_per_1m, source, fetched_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'llm-prices.com', $7, $7)
        ON CONFLICT (provider, model_id) DO UPDATE SET
          model_display_name = EXCLUDED.model_display_name,
          input_price_per_1m = EXCLUDED.input_price_per_1m,
          output_price_per_1m = EXCLUDED.output_price_per_1m,
          input_cached_price_per_1m = EXCLUDED.input_cached_price_per_1m,
          fetched_at = EXCLUDED.fetched_at,
          updated_at = EXCLUDED.updated_at`,
        [
          provider,
          modelId,
          (p.name && String(p.name).trim()) || null,
          input,
          output,
          inputCached,
          now,
        ]
      );
      updated++;
    }

    return { updated };
  } catch (err) {
    return { updated: 0, error: err.message || 'fetch failed' };
  }
}

/**
 * Загружает цены из БД в память.
 * @param {object} db
 * @returns {Promise<Map<string, { input: number, output: number }>>}
 */
async function loadPricingCache(db) {
  const cache = new Map();
  try {
    const rows = await db.query(
      `SELECT provider, model_id, input_price_per_1m, output_price_per_1m
       FROM llm_model_pricing
       WHERE input_price_per_1m IS NOT NULL AND output_price_per_1m IS NOT NULL`
    );
    for (const r of rows.rows || []) {
      const key = `${(r.provider || '').toLowerCase()}:${(r.model_id || '').toLowerCase()}`;
      cache.set(key, {
        input: Number(r.input_price_per_1m) || 0,
        output: Number(r.output_price_per_1m) || 0,
      });
    }
  } catch (_) {
    // таблица может не существовать
  }
  return cache;
}

/**
 * Получает цену из кэша по provider и model.
 * Выбирает наиболее специфичное совпадение (предпочитаем более длинный model_id).
 * @param {Map} cache
 * @param {string} provider
 * @param {string} model
 * @returns {{ input: number, output: number } | null}
 */
function getPriceFromCache(cache, provider, model) {
  if (!cache || !provider) return null;
  const p = (provider || '').toLowerCase();
  const mNorm = normalizeModelForLookup(model);
  if (!mNorm) return null;

  let best = null;
  let bestLen = 0;
  for (const [key, value] of cache) {
    const [cProvider, cModelId] = key.split(':');
    if (cProvider !== p) continue;
    if (!matchModel(mNorm, cModelId)) continue;
    if (cModelId.length > bestLen) {
      best = value;
      bestLen = cModelId.length;
    }
  }
  return best;
}

/**
 * Fallback цены если нет в кэше.
 */
function getFallbackPrice(provider, model) {
  const p = (provider || '').toLowerCase();
  const m = (model || '').toLowerCase();
  const defs = FALLBACK_PRICES[p];
  if (!defs) return null;

  if (p === 'openai') {
    if (m.includes('gpt-5') || m.includes('gpt_5')) return { input: 1.75, output: 14 };
    if (m.includes('gpt-4o') || m.includes('4o')) return { input: 2.5, output: 10 };
    if (m.includes('gpt-4')) return { input: 10, output: 30 };
  }
  if (p === 'anthropic') {
    if (m.includes('opus')) return { input: 15, output: 75 };
    if (m.includes('sonnet')) return { input: 3, output: 15 };
  }

  const d = defs.default || defs;
  return Array.isArray(d) ? { input: d[0], output: d[1] } : null;
}

module.exports = {
  fetchAndStoreLlmPrices,
  loadPricingCache,
  getPriceFromCache,
  getFallbackPrice,
  normalizeModelForLookup,
};
