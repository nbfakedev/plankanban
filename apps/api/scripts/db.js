const { Client } = require('pg');
const { createDbConfigFromEnv } = require('../lib/db-config');

function createClient() {
  const { config, source, missingEnvVars } = createDbConfigFromEnv(process.env);
  if (source === 'PG_ENV' && missingEnvVars.length > 0) {
    console.error('Missing DB env vars: %s', missingEnvVars.join(', '));
    throw new Error(
      'Database connection is not configured. Set DATABASE_URL or PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD.'
    );
  }

  return new Client(config);
}

module.exports = {
  createClient,
};
