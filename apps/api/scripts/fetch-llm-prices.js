#!/usr/bin/env node
'use strict';

/**
 * Загружает актуальные цены LLM из llm-prices.com в БД.
 * Запускать: npm run llm:prices:fetch
 * Рекомендуется: cron раз в сутки.
 */

const { Pool } = require('pg');
const { createDbConfigFromEnv } = require('../lib/db-config');
const { fetchAndStoreLlmPrices } = require('../lib/llm-pricing');

async function main() {
  const { config } = createDbConfigFromEnv(process.env);
  const pool = new Pool(config);

  try {
    const result = await fetchAndStoreLlmPrices(pool);
    if (result.error) {
      console.error('fetch-llm-prices failed:', result.error);
      process.exit(1);
    }
    console.log(`Updated ${result.updated} model prices from llm-prices.com`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
